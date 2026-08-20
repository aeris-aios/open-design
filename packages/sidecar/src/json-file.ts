/**
 * @module json-file
 *
 * Small JSON file helpers for sidecar runtime state: a forgiving reader (null on
 * any failure), an atomic pretty-printed writer via temp-file rename, a
 * best-effort remove, and a guarded pointer removal that only deletes when the
 * pointer still names the given run. Depends on `node:fs/promises` and
 * `node:path`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const REPLACE_RETRY_ATTEMPTS = 8;
const REPLACE_RETRY_DELAY_MS = 25;

type JsonFileOperations = Readonly<{
  delay: (milliseconds: number) => Promise<void>;
  mkdir: typeof mkdir;
  remove: typeof rm;
  rename: typeof rename;
  writeFile: typeof writeFile;
}>;

const jsonFileOperations: JsonFileOperations = {
  delay: async (milliseconds) => await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  mkdir,
  remove: rm,
  rename,
  writeFile,
};

function replaceRetryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EACCES" || code === "EBUSY" || code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM";
}

async function replaceWrittenFile(
  tmpPath: string,
  filePath: string,
  operations: JsonFileOperations,
): Promise<void> {
  try {
    await operations.rename(tmpPath, filePath);
    return;
  } catch (error) {
    if (!replaceRetryable(error)) throw error;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < REPLACE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      // Windows rename does not replace an existing file. Removing the stale
      // fenced descriptor first gives rename the same replacement semantics
      // while bounded retries absorb short-lived scanner/reader locks.
      await operations.remove(filePath, { force: true });
      await operations.rename(tmpPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!replaceRetryable(error) || attempt === REPLACE_RETRY_ATTEMPTS - 1) throw error;
      await operations.delay(REPLACE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Read and parse a JSON file, swallowing any read/parse error.
 * @returns The parsed value, or `null` if missing or unreadable.
 */
export async function readJsonFile<T = any>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Atomically write `payload` as pretty-printed JSON via a temp-file rename,
 * creating the parent directory if needed.
 */
export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await writeJsonFileWithOperations(filePath, payload, jsonFileOperations);
}

/** @internal Operation seam for deterministic replacement/cleanup tests. */
export async function writeJsonFileWithOperations(
  filePath: string,
  payload: unknown,
  operations: JsonFileOperations,
): Promise<void> {
  await operations.mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await operations.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await replaceWrittenFile(tmpPath, filePath, operations);
  } finally {
    // A failed Windows replacement must not accumulate launch-blocking temp
    // descriptors beside the authoritative path. Never mask the root error.
    await operations.remove(tmpPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Remove a file, forcing (no error if absent).
 */
export async function removeFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

/**
 * Remove a pointer file only if it still points at `runId`.
 */
export async function removePointerIfCurrent(pointerPath: string, runId: string): Promise<void> {
  const pointer = await readJsonFile<{ runId?: string }>(pointerPath);
  if (pointer?.runId === runId) await removeFile(pointerPath);
}
