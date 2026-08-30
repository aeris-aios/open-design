import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { optional, required } from "../storage/common.ts";
import { packCatalogSnapshot } from "./pack.ts";

function packageVersion(): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"),
    resolve(process.cwd(), "tools/release/package.json"),
  ];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next
    }
  }
  return "0.0.0";
}

function exporterVersion(): string {
  const version = packageVersion();
  let describe = "";
  try {
    describe = execFileSync("git", ["describe", "--always", "--dirty"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    describe = "";
  }
  return describe.length > 0 ? `tools-release@${version}+${describe}` : `tools-release@${version}`;
}

export async function packCatalogFromEnv(): Promise<void> {
  const stagingDir = resolve(required("CATALOG_STAGING_DIR"));
  const sourceCommit = required("CATALOG_SOURCE_COMMIT").toLowerCase();
  const result = packCatalogSnapshot({
    stagingDir,
    sourceCommit,
    exporterVersion: exporterVersion(),
  });
  console.log(`packed catalog bundle ${result.bundlePath}`);
  console.log(`bundleSha256=${result.bundleSha256}`);

  const githubOutput = optional("GITHUB_OUTPUT");
  if (githubOutput.length > 0) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      githubOutput,
      [`bundle_sha256=${result.bundleSha256}`, `staging_dir=${result.stagingDir}`].join("\n") + "\n",
      "utf8",
    );
  }
}
