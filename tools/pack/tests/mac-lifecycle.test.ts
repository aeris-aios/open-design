import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopStatusSnapshot } from "@open-design/host/sidecar";
import type { SidecarConvergeResult } from "@open-design/sidecar/control";

import type { ToolPackConfig } from "../src/config.js";
import { resolveMacPaths } from "../src/mac/paths.js";

const requestJsonIpc = vi.fn(async (): Promise<DesktopStatusSnapshot> => ({ state: "running" }));
const stopControl = vi.fn<(service?: string, options?: { graceMs?: number }) => Promise<SidecarConvergeResult>>(
  async () => ({ pid: null, state: "absent" }),
);
const collectProcessTreePids = vi.fn(
  (_processes: unknown[], rootPids: Array<number | null>) =>
    rootPids.filter((pid): pid is number => typeof pid === "number"),
);
const listProcessSnapshots = vi.fn(async () => [] as Array<{ command: string; pid: number; ppid: number }>);
const stopProcesses = vi.fn(async (pids: number[]) => ({ remainingPids: [], stoppedPids: pids }));
const spawnLoggedProcess = vi.fn(async ({ env }: { env: NodeJS.ProcessEnv }) => {
  return Object.assign(new EventEmitter(), {
    env,
    pid: 1234,
    unref: vi.fn(),
  }) as unknown as ChildProcess & { env: NodeJS.ProcessEnv };
});

vi.mock("../src/control.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/control.js")>(),
  createToolPackControl: () => ({
    connect: async () => ({ call: requestJsonIpc }),
    stop: stopControl,
    async withLifecycleSession<T>(callback: () => Promise<T>) { return await callback(); },
  }),
}));

vi.mock("@open-design/platform", () => ({
  collectProcessTreePids,
  isProcessAlive: vi.fn(() => true),
  listProcessSnapshots,
  readLogTail: vi.fn(async () => []),
  spawnLoggedProcess,
  stopProcesses,
}));

const {
  cleanupPackedMacNamespace,
  startPackedMacApp,
  stopPackedMacApp,
  uninstallPackedMacApp,
} = await import("../src/mac/lifecycle.js");

function makeConfig(root: string, overrides: Partial<ToolPackConfig> = {}): ToolPackConfig {
  return {
    containerized: false,
    electronBuilderCliPath: "/x/electron-builder/cli.js",
    electronDistPath: "/x/electron/dist",
    electronVersion: "41.3.0",
    macCompression: "normal",
    namespace: "local-test",
    platform: "mac",
    portable: true,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    requireVelaCli: false,
    roots: {
      output: {
        appBuilderRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", "local-test", "builder"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "out", "mac", "namespaces", "local-test"),
        platformRoot: join(root, ".tmp", "tools-pack", "out", "mac"),
        root: join(root, ".tmp", "tools-pack", "out"),
      },
      runtime: {
        namespaceBaseRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "runtime", "mac", "namespaces", "local-test"),
      },
      cacheRoot: join(root, ".tmp", "tools-pack", "cache"),
      toolPackRoot: join(root, ".tmp", "tools-pack"),
    },
    silent: true,
    signed: false,
    to: "app",
    webOutputMode: "standalone",
    workspaceRoot: root,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  requestJsonIpc.mockResolvedValue({ state: "running" });
  listProcessSnapshots.mockResolvedValue([]);
  collectProcessTreePids.mockImplementation(
    (_processes: unknown[], rootPids: Array<number | null>) =>
      rootPids.filter((pid): pid is number => typeof pid === "number"),
  );
  stopProcesses.mockImplementation(async (pids: number[]) => ({ remainingPids: [], stoppedPids: pids }));
  stopControl.mockResolvedValue({ pid: null, state: "absent" });
});

