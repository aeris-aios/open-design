import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

import {
  normalizeSidecarStamp,
  bootstrapSidecarProcess,
  findSidecarProcesses,
  launchSidecar,
  registerSidecarProcess,
  readCurrentSidecarStamp,
  SidecarFactory,
  SIDECAR_STAMP_FIELDS,
  SIDECAR_STAMP_FLAGS,
  stopSidecar,
  type SidecarResources,
  type SidecarStamp,
} from "../src/index.js";

const originalArgv = [...process.argv];
const originalResources = process.env.OD_SIDECAR_RESOURCES;

const stamp: SidecarStamp = {
  channel: "local",
  namespace: `test-${process.pid}`,
  source: "tools-dev",
  mode: "dev",
  app: "daemon",
};

function installCurrentProcess(stampValue: SidecarStamp, resources = {
  dataRoot: "/tmp/open-design-test-data",
  ownerPid: null,
  port: 0,
  runtimeRoot: "/tmp/open-design-test-runtime",
}): void {
  process.argv = [
    process.execPath,
    "/tmp/sidecar-entry.js",
    ...SIDECAR_STAMP_FIELDS.map((field) => `${SIDECAR_STAMP_FLAGS[field]}=${stampValue[field]}`),
  ];
  process.env.OD_SIDECAR_RESOURCES = JSON.stringify(resources);
}

afterEach(() => {
  process.argv = [...originalArgv];
  if (originalResources == null) delete process.env.OD_SIDECAR_RESOURCES;
  else process.env.OD_SIDECAR_RESOURCES = originalResources;
});

describe("five-field argv identity", () => {
  it("contains channel rather than an IPC implementation field", () => {
    expect(SIDECAR_STAMP_FIELDS).toEqual(["channel", "namespace", "source", "mode", "app"]);
    expect(SIDECAR_STAMP_FIELDS).not.toContain("ipc");
  });

  it("reads the complete stamp internally from current argv", () => {
    installCurrentProcess(stamp);
    expect(readCurrentSidecarStamp()).toEqual(stamp);

    process.argv = process.argv.filter((argument) => !argument.startsWith(`${SIDECAR_STAMP_FLAGS.channel}=`));
    expect(() => readCurrentSidecarStamp()).toThrow(/five-field sidecar argv stamp/);
  });

  it("refuses to fake registration by mutating an unstamped process argv", () => {
    process.argv = [process.execPath, "/tmp/packaged-entry.js"];
    expect(() => registerSidecarProcess(stamp, {
      dataRoot: "/tmp/data",
      ownerPid: null,
      port: 0,
      runtimeRoot: "/tmp/runtime",
    })).toThrow("current process is missing its sidecar argv stamp");
    expect(process.argv).toEqual([process.execPath, "/tmp/packaged-entry.js"]);
  });

  it("bootstraps an unstamped root through the launch atomic", async () => {
    process.argv = [process.execPath, "/tmp/packaged-entry.js", "--headless"];
    const launch = vi.fn(async () => ({ pid: 4321 }));
    const resources = { dataRoot: "/tmp/data", ownerPid: null, port: 0, runtimeRoot: "/tmp/runtime" };
    await expect(bootstrapSidecarProcess(stamp, resources, { launch })).resolves.toBe(true);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      args: ["/tmp/packaged-entry.js", "--headless"],
      command: process.execPath,
      resources,
      stamp,
    }));
  });

  it("rejects partial matching and derived identity fields", () => {
    expect(() => normalizeSidecarStamp({ ...stamp, ipc: "/tmp/not-identity.sock" })).toThrow(/unsupported fields: ipc/);
    expect(() => normalizeSidecarStamp({ app: stamp.app, namespace: stamp.namespace })).toThrow(/channel/);
  });
});

describe("normalized sidecar client", () => {
  it("is the only layer that receives OS resources and implements IPC/lifecycle", async () => {
    installCurrentProcess(stamp, {
      dataRoot: "/tmp/open-design-data",
      ownerPid: null,
      port: 4173,
      runtimeRoot: "/tmp/open-design-runtime",
    });
    const events: string[] = [];
    let receivedResources: SidecarResources | null = null;
    const client = SidecarFactory.create({
      handlers: {
        echo(input) {
          events.push("handler");
          return input;
        },
      },
      lifecycle: {
        async start(resources) {
          events.push("start");
          receivedResources = resources;
          return { ready: true };
        },
        status(runtime) {
          return runtime;
        },
        async stop() {
          events.push("stop");
        },
      },
    });

    const inheritedEnv = SidecarFactory.inheritedEnvironment();
    expect(Object.keys(inheritedEnv)).toHaveLength(1);
    expect(client.resources).toEqual({
      dataRoot: "/tmp/open-design-data",
      ownerPid: null,
      pid: process.pid,
      port: 4173,
      runtimeRoot: "/tmp/open-design-runtime",
    });
    await client.start();
    const inherited = SidecarFactory.connectInherited(inheritedEnv);
    expect(inherited).not.toBeNull();
    await expect(inherited?.status("daemon")).resolves.toEqual({ ready: true });
    await expect(inherited?.invoke("daemon", "echo", { inherited: true })).resolves.toEqual({ inherited: true });
    await expect(client.invoke("daemon", "echo", { ok: true })).resolves.toEqual({ ok: true });
    await client.stop();
    await client.waitUntilStopped();
    expect(SidecarFactory.inheritedEnvironment()).toEqual({});

    expect(receivedResources).toEqual(client.resources);
    expect(events).toEqual(["start", "handler", "handler", "stop"]);
  });

  it("does not accept argv, socket paths, or capability declarations", () => {
    installCurrentProcess(stamp);
    const options = {
      handlers: {},
      lifecycle: {
        async start() { return {}; },
        status() { return {}; },
        async stop() {},
      },
    };
    SidecarFactory.create(options);
    expect(Object.keys(options).sort()).toEqual(["handlers", "lifecycle"]);
  });
});

describe("server-side atomic operations", () => {
  it("keeps distribution channels isolated and force-stops only an exact argv stamp", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/stamped-child.mjs", import.meta.url));
    const stable = { ...stamp, channel: "stable", namespace: `isolation-${process.pid}` };
    const beta = { ...stable, channel: "beta" };
    await launchSidecar({
      args: [fixture],
      command: process.execPath,
      resources: { dataRoot: "/tmp/open-design-stable", ownerPid: null, port: 0, runtimeRoot: "/tmp/open-design-stable-runtime" },
      stamp: stable,
    });
    await launchSidecar({
      args: [fixture],
      command: process.execPath,
      resources: { dataRoot: "/tmp/open-design-beta", ownerPid: null, port: 0, runtimeRoot: "/tmp/open-design-beta-runtime" },
      stamp: beta,
    });

    try {
      await expect(findSidecarProcesses(stable)).resolves.toHaveLength(1);
      await expect(findSidecarProcesses(beta)).resolves.toHaveLength(1);
      const result = await stopSidecar(stable, { killGraceMs: 2_000, termGraceMs: 0 });
      expect(result.remainingPids).toEqual([]);
      expect(result.gracefulAccepted).toBe(false);
      await expect(findSidecarProcesses(stable)).resolves.toEqual([]);
      await expect(findSidecarProcesses(beta)).resolves.toHaveLength(1);
    } finally {
      await stopSidecar(stable, { killGraceMs: 2_000, termGraceMs: 0 }).catch(() => undefined);
      await stopSidecar(beta, { killGraceMs: 2_000, termGraceMs: 0 }).catch(() => undefined);
    }
  });
});
