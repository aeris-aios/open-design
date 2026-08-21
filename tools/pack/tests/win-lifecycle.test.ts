import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { SidecarConvergeResult } from "@open-design/sidecar/control";

import type { ToolPackConfig } from "../src/config.js";

const requestJsonIpc = vi.hoisted(() => vi.fn());
const stopControl = vi.hoisted(() => vi.fn<
  (service?: string, options?: { graceMs?: number }) => Promise<SidecarConvergeResult>
>(async () => ({ pid: null, state: "absent" })));
const spawnBackgroundProcess = vi.hoisted(() => vi.fn(async () => ({ pid: 12345 })));
const invokeNsis = vi.hoisted(() => vi.fn<typeof import("../src/win/nsis.js").invokeNsis>());
const queryWinRegistryEntries = vi.hoisted(() =>
  vi.fn<typeof import("../src/win/registry.js").queryWinRegistryEntries>(async () => []),
);
const resolveWinRegisteredPaths = vi.hoisted(() =>
  vi.fn<typeof import("../src/win/registry.js").resolveWinRegisteredPaths>(async (_config, paths) => paths),
);

vi.mock("../src/control.js", async (importOriginal) => {
  return {
    ...await importOriginal<typeof import("../src/control.js")>(),
    createToolPackControl: () => ({
      connect: async (service: string) => ({
        call: async (method: string, input: unknown) => requestJsonIpc(service, { ...input as object, type: method }),
      }),
      stop: stopControl,
      async withLifecycleSession<T>(callback: () => Promise<T>) { return await callback(); },
    }),
  };
});

vi.mock("@open-design/platform", async () => {
  const actual = await vi.importActual<typeof import("@open-design/platform")>("@open-design/platform");
  return {
    ...actual,
    spawnBackgroundProcess,
  };
});

const SIDECAR_MESSAGES = {
  EVAL: "eval",
  SHUTDOWN: "shutdown",
  STATUS: "status",
} as const;

vi.mock("../src/win/nsis.js", async () => {
  const actual = await vi.importActual<typeof import("../src/win/nsis.js")>("../src/win/nsis.js");
  return {
    ...actual,
    invokeNsis,
  };
});

vi.mock("../src/win/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/win/registry.js")>("../src/win/registry.js");
  return {
    ...actual,
    queryWinRegistryEntries,
    resolveWinRegisteredPaths,
  };
});

const {
  cleanupPackedWinNamespace,
  diagnosePackedWinIpc,
  inspectPackedWinApp,
  installPackedWinApp,
  stopPackedWinApp,
  uninstallPackedWinApp,
} = await import("../src/win/lifecycle.js");
const { resolveWinPaths } = await import("../src/win/paths.js");

function createConfig(root: string): ToolPackConfig {
  return {
    appVersion: "0.10.0-beta.1",
    containerized: false,
    electronBuilderCliPath: "electron-builder",
    electronDistPath: "electron-dist",
    electronVersion: "41.3.0",
    macCompression: "normal",
    namespace: "test",
    platform: "win",
    portable: false,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    requireVelaCli: false,
    roots: {
      cacheRoot: join(root, ".cache"),
      output: {
        appBuilderRoot: join(root, "out", "builder"),
        namespaceRoot: join(root, "out", "win", "namespaces", "test"),
        platformRoot: join(root, "out", "win"),
        root: join(root, "out"),
      },
      runtime: {
        namespaceBaseRoot: join(root, "runtime", "win", "namespaces"),
        namespaceRoot: join(root, "runtime", "win", "namespaces", "test"),
      },
      toolPackRoot: join(root, "tools-pack"),
    },
    signed: false,
    silent: true,
    to: "dir",
    webOutputMode: "standalone",
    workspaceRoot: root,
  };
}

async function writeFakeUnpackedExe(config: ToolPackConfig): Promise<void> {
  const paths = resolveWinPaths(config);
  await mkdir(dirname(paths.unpackedExePath), { recursive: true });
  await writeFile(paths.unpackedExePath, "", "utf8");
}

