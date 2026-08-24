import type { ChildProcess } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

import type { SpawnProcessRequest, StopProcessesOptions, StopProcessesResult } from "@open-design/platform";
import {
  captureProcessSnapshot,
  captureStampedProcessSnapshot,
  collectProcessTreePids,
  createProcessStampArgs,
  isProcessAlive,
  listProcessSnapshots,
  matchesStampedProcess,
  spawnBackgroundProcess,
  spawnLoggedProcess,
  stopProcesses,
} from "@open-design/platform";

import { requestJsonIpc } from "./json-ipc.js";
import {
  prepareSidecarLaunchEnvironment,
  SIDECAR_SUPERVISOR_TARGET_ENV,
  sidecarProtocol,
  type SidecarDescription,
  type SidecarResources,
} from "./client.js";
import { normalizeSidecarStamp, readCurrentSidecarStamp, resolvePrivateIpcPath, SIDECAR_STAMP_CONTRACT, type SidecarStamp } from "./stamp.js";

export type SidecarLaunchRequest = Omit<SpawnProcessRequest, "args" | "env"> & {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  resources: Omit<SidecarResources, "pid">;
  stamp: SidecarStamp;
};

export type SidecarStopResult = StopProcessesResult & {
  staleEndpointRemoved?: boolean;
  gracefulAccepted: boolean;
};

export type SidecarRestartOptions = {
  requireConcretePort?: boolean;
  reuseKnownPort?: boolean;
  stop?: StopProcessesOptions;
};

const RESTART_READY_TIMEOUT_MS = 30_000;
const BOOTSTRAP_READY_TIMEOUT_MS = 90_000;
const EXISTING_GENERATION_STABILITY_MS = 750;
const restartTails = new Map<string, Promise<void>>();

export type SidecarRestartResult = {
  pid: number;
  reusedPort: boolean;
  stop: SidecarStopResult;
};

/**
 * One concrete process generation created for a five-field sidecar resource.
 * The stamp identifies the resource across processes; this handle retains the
 * root process identity needed to retire this generation even if its runtime
 * later rewrites the argv visible to the operating system.
 */
export type SpawnedSidecar = {
  readonly process: ChildProcess & { pid: number };
  readonly stamp: SidecarStamp;
  stop(options?: StopProcessesOptions): Promise<SidecarStopResult>;
};

export function registerSidecarProcess(
  stampInput: SidecarStamp,
  resources: Omit<SidecarResources, "pid">,
): SidecarStamp {
  const stamp = normalizeSidecarStamp(stampInput);
  const carriesStamp = SIDECAR_STAMP_CONTRACT.stampFields.some((field) => {
    const prefix = `${SIDECAR_STAMP_CONTRACT.stampFlags[field]}=`;
    return process.argv.some((value) => value.startsWith(prefix));
  });
  const existing = carriesStamp ? readCurrentSidecarStamp() : null;
  if (existing == null) {
    throw new Error("current process is missing its sidecar argv stamp");
  }
  if (JSON.stringify(existing) !== JSON.stringify(stamp)) {
    throw new Error("current process carries a different sidecar argv stamp");
  }
  process.env[sidecarProtocol.resourcesEnv] = JSON.stringify(resources);
  return stamp;
}

