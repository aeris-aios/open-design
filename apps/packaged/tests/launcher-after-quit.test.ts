import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SidecarControlPlane } from "@open-design/sidecar/control";
import { describe, expect, it, vi } from "vitest";

import {
  inspectExistingDesktopForLauncher,
  waitForLauncherAfterQuit,
} from "../src/launcher-after-quit.js";
import type { PackagedNamespacePaths } from "../src/paths.js";

function paths(root: string): PackagedNamespacePaths {
  return {
    cacheRoot: join(root, "cache"),
    dataRoot: join(root, "data"),
    desktopIdentityPath: join(root, "runtime", "desktop-root.json"),
    desktopLogPath: join(root, "logs", "desktop", "latest.log"),
    desktopLogsRoot: join(root, "logs", "desktop"),
    electronSessionDataRoot: join(root, "user-data", "session"),
    electronUserDataRoot: join(root, "user-data"),
    headlessIdentityPath: join(root, "runtime", "headless-root.json"),
    installationRoot: join(root, ".."),
    installerObservationRoot: join(root, "data", "observations", "installer"),
    logsRoot: join(root, "logs"),
    namespaceRoot: root,
    resourceRoot: join(root, "resources"),
    runtimeRoot: join(root, "runtime"),
    updateRoot: join(root, "updates"),
    webIdentityPath: join(root, "runtime", "web-root.json"),
  };
}

function control(input: {
  desktop?: Record<string, unknown>;
  daemonUrl?: string | null;
  webUrl?: string | null;
  stopped?: boolean;
  stopErrors?: Partial<Record<string, Error>>;
  showError?: Error;
} = {}): { control: SidecarControlPlane; show: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  const show = vi.fn(async () => {
    if (input.showError != null) throw input.showError;
    return { accepted: true as const };
  });
  const stop = vi.fn(async (service: string) => {
    const error = input.stopErrors?.[service];
    if (error != null) throw error;
    return { forced: false, pid: 1234, stopped: input.stopped ?? true };
  });
  const connect = vi.fn(async (service: string) => ({
    call: async (method: string) => {
      if (service === "desktop" && method === "show") return await show();
      if (service === "desktop") return {
        pid: 1234,
        state: "running",
        update: { currentVersion: "0.19.4-beta.9" },
        windowVisible: true,
        ...input.desktop,
      };
      return {
        state: "running",
        url: service === "daemon"
          ? ("daemonUrl" in input ? input.daemonUrl : "http://127.0.0.1:7456")
          : ("webUrl" in input ? input.webUrl : "http://127.0.0.1:3000"),
      };
    },
  }));
  return { control: { connect, stop } as never, show, stop };
}

describe("packaged launcher convergence", () => {
  it("waits for the delegated predecessor without signalling it when it exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-after-quit-"));
    const stopProcesses = vi.fn();
    try {
      await expect(waitForLauncherAfterQuit(
        { targetPid: 4321, timeoutMs: 1000 },
        paths(root),
        console,
        { stopProcesses: stopProcesses as never, waitForExit: vi.fn(async () => true) },
      )).resolves.toBe(true);
      expect(stopProcesses).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("focuses one healthy desktop through its typed capability", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-existing-desktop-"));
    const fake = control();
    try {
      await expect(inspectExistingDesktopForLauncher("release-beta", {
        control: fake.control,
        deeplinkUrl: "opendesign://workspace/invite/test",
        incomingVersion: "0.19.4-beta.9",
        paths: paths(root),
      })).resolves.toEqual({ action: "exit", reason: "existing-focused" });
      expect(fake.show).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exits without launching a duplicate stack when healthy desktop focus fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-existing-desktop-focus-failed-"));
    const fake = control({ showError: new Error("focus rejected") });
    try {
      await expect(inspectExistingDesktopForLauncher("release-beta", {
        control: fake.control,
        incomingVersion: "0.19.4-beta.9",
        paths: paths(root),
      })).resolves.toEqual({ action: "exit", reason: "existing-focus-failed" });
      expect(fake.show).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("converges a stale service set through the atomic control owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-stale-desktop-"));
    const fake = control({ webUrl: null });
    try {
      await expect(inspectExistingDesktopForLauncher("release-beta", {
        control: fake.control,
        incomingVersion: "0.19.4-beta.9",
        paths: paths(root),
      })).resolves.toEqual({ action: "continue", reason: "stale-sidecar" });
      expect(fake.stop.mock.calls).toEqual([
        ["desktop", { graceMs: 15_000 }],
        ["web"],
        ["daemon"],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not launch a replacement when one service fails to converge", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-partial-desktop-"));
    const fake = control({
      stopErrors: { desktop: new Error("desktop descriptor mismatch") },
      webUrl: null,
    });
    try {
      await expect(inspectExistingDesktopForLauncher("release-beta", {
        control: fake.control,
        incomingVersion: "0.19.4-beta.9",
        paths: paths(root),
      })).resolves.toEqual({ action: "exit", reason: "existing-focus-failed" });
      expect(fake.stop.mock.calls.map(([service]) => service)).toEqual(["desktop", "web", "daemon"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("converges an older running desktop before handing off to a newer version", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-superseded-desktop-"));
    const fake = control();
    try {
      await expect(inspectExistingDesktopForLauncher("release-beta", {
        control: fake.control,
        incomingVersion: "0.19.4-beta.30",
        paths: paths(root),
      })).resolves.toEqual({ action: "continue", reason: "superseded-version" });
      expect(fake.stop.mock.calls.map(([service]) => service)).toEqual(["desktop", "web", "daemon"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
