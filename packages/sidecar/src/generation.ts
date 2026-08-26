import { lstat, rm } from "node:fs/promises";
import { createConnection } from "node:net";

import type { ProcessSnapshot, StopProcessesOptions, StopProcessesResult } from "@open-design/platform";
import {
  captureProcessSnapshot,
  isProcessAlive,
  matchesStampedProcess,
} from "@open-design/platform";

import { type SidecarDescription, sidecarProtocol } from "./client.js";
import { requestJsonIpc } from "./json-ipc.js";
import { captureSidecarGenerationSnapshot } from "./process-tree.js";
import { retireFencedSidecarProcessTree } from "./process-retirement.js";
import {
  normalizeSidecarStamp,
  resolvePrivateIpcPath,
  SIDECAR_STAMP_CONTRACT,
  type SidecarStamp,
} from "./stamp.js";

export type SidecarStopResult = StopProcessesResult & {
  staleEndpointRemoved?: boolean;
  gracefulAccepted: boolean;
};

export type SidecarStopOptions = StopProcessesOptions & {
  /** Bound the graceful lifecycle request before process retirement takes over. */
  gracefulRequestTimeoutMs?: number;
};

/** Authority to mutate one concrete supervisor generation of a stamped resource. */
export type SidecarGenerationRef = Readonly<{
  rootPid: number;
  stamp: SidecarStamp;
}>;

type PrivateEndpointIdentity = Readonly<{ dev: number; ino: number }>;

/** One invocation-fenced observation used by discovery-based mutation paths. */
export type ObservedSidecarGeneration = Readonly<{
  description: SidecarDescription | null;
  endpoint: PrivateEndpointIdentity | null;
  processes: ProcessSnapshot[];
  ref: SidecarGenerationRef | null;
  stamp: SidecarStamp;
}>;

export function sidecarGenerationRef(stampInput: SidecarStamp, rootPid: number): SidecarGenerationRef {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
    throw new Error("sidecar generation root pid must be a positive safe integer");
  }
  return Object.freeze({ rootPid, stamp: normalizeSidecarStamp(stampInput) });
}

export async function describeSidecarGeneration(
  stampInput: SidecarStamp,
  timeoutMs = 2_000,
): Promise<SidecarDescription | null> {
  const stamp = normalizeSidecarStamp(stampInput);
  let description: SidecarDescription;
  try {
    description = await requestJsonIpc<SidecarDescription>(
      resolvePrivateIpcPath(stamp),
      { type: sidecarProtocol.describe },
      { timeoutMs },
    );
  } catch {
    return null;
  }
  const describedStamp = normalizeSidecarStamp(description.stamp);
  if (JSON.stringify(describedStamp) !== JSON.stringify(stamp)) {
    throw new Error("sidecar endpoint described a different stamp");
  }
  if (!Number.isSafeInteger(description.resources.pid) || description.resources.pid <= 0) {
    throw new Error("sidecar endpoint described an invalid pid");
  }
  if (!Number.isInteger(description.resources.port) || description.resources.port < 0 || description.resources.port > 65535) {
    throw new Error("sidecar endpoint described an invalid port");
  }
  if (typeof description.ready !== "boolean") throw new Error("sidecar endpoint described invalid readiness");
  return description;
}

