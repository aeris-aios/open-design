import { resolve } from "node:path";

import {
  OPEN_DESIGN_RUNTIME_MODES,
  OPEN_DESIGN_RUNTIME_SOURCES,
  createOpenDesignRuntimeProjection,
} from "@open-design/contracts/runtime/sidecars";
import { bootstrapControlPlane, type SidecarControlPlane } from "@open-design/sidecar/control";

import type { ToolDevConfig } from "./config.js";

export function createToolsDevControl(config: ToolDevConfig): SidecarControlPlane {
  return bootstrapControlPlane({
    projection: createOpenDesignRuntimeProjection(
      OPEN_DESIGN_RUNTIME_MODES.DEV,
      OPEN_DESIGN_RUNTIME_SOURCES.TOOLS_DEV,
    ),
    roots: {
      dataRoot: resolve(process.env.OD_DATA_DIR ?? config.namespaceRoot),
      logsRoot: resolve(config.namespaceRoot, "logs"),
      resourceRoot: config.workspaceRoot,
      runtimeRoot: config.namespaceRoot,
    },
    scope: {
      channel: "dev",
      generation: 0,
      namespace: config.namespace,
    },
  });
}
