import {
  OPEN_DESIGN_SERVICES,
  type DaemonSidecarMethods,
  type DaemonStatusSnapshot,
  type WebSidecarMethods,
  type WebStatusSnapshot,
} from "@open-design/contracts/runtime/sidecars";
import type { DesktopSidecarMethods, DesktopStatusSnapshot } from "@open-design/host/sidecar";
import type { SidecarControlPlane } from "@open-design/sidecar/control";

export type AppRuntimeLookup = { control: SidecarControlPlane };

export const DAEMON_STARTUP_TIMEOUT_MS = 120_000;
const WEB_STARTUP_TIMEOUT_MS = 35_000;
const DESKTOP_STARTUP_TIMEOUT_MS = 15_000;

type ProcessAliveProbe = () => boolean;

function assertSpawnedProcessAlive(appName: string, isProcessAlive: ProcessAliveProbe | undefined): void {
  if (isProcessAlive?.() === false) throw new Error(`${appName} exited before exposing status`);
}

export async function inspectDaemonRuntime(runtime: AppRuntimeLookup, timeoutMs = 800): Promise<DaemonStatusSnapshot | null> {
  try {
    const client = await runtime.control.connect<DaemonSidecarMethods>(OPEN_DESIGN_SERVICES.DAEMON);
    return await client.call("status", {}, { timeoutMs });
  } catch {
    return null;
  }
}

export async function waitForDaemonRuntime(
  runtime: AppRuntimeLookup,
  timeoutMs = DAEMON_STARTUP_TIMEOUT_MS,
  isProcessAlive?: ProcessAliveProbe,
): Promise<DaemonStatusSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    assertSpawnedProcessAlive(OPEN_DESIGN_SERVICES.DAEMON, isProcessAlive);
    const snapshot = await inspectDaemonRuntime(runtime, 800);
    if (snapshot?.url != null) return snapshot;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  assertSpawnedProcessAlive(OPEN_DESIGN_SERVICES.DAEMON, isProcessAlive);
  throw new Error("daemon did not expose status in time");
}

export async function inspectWebRuntime(runtime: AppRuntimeLookup, timeoutMs = 800): Promise<WebStatusSnapshot | null> {
  try {
    const client = await runtime.control.connect<WebSidecarMethods>(OPEN_DESIGN_SERVICES.WEB);
    return await client.call("status", {}, { timeoutMs });
  } catch {
    return null;
  }
}

export async function waitForWebRuntime(
  runtime: AppRuntimeLookup,
  timeoutMs = WEB_STARTUP_TIMEOUT_MS,
  isProcessAlive?: ProcessAliveProbe,
): Promise<WebStatusSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    assertSpawnedProcessAlive(OPEN_DESIGN_SERVICES.WEB, isProcessAlive);
    const snapshot = await inspectWebRuntime(runtime, 800);
    if (snapshot?.url != null) return snapshot;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  assertSpawnedProcessAlive(OPEN_DESIGN_SERVICES.WEB, isProcessAlive);
  throw new Error("web did not expose status in time");
}

export async function inspectDesktopRuntime(runtime: AppRuntimeLookup, timeoutMs = 800): Promise<DesktopStatusSnapshot | null> {
  try {
    const client = await runtime.control.connect<DesktopSidecarMethods>(OPEN_DESIGN_SERVICES.DESKTOP);
    return await client.call("status", {}, { timeoutMs });
  } catch {
    return null;
  }
}

export async function waitForDesktopRuntime(
  runtime: AppRuntimeLookup,
  timeoutMs = DESKTOP_STARTUP_TIMEOUT_MS,
  isProcessAlive?: ProcessAliveProbe,
): Promise<DesktopStatusSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    assertSpawnedProcessAlive(OPEN_DESIGN_SERVICES.DESKTOP, isProcessAlive);
    const snapshot = await inspectDesktopRuntime(runtime, 800);
    if (snapshot != null) return snapshot;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  assertSpawnedProcessAlive(OPEN_DESIGN_SERVICES.DESKTOP, isProcessAlive);
  throw new Error("desktop did not expose status in time");
}
