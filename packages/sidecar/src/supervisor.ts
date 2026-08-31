import { spawn } from "node:child_process";

import {
  captureProcessSnapshot,
  stopProcesses,
} from "@open-design/platform";

import {
  readSidecarLaunchResources,
  sidecarProtocol,
  SIDECAR_SUPERVISOR_TARGET_ENV,
} from "./client.js";
import { requestJsonIpc } from "./json-ipc.js";
import { retireSupervisedSidecarTargetTree } from "./process-retirement.js";
import {
  readCurrentSidecarArgvStamp,
  resolvePrivateIpcPath,
  serializeSupervisedSidecarContext,
  SIDECAR_SUPERVISED_CONTEXT_ENV,
} from "./stamp.js";

type SupervisorTarget = {
  args: string[];
  command: string;
  electronRunAsNode: string | null;
};

function readTarget(): SupervisorTarget {
  const serialized = process.env[SIDECAR_SUPERVISOR_TARGET_ENV];
  if (serialized == null) throw new Error(`${SIDECAR_SUPERVISOR_TARGET_ENV} is required`);
  const value = JSON.parse(serialized) as Partial<SupervisorTarget>;
  if (typeof value.command !== "string" || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
    throw new Error(`${SIDECAR_SUPERVISOR_TARGET_ENV} is invalid`);
  }
  return {
    args: value.args,
    command: value.command,
    electronRunAsNode: typeof value.electronRunAsNode === "string" ? value.electronRunAsNode : null,
  };
}

const target = readTarget();
const stamp = readCurrentSidecarArgvStamp();
const resources = readSidecarLaunchResources();
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  [SIDECAR_SUPERVISED_CONTEXT_ENV]: serializeSupervisedSidecarContext(stamp, process.pid, resources),
};
delete childEnv[SIDECAR_SUPERVISOR_TARGET_ENV];
delete childEnv[sidecarProtocol.resourcesEnv];
if (target.electronRunAsNode == null) delete childEnv.ELECTRON_RUN_AS_NODE;
else childEnv.ELECTRON_RUN_AS_NODE = target.electronRunAsNode;

const child = spawn(target.command, target.args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
  windowsHide: true,
});

const ownerPid = resources.ownerPid;
let ownerShutdownTask: Promise<void> | null = null;
async function stopTargetAfterOwnerDeath(): Promise<void> {
  if (child.pid == null) return;
  const rootPid = child.pid;
  let snapshots;
  try {
    snapshots = await captureProcessSnapshot();
  } catch {
    // The exact child pid remains a safe fallback when process discovery fails.
    const gracefulStopInitiated = await requestTargetStop();
    if (!gracefulStopInitiated) {
      try { child.kill("SIGTERM"); } catch {}
    }
    const stopped = await stopProcesses([rootPid], { killGraceMs: 1_000, termGraceMs: 5_000 });
    reportOwnerlessSurvivors(stopped.remainingPids);
    return;
  }
  // Fence the live child tree before asking it to stop. A fast graceful exit
  // may reparent resistant descendants, but the entry snapshot still retains
  // the exact processes this supervisor owned at owner-death time.
  const gracefulStopInitiated = await requestTargetStop();
  const stopped = await retireSupervisedSidecarTargetTree({
    rootPid,
    stamp,
    supervisorPid: process.pid,
  }, {
    gracefulStopInitiated,
    knownSnapshots: snapshots,
    stopOptions: { killGraceMs: 1_000, termGraceMs: 5_000 },
  });
  reportOwnerlessSurvivors(stopped.remainingPids);
}

async function requestTargetStop(): Promise<boolean> {
  try {
    const response = await requestJsonIpc<{ accepted?: unknown }>(
      resolvePrivateIpcPath(stamp),
      { targetPids: [process.pid], type: sidecarProtocol.stop },
      { timeoutMs: 750 },
    );
    return response.accepted === true;
  } catch {
    return false;
  }
}

function reportOwnerlessSurvivors(remainingPids: number[]): void {
  if (remainingPids.length === 0) return;
  console.error(`sidecar supervisor could not stop ownerless target: ${remainingPids.join(", ")}`);
  process.exitCode = 1;
}

const ownerTimer = ownerPid == null ? null : setInterval(() => {
  try {
    process.kill(ownerPid, 0);
  } catch {
    if (ownerTimer != null) clearInterval(ownerTimer);
    ownerShutdownTask ??= stopTargetAfterOwnerDeath().catch((error) => {
      console.error("sidecar supervisor failed to stop ownerless target", error);
      process.exitCode = 1;
    });
  }
}, 1_000);
ownerTimer?.unref();

let forwardedSignal: NodeJS.Signals | null = null;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    forwardedSignal = signal;
    if (child.pid != null) {
      try { child.kill(signal); } catch {}
    }
  });
}

child.once("error", (error) => {
  console.error("sidecar supervisor failed to spawn target", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (ownerTimer != null) clearInterval(ownerTimer);
  if (signal != null || forwardedSignal != null) process.exitCode = 0;
  else process.exitCode = code ?? 1;
});
