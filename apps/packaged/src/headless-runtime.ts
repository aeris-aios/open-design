import { mkdir } from "node:fs/promises";

import {
  OPEN_DESIGN_SERVICES,
} from "@open-design/contracts/runtime/sidecars";
import type { DesktopStatusSnapshot } from "@open-design/host/sidecar";

import type { PackagedConfig } from "./config.js";
import { createPackagedControl } from "./control.js";
import type { PackagedDesktopIdentityHandle } from "./identity.js";
import { writePackagedDesktopIdentity, writePackagedWebIdentity } from "./identity.js";
import { confirmPackagedLauncherRuntime, resolvePackagedLauncherRuntime } from "./launcher-runtime.js";
import { resolvePackagedNamespacePaths } from "./paths.js";
import type { PackagedSidecarHandle } from "./sidecars.js";
import { startPackagedSidecars } from "./sidecars.js";

function colorize(text: string): string {
  if (process.stdout.isTTY !== true || process.env.NO_COLOR != null) return text;
  return `\x1b[36m\x1b[4m${text}\x1b[0m`;
}

export interface PackagedMcpBootstrapLaunch {
  args: string[];
  command: string;
}

export interface PackagedHeadlessRequest {
  headless: boolean;
  mcpInstallAgent: "codex" | null;
}

export interface RunPackagedHeadlessOptions {
  mcpBootstrapLaunch?: PackagedMcpBootstrapLaunch;
}

export interface PackagedHeadlessStartupDependencies {
  confirmRuntime(): Promise<void>;
  createControlServer(options: {
    shutdown(): Promise<void>;
    webUrl: string;
  }): Promise<{ close(): Promise<void> }>;
  exit(code: number): void;
  installMcp(daemonUrl: string | null): Promise<void>;
  startSidecars(): Promise<PackagedSidecarHandle>;
  writeIdentity(): Promise<PackagedDesktopIdentityHandle>;
  writeWebIdentity(webUrl: string): Promise<void>;
}

export interface PackagedHeadlessStartupHandle {
  shutdown(): Promise<void>;
  webUrl: string;
}

export async function acquirePackagedHeadlessStartup(
  dependencies: PackagedHeadlessStartupDependencies,
): Promise<PackagedHeadlessStartupHandle> {
  let identity: PackagedDesktopIdentityHandle | null = null;
  let sidecars: PackagedSidecarHandle | null = null;
  let controlServer: { close(): Promise<void> } | null = null;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await controlServer?.close().catch(() => undefined);
    await sidecars?.close().catch(() => undefined);
    await identity?.close().catch(() => undefined);
  };
  const shutdown = async (): Promise<void> => {
    await close();
    dependencies.exit(0);
  };

  try {
    identity = await dependencies.writeIdentity();
    sidecars = await dependencies.startSidecars();
    const webUrl = sidecars.web.url;
    if (!webUrl) {
      throw new Error(
        "web sidecar failed to produce URL — check logs/desktop/latest.log",
      );
    }
    await dependencies.installMcp(sidecars.daemon.url);
    controlServer = await dependencies.createControlServer({ shutdown, webUrl });
    await dependencies.writeWebIdentity(webUrl);
    await dependencies.confirmRuntime();
    return { shutdown, webUrl };
  } catch (error) {
    await close();
    throw error;
  }
}

export function parsePackagedHeadlessRequest(
  argv: readonly string[],
): PackagedHeadlessRequest {
  const headless = argv.includes("--headless");
  const installIndex = argv.indexOf("--mcp-install");
  if (installIndex === -1) return { headless, mcpInstallAgent: null };
  if (!headless) {
    throw new Error("--mcp-install requires --headless");
  }
  const agent = argv[installIndex + 1];
  if (agent !== "codex") {
    throw new Error(
      "Packaged headless MCP installation currently only supports codex.",
    );
  }
  return { headless: true, mcpInstallAgent: agent };
}

export function resolvePackagedMcpBootstrapLaunch(options: {
  currentExecutablePath?: string;
  installedLaunchPath: string | null;
  platform?: NodeJS.Platform;
}): PackagedMcpBootstrapLaunch {
  const platform = options.platform ?? process.platform;
  const currentExecutablePath =
    options.currentExecutablePath ?? process.execPath;
  if (
    platform === "darwin"
    && options.installedLaunchPath?.endsWith(".app")
  ) {
    return {
      command: "/usr/bin/open",
      args: [
        "-g",
        "-j",
        options.installedLaunchPath,
        "--args",
        "--headless",
      ],
    };
  }
  return {
    command: options.installedLaunchPath ?? currentExecutablePath,
    args: ["--headless"],
  };
}

