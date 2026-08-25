import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { SpawnProcessRequest, StopProcessesOptions } from "@open-design/platform";
import {
  captureStampedProcessSnapshot,
  createProcessStampArgs,
  isProcessAlive,
  listProcessSnapshots,
  matchesStampedProcess,
  spawnBackgroundProcess,
  spawnLoggedProcess,
} from "@open-design/platform";

import { requestJsonIpc } from "./json-ipc.js";
import {
  prepareSidecarLaunchEnvironment,
  SIDECAR_SUPERVISOR_TARGET_ENV,
  sidecarProtocol,
  type SidecarResources,
} from "./client.js";
import {
  describeSidecarGeneration,
  observeSidecarGeneration,
  retireKnownSidecarGeneration,
  retireObservedSidecarGeneration,
  sidecarGenerationRef,
  type SidecarStopResult,
} from "./generation.js";
import { normalizeSidecarStamp, readCurrentSidecarStamp, resolvePrivateIpcPath, SIDECAR_STAMP_CONTRACT, type SidecarStamp } from "./stamp.js";

export type { SidecarStopResult } from "./generation.js";

export type SidecarLaunchRequest = Omit<SpawnProcessRequest, "args" | "env"> & {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  resources: Omit<SidecarResources, "pid">;
  stamp: SidecarStamp;
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
    const cleanup = await retireKnownSidecarGeneration(sidecarGenerationRef(stamp, launched.pid), { termGraceMs: 0 });
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
  const child = await spawnLoggedProcess(sidecarSpawnRequest({
    ...request,
    detached: request.detached ?? (process.platform === "win32"),
    stamp,
  }));
  if (child.pid == null) throw new Error("spawned sidecar process has no pid");
  const rootPid = child.pid;
  const ref = sidecarGenerationRef(stamp, rootPid);
  const childProcess = child as ChildProcess & { pid: number };
  let stopTask: Promise<SidecarStopResult> | null = null;
  return {
    process: childProcess,
    stamp,
    stop(options = {}) {
      stopTask ??= retireKnownSidecarGeneration(ref, options).finally(() => {
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
  return await retireObservedSidecarGeneration(await observeSidecarGeneration(exact), options);
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
  const inspected = await observeSidecarGeneration(stamp);
  const previous = inspected.description;
  const requestedPort = request.resources.port;
  const knownPort = previous?.resources.port ?? 0;
  if (options.requireConcretePort === true && requestedPort === 0 && knownPort === 0) {
    throw new Error("cannot restart sidecar without a concrete port");
  }
  const stop = await retireObservedSidecarGeneration(inspected, options.stop ?? {});
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
    const cleanup = await retireKnownSidecarGeneration(sidecarGenerationRef(stamp, launched.pid), { termGraceMs: 0 });
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
    const description = await describeSidecarGeneration(stamp);
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
    const description = await describeSidecarGeneration(stamp);
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
