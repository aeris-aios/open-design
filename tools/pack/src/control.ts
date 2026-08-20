import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
} from "@open-design/release";
import {
  OPEN_DESIGN_SERVICES as APP_KEYS,
} from "@open-design/contracts/runtime/sidecars";
import {
  accessControlPlane,
  stopSidecarServices,
  type SidecarControlAccess,
  type SidecarConvergeResult,
  type SidecarControlScope,
} from "@open-design/sidecar/control";

import type { ToolPackConfig } from "./config.js";

export type ToolPackControlMode = "desktop" | "headless";

const TOOL_PACK_SERVICE_STOPS = [
  { service: APP_KEYS.DESKTOP, options: { graceMs: 15_000 } },
  { service: APP_KEYS.WEB },
  { service: APP_KEYS.DAEMON },
] as const;

export function createToolPackControl(
  config: ToolPackConfig,
  mode: ToolPackControlMode,
): SidecarControlAccess {
  const fallbackChannel = releaseChannelFromVersion(config.appVersion)
    ?? releaseChannelFromNamespace(config.namespace, "default")
    ?? "local";
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
): Promise<SidecarConvergeResult[]> {
  const attempts = await stopSidecarServices(control, TOOL_PACK_SERVICE_STOPS);
  const failures = attempts.flatMap((attempt) =>
    attempt.status === "rejected"
      ? [new Error(`failed to stop ${attempt.service}`, { cause: attempt.error })]
      : []
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "failed to converge one or more packaged services");
  }
  return attempts.map((attempt) => {
    if (attempt.status !== "fulfilled") throw new Error("unreachable rejected stop attempt");
    return attempt.result;
  });
}

export async function convergeToolPackServices(
  control: SidecarControlAccess,
): Promise<SidecarConvergeResult[]> {
  const results = await stopToolPackServices(control);
  const failures = results.flatMap((result, index) =>
    result.stopped
      ? []
      : [new Error(
          `could not prove ${TOOL_PACK_SERVICE_STOPS[index]!.service} stopped`
          + (result.pid == null ? "" : ` (pid ${result.pid})`),
        )],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "failed to converge one or more packaged services");
  }
  return results;
}
