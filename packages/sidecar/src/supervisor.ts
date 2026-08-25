import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import {
  captureProcessSnapshot,
  createProcessStampArgs,
  isProcessAlive,
  stopProcesses,
} from "@open-design/platform";

import {
  readSidecarLaunchResources,
  SIDECAR_GENERATION_PID_ENV,
  SIDECAR_SUPERVISOR_TARGET_ENV,
} from "./client.js";
import { collectSidecarGenerationPids } from "./process-tree.js";
import { readCurrentSidecarStamp, SIDECAR_STAMP_CONTRACT } from "./stamp.js";

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
const stamp = readCurrentSidecarStamp();
const childEnv: NodeJS.ProcessEnv = { ...process.env, [SIDECAR_GENERATION_PID_ENV]: String(process.pid) };
delete childEnv[SIDECAR_SUPERVISOR_TARGET_ENV];
if (target.electronRunAsNode == null) delete childEnv.ELECTRON_RUN_AS_NODE;
else childEnv.ELECTRON_RUN_AS_NODE = target.electronRunAsNode;

const child = spawn(target.command, [
  ...target.args,
  ...createProcessStampArgs(stamp, SIDECAR_STAMP_CONTRACT),
], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
  windowsHide: true,
});

const ownerPid = readSidecarLaunchResources().ownerPid;
let ownerShutdownTask: Promise<void> | null = null;
async function stopTargetAfterOwnerDeath(): Promise<void> {
  if (child.pid == null) return;
  const rootPid = child.pid;
  try { child.kill("SIGTERM"); } catch {}
  await sleep(5_000);
  if (!isProcessAlive(rootPid)) return;
  let ownedPids = [rootPid];
  try {
    ownedPids = collectSidecarGenerationPids(await captureProcessSnapshot(), [rootPid], stamp);
  } catch {
    // The exact child pid remains a safe fallback when process discovery fails.
  }
  const stopped = await stopProcesses(ownedPids, { killGraceMs: 1_000, termGraceMs: 0 });
  if (stopped.remainingPids.length > 0) {
    console.error(`sidecar supervisor could not stop ownerless target: ${stopped.remainingPids.join(", ")}`);
    process.exitCode = 1;
  }
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
