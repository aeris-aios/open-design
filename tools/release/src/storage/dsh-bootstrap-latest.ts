import { contentType } from "./common.ts";
import { getStorageObject, putStorageObjectWithStatus, type StorageConfig } from "./s3-upload.ts";

const POINTER_CACHE_CONTROL = "public, max-age=60";
export const DSH_BOOTSTRAP_POINTER_KEY = "bootstrap/dsh/latest.json";

export type DshBootstrapLatestPointer = {
  files: Record<string, string>;
  github: Record<string, unknown>;
  publishedAt: string;
  version: string;
};

function versionNumber(version: string): number {
  const match = /^v([1-9]\d*)$/.exec(version);
  if (match == null) {
    throw new Error(`DeepSeek Harness bootstrap version must look like v1 or v2; got ${version}`);
  }
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`DeepSeek Harness bootstrap version is too large: ${version}`);
  }
  return number;
}

function parseLatestPointer(text: string): DshBootstrapLatestPointer {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(
      `DeepSeek Harness bootstrap latest pointer is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value == null || typeof value !== "object") {
    throw new Error("DeepSeek Harness bootstrap latest pointer must be an object");
  }
  const pointer = value as DshBootstrapLatestPointer;
  versionNumber(pointer.version);
  return pointer;
}

/**
 * Move latest.json forward by immutable bootstrap version. The conditional PUT
 * prevents concurrent publishers from winning with a stale read, while the
 * version comparison prevents a rerun that reused older installer bytes from
 * rewinding the pointer after a newer version has shipped.
 */
export async function updateDshBootstrapLatestPointer(
  storage: StorageConfig,
  pointer: DshBootstrapLatestPointer,
): Promise<boolean> {
  const candidateVersion = versionNumber(pointer.version);
  const body = Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`, "utf8");

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const currentObject = await getStorageObject({
      ...storage,
      objectKey: DSH_BOOTSTRAP_POINTER_KEY,
    });
    const headers: Record<string, string> = {};
    if (currentObject == null) {
      headers["if-none-match"] = "*";
    } else {
      const current = parseLatestPointer(currentObject.text);
      if (versionNumber(current.version) >= candidateVersion) {
        return false;
      }
      if (!currentObject.etag) {
        throw new Error(
          "DeepSeek Harness bootstrap latest pointer GET did not return an ETag for CAS update",
        );
      }
      headers["if-match"] = currentObject.etag;
    }

    const result = await putStorageObjectWithStatus({
      ...storage,
      body,
      cacheControl: POINTER_CACHE_CONTROL,
      contentType: contentType("latest.json"),
      headers,
      objectKey: DSH_BOOTSTRAP_POINTER_KEY,
    });
    if (result.ok) return true;
    if (result.status !== 412) {
      throw new Error(
        `DeepSeek Harness bootstrap latest pointer PUT failed with HTTP ${result.status}${result.body.length > 0 ? `: ${result.body}` : ""}`,
      );
    }
    console.log(
      `DeepSeek Harness bootstrap latest pointer CAS conflict on attempt ${attempt}; retrying`,
    );
  }

  throw new Error("failed to update DeepSeek Harness bootstrap latest pointer after 5 CAS attempts");
}
