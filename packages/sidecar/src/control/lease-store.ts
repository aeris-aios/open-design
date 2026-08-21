import { randomUUID } from "node:crypto";
import { access, link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SidecarControlError } from "./error.js";
import {
  normalizePrivateControlLease,
  privateControlPaths,
  type PrivateControlLease,
  type PrivateLaunchMetadata,
  type PrivateLeaseMetadata,
} from "./private-protocol.js";
import type { SidecarControlIdentity, SidecarControlRoots } from "./public-types.js";

const UNPUBLISHED_LEASE_GRACE_MS = 250;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new SidecarControlError("peer-mismatch", `${label} is unreadable`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SidecarControlError("peer-mismatch", `${label} is malformed`, { cause: error });
  }
}

export async function readControlLease(
  identity: SidecarControlIdentity,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): Promise<PrivateControlLease | null> {
  const paths = privateControlPaths(identity, roots);
  if (!await pathExists(paths.leasePath)) return null;

  const metadata = await readJson(paths.leaseMetadataPath, "sidecar lease metadata");
  const processExists = await pathExists(paths.leaseProcessPath);
  const bodyExists = await pathExists(paths.leaseBodyPath);
  const ready = await pathExists(paths.readyMarkerPath);
  const stopping = await pathExists(paths.stoppingMarkerPath);
  let raw: unknown = { ...(metadata as object), state: "claiming" };
  if (processExists) {
    const processRecord = await readJson(paths.leaseProcessPath, "sidecar lease process");
    const bodyRecord = bodyExists
      ? await readJson(paths.leaseBodyPath, "sidecar lease body")
      : processRecord;
    raw = {
      ...(metadata as object),
      ...(bodyRecord as object),
      processPid: (processRecord as { pid?: unknown }).pid,
      state: stopping ? "stopping" : ready ? "ready" : "starting",
    };
  } else if (bodyExists || ready || stopping) {
    throw new SidecarControlError("peer-mismatch", "sidecar lease markers require a process");
  }
  if (ready && !bodyExists) {
    throw new SidecarControlError("peer-mismatch", "sidecar ready marker requires a body");
  }
  try {
    return normalizePrivateControlLease(raw);
  } catch (error) {
    throw new SidecarControlError("peer-mismatch", "sidecar lease is invalid", { cause: error });
  }
}

async function writeJsonExclusive(path: string, payload: unknown): Promise<void> {
  const pendingPath = `${path}.${randomUUID()}.pending`;
  const handle = await open(pendingPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // A hard link publishes fully-written bytes atomically and refuses to
    // replace an existing immutable member on every supported platform.
    await link(pendingPath, path);
  } finally {
    await rm(pendingPath, { force: true });
  }
}

async function writeMarkerExclusive(path: string): Promise<void> {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/** Atomically claim the one active path, then populate immutable metadata. */
export async function claimControlLease(
  metadata: PrivateLaunchMetadata,
  terminal: PrivateLeaseMetadata["terminal"],
): Promise<PrivateLeaseMetadata> {
  const paths = privateControlPaths(metadata.identity, metadata.roots);
  await mkdir(dirname(paths.leasePath), { recursive: true });
  try {
    await mkdir(paths.leasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SidecarControlError("peer-unavailable", "sidecar identity already has an active lease");
    }
    throw error;
  }
  const leaseMetadata = Object.freeze({ ...metadata, ownerPid: process.pid, terminal });
  // If this write is interrupted, the active directory deliberately remains:
  // absence must never be inferred from a partially published authority.
  await writeJsonExclusive(paths.leaseMetadataPath, leaseMetadata);
  return leaseMetadata;
}

export async function retireControlLeaseIfCurrent(metadata: PrivateLaunchMetadata): Promise<boolean> {
  const paths = privateControlPaths(metadata.identity, metadata.roots);
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation) return false;
  await mkdir(paths.retiredRoot, { recursive: true });
  const retiredPath = join(paths.retiredRoot, metadata.incarnation);
  try {
    await rename(paths.leasePath, retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await rm(retiredPath, { recursive: true, force: true });
  return true;
}

/** Recover only the mkdir→metadata crash window while a lifecycle session is held. */
export async function recoverUnpublishedControlLease(
  identity: SidecarControlIdentity,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): Promise<boolean> {
  const paths = privateControlPaths(identity, roots);
  if (!await pathExists(paths.leasePath) || await pathExists(paths.leaseMetadataPath)) return false;
  const leaseStat = await stat(paths.leasePath);
  const waitMs = Math.max(0, leaseStat.mtimeMs + UNPUBLISHED_LEASE_GRACE_MS - Date.now());
  if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  if (await pathExists(paths.leaseMetadataPath)) return false;

  await mkdir(paths.retiredRoot, { recursive: true });
  const retiredPath = join(paths.retiredRoot, `unpublished-${randomUUID()}`);
  try {
    await rename(paths.leasePath, retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await rm(retiredPath, { recursive: true, force: true });
  return true;
}

export async function publishReadyLease(metadata: PrivateLaunchMetadata, pid: number): Promise<void> {
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation) {
    throw new SidecarControlError("peer-mismatch", "sidecar launch claim belongs to another incarnation");
  }
  if (current.state === "claiming") {
    throw new SidecarControlError("peer-unavailable", "sidecar launch claim has no captured process");
  }
  if (current.state === "stopping") {
    throw new SidecarControlError("peer-unavailable", "sidecar launch was stopped before readiness");
  }
  const paths = privateControlPaths(metadata.identity, metadata.roots);
  try {
    await writeJsonExclusive(paths.leaseBodyPath, { pid });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const body = await readJson(paths.leaseBodyPath, "sidecar lease body") as { pid?: unknown };
    if (body.pid !== pid) {
      throw new SidecarControlError("peer-mismatch", "sidecar launch claim was consumed by another body");
    }
  }
  await writeMarkerExclusive(paths.readyMarkerPath);
}

export async function beginProcessLease(metadata: PrivateLaunchMetadata, pid: number): Promise<void> {
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation) {
    throw new SidecarControlError("peer-mismatch", "sidecar launch claim changed before process start");
  }
  if (current.state !== "claiming") {
    if (current.processPid !== pid) {
      throw new SidecarControlError("peer-mismatch", "sidecar launch process does not match its claim");
    }
    return;
  }
  await writeJsonExclusive(
    privateControlPaths(metadata.identity, metadata.roots).leaseProcessPath,
    { pid },
  );
}

export async function markStoppingLease(metadata: PrivateLaunchMetadata): Promise<void> {
  const current = await readControlLease(metadata.identity, metadata.roots);
  if (current?.incarnation !== metadata.incarnation || current.state === "claiming") return;
  await writeMarkerExclusive(privateControlPaths(metadata.identity, metadata.roots).stoppingMarkerPath);
}
