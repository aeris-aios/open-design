import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { contentType, githubInfo, optional, publicUrl, required, storageConfigFromEnv } from "./common.ts";
import {
  resolveDshBootstrapVersion,
  updateDshBootstrapLatestPointer,
} from "./dsh-bootstrap-latest.ts";
import { getStorageObject, putStorageObjectWithStatus, type StorageConfig } from "./s3-upload.ts";

const BOOTSTRAP_FILES = ["install-dsh.cmd", "install-dsh.ps1", "install-dsh.sh"] as const;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type BootstrapObject = {
  body: Buffer;
  name: string;
};

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function versionPrefix(version: string): string {
  return `bootstrap/dsh/${version}`;
}

async function publishImmutableBootstrapObject(
  storage: StorageConfig,
  prefix: string,
  object: BootstrapObject,
): Promise<void> {
  const objectKey = `${prefix}/${object.name}`;
  const result = await putStorageObjectWithStatus({
    ...storage,
    body: object.body,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    contentType: contentType(object.name),
    headers: { "if-none-match": "*" },
    objectKey,
  });
  if (result.ok) return;
  if (result.status !== 412) {
    throw new Error(`PUT ${result.url} failed with HTTP ${result.status}${result.body.length > 0 ? `: ${result.body}` : ""}`);
  }

  const existing = await getStorageObject({ ...storage, objectKey });
  if (existing == null) {
    throw new Error(`bootstrap object disappeared after immutable PUT conflict: ${objectKey}`);
  }
  if (!existing.bytes.equals(object.body)) {
    throw new Error(`immutable bootstrap object already exists with different content: ${objectKey}`);
  }
  console.log(`reused identical immutable bootstrap object ${objectKey}`);
}

const pinnedVersion = optional("DSH_BOOTSTRAP_VERSION");
if (pinnedVersion.length > 0 && !/^v[1-9]\d*$/.test(pinnedVersion)) {
  throw new Error(`DSH_BOOTSTRAP_VERSION must look like v1 or v2; got ${pinnedVersion}`);
}

const sourceDir = required("DSH_BOOTSTRAP_SOURCE_DIR");
const publicOrigin = required("RELEASE_PUBLIC_ORIGIN");
const storage = storageConfigFromEnv();
const installers = BOOTSTRAP_FILES.map((name) => ({
  body: readFileSync(join(sourceDir, name)),
  name,
}));
const checksums = Buffer.from(
  installers.map(({ body, name }) => `${sha256(body)}  ${name}`).join("\n") + "\n",
  "utf8",
);
const objects: BootstrapObject[] = [...installers, { body: checksums, name: "SHA256SUMS" }];

// An explicit pin stays fail-closed: it is the escape hatch for forcing a
// specific version, and it must never silently overwrite different bytes.
const version = pinnedVersion.length > 0
  ? pinnedVersion
  : await resolveDshBootstrapVersion(storage, checksums);
const prefix = versionPrefix(version);

for (const object of objects) {
  await publishImmutableBootstrapObject(storage, prefix, object);
}

for (const object of objects) {
  const objectKey = `${prefix}/${object.name}`;
  const published = await getStorageObject({ ...storage, objectKey });
  if (published == null || !published.bytes.equals(object.body)) {
    throw new Error(`published bootstrap object failed byte-for-byte verification: ${objectKey}`);
  }
  console.log(publicUrl(publicOrigin, prefix, object.name));
}

// Mutable pointer so consumers and the deploy workflow can find the current
// version without hard-coding it. Only move it forward: an older workflow
// rerun can reuse an earlier immutable version but must never rewind latest.
await updateDshBootstrapLatestPointer(storage, {
  files: Object.fromEntries(installers.map(({ body, name }) => [name, sha256(body)])),
  github: githubInfo(),
  publishedAt: new Date().toISOString(),
  version,
});
console.log(publicUrl(publicOrigin, "bootstrap/dsh", "latest.json"));

const githubOutput = optional("GITHUB_OUTPUT");
if (githubOutput.length > 0) {
  appendFileSync(githubOutput, `version=${version}\n`, "utf8");
}