export async function bootstrapSidecarProcess(
  stampInput: SidecarStamp,
  resources: Omit<SidecarResources, "pid">,
  options: {
    args?: readonly string[];
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    launch?: typeof launchSidecar;
    waitUntilReady?: (stamp: SidecarStamp, pid: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const stamp = normalizeSidecarStamp(stampInput);
  try {
    registerSidecarProcess(stamp, resources);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "current process is missing its sidecar argv stamp") throw error;
  }
  const launched = await (options.launch ?? launchSidecar)({
    args: options.args ?? process.argv.slice(1),
    command: options.command ?? process.execPath,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    logFd: null,
    resources,
    stamp,
  });
  try {
    await (options.waitUntilReady ?? waitForBootstrappedSidecarReady)(stamp, launched.pid, BOOTSTRAP_READY_TIMEOUT_MS);
  } catch (error) {
    const cleanup = await stopSidecarRoots(stamp, [launched.pid], { termGraceMs: 0 });
    if (cleanup.remainingPids.length > 0) {
      throw new AggregateError(
        [error, new Error(`failed to retire rejected bootstrap generation: ${cleanup.remainingPids.join(", ")}`)],
        "sidecar bootstrap failed and cleanup was incomplete",
      );
    }
    throw error;
  }
  return true;
}

export async function launchSidecar(request: SidecarLaunchRequest): Promise<{ pid: number }> {
  return await spawnBackgroundProcess(sidecarSpawnRequest(request));
}

function sidecarSpawnRequest(request: SidecarLaunchRequest): SpawnProcessRequest {
  const stamp = normalizeSidecarStamp(request.stamp);
  const { args = [], command, env, resources, ...spawnRequest } = request;
  const preparedEnv = prepareSidecarLaunchEnvironment(env ?? process.env, resources);
  const supervisorEntry = import.meta.url.endsWith(".ts")
    ? fileURLToPath(new URL("./supervisor.ts", import.meta.url))
    : fileURLToPath(new URL("./supervisor.mjs", import.meta.url));
  return {
    ...spawnRequest,
    args: [
      ...(import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : []),
      supervisorEntry,
      ...createProcessStampArgs(stamp, SIDECAR_STAMP_CONTRACT),
    ],
    command: process.execPath,
    env: {
      ...preparedEnv,
      ELECTRON_RUN_AS_NODE: "1",
      [SIDECAR_SUPERVISOR_TARGET_ENV]: JSON.stringify({
        args,
        command,
        electronRunAsNode: preparedEnv.ELECTRON_RUN_AS_NODE ?? null,
      }),
    },
  };
}

export async function spawnSidecar(request: SidecarLaunchRequest): Promise<SpawnedSidecar> {
  const stamp = normalizeSidecarStamp(request.stamp);
  const child = await spawnLoggedProcess(sidecarSpawnRequest({ ...request, stamp }));
  if (child.pid == null) throw new Error("spawned sidecar process has no pid");
  const rootPid = child.pid;
  const process = child as ChildProcess & { pid: number };
  let stopTask: Promise<SidecarStopResult> | null = null;
  return {
    process,
    stamp,
    stop(options = {}) {
      stopTask ??= stopSidecarRoots(stamp, [rootPid], options).finally(() => {
        stopTask = null;
      });
      return stopTask;
    },
  };
}

export async function findSidecarProcesses(stamp: SidecarStamp) {
  const exact = normalizeSidecarStamp(stamp);
  const matches = (await listProcessSnapshots()).filter((processInfo) =>
    matchesStampedProcess(processInfo, exact, SIDECAR_STAMP_CONTRACT),
  );
  const matchedPids = new Set(matches.map(({ pid }) => pid));
  return matches.filter(({ ppid }) => !matchedPids.has(ppid));
}

export async function getSidecarStatus<TResult = unknown>(
  stamp: SidecarStamp,
  options?: { generationPid?: number; timeoutMs?: number },
): Promise<TResult> {
  const exact = normalizeSidecarStamp(stamp);
  return await requestJsonIpc<TResult>(
    resolvePrivateIpcPath(exact),
    { targetPid: options?.generationPid, type: sidecarProtocol.status },
    options == null ? undefined : { timeoutMs: options.timeoutMs },
  );
}

async function describeSidecar(stamp: SidecarStamp, timeoutMs = 2_000): Promise<SidecarDescription | null> {
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

export async function invokeSidecar<TResult = unknown>(
  stamp: SidecarStamp,
  action: string,
  input: unknown,
  options?: { timeoutMs?: number },
): Promise<TResult> {
  const exact = normalizeSidecarStamp(stamp);
  return await requestJsonIpc<TResult>(
    resolvePrivateIpcPath(exact),
    { action, app: exact.app, input, type: "sidecar:invoke" },
    options,
  );
}

type InspectedSidecarGeneration = {
  description: SidecarDescription | null;
  endpoint: PrivateEndpointIdentity | null;
  processes: Awaited<ReturnType<typeof captureProcessSnapshot>>;
  roots: number[];
};

async function inspectSidecarGeneration(stamp: SidecarStamp): Promise<InspectedSidecarGeneration> {
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
  const description = await describeSidecar(stamp);
  const endpointAfterDescribe = await readPrivateEndpointIdentity(stamp);
  if (!samePrivateEndpointIdentity(endpoint, endpointAfterDescribe)) {
    throw new Error("cannot mutate sidecar because endpoint ownership changed during description");
  }
  const roots = snapshot.roots.map(({ pid }) => pid);
  if (description != null && (roots.length !== 1 || roots[0] !== description.resources.pid)) {
    throw new Error(
      `cannot mutate sidecar because endpoint pid ${description.resources.pid} is not the stamped generation root`,
    );
  }
  return { description, endpoint, processes: snapshot.processes, roots };
}

async function stopInspectedSidecar(
  stamp: SidecarStamp,
  inspected: InspectedSidecarGeneration,
  options: StopProcessesOptions,
): Promise<SidecarStopResult> {
  const result = await stopSidecarRoots(stamp, inspected.roots, options, inspected.processes);
  const replacements = (await captureStampedProcessSnapshot(stamp, SIDECAR_STAMP_CONTRACT)).roots;
  if (replacements.length > 0) {
    return {
      ...result,
      remainingPids: [...new Set([...result.remainingPids, ...replacements.map(({ pid }) => pid)])],
    };
  }
  let staleEndpointRemoved = false;
  if (
    result.remainingPids.length === 0 &&
    (inspected.roots.length > 0 || await privateEndpointRefusesConnections(stamp))
  ) {
    staleEndpointRemoved = await removeOwnedPrivateEndpoint(stamp, inspected.endpoint);
  }
  return { ...result, staleEndpointRemoved };
}

export async function stopSidecar(stamp: SidecarStamp, options: StopProcessesOptions = {}): Promise<SidecarStopResult> {
  const exact = normalizeSidecarStamp(stamp);
  return await stopInspectedSidecar(exact, await inspectSidecarGeneration(exact), options);
}

type PrivateEndpointIdentity = Readonly<{ dev: number; ino: number }>;

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
  const endpoint = resolvePrivateIpcPath(stamp);
  const entry = await lstat(endpoint).catch(() => null);
  return entry?.isSocket() ? { dev: entry.dev, ino: entry.ino } : null;
}

async function removeOwnedPrivateEndpoint(stamp: SidecarStamp, owned: PrivateEndpointIdentity | null): Promise<boolean> {
  if (owned == null) return false;
  const current = await readPrivateEndpointIdentity(stamp);
  if (current?.dev === owned.dev && current.ino === owned.ino) {
    await rm(resolvePrivateIpcPath(stamp), { force: true });
    return true;
  }
  return false;
}

async function privateEndpointRefusesConnections(stamp: SidecarStamp): Promise<boolean> {
  if (process.platform === "win32") return false;
  const endpoint = resolvePrivateIpcPath(stamp);
  return await new Promise<boolean>((resolveProbe) => {
    const socket = createConnection(endpoint);
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

/**
 * Replace one exact five-field sidecar resource while preserving concrete OS
 * resources known by the prior generation. A requested non-zero port remains
 * authoritative; zero means dynamic and inherits a known concrete predecessor
 * port unless the caller explicitly asks for a fresh allocation.
 */
export async function restartSidecar(
  request: SidecarLaunchRequest,
  options: SidecarRestartOptions = {},
): Promise<SidecarRestartResult> {
  const stamp = normalizeSidecarStamp(request.stamp);
  return await serializeRestart(stamp, async () => await restartSidecarGeneration({ ...request, stamp }, options));
}

async function restartSidecarGeneration(
  request: SidecarLaunchRequest,
  options: SidecarRestartOptions,
): Promise<SidecarRestartResult> {
  const stamp = normalizeSidecarStamp(request.stamp);
  const inspected = await inspectSidecarGeneration(stamp);
  const previous = inspected.description;
  const requestedPort = request.resources.port;
  const knownPort = previous?.resources.port ?? 0;
  if (options.requireConcretePort === true && requestedPort === 0 && knownPort === 0) {
    throw new Error("cannot restart sidecar without a concrete port");
  }
  const stop = await stopInspectedSidecar(stamp, inspected, options.stop ?? {});
  if (stop.remainingPids.length > 0) {
    throw new Error(`cannot restart sidecar while prior generation remains: ${stop.remainingPids.join(", ")}`);
  }

  const replacements = (await captureStampedProcessSnapshot(stamp, SIDECAR_STAMP_CONTRACT)).roots;
  if (replacements.length > 0) {
    throw new Error(`cannot restart sidecar because another generation appeared: ${replacements.map(({ pid }) => pid).join(", ")}`);
  }

  const reusedPort = options.reuseKnownPort !== false && requestedPort === 0 && knownPort > 0;
  const launched = await launchSidecar({
    ...request,
    resources: {
      ...request.resources,
      port: reusedPort ? knownPort : requestedPort,
    },
    stamp,
  });
  try {
    await waitForOwnedSidecarReady(stamp, launched.pid);
  } catch (error) {
    const cleanup = await stopSidecarRoots(stamp, [launched.pid], { termGraceMs: 0 });
    if (cleanup.remainingPids.length > 0) {
      throw new AggregateError(
        [error, new Error(`failed to retire rejected restart generation: ${cleanup.remainingPids.join(", ")}`)],
        "sidecar restart failed and cleanup was incomplete",
      );
    }
    throw error;
  }
  return { pid: launched.pid, reusedPort, stop };
}

async function serializeRestart<TResult>(stamp: SidecarStamp, operation: () => Promise<TResult>): Promise<TResult> {
  const key = JSON.stringify(normalizeSidecarStamp(stamp));
  const previous = restartTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  restartTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (restartTails.get(key) === tail) restartTails.delete(key);
  }
}

async function waitForOwnedSidecarReady(stamp: SidecarStamp, pid: number, timeoutMs = RESTART_READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const description = await describeSidecar(stamp);
    if (description?.resources.pid === pid && description.ready) return;
    if (description != null && description.resources.pid !== pid) {
      throw new Error(`sidecar restart lost endpoint ownership to pid ${description.resources.pid}`);
    }
    if (!isProcessAlive(pid)) throw new Error(`sidecar restart generation ${pid} exited before becoming ready`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sidecar restart did not acquire endpoint ownership for pid ${pid}`);
}

async function waitForBootstrappedSidecarReady(stamp: SidecarStamp, pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableExisting: { pid: number; since: number } | null = null;
  while (Date.now() < deadline) {
    const description = await describeSidecar(stamp);
    if (description?.resources.pid === pid && description.ready) return;
    if (description?.ready === true && description.resources.pid !== pid && !isProcessAlive(pid)) {
      const observedExisting = stableExisting as { pid: number; since: number } | null;
      if (observedExisting == null || observedExisting.pid !== description.resources.pid) {
        stableExisting = { pid: description.resources.pid, since: Date.now() };
      } else if (Date.now() - observedExisting.since >= EXISTING_GENERATION_STABILITY_MS) {
        return;
      }
    } else {
      stableExisting = null;
    }
    if (!isProcessAlive(pid) && description == null) {
      throw new Error(`sidecar bootstrap generation ${pid} exited before a generation became ready`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sidecar bootstrap did not leave a ready generation for pid ${pid}`);
}

async function stopSidecarRoots(
  stamp: SidecarStamp,
  rootPids: readonly number[],
  options: StopProcessesOptions,
  knownSnapshots?: Awaited<ReturnType<typeof listProcessSnapshots>>,
): Promise<SidecarStopResult> {
  const snapshots = knownSnapshots ?? await captureProcessSnapshot();
  const existingPidSet = new Set(snapshots.map(({ pid }) => pid));
  const initialRoots = [...new Set(rootPids)].filter((pid) => existingPidSet.has(pid));
  const initialPids = collectProcessTreePids(snapshots, initialRoots);
  const initialPidSet = new Set(initialPids);
  let gracefulAccepted = false;
  if (initialRoots.length > 0) {
    try {
      const response = await requestJsonIpc<{ accepted?: unknown }>(
        resolvePrivateIpcPath(stamp),
        { targetPids: initialRoots, type: sidecarProtocol.stop },
        { timeoutMs: 2_000 },
      );
      gracefulAccepted = response.accepted === true;
    } catch {
      // An absent or stale endpoint is resolved by the exact argv scan below.
    }
  }

  if (initialRoots.length === 0) {
    return {
      alreadyStopped: true,
      forcedPids: [],
      gracefulAccepted,
      matchedPids: [],
      remainingPids: [],
      stoppedPids: [],
    };
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

  // The five-field stamp names a resource set, not a process generation. Keep
  // this stop invocation scoped to the process tree observed at call entry so
  // a replacement that acquires the same stamp during the grace window cannot
  // be swept into the old instance's fallback termination.
  // A supervisor can create descendants immediately after the invocation
  // snapshot. Refresh only the already-owned root trees before escalation so
  // late children cannot be orphaned, while a replacement root remains fenced.
  const latestSnapshots = await captureProcessSnapshot();
  const ownedRootSet = new Set(
    latestSnapshots
      .filter((processInfo) => initialRoots.includes(processInfo.pid))
      .filter((processInfo) => matchesStampedProcess(processInfo, stamp, SIDECAR_STAMP_CONTRACT))
      .map(({ pid }) => pid),
  );
  const latestGenerationPids = [...new Set([
    ...collectProcessTreePids(latestSnapshots, [...ownedRootSet]),
  ])];
  if (latestGenerationPids.length === 0) {
    return {
      alreadyStopped: false,
      forcedPids: [],
      gracefulAccepted,
      matchedPids: initialPids,
      remainingPids: remaining,
      stoppedPids: initialPids.filter((pid) => !remaining.includes(pid)),
    };
  }
  const forced = await stopProcesses(latestGenerationPids, { termGraceMs: 0, killGraceMs: options.killGraceMs });
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
