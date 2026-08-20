import {
  createOpenDesignRuntimeProjection,
  OPEN_DESIGN_RUNTIME_DEFAULTS,
  OPEN_DESIGN_RUNTIME_MODES,
  OPEN_DESIGN_RUNTIME_SOURCES,
  type OpenDesignRuntimeContext,
} from "@open-design/contracts/runtime/sidecars";
import { releaseChannelFromIdentity } from "@open-design/release";
import { bootstrapControlPlane, type SidecarControlPlane } from "@open-design/sidecar/control";

import type { PackagedNamespacePaths } from "./paths.js";

export function createPackagedControl(
  appVersion: string | null,
  generation: number,
  namespace: string,
  paths: PackagedNamespacePaths,
): { control: SidecarControlPlane; runtime: OpenDesignRuntimeContext } {
  const channel = releaseChannelFromIdentity(
    appVersion,
    namespace,
    OPEN_DESIGN_RUNTIME_DEFAULTS.namespace,
  ) ?? "local";
  const projection = createOpenDesignRuntimeProjection(
    OPEN_DESIGN_RUNTIME_MODES.RUNTIME,
    OPEN_DESIGN_RUNTIME_SOURCES.PACKAGED,
  );
  const roots = {
    dataRoot: paths.dataRoot,
    logsRoot: paths.logsRoot,
    resourceRoot: paths.resourceRoot,
    runtimeRoot: paths.runtimeRoot,
  };
  return {
    control: bootstrapControlPlane({
      projection,
      roots,
      scope: { channel, generation, namespace },
    }),
    runtime: { ...projection, ...roots, channel, generation, namespace },
  };
}
