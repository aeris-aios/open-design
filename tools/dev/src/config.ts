import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPEN_DESIGN_RUNTIME_DEFAULTS,
  OPEN_DESIGN_SERVICES,
  normalizeOpenDesignNamespace,
} from "@open-design/contracts/runtime/sidecars";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

export const ALL_APPS = [OPEN_DESIGN_SERVICES.DAEMON, OPEN_DESIGN_SERVICES.WEB, OPEN_DESIGN_SERVICES.DESKTOP] as const;
export const DEFAULT_START_APPS = [...ALL_APPS] as const;
export const DEFAULT_RUN_APPS = [OPEN_DESIGN_SERVICES.DAEMON, OPEN_DESIGN_SERVICES.WEB] as const;
export const DEFAULT_STOP_APPS = [OPEN_DESIGN_SERVICES.DESKTOP, OPEN_DESIGN_SERVICES.WEB, OPEN_DESIGN_SERVICES.DAEMON] as const;

export type ToolDevAppName = (typeof ALL_APPS)[number];

export type ToolDevOptions = {
  daemonPort?: number | string | null;
  json?: boolean;
  namespace?: string;
  prod?: boolean;
  toolsDevRoot?: string;
  webPort?: number | string | null;
};

export type ToolDevAppConfig = {
  app: ToolDevAppName;
  latestLogPath: string;
  logDir: string;
};

export type ToolDevConfig = {
  apps: {
    daemon: ToolDevAppConfig & {
      sidecarEntryPath: string;
    };
    desktop: ToolDevAppConfig & {
      electronBinaryPath: string;
      mainEntryPath: string;
      packageJsonPath: string;
    };
    web: ToolDevAppConfig & {
      nextDistDir: string;
      nextTsconfigPath: string;
      sidecarEntryPath: string;
    };
  };
  namespace: string;
  namespaceRoot: string;
  toolsDevRoot: string;
  tsxCliPath: string;
  workspaceRoot: string;
};

function resolveTsxCliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("tsx/cli");
}

function resolveElectronBinaryPath(workspaceRoot: string): string {
  const packageJsonPath = path.join(workspaceRoot, "apps/desktop/package.json");
  const require = createRequire(packageJsonPath);
  const electron = require("electron") as unknown;
  if (typeof electron === "string" && electron.length > 0) return electron;
  return require.resolve("electron/cli.js");
}

function resolveAppConfig(options: {
  app: ToolDevAppName;
  namespace: string;
  namespaceRoot: string;
  toolsDevRoot: string;
}): ToolDevAppConfig {
  return {
    app: options.app,
    latestLogPath: path.join(options.namespaceRoot, "logs", options.app, "latest.log"),
    logDir: path.join(options.namespaceRoot, "logs", options.app),
  };
}

export function isToolDevAppName(value: string): value is ToolDevAppName {
  return ALL_APPS.includes(value as ToolDevAppName);
}

function unsupportedAppError(value: string): Error {
  return new Error(`unsupported tools-dev app: ${value} (expected one of: ${ALL_APPS.join(", ")})`);
}

export function resolveTargetApps(appName: string | undefined, defaults: readonly ToolDevAppName[]): ToolDevAppName[] {
  if (appName == null) return [...defaults];
  if (!isToolDevAppName(appName)) throw unsupportedAppError(appName);
  return [appName];
}

export function resolveStartApps(appName: string | undefined): ToolDevAppName[] {
  if (appName == null) return [...DEFAULT_START_APPS];
  if (!isToolDevAppName(appName)) throw unsupportedAppError(appName);
  if (appName === OPEN_DESIGN_SERVICES.WEB) return [OPEN_DESIGN_SERVICES.DAEMON, OPEN_DESIGN_SERVICES.WEB];
  if (appName === OPEN_DESIGN_SERVICES.DESKTOP) return [...ALL_APPS];
  return [OPEN_DESIGN_SERVICES.DAEMON];
}

export function resolveRunApps(appName: string | undefined): ToolDevAppName[] {
  if (appName == null) return [...DEFAULT_RUN_APPS];
  return resolveStartApps(appName);
}

export function resolveStopApps(appName: string | undefined): ToolDevAppName[] {
  if (appName == null) return [...DEFAULT_STOP_APPS];
  if (!isToolDevAppName(appName)) throw unsupportedAppError(appName);
  if (appName === OPEN_DESIGN_SERVICES.WEB) return [OPEN_DESIGN_SERVICES.WEB, OPEN_DESIGN_SERVICES.DAEMON];
  if (appName === OPEN_DESIGN_SERVICES.DESKTOP) return [OPEN_DESIGN_SERVICES.DESKTOP];
  return [OPEN_DESIGN_SERVICES.DAEMON];
}

export function parsePortOption(value: number | string | null | undefined, optionName: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${optionName} must be an integer between 1 and 65535`);
  }
  return parsed;
}

export function parseParentPidOption(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--parent-pid must be a positive safe integer`);
  }
  return parsed;
}

export function resolveToolDevConfig(options: ToolDevOptions = {}): ToolDevConfig {
  const namespace = normalizeOpenDesignNamespace(options.namespace ?? OPEN_DESIGN_RUNTIME_DEFAULTS.namespace);
  const toolsDevRoot = path.resolve(options.toolsDevRoot ?? path.join(WORKSPACE_ROOT, ".tmp", "tools-dev"));
  const namespaceRoot = path.join(toolsDevRoot, namespace);
  const daemon = resolveAppConfig({ app: OPEN_DESIGN_SERVICES.DAEMON, namespace, namespaceRoot, toolsDevRoot });
  const desktop = resolveAppConfig({ app: OPEN_DESIGN_SERVICES.DESKTOP, namespace, namespaceRoot, toolsDevRoot });
  const web = resolveAppConfig({ app: OPEN_DESIGN_SERVICES.WEB, namespace, namespaceRoot, toolsDevRoot });
  const desktopPackageJsonPath = path.join(WORKSPACE_ROOT, "apps/desktop/package.json");
  let cachedElectronBinaryPath: string | undefined;

  return {
    apps: {
      daemon: {
        ...daemon,
        sidecarEntryPath: path.join(WORKSPACE_ROOT, "apps/daemon/src/sidecar/index.ts"),
      },
      desktop: {
        ...desktop,
        get electronBinaryPath() {
          if (cachedElectronBinaryPath == null) cachedElectronBinaryPath = resolveElectronBinaryPath(WORKSPACE_ROOT);
          return cachedElectronBinaryPath;
        },
        mainEntryPath: path.join(WORKSPACE_ROOT, "apps/desktop/dist/main/index.js"),
        packageJsonPath: desktopPackageJsonPath,
      },
      web: {
        ...web,
        nextDistDir: path.join(namespaceRoot, OPEN_DESIGN_SERVICES.WEB, "next"),
        nextTsconfigPath: path.join(namespaceRoot, OPEN_DESIGN_SERVICES.WEB, "tsconfig.json"),
        sidecarEntryPath: path.join(WORKSPACE_ROOT, "apps/web/sidecar/index.ts"),
      },
    },
    namespace,
    namespaceRoot,
    toolsDevRoot,
    tsxCliPath: resolveTsxCliPath(),
    workspaceRoot: WORKSPACE_ROOT,
  };
}
