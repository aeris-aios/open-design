import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { stopProcesses, waitForProcessExit, type StopProcessesResult } from "@open-design/platform";
import { compareLauncherVersions, type LauncherAfterQuitRequest } from "@open-design/launcher-proto";
import {
  OPEN_DESIGN_SERVICES as APP_KEYS,
  type DaemonSidecarMethods,
  type OpenDesignService as AppKey,
  type WebSidecarMethods,
} from "@open-design/contracts/runtime/sidecars";
import type { DesktopSidecarMethods } from "@open-design/host/sidecar";
import {
  accessControlPlane,
  stopSidecarServices,
  type SidecarControlAccess,
} from "@open-design/sidecar/control";

import { readPackagedDesktopControlIdentity } from "./identity.js";
import type { PackagedNamespacePaths } from "./paths.js";

type LauncherAfterQuitLogger = Pick<Console, "warn"> & Partial<Pick<Console, "info">>;

export type LauncherExistingDesktopGateResult =
  | { action: "continue"; reason: "headless-owner" | "inspect-failed" | "not-running" | "stale-sidecar" | "superseded-version" }
  | { action: "exit"; reason: "existing-focused" | "existing-focus-failed" };

/**
 * Finish a duplicate packaged entry after the healthy namespace desktop has
 * accepted focus (or after focus failed without making a duplicate safe).
 *
 * Returning from `main()` alone does not terminate Electron's event loop: the
 * unused outer can keep a main process and Chromium helpers alive indefinitely.
 */
export function exitPackagedLauncherForExistingDesktop(
  result: LauncherExistingDesktopGateResult,
  exit: (code: number) => void,
): boolean {
  if (result.action !== "exit") return false;
  exit(0);
  return true;
}

async function writeLauncherAfterQuitLog(paths: PackagedNamespacePaths, message: string): Promise<void> {
  const logDir = join(paths.logsRoot, "launcher");
  await mkdir(logDir, { recursive: true });
  await appendFile(
    join(logDir, "after-quit.log"),
    `${new Date().toISOString()} ${message}\n`,
    "utf8",
  );
}

/** Injectable process controls so tests never signal real PIDs. */
export type LauncherProcessControls = {
  stopProcesses: typeof stopProcesses;
  waitForExit: typeof waitForProcessExit;
};

/**
 * Force a desktop process that outlived the launcher's graceful handshake out
 * of its fenced control incarnation.
 *
 * A packaged desktop that ignores SHUTDOWN or never quits keeps holding that
 * socket. A freshly updated daemon then connects to the *stale* desktop, and its
 * newer messages (e.g. `render-slides`, added in 0.13.0) are rejected as
 * "unknown sidecar message" — the version-skew export failure users hit after an
 * update. Escalating SIGTERM→SIGKILL here mirrors how `closeManagedChild`
 * already force-stops daemon/web children that ignore SHUTDOWN, so no
 * skewed desktop is left squatting on the socket the relaunched app must bind.
 *
 * @returns whether the process is confirmed gone (safe to rebind the socket).
 */
async function forceStopLingeringDesktop(
  pid: number | null | undefined,
  context: string,
  paths: PackagedNamespacePaths,
  logger: LauncherAfterQuitLogger,
  stop: typeof stopProcesses,
): Promise<boolean> {
  if (pid == null) return true;
  const result: StopProcessesResult = await stop([pid]);
  const gone = !result.remainingPids.includes(pid);
  const outcome = !gone ? "survived" : result.forcedPids.includes(pid) ? "sigkill" : "sigterm";
  const message = `force-stop ${context} pid=${pid} outcome=${outcome}`;
  await writeLauncherAfterQuitLog(paths, message);
  if (!gone) logger.warn(`[open-design launcher] ${message}`);
  return gone;
}

async function restartExistingDesktop(input: {
  control: SidecarControlAccess;
  namespace: string;
  paths: PackagedNamespacePaths;
  reason: "headless-owner" | "stale-sidecar" | "superseded-version";
}): Promise<boolean> {
  const attempts = await stopSidecarServices(input.control, [
    { service: APP_KEYS.DESKTOP, options: { graceMs: 15_000 } },
    { service: APP_KEYS.WEB },
    { service: APP_KEYS.DAEMON },
  ]);
  const desktop = attempts[0];
  const desktopResult = desktop?.status === "fulfilled" ? desktop.result : null;
  const failedServices = attempts
    .filter((attempt) => attempt.status === "rejected" || !attempt.result.stopped)
    .map((attempt) => attempt.service);
  await writeLauncherAfterQuitLog(
    input.paths,
    `inspect-found-existing namespace=${input.namespace} shutdown=${failedServices.length === 0 ? "exited" : "failed"} reason=${input.reason} pid=${desktopResult?.pid ?? "unknown"} forced=${desktopResult?.forced ?? false} failedServices=${failedServices.join(",") || "none"}`,
  );
  return failedServices.length === 0;
}