export async function observeSidecarGeneration(
  stampInput: SidecarStamp,
  descriptionTimeoutMs = 2_000,
): Promise<ObservedSidecarGeneration> {
  const stamp = normalizeSidecarStamp(stampInput);
  const normalizedDescriptionTimeoutMs = normalizeGracefulRequestTimeoutMs(descriptionTimeoutMs);
  const deadline = Date.now() + 1_000;
  while (true) {
    try {
      return await observeSidecarGenerationOnce(stamp, normalizedDescriptionTimeoutMs);
    } catch (error) {
      if (!isTransientGenerationObservation(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function observeSidecarGenerationOnce(
  stamp: SidecarStamp,
  descriptionTimeoutMs: number,
): Promise<ObservedSidecarGeneration> {
  const endpoint = await readPrivateEndpointIdentity(stamp);
  const snapshot = await captureSidecarGenerationSnapshot(stamp);
  const endpointAfterCapture = await readPrivateEndpointIdentity(stamp);
  if (!samePrivateEndpointIdentity(endpoint, endpointAfterCapture)) {
    throw new Error("cannot mutate sidecar because endpoint ownership changed during process discovery");
  }
  if (snapshot.roots.length > 1) {
    throw new Error(
      `cannot mutate sidecar with multiple stamped generation roots: ${snapshot.roots.map(({ pid }) => pid).join(", ")}`,
    );
  }
  const description = await describeSidecarGeneration(stamp, descriptionTimeoutMs);
  const endpointAfterDescribe = await readPrivateEndpointIdentity(stamp);
  if (!samePrivateEndpointIdentity(endpoint, endpointAfterDescribe)) {
    throw new Error("cannot mutate sidecar because endpoint ownership changed during description");
  }
  const rootPid = snapshot.roots[0]?.pid ?? null;
  if (description != null && rootPid !== description.resources.pid) {
    throw new Error(
      `cannot mutate sidecar because endpoint pid ${description.resources.pid} is not the stamped generation root`,
    );
  }
  return {
    description,
    endpoint,
    processes: snapshot.processes,
    ref: rootPid == null ? null : sidecarGenerationRef(stamp, rootPid),
    stamp,
  };
}

function isTransientGenerationObservation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith("cannot mutate sidecar with multiple stamped generation roots") ||
    error.message.startsWith("cannot mutate sidecar because endpoint");
}

export async function retireObservedSidecarGeneration(
  observation: ObservedSidecarGeneration,
  options: SidecarStopOptions = {},
): Promise<SidecarStopResult> {
  const result = observation.ref == null
    ? alreadyStoppedResult()
    : await retireSidecarGeneration(observation.ref, options, observation.processes);
  const stamp = observation.stamp;
  const replacements = (await captureSidecarGenerationSnapshot(stamp)).roots
    .filter(({ pid }) => isProcessAlive(pid));
  if (replacements.length > 0) {
    return {
      ...result,
      remainingPids: [...new Set([...result.remainingPids, ...replacements.map(({ pid }) => pid)])],
    };
  }
  let staleEndpointRemoved = false;
  if (
    result.remainingPids.length === 0 &&
    (observation.ref != null || await privateEndpointRefusesConnections(stamp))
  ) {
    staleEndpointRemoved = await removeOwnedPrivateEndpoint(stamp, observation.endpoint);
  }
  return { ...result, staleEndpointRemoved };
}

/** Retire a generation already owned by the caller without adopting a replacement. */
export async function retireKnownSidecarGeneration(
  ref: SidecarGenerationRef,
  options: SidecarStopOptions = {},
): Promise<SidecarStopResult> {
  const endpoint = await readPrivateEndpointIdentity(ref.stamp);
  const description = await describeSidecarGeneration(ref.stamp);
  const endpointAfterDescribe = await readPrivateEndpointIdentity(ref.stamp);
  if (!samePrivateEndpointIdentity(endpoint, endpointAfterDescribe)) {
    throw new Error("cannot retire sidecar generation because endpoint ownership changed during description");
  }
  const ownsEndpoint = description?.resources.pid === ref.rootPid;
  const result = await retireSidecarGeneration(ref, options);
  const replacementExists = (await captureSidecarGenerationSnapshot(ref.stamp)).roots
    .some(({ pid }) => isProcessAlive(pid));
  let staleEndpointRemoved = false;
  if (
    result.remainingPids.length === 0 &&
    !replacementExists &&
    (ownsEndpoint || (description == null && await privateEndpointRefusesConnections(ref.stamp)))
  ) {
    staleEndpointRemoved = await removeOwnedPrivateEndpoint(ref.stamp, endpoint);
  }
  return { ...result, staleEndpointRemoved };
}

/** Retire exactly the generation named by the stable supervisor root. */
export async function retireSidecarGeneration(
  ref: SidecarGenerationRef,
  options: SidecarStopOptions = {},
  knownSnapshots?: ProcessSnapshot[],
): Promise<SidecarStopResult> {
  const snapshots = knownSnapshots ?? await captureProcessSnapshot();
  const rootOwnedAtEntry = snapshots.some((processInfo) =>
    processInfo.pid === ref.rootPid &&
    matchesStampedProcess(processInfo, ref.stamp, SIDECAR_STAMP_CONTRACT),
  );
  if (!rootOwnedAtEntry) return alreadyStoppedResult();
  let gracefulAccepted = false;
  try {
    const response = await requestJsonIpc<{ accepted?: unknown }>(
      resolvePrivateIpcPath(ref.stamp),
      { targetPids: [ref.rootPid], type: sidecarProtocol.stop },
      { timeoutMs: normalizeGracefulRequestTimeoutMs(options.gracefulRequestTimeoutMs) },
    );
    gracefulAccepted = response.accepted === true;
  } catch {
    // An absent, stale, or replacement endpoint is resolved by the owned root tree.
  }

  const result = await retireFencedSidecarProcessTree(ref, {
    gracefulStopInitiated: gracefulAccepted,
    knownSnapshots: snapshots,
    stopOptions: options,
  });
  return { ...result, gracefulAccepted };
}

function normalizeGracefulRequestTimeoutMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 2_000;
}

function alreadyStoppedResult(): SidecarStopResult {
  return {
    alreadyStopped: true,
    forcedPids: [],
    gracefulAccepted: false,
    matchedPids: [],
    remainingPids: [],
    stoppedPids: [],
  };
}

function samePrivateEndpointIdentity(
  left: PrivateEndpointIdentity | null,
  right: PrivateEndpointIdentity | null,
): boolean {
  return left == null || right == null
    ? left === right
    : left.dev === right.dev && left.ino === right.ino;
}

async function readPrivateEndpointIdentity(stamp: SidecarStamp): Promise<PrivateEndpointIdentity | null> {
  if (process.platform === "win32") return null;
  const entry = await lstat(resolvePrivateIpcPath(stamp)).catch(() => null);
  return entry?.isSocket() ? { dev: entry.dev, ino: entry.ino } : null;
}

async function removeOwnedPrivateEndpoint(stamp: SidecarStamp, owned: PrivateEndpointIdentity | null): Promise<boolean> {
  if (owned == null) return false;
  const current = await readPrivateEndpointIdentity(stamp);
  if (current?.dev !== owned.dev || current.ino !== owned.ino) return false;
  await rm(resolvePrivateIpcPath(stamp), { force: true });
  return true;
}

async function privateEndpointRefusesConnections(stamp: SidecarStamp): Promise<boolean> {
  if (process.platform === "win32") return false;
  return await new Promise<boolean>((resolveProbe) => {
    const socket = createConnection(resolvePrivateIpcPath(stamp));
    socket.once("connect", () => {
      socket.destroy();
      resolveProbe(false);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      resolveProbe(error.code === "ECONNREFUSED");
    });
  });
}