export async function runPackagedHeadless(
  config: PackagedConfig,
  request: PackagedHeadlessRequest = {
    headless: true,
    mcpInstallAgent: null,
  },
  options: RunPackagedHeadlessOptions = {},
): Promise<void> {
  const initialPaths = resolvePackagedNamespacePaths(
    config,
    config.namespace,
    process.env,
  );
  const launcherRuntime = await resolvePackagedLauncherRuntime(config, initialPaths);
  const activeConfig = launcherRuntime.config;
  const paths = launcherRuntime.paths;
  const mcpBootstrap =
    options.mcpBootstrapLaunch
    ?? resolvePackagedMcpBootstrapLaunch({
      installedLaunchPath: launcherRuntime.installedLaunchPath,
    });

  await mkdir(paths.runtimeRoot, { recursive: true });

  const { control, runtime } = createPackagedControl(
    activeConfig.appVersion,
    launcherRuntime.selection.selected ? launcherRuntime.selection.pointer.generation : 0,
    config.namespace,
    paths,
  );

  const { shutdown, webUrl } = await acquirePackagedHeadlessStartup({
    confirmRuntime: async () => await confirmPackagedLauncherRuntime(launcherRuntime),
    createControlServer: async ({ shutdown: stop, webUrl: activeWebUrl }) =>
      await control.expose<{ status: { input: Record<string, never>; output: DesktopStatusSnapshot } }>({
        service: OPEN_DESIGN_SERVICES.DESKTOP,
        handlers: {
          status: async () => ({
            pid: process.pid,
            state: "running",
            updatedAt: new Date().toISOString(),
            url: activeWebUrl,
            windowVisible: false,
          }),
        },
        onStopRequested: async () => { setImmediate(() => { void stop(); }); },
      }),
    exit: (code) => process.exit(code),
    installMcp: async (daemonUrl) => {
      if (request.mcpInstallAgent === "codex") {
        await installCodexMcp(daemonUrl);
      }
    },
    startSidecars: async () =>
      await startPackagedSidecars(control, paths, {
        appVersion: activeConfig.appVersion,
        amrProfile: activeConfig.amrProfile,
        daemonCliEntry: activeConfig.daemonCliEntry,
        daemonSidecarEntry: activeConfig.daemonSidecarEntry,
        electronNodeCommand: launcherRuntime.electronNodeCommand,
        mcpBootstrapArgs: mcpBootstrap.args,
        mcpBootstrapCommand: mcpBootstrap.command,
        nodeCommand: activeConfig.nodeCommand,
        telemetryRelayUrl: activeConfig.telemetryRelayUrl,
        posthogKey: activeConfig.posthogKey,
        posthogHost: activeConfig.posthogHost,
        velaWebUrl: activeConfig.velaWebUrl,
        velaWebUrls: activeConfig.velaWebUrls,
        // PR #974 round-5 (lefarcen P2): headless packaged mode uses the signed
        // Electron entry as a lifecycle owner, but creates no BrowserWindow and
        // exposes no privileged shell.openPath surface.
        // Pinning OD_REQUIRE_DESKTOP_AUTH here would arm a gate no client
        // can ever satisfy (no desktop window/main bridge to register a secret),
        // so folder import would permanently return DESKTOP_AUTH_PENDING.
        // The Electron entry counterpart in `apps/packaged/src/index.ts`
        // passes `true` because it does start that desktop bridge.
        requireDesktopAuth: false,
        webSidecarEntry: activeConfig.webSidecarEntry,
        webStandaloneRoot: activeConfig.webStandaloneRoot,
        webOutputMode: activeConfig.webOutputMode,
      }),
    // Write a headless-specific identity marker so `tools-pack linux stop
    // --headless` can find this process without confusing it for a
    // menu-launched AppImage that owns desktop-root.json in the same namespace.
    writeIdentity: async () =>
      await writePackagedDesktopIdentity({
        identityPath: paths.headlessIdentityPath,
        paths,
        runtime,
      }),
    writeWebIdentity: async (activeWebUrl) =>
      await writePackagedWebIdentity({
        paths,
        pid: process.pid,
        url: activeWebUrl,
      }),
  });

  process.stdout.write(`\n Open Design is running\n\n`);
  process.stdout.write(` ➜ ${colorize(webUrl)}\n\n`);
  process.stdout.write(` Press Ctrl+C to stop\n\n`);

  process.on("SIGINT", () => {
    process.stdout.write("\n Shutting down Open Design...\n");
    void shutdown();
  });
  process.on("SIGTERM", () => {
    process.stdout.write("\n Shutting down Open Design...\n");
    void shutdown();
  });
}

async function installCodexMcp(daemonUrl: string | null): Promise<void> {
  if (daemonUrl == null || daemonUrl.length === 0) {
    throw new Error("daemon sidecar failed to produce a URL for MCP install");
  }
  const url = `${daemonUrl.replace(/\/$/u, "")}/api/mcp/install/codex`;
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(
      `Codex MCP install failed (${response.status}): ${detail}`,
    );
  }
  process.stdout.write(" Open Design MCP installed for Codex\n");
}