function incomingVersionSupersedesExisting(
  incomingVersion: string | null | undefined,
  existingVersion: string | null | undefined,
): boolean {
  if (incomingVersion == null || existingVersion == null) return false;
  const incoming = incomingVersion.trim();
  const existing = existingVersion.trim();
  if (incoming.length === 0 || existing.length === 0) return false;
  try {
    return compareLauncherVersions(incoming, existing) > 0;
  } catch {
    return false;
  }
}

export async function waitForLauncherAfterQuit(
  request: LauncherAfterQuitRequest | null,
  paths: PackagedNamespacePaths,
  logger: LauncherAfterQuitLogger = console,
  controls: Partial<LauncherProcessControls> = {},
): Promise<boolean> {
  if (request == null) return true;
  const waitForExit = controls.waitForExit ?? waitForProcessExit;
  const stop = controls.stopProcesses ?? stopProcesses;
  await writeLauncherAfterQuitLog(paths, `armed targetPid=${request.targetPid} timeoutMs=${request.timeoutMs}`);
  const exited = await waitForExit(request.targetPid, request.timeoutMs);
  if (exited) {
    await writeLauncherAfterQuitLog(paths, `observed-exit targetPid=${request.targetPid}`);
    return true;
  }
  // The old process outlived its quit grace and still holds the fixed socket.
  // Force it off so the relaunched app binds cleanly instead of skewing.
  const message = `timed-out targetPid=${request.targetPid}; forcing stop`;
  await writeLauncherAfterQuitLog(paths, message);
  logger.warn(`[open-design launcher] ${message}`);
  return await forceStopLingeringDesktop(request.targetPid, "after-quit-timeout", paths, logger, stop);
}

export async function inspectExistingDesktopForLauncher(
  namespace: string,
  options: {
    deeplinkUrl?: string | null;
    incomingVersion?: string | null;
    logger?: LauncherAfterQuitLogger;
    paths: PackagedNamespacePaths;
    control?: SidecarControlAccess;
  },
): Promise<LauncherExistingDesktopGateResult> {
  const logger = options.logger ?? console;
  try {
    const identity = options.control == null
      ? await readPackagedDesktopControlIdentity(options.paths)
      : null;
    if (options.control == null && (
      identity == null
      || identity.runtime.namespace !== namespace
      || !Number.isSafeInteger(identity.runtime.generation)
      || identity.runtime.generation < 0
    )) {
      throw new Error("desktop control identity is unavailable");
    }
    const control = options.control ?? accessControlPlane({
      runtimeRoot: options.paths.runtimeRoot,
      scope: {
        channel: identity!.runtime.channel,
        generation: identity!.runtime.generation,
        namespace: identity!.runtime.namespace,
      },
    });
    const desktop = await control.connect<DesktopSidecarMethods>(APP_KEYS.DESKTOP);
    const status = await desktop.call("status", {}, { timeoutMs: 350 });
    if (status.state !== "running") {
      await writeLauncherAfterQuitLog(options.paths, `inspect-not-running namespace=${namespace} state=${status.state}`);
      return { action: "continue", reason: "not-running" };
    }

    const staleSidecars: AppKey[] = [];
    const daemon = await control.connect<DaemonSidecarMethods>(APP_KEYS.DAEMON)
      .then((client) => client.call("status", {}, { timeoutMs: 350 })).catch(() => null);
    const web = await control.connect<WebSidecarMethods>(APP_KEYS.WEB)
      .then((client) => client.call("status", {}, { timeoutMs: 350 })).catch(() => null);
    if (daemon?.url == null) staleSidecars.push(APP_KEYS.DAEMON);
    if (web?.url == null) staleSidecars.push(APP_KEYS.WEB);

    const restart = async (reason: "headless-owner" | "stale-sidecar" | "superseded-version") => {
      const restarted = await restartExistingDesktop({ control, namespace, paths: options.paths, reason });
      return restarted
        ? { action: "continue", reason } as const
        : { action: "exit", reason: "existing-focus-failed" } as const;
    };
    if (staleSidecars.length > 0) return await restart("stale-sidecar");
    if (incomingVersionSupersedesExisting(options.incomingVersion, status.update?.currentVersion)) {
      return await restart("superseded-version");
    }
    if (status.windowVisible === false) return await restart("headless-owner");
    try {
      await desktop.call(
        "show",
        options.deeplinkUrl == null ? {} : { deeplinkUrl: options.deeplinkUrl },
        { timeoutMs: 800 },
      );
    } catch (error) {
      const message = `inspect-found-existing namespace=${namespace} focus=failed error=${error instanceof Error ? error.message : String(error)}`;
      await writeLauncherAfterQuitLog(options.paths, message);
      logger.warn(`[open-design launcher] ${message}`);
      return { action: "exit", reason: "existing-focus-failed" };
    }
    await writeLauncherAfterQuitLog(options.paths, `inspect-found-existing namespace=${namespace} focus=accepted`);
    return { action: "exit", reason: "existing-focused" };
  } catch (error) {
    const message = `inspect-unavailable namespace=${namespace} action=continue error=${error instanceof Error ? error.message : String(error)}`;
    await writeLauncherAfterQuitLog(options.paths, message);
    logger.info?.(`[open-design launcher] ${message}`);
    return { action: "continue", reason: "inspect-failed" };
  }
}
