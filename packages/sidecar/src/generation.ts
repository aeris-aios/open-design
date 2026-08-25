import { lstat, rm } from "node:fs/promises";
import { createConnection } from "node:net";

import type { ProcessSnapshot, StopProcessesOptions, StopProcessesResult } from "@open-design/platform";
import {
  captureProcessSnapshot,
  captureStampedProcessSnapshot,
  isProcessAlive,
  matchesStampedProcess,
  stopProcesses,
} from "@open-design/platform";

import { type SidecarDescription, sidecarProtocol } from "./client.js";
import { requestJsonIpc } from "./json-ipc.js";
import { collectSidecarGenerationPids } from "./process-tree.js";
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

export async function observeSidecarGeneration(stampInput: SidecarStamp): Promise<ObservedSidecarGeneration> {
  const stamp = normalizeSidecarStamp(stampInput);
  const endpoint = await readPrivateEndpointIdentity(stamp);
  const snapshot = await captureStampedProcessSnapshot(stamp, SIDECAR_STAMP_CONTRACT);
  const endpointAfterCapture = await readPrivateEndpointIdentity(stamp);
  if (!samePrivateEndpointIdentity(endpoint, endpointAfterCapture)) {
    throw new Error("cannot mutate sidecar because endpoint ownership changed during process discovery");
  }
  if (snapshot.roots.length > 1) {
    throw new Error(
      `cannot mutate sidecar with multiple stamped generation roots: ${snapshot.roots.map(({ pid }) => pid).join(", ")}`,
    );
  }
  const description = await describeSidecarGeneration(stamp);
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

export async function retireObservedSidecarGeneration(
  observation: ObservedSidecarGeneration,
  options: StopProcessesOptions = {},
): Promise<SidecarStopResult> {
  const result = observation.ref == null
    ? alreadyStoppedResult()
    : await retireSidecarGeneration(observation.ref, options, observation.processes);
  const stamp = observation.stamp;
  const replacements = (await captureStampedProcessSnapshot(stamp, SIDECAR_STAMP_CONTRACT)).roots
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
  options: StopProcessesOptions = {},
): Promise<SidecarStopResult> {
  const endpoint = await readPrivateEndpointIdentity(ref.stamp);
  const description = await describeSidecarGeneration(ref.stamp);
  const endpointAfterDescribe = await readPrivateEndpointIdentity(ref.stamp);
  if (!samePrivateEndpointIdentity(endpoint, endpointAfterDescribe)) {
    throw new Error("cannot retire sidecar generation because endpoint ownership changed during description");
  }
  const ownsEndpoint = description?.resources.pid === ref.rootPid;
  const result = await retireSidecarGeneration(ref, options);
  const replacementExists = (await captureStampedProcessSnapshot(ref.stamp, SIDECAR_STAMP_CONTRACT)).roots
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
  options: StopProcessesOptions = {},
  knownSnapshots?: ProcessSnapshot[],
): Promise<SidecarStopResult> {
  const snapshots = knownSnapshots ?? await captureProcessSnapshot();
  const rootOwnedAtEntry = snapshots.some((processInfo) =>
    processInfo.pid === ref.rootPid &&
    matchesStampedProcess(processInfo, ref.stamp, SIDECAR_STAMP_CONTRACT),
  );
  if (!rootOwnedAtEntry) return alreadyStoppedResult();
  const initialPids = collectSidecarGenerationPids(snapshots, [ref.rootPid], ref.stamp);
  const initialPidSet = new Set(initialPids);
  let gracefulAccepted = false;
  try {
    const response = await requestJsonIpc<{ accepted?: unknown }>(
      resolvePrivateIpcPath(ref.stamp),
      { targetPids: [ref.rootPid], type: sidecarProtocol.stop },
      { timeoutMs: 2_000 },
    );
    gracefulAccepted = response.accepted === true;
  } catch {
    // An absent, stale, or replacement endpoint is resolved by the owned root tree.
  }

  const graceMs = options.termGraceMs ?? 5_000;
  const deadline = Date.now() + graceMs;
  const remainingInitialPids = () => [...initialPidSet].filter(isProcessAlive);
  let remaining = await remainingInitialPids();
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    remaining = await remainingInitialPids();
  }
  if (remaining.length === 0) {
    return {
      alreadyStopped: false,
      forcedPids: [],
      gracefulAccepted,
      matchedPids: initialPids,
      remainingPids: [],
      stoppedPids: initialPids,
    };
  }

  // Refresh only this invocation's still-stamped supervisor root. This admits
  // late ordinary descendants without crossing into replacements or another
  // complete five-field resource rooted below the generation.
  const latestSnapshots = await captureProcessSnapshot();
  const rootStillOwned = latestSnapshots.some((processInfo) =>
    processInfo.pid === ref.rootPid &&
    matchesStampedProcess(processInfo, ref.stamp, SIDECAR_STAMP_CONTRACT),
  );
  const latestGenerationPids = rootStillOwned
    ? collectSidecarGenerationPids(latestSnapshots, [ref.rootPid], ref.stamp)
    : [];
  if (latestGenerationPids.length === 0) {
    // The root can exit while the refresh snapshot is being captured. Its
    // already-fenced initial descendants still belong to this generation and
    // must be force-stopped without adopting a replacement root.
    const remainingAfterRefresh = remainingInitialPids();
    if (remainingAfterRefresh.length > 0) {
      const forced = await stopProcesses(remainingAfterRefresh, {
        killGraceMs: options.killGraceMs,
        termGraceMs: 0,
      });
      return {
        alreadyStopped: false,
        forcedPids: forced.forcedPids,
        gracefulAccepted,
        matchedPids: initialPids,
        remainingPids: forced.remainingPids,
        stoppedPids: initialPids.filter((pid) => !forced.remainingPids.includes(pid)),
      };
    }
    return {
      alreadyStopped: false,
      forcedPids: [],
      gracefulAccepted,
      matchedPids: initialPids,
      remainingPids: [],
      stoppedPids: initialPids,
    };
  }
  const forced = await stopProcesses(latestGenerationPids, {
    killGraceMs: options.killGraceMs,
    termGraceMs: 0,
  });
  const matchedPids = [...new Set([...initialPids, ...latestGenerationPids])];
  return {
    alreadyStopped: false,
    forcedPids: forced.forcedPids,
    gracefulAccepted,
    matchedPids,
    remainingPids: forced.remainingPids,
    stoppedPids: matchedPids.filter((pid) => !forced.remainingPids.includes(pid)),
  };
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
