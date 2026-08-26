import type { ProcessSnapshot, StopProcessesOptions, StopProcessesResult } from "@open-design/platform";
import {
  captureProcessSnapshot,
  isProcessAlive,
  matchesStampedProcess,
  signalProcesses,
  stopProcesses,
} from "@open-design/platform";

import { collectSidecarGenerationPids } from "./process-tree.js";
import { SIDECAR_STAMP_CONTRACT, type SidecarStamp } from "./stamp.js";

type FencedGenerationRef = Readonly<{ rootPid: number; stamp: SidecarStamp }>;

type FencedRetirementOptions = Readonly<{
  gracefulStopInitiated: boolean;
  knownSnapshots?: ProcessSnapshot[];
  stopOptions?: StopProcessesOptions;
}>;

/** Retire one already-fenced generation without ever adopting a replacement root. */
export async function retireFencedSidecarProcessTree(
  ref: FencedGenerationRef,
  options: FencedRetirementOptions,
): Promise<StopProcessesResult> {
  const snapshots = options.knownSnapshots ?? await captureProcessSnapshot();
  const rootOwnedAtEntry = snapshots.some((processInfo) =>
    processInfo.pid === ref.rootPid &&
    matchesStampedProcess(processInfo, ref.stamp, SIDECAR_STAMP_CONTRACT),
  );
  if (!rootOwnedAtEntry) return alreadyStoppedResult();

  const initialPids = collectSidecarGenerationPids(snapshots, [ref.rootPid], ref.stamp);
  if (!options.gracefulStopInitiated) signalProcesses(initialPids, "SIGTERM");

  const graceMs = normalizeGraceMs(options.stopOptions?.termGraceMs, 5_000);
  const deadline = Date.now() + graceMs;
  const remainingInitialPids = (): number[] => initialPids.filter(isProcessAlive);
  let remaining = remainingInitialPids();
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    remaining = remainingInitialPids();
  }
  if (remaining.length === 0) return stoppedResult(initialPids);

  // Refresh only the same stamped root. If it vanished while descendants
  // survived, fall back to the entry snapshot instead of adopting another
  // generation that now owns the same five-field stamp.
  const latestSnapshots = await captureProcessSnapshot();
  const rootStillOwned = latestSnapshots.some((processInfo) =>
    processInfo.pid === ref.rootPid &&
    matchesStampedProcess(processInfo, ref.stamp, SIDECAR_STAMP_CONTRACT),
  );
  const forceTargets = rootStillOwned
    ? collectSidecarGenerationPids(latestSnapshots, [ref.rootPid], ref.stamp)
    : remainingInitialPids();
  if (forceTargets.length === 0) return stoppedResult(initialPids);

  const forced = await stopProcesses(forceTargets, {
    killGraceMs: options.stopOptions?.killGraceMs,
    termGraceMs: 0,
  });
  const matchedPids = [...new Set([...initialPids, ...forceTargets])];
  return {
    alreadyStopped: false,
    forcedPids: forced.forcedPids,
    matchedPids,
    remainingPids: forced.remainingPids,
    stoppedPids: matchedPids.filter((pid) => !forced.remainingPids.includes(pid)),
  };
}

function normalizeGraceMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function alreadyStoppedResult(): StopProcessesResult {
  return {
    alreadyStopped: true,
    forcedPids: [],
    matchedPids: [],
    remainingPids: [],
    stoppedPids: [],
  };
}

function stoppedResult(matchedPids: number[]): StopProcessesResult {
  return {
    alreadyStopped: false,
    forcedPids: [],
    matchedPids,
    remainingPids: [],
    stoppedPids: matchedPids,
  };
}
