import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  releaseChannelFromNamespace,
  releaseChannelFromVersion,
} from "@open-design/release";
import {
  accessControlPlane,
  type SidecarControlAccess,
  type SidecarControlScope,
} from "@open-design/sidecar/control";

import type { ToolPackConfig } from "./config.js";

export function createToolPackControl(
  config: ToolPackConfig,
): SidecarControlAccess {
  const fallbackChannel = releaseChannelFromVersion(config.appVersion)
    ?? releaseChannelFromNamespace(config.namespace, "default")
    ?? "local";
  const namespaceRoot = resolve(config.roots.runtime.namespaceRoot);
  let scope: SidecarControlScope = { channel: fallbackChannel, generation: 0, namespace: config.namespace };
  let newestIdentityMtime = Number.NEGATIVE_INFINITY;
  for (const name of ["desktop-root.json", "headless-root.json"]) {
    const identityPath = join(namespaceRoot, "runtime", name);
    try {
      const identity = JSON.parse(readFileSync(identityPath, "utf8")) as {
        runtime?: { channel?: unknown; generation?: unknown; namespace?: unknown };
      };
      const mtime = statSync(identityPath).mtimeMs;
      if (
        mtime > newestIdentityMtime
        && typeof identity.runtime?.channel === "string"
        && Number.isSafeInteger(identity.runtime.generation)
        && (identity.runtime.generation as number) >= 0
        && identity.runtime.namespace === config.namespace
      ) {
        newestIdentityMtime = mtime;
        scope = {
          channel: identity.runtime.channel,
          generation: identity.runtime.generation as number,
          namespace: config.namespace,
        };
      }
    } catch {
      // Missing or invalid identities do not define a live control scope.
    }
  }
  return accessControlPlane({
    runtimeRoot: join(namespaceRoot, "runtime"),
    scope,
  });
}