describe("startPackedMacApp", () => {
  it("does not spawn a replacement when a service stop is unproven", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    try {
      const config = makeConfig(root);
      const paths = resolveMacPaths(config);
      const executablePath = join(paths.installedAppPath, "Contents", "MacOS", "Open Design");
      await mkdir(join(paths.installedAppPath, "Contents", "MacOS"), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(executablePath, 0o755);
      stopControl.mockImplementation(async (service) => service === "web"
        ? { pid: 4321, state: "alive" }
        : { pid: null, state: "absent" });

      await expect(startPackedMacApp(config)).rejects.toThrow(
        "failed to converge one or more packaged services",
      );
      expect(spawnLoggedProcess).not.toHaveBeenCalled();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts a clean launcher exit when the delegated desktop becomes healthy", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    try {
      const config = makeConfig(root);
      const paths = resolveMacPaths(config);
      const executablePath = join(paths.installedAppPath, "Contents", "MacOS", "Open Design");
      const delegatedPid = 5678;

      await mkdir(join(paths.installedAppPath, "Contents", "MacOS"), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(executablePath, 0o755);
      requestJsonIpc.mockResolvedValue({ pid: delegatedPid, state: "running" });
      spawnLoggedProcess.mockImplementationOnce(async ({ env }: { env: NodeJS.ProcessEnv }) => {
        const child = Object.assign(new EventEmitter(), {
          env,
          pid: 1234,
          unref: vi.fn(),
        }) as unknown as ChildProcess & { env: NodeJS.ProcessEnv };
        setTimeout(() => child.emit("exit", 0, null), 10);
        return child;
      });

      const result = await startPackedMacApp(config);

      expect(result.pid).toBe(delegatedPid);
      expect(result.status).toEqual({ pid: delegatedPid, state: "running" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a non-zero launcher exit before desktop handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    try {
      const config = makeConfig(root);
      const paths = resolveMacPaths(config);
      const executablePath = join(paths.installedAppPath, "Contents", "MacOS", "Open Design");

      await mkdir(join(paths.installedAppPath, "Contents", "MacOS"), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 1\n", "utf8");
      await chmod(executablePath, 0o755);
      spawnLoggedProcess.mockImplementationOnce(async ({ env }: { env: NodeJS.ProcessEnv }) => {
        const child = Object.assign(new EventEmitter(), {
          env,
          pid: 1234,
          unref: vi.fn(),
        }) as unknown as ChildProcess & { env: NodeJS.ProcessEnv };
        setTimeout(() => child.emit("exit", 1, null), 10);
        return child;
      });

      await expect(startPackedMacApp(config)).rejects.toThrow("process exited early code=1 signal=null");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("writes a launch override when the bundled config is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    try {
      const config = makeConfig(root);
      const paths = resolveMacPaths(config);
      const executablePath = join(paths.installedAppPath, "Contents", "MacOS", "Open Design");

      await mkdir(join(paths.installedAppPath, "Contents", "MacOS"), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(executablePath, 0o755);

      const result = await startPackedMacApp(config);
      const launchConfigPath = join(config.roots.runtime.namespaceRoot, "runtime", "open-design-config.json");
      const launchEnv = spawnLoggedProcess.mock.calls[0]?.[0]?.env as NodeJS.ProcessEnv | undefined;

      expect(result.source).toBe("installed");
      expect(result.status?.state).toBe("running");
      expect(launchEnv?.OD_PACKAGED_CONFIG_PATH).toBe(launchConfigPath);
      await expect(readFile(launchConfigPath, "utf8")).resolves.toContain(
        `"namespaceBaseRoot": ${JSON.stringify(config.roots.runtime.namespaceBaseRoot)}`,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("passes a launch override config path for portable mac starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    try {
      const config = makeConfig(root);
      const paths = resolveMacPaths(config);
      const executablePath = join(paths.installedAppPath, "Contents", "MacOS", "Open Design");
      const bundledConfigPath = join(paths.installedAppPath, "Contents", "Resources", "open-design-config.json");

      await mkdir(join(paths.installedAppPath, "Contents", "MacOS"), { recursive: true });
      await mkdir(join(paths.installedAppPath, "Contents", "Resources"), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(executablePath, 0o755);
      await writeFile(
        bundledConfigPath,
        `${JSON.stringify({
          appVersion: "1.2.3",
          daemonCliEntryRelative: "open-design/bin/od",
          namespace: config.namespace,
          nodeCommandRelative: "open-design/bin/node",
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await startPackedMacApp(config);
      const launchConfigPath = join(config.roots.runtime.namespaceRoot, "runtime", "open-design-config.json");
      const launchEnv = spawnLoggedProcess.mock.calls[0]?.[0]?.env as NodeJS.ProcessEnv | undefined;

      expect(result.source).toBe("installed");
      expect(result.status?.state).toBe("running");
      expect(launchEnv?.OD_PACKAGED_CONFIG_PATH).toBe(launchConfigPath);
      await expect(readFile(launchConfigPath, "utf8")).resolves.toContain(
        `"namespaceBaseRoot": ${JSON.stringify(config.roots.runtime.namespaceBaseRoot)}`,
      );
      await expect(readFile(launchConfigPath, "utf8")).resolves.toContain('"appVersion": "1.2.3"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses the preview executable name for preview release namespaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    try {
      const config = makeConfig(root, { namespace: "release-preview" });
      const paths = resolveMacPaths(config);
      const executablePath = join(paths.installedAppPath, "Contents", "MacOS", "Open Design Preview");

      await mkdir(join(paths.installedAppPath, "Contents", "MacOS"), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(executablePath, 0o755);

      const result = await startPackedMacApp(config);

      expect(result.source).toBe("installed");
      expect(result.executablePath).toBe(executablePath);
      expect(result.status?.state).toBe("running");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("stopPackedMacApp", () => {
  it("delegates convergence to the atomic control plane", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    const config = makeConfig(root);
    try {
      stopControl.mockImplementation(async (service) => service === "daemon"
        ? { pid: 4242, state: "stopped" }
        : { pid: null, state: "absent" });

      await expect(stopPackedMacApp(config)).resolves.toMatchObject({
        gracefulRequested: true,
        namespace: config.namespace,
        remainingPids: [],
        status: "stopped",
        stoppedPids: [4242],
      });
      expect(stopControl.mock.calls).toEqual([
        ["web"],
        ["daemon"],
        ["desktop", { graceMs: 15_000 }],
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves install and namespace files when a stop is unproven without a PID", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-mac-lifecycle-"));
    const config = makeConfig(root);
    const paths = resolveMacPaths(config);
    const installedSentinel = join(paths.installedAppPath, "sentinel.txt");
    const outputSentinel = join(config.roots.output.namespaceRoot, "output.txt");
    const runtimeSentinel = join(config.roots.runtime.namespaceRoot, "runtime.txt");
    try {
      await mkdir(paths.installedAppPath, { recursive: true });
      await mkdir(config.roots.output.namespaceRoot, { recursive: true });
      await mkdir(config.roots.runtime.namespaceRoot, { recursive: true });
      await writeFile(installedSentinel, "installed", "utf8");
      await writeFile(outputSentinel, "output", "utf8");
      await writeFile(runtimeSentinel, "runtime", "utf8");
      stopControl.mockImplementation(async (service) => service === "web"
        ? { pid: null, state: "alive" }
        : { pid: null, state: "absent" });

      await expect(uninstallPackedMacApp(config)).resolves.toMatchObject({
        removed: false,
        skipped: true,
        stop: { status: "partial" },
      });
      await expect(readFile(installedSentinel, "utf8")).resolves.toBe("installed");

      await expect(cleanupPackedMacNamespace(config)).resolves.toMatchObject({
        removedOutputRoot: false,
        removedRuntimeNamespaceRoot: false,
        skipped: true,
        stop: { status: "partial" },
      });
      await expect(readFile(outputSentinel, "utf8")).resolves.toBe("output");
      await expect(readFile(runtimeSentinel, "utf8")).resolves.toBe("runtime");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