describe("installPackedWinApp", () => {
  it("pins the installed portable config to the tools-pack namespace for bare protocol launches", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));
    const config = { ...createConfig(root), portable: true };
    const paths = resolveWinPaths(config);
    const installedConfigPath = join(paths.installDir, "resources", "open-design-config.json");

    try {
      await mkdir(dirname(paths.setupPath), { recursive: true });
      await writeFile(paths.setupPath, "", "utf8");
      invokeNsis.mockReset();
      invokeNsis.mockImplementation(async () => {
        await mkdir(dirname(installedConfigPath), { recursive: true });
        await writeFile(paths.installedExePath, "", "utf8");
        await writeFile(
          installedConfigPath,
          `${JSON.stringify({ channel: "prerelease", namespace: "baked-default" }, null, 2)}\n`,
          "utf8",
        );
      });

      const result = await installPackedWinApp(config);
      const installedConfig = JSON.parse(await readFile(installedConfigPath, "utf8")) as Record<string, unknown>;

      expect(installedConfig).toMatchObject({
        channel: "prerelease",
        namespace: config.namespace,
        namespaceBaseRoot: config.roots.runtime.namespaceBaseRoot,
      });
      expect(result.lifecycleTimings.map(({ step }) => step)).toContain("pin installed packaged namespace");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("creates the exact fresh install directory before invoking transactional NSIS", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));
    const config = createConfig(root);
    const paths = resolveWinPaths(config);

    try {
      await mkdir(dirname(paths.setupPath), { recursive: true });
      await writeFile(paths.setupPath, "", "utf8");
      invokeNsis.mockReset();
      invokeNsis.mockImplementation(async () => {
        await expect(access(paths.installDir)).resolves.toBeUndefined();
        const installedConfigPath = join(paths.installDir, "resources", "open-design-config.json");
        await mkdir(dirname(installedConfigPath), { recursive: true });
        await writeFile(paths.installedExePath, "", "utf8");
        await writeFile(installedConfigPath, "{}\n", "utf8");
      });

      const result = await installPackedWinApp(config);

      expect(result.installDir).toBe(paths.installDir);
      expect(result.lifecycleTimings.map(({ step }) => step)).toContain("ensure install directory");
      expect(invokeNsis).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([false, true])(
    "refuses install after an unproven stop (existing uninstaller: %s)",
    async (withUninstaller) => {
      const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));
      const config = createConfig(root);
      const paths = resolveWinPaths(config);
      const installedSentinel = join(paths.installDir, "sentinel.txt");
      try {
        await mkdir(dirname(paths.setupPath), { recursive: true });
        await mkdir(paths.installDir, { recursive: true });
        await writeFile(paths.setupPath, "", "utf8");
        await writeFile(installedSentinel, "installed", "utf8");
        if (withUninstaller) await writeFile(paths.uninstallerPath, "uninstaller", "utf8");
        stopControl.mockImplementation(async (service) => service === "web"
          ? { pid: null, state: "alive" }
          : { pid: null, state: "absent" });
        invokeNsis.mockReset();

        await expect(installPackedWinApp(config)).rejects.toThrow(
          "cannot install Windows app after an unproven stop (partial)",
        );
        await expect(readFile(installedSentinel, "utf8")).resolves.toBe("installed");
        expect(invokeNsis).not.toHaveBeenCalled();
      } finally {
        stopControl.mockResolvedValue({ pid: null, state: "absent" });
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});

describe("inspectPackedWinApp", () => {
  it("returns status and diagnostics when eval IPC times out", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));

    try {
      requestJsonIpc.mockReset();
      requestJsonIpc.mockImplementation(async (ipc: string, payload: { type?: string }) => {
        if (payload.type === SIDECAR_MESSAGES.STATUS) {
          if (ipc.includes("daemon")) return { state: "running", url: "http://127.0.0.1:1234" };
          if (ipc.includes("web")) return { state: "running", url: "http://127.0.0.1:5678" };
          return { state: "running", url: "od://app/" };
        }
        if (payload.type === SIDECAR_MESSAGES.EVAL) {
          throw new Error("IPC request timed out: test-pipe");
        }
        throw new Error(`unexpected IPC message: ${String(payload.type)}`);
      });

      const result = await inspectPackedWinApp(createConfig(root), { expr: "document.title" });

      expect(result.status).toEqual({ state: "running", url: "od://app/" });
      expect(result.daemonStatus).toEqual({ state: "running", url: "http://127.0.0.1:1234" });
      expect(result.webStatus).toEqual({ state: "running", url: "http://127.0.0.1:5678" });
      expect(result.eval).toEqual({
        error: "IPC request timed out: test-pipe",
        ok: false,
      });
      expect(result.launcher.exists).toBe(false);
      expect(result.updateCache.releaseCount).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns status errors with launcher diagnostics when status IPC fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));

    try {
      requestJsonIpc.mockReset();
      requestJsonIpc.mockImplementation(async (ipc: string, payload: { type?: string }) => {
        if (payload.type === SIDECAR_MESSAGES.STATUS) {
          if (ipc.includes("daemon")) return { state: "running", url: "http://127.0.0.1:1234" };
          if (ipc.includes("web")) return { state: "running", url: "http://127.0.0.1:5678" };
          throw new Error("IPC request timed out: test-pipe");
        }
        throw new Error(`unexpected IPC message: ${String(payload.type)}`);
      });

      const result = await inspectPackedWinApp(createConfig(root), {});

      expect(result.status).toBeNull();
      expect(result.statusError).toBe("IPC request timed out: test-pipe");
      expect(result.daemonStatus).toEqual({ state: "running", url: "http://127.0.0.1:1234" });
      expect(result.webStatus).toEqual({ state: "running", url: "http://127.0.0.1:5678" });
      expect(result.launcher.exists).toBe(false);
      expect(result.updateCache.releaseCount).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("polls status diagnostics when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));

    try {
      requestJsonIpc.mockReset();
      requestJsonIpc.mockImplementation(async (ipc: string, payload: { type?: string }) => {
        if (payload.type === SIDECAR_MESSAGES.STATUS) {
          if (ipc.includes("daemon")) return { state: "running", url: "http://127.0.0.1:1234" };
          if (ipc.includes("web")) return { state: "running", url: "http://127.0.0.1:5678" };
          throw new Error("IPC request timed out: test-pipe");
        }
        throw new Error(`unexpected IPC message: ${String(payload.type)}`);
      });

      const result = await inspectPackedWinApp(createConfig(root), {
        statusPollCount: 2,
        statusPollIntervalMs: 1,
      });

      expect(result.statusPoll?.count).toBe(2);
      expect(result.statusPoll?.intervalMs).toBe(1);
      expect(result.statusPoll?.samples).toHaveLength(2);
      expect(result.statusPoll?.samples.map((sample) => sample.attempt)).toEqual([1, 2]);
      expect(result.statusPoll?.samples[0]?.status).toBeNull();
      expect(result.statusPoll?.samples[0]?.statusError).toBe("IPC request timed out: test-pipe");
      expect(result.statusPoll?.samples[0]?.daemonStatus).toEqual({ state: "running", url: "http://127.0.0.1:1234" });
      expect(result.statusPoll?.samples[0]?.webStatus).toEqual({ state: "running", url: "http://127.0.0.1:5678" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("diagnoses Windows IPC by polling status during repeated fresh starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));
    const config = createConfig(root);
    const previousTrace = process.env.OD_JSON_IPC_TRACE;

    try {
      await writeFakeUnpackedExe(config);
      requestJsonIpc.mockReset();
      spawnBackgroundProcess.mockClear();
      stopControl.mockResolvedValue({ pid: null, state: "absent" });
      process.env.OD_JSON_IPC_TRACE = "already-on";
      requestJsonIpc.mockImplementation(async (ipc: string, payload: { type?: string }) => {
        if (payload.type === SIDECAR_MESSAGES.STATUS) {
          if (ipc.includes("daemon")) return { state: "running", url: "http://127.0.0.1:1234" };
          if (ipc.includes("web")) return { state: "running", url: "http://127.0.0.1:5678" };
          return { state: "running", url: "od://app/" };
        }
        if (payload.type === SIDECAR_MESSAGES.SHUTDOWN) return { accepted: true };
        throw new Error(`unexpected IPC message: ${String(payload.type)}`);
      });

      const result = await diagnosePackedWinIpc(config, {
        diagnoseAttempts: 2,
        statusPollCount: 2,
        statusPollIntervalMs: 1,
      });

      expect(result.namespace).toBe("test");
      expect(result.traceEnabled).toBe(true);
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0]?.start.status).toBeNull();
      expect(result.attempts[0]?.statusPoll.samples).toHaveLength(2);
      expect(result.attempts[0]?.statusPoll.samples[0]?.status).toEqual({ state: "running", url: "od://app/" });
      expect(spawnBackgroundProcess).toHaveBeenCalledTimes(2);
      expect(process.env.OD_JSON_IPC_TRACE).toBe("already-on");
    } finally {
      if (previousTrace == null) {
        delete process.env.OD_JSON_IPC_TRACE;
      } else {
        process.env.OD_JSON_IPC_TRACE = previousTrace;
      }
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("stopPackedWinApp", () => {
  it("delegates convergence to the atomic control plane", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));
    const config = createConfig(root);
    try {
      stopControl.mockReset();
      stopControl.mockImplementation(async (service) => service === "daemon"
        ? { pid: 4242, state: "stopped" }
        : { pid: null, state: "absent" });

      await expect(stopPackedWinApp(config)).resolves.toEqual({
        gracefulRequested: true,
        namespace: config.namespace,
        remainingPids: [],
        status: "stopped",
        stoppedPids: [4242],
      });
      expect(stopControl.mock.calls).toEqual([
        ["desktop", { graceMs: 15_000 }],
        ["web"],
        ["daemon"],
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves install and namespace files when a stop is unproven without a PID", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-lifecycle-"));
    const config = createConfig(root);
    const paths = resolveWinPaths(config);
    const installedSentinel = join(paths.installDir, "sentinel.txt");
    const outputSentinel = join(config.roots.output.namespaceRoot, "output.txt");
    const runtimeSentinel = join(config.roots.runtime.namespaceRoot, "runtime.txt");
    try {
      await mkdir(paths.installDir, { recursive: true });
      await mkdir(config.roots.output.namespaceRoot, { recursive: true });
      await mkdir(config.roots.runtime.namespaceRoot, { recursive: true });
      await writeFile(installedSentinel, "installed", "utf8");
      await writeFile(outputSentinel, "output", "utf8");
      await writeFile(runtimeSentinel, "runtime", "utf8");
      stopControl.mockImplementation(async (service) => service === "web"
        ? { pid: null, state: "alive" }
        : { pid: null, state: "absent" });
      invokeNsis.mockClear();

      await expect(uninstallPackedWinApp(config)).resolves.toMatchObject({
        removedCacheRoot: false,
        removedDataRoot: false,
        removedLogsRoot: false,
        removedProductUserDataRoot: false,
        removedSidecarRoot: false,
        skipped: true,
        stop: { status: "partial" },
      });
      await expect(readFile(installedSentinel, "utf8")).resolves.toBe("installed");
      expect(invokeNsis).not.toHaveBeenCalled();

      await expect(cleanupPackedWinNamespace(config)).resolves.toMatchObject({
        removedLauncherNamespaceRoot: false,
        removedOutputRoot: false,
        removedProductUserDataRoot: false,
        removedRuntimeNamespaceRoot: false,
        skipped: true,
        stop: { status: "partial" },
      });
      await expect(readFile(outputSentinel, "utf8")).resolves.toBe("output");
      await expect(readFile(runtimeSentinel, "utf8")).resolves.toBe("runtime");
    } finally {
      stopControl.mockResolvedValue({ pid: null, state: "absent" });
      await rm(root, { force: true, recursive: true });
    }
  });
});
