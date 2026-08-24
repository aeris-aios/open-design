import { spawn } from "node:child_process";

import { createProcessStampArgs } from "@open-design/platform";

import { SIDECAR_GENERATION_PID_ENV, SIDECAR_SUPERVISOR_TARGET_ENV } from "./client.js";
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

const serializedResources = process.env.OD_SIDECAR_RESOURCES;
const ownerPid = serializedResources == null
  ? null
  : (() => {
      try {
        const value = Number((JSON.parse(serializedResources) as { ownerPid?: unknown }).ownerPid);
        return Number.isSafeInteger(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    })();
const ownerTimer = ownerPid == null ? null : setInterval(() => {
  try {
    process.kill(ownerPid, 0);
  } catch {
    if (child.pid != null) {
      try { child.kill("SIGTERM"); } catch {}
    }
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
