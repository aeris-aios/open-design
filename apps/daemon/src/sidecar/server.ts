import { randomBytes } from "node:crypto";

import {
  OPEN_DESIGN_RUNTIME_ENV,
  type DaemonStatusSnapshot,
  type MintImportTokenResult,
  type OpenDesignRuntimeContext,
  type RegisterDesktopAuthInput,
  type RegisterDesktopAuthResult,
  type RegisterWebUrlInput,
  type RegisterWebUrlResult,
} from "@open-design/contracts/runtime/sidecars";
import {
  type SidecarControlPlane,
} from "@open-design/sidecar/control";
import type {
  DesktopExportArtifactInput,
  DesktopExportArtifactResult,
  DesktopExportPdfInput,
  DesktopExportPdfResult,
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
  DesktopSidecarMethods,
} from "@open-design/host/sidecar";

import { startDaemonRuntime, type StartedDaemonRuntime } from "../daemon-startup.js";
import {
  getDesktopAuthSecret,
  isDesktopAuthGateActive,
  isDesktopAuthRegistered,
  setDesktopAuthSecret,
  signDesktopImportToken,
} from "../desktop-auth.js";

/**
 * PR #974 round 6 (mrcfps): pure wrapper that overlays the live
 * `desktopAuthGateActive` flag on a cached startup snapshot. The
 * STATUS IPC handler and the public `status()` method both call this
 * so the gate flag is always read fresh (it flips after
 * REGISTER_DESKTOP_AUTH and stays sticky), even though the rest of
 * the snapshot is captured once at boot. Exported so the daemon
 * test suite can pin the wiring without booting a real IPC server.
 */
export function withCurrentDesktopAuthGate(snapshot: DaemonStatusSnapshot): DaemonStatusSnapshot {
  return { ...snapshot, desktopAuthGateActive: isDesktopAuthGateActive() };
}

const DAEMON_PORT_ENV = OPEN_DESIGN_RUNTIME_ENV.DAEMON_PORT;
const WEB_PORT_ENV = OPEN_DESIGN_RUNTIME_ENV.WEB_PORT;
const TOOLS_DEV_PARENT_PID_ENV = OPEN_DESIGN_RUNTIME_ENV.TOOLS_DEV_PARENT_PID;
const DESKTOP_IMPORT_TOKEN_TTL_MS = 60_000;

export type DaemonSidecarHandle = {
  mintImportToken(baseDir: string): MintImportTokenResult;
  registerDesktopAuth(input: RegisterDesktopAuthInput): RegisterDesktopAuthResult;
  registerWebUrl(input: RegisterWebUrlInput): RegisterWebUrlResult;
  status(): Promise<DaemonStatusSnapshot>;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
};

function parsePort(value: string | undefined): number {
  if (value == null || value.trim().length === 0) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${DAEMON_PORT_ENV} must be an integer between 0 and 65535`);
  }
  return port;
}

function parseOptionalTrustedWebPort(value: string | undefined): number | null {
  const port = parsePort(value);
  return port > 0 ? port : null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function attachParentMonitor(stop: () => Promise<void>): void {
  const parentPid = Number(process.env[TOOLS_DEV_PARENT_PID_ENV]);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  const timer = setInterval(() => {
    if (isProcessAlive(parentPid)) return;
    clearInterval(timer);
    void stop().finally(() => process.exit(0));
  }, 1000);
  timer.unref();
}

export function mintImportTokenForCli(baseDir: string): MintImportTokenResult {
  if (!isDesktopAuthGateActive()) {
    return {
      ok: false,
      code: "DESKTOP_AUTH_INACTIVE",
      message: "desktop import auth gate is inactive",
      retryable: false,
    };
  }
  const secret = getDesktopAuthSecret();
  if (secret == null || !isDesktopAuthRegistered()) {
    return {
      ok: false,
      code: "DESKTOP_AUTH_PENDING",
      message: "desktop auth required but secret not yet registered",
      retryable: true,
    };
  }
  const nonce = randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + DESKTOP_IMPORT_TOKEN_TTL_MS).toISOString();
  return {
    ok: true,
    expiresAt,
    token: signDesktopImportToken(secret, baseDir, { nonce, exp: expiresAt }),
  };
}

export async function startDaemonSidecar(
  runtime: OpenDesignRuntimeContext,
  control: SidecarControlPlane,
): Promise<DaemonSidecarHandle> {
  const desktop = () => control.connect<DesktopSidecarMethods>("desktop");
  const serverHandle: StartedDaemonRuntime = await startDaemonRuntime({
    desktopPdfExporter: async (input: DesktopExportPdfInput): Promise<DesktopExportPdfResult> => {
      return await (await desktop()).call("exportPdf", input, { timeoutMs: 600_000 });
    },
    desktopSlideRenderer: async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
      return await (await desktop()).call("renderSlides", input, { timeoutMs: 600_000 });
    },
    desktopArtifactExporter: async (input: DesktopExportArtifactInput): Promise<DesktopExportArtifactResult> => {
      return await (await desktop()).call("exportArtifact", input, { timeoutMs: 600_000 });
    },
    port: parsePort(process.env[DAEMON_PORT_ENV]),
    runtime,
  });

  // PR #974 round 6 (mrcfps): tools-dev's split-start hardening reads
  // `desktopAuthGateActive` from the STATUS IPC. The flag is dynamic
  // (flips to true on REGISTER_DESKTOP_AUTH) so the STATUS handler and
  // the public `status()` method below recompute it from
  // `isDesktopAuthGateActive()` per request — the value cached here is
  // a startup snapshot only.
  const state: DaemonStatusSnapshot = {
    desktopAuthGateActive: isDesktopAuthGateActive(),
    pid: process.pid,
    state: "running",
    trustedWebOriginPort: parseOptionalTrustedWebPort(process.env[WEB_PORT_ENV]),
    updatedAt: new Date().toISOString(),
    url: serverHandle.url,
  };
  let stopped = false;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((resolveStop) => {
    resolveStopped = resolveStop;
  });

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    state.state = "stopped";
    state.updatedAt = new Date().toISOString();
    await serverHandle.stop().catch(() => undefined);
    resolveStopped();
  }

  attachParentMonitor(stop);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stop().finally(() => process.exit(0));
    });
  }

  return {
    mintImportToken(baseDir) {
      return mintImportTokenForCli(baseDir);
    },
    registerDesktopAuth(input) {
      setDesktopAuthSecret(Buffer.from(input.secret, "base64"));
      return { accepted: true };
    },
    registerWebUrl(input) {
      const webPort = Number(new URL(input.url).port);
      process.env[WEB_PORT_ENV] = String(webPort);
      state.trustedWebOriginPort = webPort;
      state.updatedAt = new Date().toISOString();
      return { accepted: true };
    },
    async status() {
      return withCurrentDesktopAuthGate(state);
    },
    stop,
    waitUntilStopped() {
      return stoppedPromise;
    },
  };
}
