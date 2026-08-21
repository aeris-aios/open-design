import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { writeJsonFile } from "../json-file.js";
import { SidecarControlError } from "./error.js";
import {
  normalizePrivateControlLease,
  privateControlPaths,
  type PrivateControlLease,
  type PrivateLaunchMetadata,
} from "./private-protocol.js";
import type { SidecarControlIdentity, SidecarControlRoots } from "./public-types.js";

const LOCK_POLL_MS = 25;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function readControlLease(
  identity: SidecarControlIdentity,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): Promise<PrivateControlLease | null> {
  const { descriptorPath } = privateControlPaths(identity, roots);
  let text: string;
  try {
    text = await readFile(descriptorPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SidecarControlError("peer-mismatch", "sidecar authority is unreadable", { cause: error });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SidecarControlError("peer-mismatch", "sidecar authority is malformed", { cause: error });
  }
  try {
    return normalizePrivateControlLease(raw);
  } catch (error) {
    throw new SidecarControlError("peer-mismatch", "sidecar authority is invalid", { cause: error });
  }
}

export async function writeControlLease(lease: PrivateControlLease): Promise<void> {
  const { descriptorPath } = privateControlPaths(lease.identity, lease.roots);
  await writeJsonFile(descriptorPath, lease);
}

export async function removeControlLeaseIfCurrent(metadata: PrivateLaunchMetadata): Promise<boolean> {
  const { descriptorPath } = privateControlPaths(metadata.identity, metadata.roots);
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation) return false;
  await rm(descriptorPath, { force: true });
  return true;
}

/** Return whether an external launcher already owned this incarnation's claim. */
export async function publishReadyLease(
  metadata: PrivateLaunchMetadata,
  pid: number,
  claimOwnedByBody = false,
): Promise<boolean> {
  const { descriptorPath } = privateControlPaths(metadata.identity, metadata.roots);
  const ready = { ...metadata, pid, state: "ready" } as const;
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current == null) {
    await mkdir(dirname(descriptorPath), { recursive: true });
    try {
      await writeJsonFileExclusive(descriptorPath, ready);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } else if (current.incarnation !== metadata.incarnation) {
    throw new SidecarControlError("peer-mismatch", "sidecar launch claim belongs to another incarnation");
  }
  let claimed = await readControlLease(metadata.identity, metadata.roots);
  const deadline = Date.now() + 5_000;
  while (
    claimed?.incarnation === metadata.incarnation
    && claimed.state === "claiming"
    && !claimOwnedByBody
    && Date.now() < deadline
  ) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, LOCK_POLL_MS));
    claimed = await readControlLease(metadata.identity, metadata.roots);
  }
  if (claimed?.incarnation !== metadata.incarnation) {
    throw new SidecarControlError("peer-mismatch", "sidecar launch claim changed before readiness");
  }
  if (claimed.state === "claiming" && !claimOwnedByBody) {
    throw new SidecarControlError("peer-unavailable", "sidecar launch claim did not enter starting state");
  }
  if (claimed.state === "stopping") {
    throw new SidecarControlError("peer-unavailable", "sidecar launch was stopped before readiness");
  }
  await writeControlLease(ready);
  return !claimOwnedByBody;
}

export async function beginProcessLease(metadata: PrivateLaunchMetadata, pid: number): Promise<void> {
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation) {
    throw new SidecarControlError("peer-mismatch", "sidecar launch claim changed before process start");
  }
  if (current.state === "claiming") {
    await writeControlLease({ ...metadata, pid, state: "starting" });
    return;
  }
  if (current.pid !== pid) {
    throw new SidecarControlError("peer-mismatch", "sidecar launch process does not match its claim");
  }
}

async function writeJsonFileExclusive(path: string, payload: unknown): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

export async function markStoppingLease(metadata: PrivateLaunchMetadata): Promise<void> {
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation || current.state === "claiming") return;
  await writeControlLease({ ...current, state: "stopping" });
}

type LeaseLock = Readonly<{ release(): Promise<void> }>;

export async function acquireControlLeaseLock(
  identity: SidecarControlIdentity,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
  timeoutMs: number,
): Promise<LeaseLock> {
  const { operationLockPath } = privateControlPaths(identity, roots);
  await mkdir(dirname(operationLockPath), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const handle = await open(operationLockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ ownerPid: process.pid, token }), "utf8");
      } finally {
        await handle.close();
      }
      return {
        async release() {
          try {
            const current = JSON.parse(await readFile(operationLockPath, "utf8")) as {
              token?: unknown;
            };
            if (current.token === token) await rm(operationLockPath, { force: true });
          } catch {
            // A missing or replaced lock is no longer ours to release.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    try {
      const current = JSON.parse(await readFile(operationLockPath, "utf8")) as {
        ownerPid?: unknown;
      };
      if (
        Number.isSafeInteger(current.ownerPid)
        && (current.ownerPid as number) > 0
        && !processAlive(current.ownerPid as number)
      ) {
        await rm(operationLockPath, { force: true });
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    }

    if (Date.now() >= deadline) {
      throw new SidecarControlError("peer-unavailable", "sidecar lifecycle operation lock timed out");
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, LOCK_POLL_MS));
  }
}
