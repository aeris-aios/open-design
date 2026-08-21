import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  releaseChannelFromIdentity,
} from "@open-design/release";
import {
  OPEN_DESIGN_RUNTIME_DEFAULTS,
  OPEN_DESIGN_SERVICES as APP_KEYS,
} from "@open-design/contracts/runtime/sidecars";
import {
  accessControlPlane,
  stopSidecarServices,
  type SidecarControlAccess,
  type SidecarConvergenceProof,
  type SidecarControlScope,
  type SidecarServicesConvergence,
} from "@open-design/sidecar/control";

import type { ToolPackConfig } from "./config.js";

export type ToolPackControlMode = "desktop" | "headless";

export type ToolPackStopResult = {
  gracefulRequested: boolean;
  namespace: string;
  remainingPids: number[];
  status: "not-running" | "partial" | "stopped";
  stoppedPids: number[];
};

const TOOL_PACK_SERVICE_STOPS = [
  { service: APP_KEYS.DESKTOP, options: { graceMs: 15_000 } },
  { service: APP_KEYS.WEB },
  { service: APP_KEYS.DAEMON },
] as const;

export function createToolPackControl(
  config: ToolPackConfig,
  mode: ToolPackControlMode,
): SidecarControlAccess {
  const fallbackChannel = releaseChannelFromIdentity(
    config.appVersion,
    config.namespace,
    OPEN_DESIGN_RUNTIME_DEFAULTS.namespace,
  ) ?? "local";
  const namespaceRoot = resolve(config.roots.runtime.namespaceRoot);
  let scope: SidecarControlScope = { channel: fallbackChannel, generation: 0, namespace: config.namespace };
  const identityPath = join(namespaceRoot, "runtime", `${mode}-root.json`);
  try {
    const identity = JSON.parse(readFileSync(identityPath, "utf8")) as {
      runtime?: { channel?: unknown; generation?: unknown; namespace?: unknown };
    };
    if (
      typeof identity.runtime?.channel === "string"
      && Number.isSafeInteger(identity.runtime.generation)
      && (identity.runtime.generation as number) >= 0
      && identity.runtime.namespace === config.namespace
    ) {
      scope = {
        channel: identity.runtime.channel,
        generation: identity.runtime.generation as number,
        namespace: config.namespace,
      };
    }
  } catch {
    // A missing or invalid mode-owned identity does not define a live scope.
  }
  return accessControlPlane({
    runtimeRoot: join(namespaceRoot, "runtime"),
    scope,
  });
}

export async function stopToolPackServices(
  control: SidecarControlAccess,
): Promise<SidecarServicesConvergence> {
  return await stopSidecarServices(control, TOOL_PACK_SERVICE_STOPS);
}

export async function convergeToolPackServices(
  control: SidecarControlAccess,
): Promise<SidecarConvergenceProof> {
  const convergence = await stopToolPackServices(control);
  if (convergence.state === "complete") return convergence.proof;
  const failures = convergence.attempts.flatMap((attempt) => {
    if (attempt.status === "rejected") {
      return [new Error(`failed to stop ${attempt.service}`, { cause: attempt.error })];
    }
    return attempt.result.state === "alive"
      ? [new Error(
          `could not prove ${attempt.service} stopped`
          + (attempt.result.pid == null ? "" : ` (pid ${attempt.result.pid})`),
        )]
      : [];
  });
  throw new AggregateError(failures, "failed to converge one or more packaged services");
}

export function summarizeToolPackStopResults(
  namespace: string,
  convergence: SidecarServicesConvergence,
): ToolPackStopResult {
  const results = convergence.attempts.flatMap((attempt) =>
    attempt.status === "fulfilled" ? [attempt.result] : []
  );
  const pids = [...new Set(results.flatMap((result) => result.pid == null ? [] : [result.pid]))];
  const remainingPids = [...new Set(
    results.flatMap((result) => result.state === "alive" && result.pid != null ? [result.pid] : []),
  )];
  const stoppedPids = [...new Set(
    results.flatMap((result) => result.state === "stopped" ? [result.pid] : []),
  )];
  return {
    gracefulRequested: pids.length > 0,
    namespace,
    remainingPids,
    status: convergence.state === "complete"
      ? (pids.length === 0 ? "not-running" : "stopped")
      : "partial",
    stoppedPids,
  };
}

export function isToolPackStopSafeForRemoval(
  stop: Pick<ToolPackStopResult, "status">,
): boolean {
  return stop.status === "stopped" || stop.status === "not-running";
}
