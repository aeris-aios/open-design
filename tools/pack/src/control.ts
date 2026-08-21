import { readFileSync, readdirSync } from "node:fs";
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
  type SidecarControlScope,
  type SidecarServicesConvergence,
} from "@open-design/sidecar/control";

import type { ToolPackConfig } from "./config.js";

export type ToolPackControlMode = "desktop" | "headless";

type ToolPackControlAccess = SidecarControlAccess & Readonly<{
  authority: "empty-namespace" | "mode-identity" | "unresolved";
}>;

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
): ToolPackControlAccess {
  const fallbackChannel = releaseChannelFromIdentity(
    config.appVersion,
    config.namespace,
    OPEN_DESIGN_RUNTIME_DEFAULTS.namespace,
  ) ?? "local";
  const namespaceRoot = resolve(config.roots.runtime.namespaceRoot);
  let scope: SidecarControlScope = { channel: fallbackChannel, generation: 0, namespace: config.namespace };
  const identityPath = join(namespaceRoot, "runtime", `${mode}-root.json`);
  let authority: ToolPackControlAccess["authority"] = "mode-identity";
  try {
    const identity = JSON.parse(readFileSync(identityPath, "utf8")) as {
      runtime?: { channel?: unknown; generation?: unknown; namespace?: unknown };
    };
    if (
      typeof identity.runtime?.channel !== "string"
      || !Number.isSafeInteger(identity.runtime.generation)
      || (identity.runtime.generation as number) < 0
      || identity.runtime.namespace !== config.namespace
    ) {
      throw new Error(`invalid ${mode} control identity`);
    }
    scope = {
      channel: identity.runtime.channel,
      generation: identity.runtime.generation as number,
      namespace: config.namespace,
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    authority = missing && !hasControlEvidence(namespaceRoot)
      ? "empty-namespace"
      : "unresolved";
  }
  const control = accessControlPlane({
    runtimeRoot: join(namespaceRoot, "runtime"),
    scope,
  });
  if (authority !== "unresolved") return Object.freeze({ ...control, authority });
  return Object.freeze({
    ...control,
    authority,
    async stop() {
      throw new Error(`cannot prove ${mode} control identity from ${identityPath}`);
    },
  });
}

function hasControlEvidence(namespaceRoot: string): boolean {
  try {
    return readdirSync(join(namespaceRoot, "runtime", ".sidecar-control")).length > 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

export async function stopToolPackServices(
  control: SidecarControlAccess,
): Promise<SidecarServicesConvergence> {
  return await stopSidecarServices(control, TOOL_PACK_SERVICE_STOPS);
}

async function requireToolPackConvergence(
  control: SidecarControlAccess,
): Promise<void> {
  const convergence = await stopToolPackServices(control);
  if (convergence.state === "complete") return;
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

/** Keep the namespace session through both convergence and caller-owned mutation. */
export async function withConvergedToolPackServices<T>(
  control: SidecarControlAccess,
  callback: () => Promise<T>,
): Promise<T> {
  return await control.withLifecycleSession(async () => {
    await requireToolPackConvergence(control);
    return await callback();
  });
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
