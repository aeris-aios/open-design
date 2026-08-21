import type { SpawnProcessRequest, StopProcessesOptions, StopProcessesResult } from "@open-design/platform";
import {
  collectProcessTreePids,
  createProcessStampArgs,
  listProcessSnapshots,
  matchesStampedProcess,
  spawnBackgroundProcess,
  stopProcesses,
} from "@open-design/platform";

import { requestJsonIpc } from "./json-ipc.js";
import { sidecarProtocol, type SidecarResources } from "./client.js";
import { normalizeSidecarStamp, resolvePrivateIpcPath, SIDECAR_STAMP_CONTRACT, type SidecarStamp } from "./stamp.js";

export type SidecarLaunchRequest = Omit<SpawnProcessRequest, "args" | "env"> & {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  resources: Omit<SidecarResources, "pid">;
  stamp: SidecarStamp;
};

export type SidecarStopResult = StopProcessesResult & {
  gracefulAccepted: boolean;
};

export async function launchSidecar(request: SidecarLaunchRequest): Promise<{ pid: number }> {
  const stamp = normalizeSidecarStamp(request.stamp);
  const { args = [], env, resources, ...spawnRequest } = request;
  return await spawnBackgroundProcess({
    ...spawnRequest,
    args: [...args, ...createProcessStampArgs(stamp, SIDECAR_STAMP_CONTRACT)],
    env: {
      ...(env ?? process.env),
      [sidecarProtocol.resourcesEnv]: JSON.stringify({ dataRoot: resources.dataRoot, port: resources.port }),
    },
  });
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
  let gracefulAccepted = false;
  try {
    const response = await requestJsonIpc<{ accepted?: unknown }>(
      resolvePrivateIpcPath(exact),
      { type: sidecarProtocol.stop },
      { timeoutMs: 2_000 },
    );
    gracefulAccepted = response.accepted === true;
  } catch {
    // An absent or stale endpoint is resolved by the exact argv scan below.
  }

  const initial = await findSidecarProcesses(exact);
  if (initial.length === 0) {
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
  let remaining = initial;
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    remaining = await findSidecarProcesses(exact);
  }
  if (remaining.length === 0) {
    return {
      alreadyStopped: false,
      forcedPids: [],
      gracefulAccepted,
      matchedPids: initial.map(({ pid }) => pid),
      remainingPids: [],
      stoppedPids: initial.map(({ pid }) => pid),
    };
  }

  const snapshots = await listProcessSnapshots();
  const exactRoots = snapshots.filter((processInfo) =>
    matchesStampedProcess(processInfo, exact, SIDECAR_STAMP_CONTRACT),
  );
  const pids = collectProcessTreePids(snapshots, exactRoots.map(({ pid }) => pid));
  const forced = await stopProcesses(pids, { termGraceMs: 0, killGraceMs: options.killGraceMs });
  return { ...forced, alreadyStopped: false, gracefulAccepted };
}
