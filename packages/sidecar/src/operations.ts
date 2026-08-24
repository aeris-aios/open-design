import type { ChildProcess } from "node:child_process";
import { lstat, rm } from "node:fs/promises";

import type { SpawnProcessRequest, StopProcessesOptions, StopProcessesResult } from "@open-design/platform";
import {
  captureStampedProcessSnapshot,
  collectProcessTreePids,
  createProcessStampArgs,
  listProcessSnapshots,
  matchesStampedProcess,
  spawnBackgroundProcess,
  spawnLoggedProcess,
  stopProcesses,
} from "@open-design/platform";

import { requestJsonIpc } from "./json-ipc.js";
import {
  prepareSidecarLaunchEnvironment,
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
  gracefulAccepted: boolean;
};

export type SidecarRestartOptions = {
  requireConcretePort?: boolean;
  reuseKnownPort?: boolean;
  stop?: StopProcessesOptions;
};

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
  } = {},
): Promise<boolean> {
  const stamp = normalizeSidecarStamp(stampInput);
  try {
    registerSidecarProcess(stamp, resources);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "current process is missing its sidecar argv stamp") throw error;
  }
  await (options.launch ?? launchSidecar)({
    args: options.args ?? process.argv.slice(1),
    command: options.command ?? process.execPath,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    logFd: null,
    resources,
    stamp,
  });
  return true;
}

export async function launchSidecar(request: SidecarLaunchRequest): Promise<{ pid: number }> {
  return await spawnBackgroundProcess(sidecarSpawnRequest(request));
}

function sidecarSpawnRequest(request: SidecarLaunchRequest): SpawnProcessRequest {
  const stamp = normalizeSidecarStamp(request.stamp);
  const { args = [], env, resources, ...spawnRequest } = request;
  return {
    ...spawnRequest,
    args: [...args, ...createProcessStampArgs(stamp, SIDECAR_STAMP_CONTRACT)],
    env: prepareSidecarLaunchEnvironment(env ?? process.env, resources),
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
      stopTask ??= stopSidecarRoots(stamp, [rootPid], options);
      return stopTask;
    },
  };
}

export async function findSidecarProcesses(stamp: SidecarStamp) {
  const exact = normalizeSidecarStamp(stamp);
  return (await listProcessSnapshots()).filter((processInfo) =>
    matchesStampedProcess(processInfo, exact, SIDECAR_STAMP_CONTRACT),
  );
}

export async function getSidecarStatus<TResult = unknown>(stamp: SidecarStamp, options?: { timeoutMs?: number }): Promise<TResult> {
  return await requestJsonIpc<TResult>(resolvePrivateIpcPath(normalizeSidecarStamp(stamp)), { type: sidecarProtocol.status }, options);
}

async function describeSidecar(stamp: SidecarStamp): Promise<SidecarDescription | null> {
  try {
    const description = await requestJsonIpc<SidecarDescription>(
      resolvePrivateIpcPath(stamp),
      { type: sidecarProtocol.describe },
      { timeoutMs: 2_000 },
    );
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
    return description;
  } catch {
    return null;
  }
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

export async function stopSidecar(stamp: SidecarStamp, options: StopProcessesOptions = {}): Promise<SidecarStopResult> {
  const exact = normalizeSidecarStamp(stamp);
  const initial = await captureStampedProcessSnapshot(exact, SIDECAR_STAMP_CONTRACT);
  const result = await stopSidecarRoots(exact, initial.roots.map(({ pid }) => pid), options, initial.processes);
  if (result.remainingPids.length === 0 && (await findSidecarProcesses(exact)).length === 0) {
    await removeStalePrivateEndpoint(exact);
  }
  return result;
}

async function removeStalePrivateEndpoint(stamp: SidecarStamp): Promise<void> {
  if (process.platform === "win32") return;
  const endpoint = resolvePrivateIpcPath(stamp);
  const entry = await lstat(endpoint).catch(() => null);
  if (entry?.isSocket()) await rm(endpoint, { force: true });
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
  const previous = await describeSidecar(stamp);
  const requestedPort = request.resources.port;
  const knownPort = previous?.resources.port ?? 0;
  if (options.requireConcretePort === true && requestedPort === 0 && knownPort === 0) {
    throw new Error("cannot restart sidecar without a concrete port");
  }
  const stop = previous == null
    ? await stopSidecar(stamp, options.stop)
    : await stopSidecarRoots(stamp, [previous.resources.pid], options.stop ?? {});
  if (stop.remainingPids.length > 0) {
    throw new Error(`cannot restart sidecar while prior generation remains: ${stop.remainingPids.join(", ")}`);
  }

  const replacements = await findSidecarProcesses(stamp);
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
  return { pid: launched.pid, reusedPort, stop };
}

async function stopSidecarRoots(
  stamp: SidecarStamp,
  rootPids: readonly number[],
  options: StopProcessesOptions,
  knownSnapshots?: Awaited<ReturnType<typeof listProcessSnapshots>>,
): Promise<SidecarStopResult> {
  const snapshots = knownSnapshots ?? await listProcessSnapshots();
  const existingPidSet = new Set(snapshots.map(({ pid }) => pid));
  const initialRoots = [...new Set(rootPids)].filter((pid) => existingPidSet.has(pid));
  const initialPids = collectProcessTreePids(snapshots, initialRoots);
  const initialPidSet = new Set(initialPids);
  let gracefulAccepted = false;
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
  const remainingInitialPids = async () => (await listProcessSnapshots())
    .map(({ pid }) => pid)
    .filter((pid) => initialPidSet.has(pid));
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
  const forced = await stopProcesses(remaining, { termGraceMs: 0, killGraceMs: options.killGraceMs });
  return {
    alreadyStopped: false,
    forcedPids: forced.forcedPids,
    gracefulAccepted,
    matchedPids: initialPids,
    remainingPids: forced.remainingPids,
    stoppedPids: initialPids.filter((pid) => !forced.remainingPids.includes(pid)),
  };
}
