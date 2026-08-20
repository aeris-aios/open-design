import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as publicControl from "../src/control/index.js";
import {
  createPrivateLaunchForTest,
  installPrivateLaunchForTest,
  privateLaunchStateForTest,
  sendPrivateRequestForTest,
  writePrivateReadyDescriptorForTest,
} from "../src/control/private-testing.js";
import { attachDemoBody } from "./fixtures/control-body.js";
import {
  createDemoController,
  demoProjection,
  type DemoMethods,
} from "./fixtures/control-controller.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "open-design-sidecar-control-"));
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  return {
    roots: {
      dataRoot: join(root, "data"),
      logsRoot: join(root, "logs"),
      resourceRoot: join(root, "resources"),
      runtimeRoot: join(root, "runtime"),
    },
    scope: {
      channel: "beta",
      generation: 7,
      namespace: "release-beta",
    },
  } as const;
}

describe("sidecar control public boundary", () => {
  it("exports semantic control operations without raw transport or incarnation helpers", () => {
    expect(Object.keys(publicControl).sort()).toEqual([
      "SidecarControlError",
      "accessControlPlane",
      "attachSidecar",
      "bootstrapControlPlane",
      "connectSidecar",
      "forwardSidecarEnvironment",
      "readSidecarContext",
      "resumeControlPlane",
      "stopSidecarServices",
      "stripSidecarEnvironment",
    ]);

    const publicNames = Object.keys(publicControl).join(" ").toLowerCase();
    expect(publicNames).not.toMatch(/endpoint|incarnation|ipc|process|stamp|transport/);
  });
});

describe("sidecar ordered convergence", () => {
  it("attempts every requested service even when earlier stops reject", async () => {
    const calls: string[] = [];
    const control = {
      async stop(service: string) {
        calls.push(service);
        if (service !== "daemon") throw new Error(`${service} failed`);
        return { forced: false, pid: 42, stopped: true };
      },
    };

    await expect(publicControl.stopSidecarServices(control, [
      { service: "desktop" },
      { service: "web" },
      { service: "daemon" },
    ])).resolves.toMatchObject([
      { service: "desktop", status: "rejected" },
      { service: "web", status: "rejected" },
      { result: { stopped: true }, service: "daemon", status: "fulfilled" },
    ]);
    expect(calls).toEqual(["desktop", "web", "daemon"]);
  });
});

describe("sidecar control identity", () => {
  it("keeps channel, namespace, generation and service independent", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);

    expect(controller.scope).toEqual(scope);
    expect(controller.roots).toEqual(roots);
    expect(() =>
      createDemoController({ ...scope, channel: "release/beta" }, roots),
    ).toThrow(/channel/);
    expect(() =>
      createDemoController({ ...scope, namespace: "Beta Namespace" }, roots),
    ).toThrow(/namespace/);
    expect(() => createDemoController({ ...scope, generation: -1 }, roots)).toThrow(
      /generation/,
    );
  });
});

describe("independent sidecar controller and body", () => {
  it("exposes a caller-hosted semantic service through the same fenced control plane", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const hosted = await controller.expose<DemoMethods>({
      handlers: {
        context(_input, context) {
          return context;
        },
        echo(input) {
          return { value: `hosted:${input.value}` };
        },
      },
      service: "shell",
    });
    cleanups.push(() => hosted.close());

    const client = await controller.connect<DemoMethods>("shell");
    await expect(client.call("echo", { value: "capability" })).resolves.toEqual({
      value: "hosted:capability",
    });
    await expect(client.call("context", {})).resolves.toEqual({
      identity: { ...scope, service: "shell" },
      projection: controller.projection,
      roots,
    });

    await hosted.close();
    await expect(controller.connect("shell")).rejects.toThrow(/unavailable/);
  });

  it("gives semantic calls a long default deadline while preserving caller overrides", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    let contextCalls = 0;
    const hosted = await controller.expose<DemoMethods>({
      handlers: {
        async context(_input, context) {
          contextCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, contextCalls === 1 ? 1_600 : 25));
          return context;
        },
        echo(input) {
          return input;
        },
      },
      service: "shell",
    });
    cleanups.push(() => hosted.close());

    const client = await controller.connect<DemoMethods>("shell");
    await expect(client.call("context", {})).resolves.toMatchObject({
      identity: { ...scope, service: "shell" },
    });
    await expect(client.call("context", {}, { timeoutMs: 5 })).rejects.toMatchObject({
      code: "peer-unavailable",
    });
    await expect(client.call("context", {}, { timeoutMs: null })).resolves.toMatchObject({
      identity: { ...scope, service: "shell" },
    });
  });

  it("initializes the body from validated roots before publishing readiness", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "web",
    });
    const restoreLaunch = installPrivateLaunchForTest(launch);
    cleanups.push(restoreLaunch);
    let initialized = false;
    const body = await publicControl.attachSidecar<DemoMethods>({
      handlers: {
        context(_input, context) {
          expect(initialized).toBe(true);
          return context;
        },
        echo(input) {
          expect(initialized).toBe(true);
          return { value: input.value };
        },
      },
      initialize(context) {
        expect(context).toEqual({
          identity: { ...scope, service: "web" },
          projection: createDemoController(scope, roots).projection,
          roots,
        });
        initialized = true;
      },
    });
    cleanups.push(() => body.close());

    const client = await createDemoController(scope, roots).connect<DemoMethods>("web");
    await expect(client.call("echo", { value: "ready-after-body" })).resolves.toEqual({
      value: "ready-after-body",
    });
  });

  it("cleans up body startup when initialization fails", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "web",
    });
    const restoreLaunch = installPrivateLaunchForTest(launch);
    cleanups.push(restoreLaunch);
    let stopped = false;

    await expect(publicControl.attachSidecar<DemoMethods>({
      handlers: {
        context(_input, context) {
          return context;
        },
        echo(input) {
          return { value: input.value };
        },
      },
      initialize() {
        throw new Error("body startup failed");
      },
      onStopRequested() {
        stopped = true;
      },
    })).rejects.toThrow("body startup failed");

    expect(stopped).toBe(true);
    await expect(createDemoController(scope, roots).connect("web")).rejects.toThrow(
      /unavailable/,
    );
  });

  it("launches and stops a real body without exposing launch metadata to it", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const childEntry = join(import.meta.dirname, "fixtures", "control-child.ts");
    const launch = await controller.launch<DemoMethods>({
      args: ["--import", "tsx", childEntry],
      executable: process.execPath,
      readyTimeoutMs: 5_000,
      service: "daemon",
    });
    cleanups.push(async () => {
      await launch.stop();
    });

    await expect(launch.client.call("echo", { value: "real-child" })).resolves.toEqual({
      value: "real-child",
    });
    await expect(launch.client.call("context", {})).resolves.toEqual({
      identity: { ...scope, service: "daemon" },
      projection: controller.projection,
      roots,
    });
    await expect(launch.stop()).resolves.toMatchObject({ code: 0, signal: null });
    await expect(controller.connect("daemon")).rejects.toThrow(/unavailable/);
  });

  it("treats an explicit launch environment as complete and only inherits when omitted", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const childEntry = join(import.meta.dirname, "fixtures", "control-env-child.ts");
    const ambientKey = "OD_SIDECAR_TEST_AMBIENT_SECRET";
    const previousAmbient = process.env[ambientKey];
    process.env[ambientKey] = "must-not-leak";
    type EnvironmentMethods = {
      readEnvironment: {
        input: { key: string };
        output: { value: string | null };
      };
    };

    try {
      const exact = await controller.launch<EnvironmentMethods>({
        args: ["--import", "tsx", childEntry],
        env: {
          PATH: process.env.PATH,
          ...(process.env.SystemRoot == null ? {} : { SystemRoot: process.env.SystemRoot }),
        },
        executable: process.execPath,
        service: "web",
      });
      cleanups.push(async () => {
        await exact.stop();
      });
      await expect(exact.client.call("readEnvironment", { key: ambientKey })).resolves.toEqual({
        value: null,
      });
      expect(exact.client.environment({ PATH: "/bin" })[ambientKey]).toBeUndefined();
      expect(exact.client.environment()[ambientKey]).toBe("must-not-leak");

      const inherited = await controller.launch<EnvironmentMethods>({
        args: ["--import", "tsx", childEntry],
        executable: process.execPath,
        service: "daemon",
      });
      cleanups.push(async () => {
        await inherited.stop();
      });
      await expect(inherited.client.call("readEnvironment", { key: ambientKey })).resolves.toEqual({
        value: "must-not-leak",
      });
    } finally {
      if (previousAmbient == null) delete process.env[ambientKey];
      else process.env[ambientKey] = previousAmbient;
    }
  });

  it("force-terminates an uncooperative body and converges its control state", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const childEntry = join(import.meta.dirname, "fixtures", "control-uncooperative-child.ts");
    const launch = await controller.launch<DemoMethods>({
      args: ["--import", "tsx", childEntry],
      executable: process.execPath,
      service: "daemon",
      stopTimeoutMs: 50,
    });
    cleanups.push(async () => {
      await launch.stop();
    });

    await expect(launch.stop()).resolves.toMatchObject({ code: null });
    await expect(controller.connect("daemon")).rejects.toThrow(/unavailable/);
    const privateState = await privateLaunchStateForTest(
      createPrivateLaunchForTest({
        projection: demoProjection,
        roots,
        scope,
        service: "daemon",
      }),
    );
    expect(privateState).toEqual({ descriptorExists: false, endpointExists: false });
  });

  it("converges a live peer before replacing the service identity", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const childEntry = join(import.meta.dirname, "fixtures", "control-child.ts");
    const first = await controller.launch<DemoMethods>({
      args: ["--import", "tsx", childEntry],
      executable: process.execPath,
      service: "daemon",
    });
    cleanups.push(async () => {
      await first.stop();
    });

    const replacement = await controller.launch<DemoMethods>({
        args: ["--import", "tsx", childEntry],
        executable: process.execPath,
        readyTimeoutMs: 2_000,
        service: "daemon",
      });
    cleanups.push(async () => { await replacement.stop(); });
    await expect(first.exited).resolves.toBeDefined();
    await expect(replacement.client.call("echo", { value: "replacement" })).resolves.toEqual({
      value: "replacement",
    });
  });

  it("adopts the winner when two cold launches race for one service identity", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const childEntry = join(import.meta.dirname, "fixtures", "control-delayed-child.ts");
    const launchOptions = {
      args: ["--import", "tsx", childEntry],
      executable: process.execPath,
      existing: "adopt",
      readyTimeoutMs: 5_000,
      service: "daemon",
    } as const;

    const [left, right] = await Promise.all([
      controller.launch<DemoMethods>(launchOptions),
      controller.launch<DemoMethods>(launchOptions),
    ]);
    cleanups.push(async () => {
      await Promise.allSettled([left.stop(), right.stop()]);
    });

    expect(left.pid).toBe(right.pid);
    await expect(left.client.call("echo", { value: "left" })).resolves.toEqual({ value: "left" });
    await expect(right.client.call("echo", { value: "right" })).resolves.toEqual({ value: "right" });
  });

  it("does not spawn when an adopted identity exists but its peer is unprobeable", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      holder.once("error", rejectSpawn);
      holder.once("spawn", resolveSpawn);
    });
    const holderPid = holder.pid;
    if (holderPid == null) throw new Error("unprobeable peer fixture did not report a pid");
    cleanups.push(async () => {
      if (holder.exitCode == null && holder.signalCode == null) holder.kill("SIGKILL");
      await new Promise<void>((resolveExit) => {
        if (holder.exitCode != null || holder.signalCode != null) resolveExit();
        else holder.once("exit", () => resolveExit());
      });
    });

    const metadata = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    await writePrivateReadyDescriptorForTest(metadata, holderPid);
    const spawnMarker = join(roots.runtimeRoot, "unexpected-spawn");

    await expect(controller.launch<DemoMethods>({
      args: [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'spawned')",
        spawnMarker,
      ],
      executable: process.execPath,
      existing: "adopt",
      readyTimeoutMs: 200,
      service: "daemon",
    })).rejects.toMatchObject({ code: "peer-unavailable" });
    await expect(access(spawnMarker)).rejects.toThrow();
  });

  it("reclaims an adopted identity whose recorded process has exited", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const metadata = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    await writePrivateReadyDescriptorForTest(metadata, 2_147_483_647);

    const launch = await controller.launch<DemoMethods>({
      args: ["--import", "tsx", join(import.meta.dirname, "fixtures", "control-child.ts")],
      executable: process.execPath,
      existing: "adopt",
      readyTimeoutMs: 5_000,
      service: "daemon",
    });
    cleanups.push(async () => {
      await launch.stop();
    });

    await expect(launch.client.call("echo", { value: "reclaimed" })).resolves.toEqual({
      value: "reclaimed",
    });
  });

  it("agree on normalized identity, roots and caller-owned methods", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    const restoreLaunch = installPrivateLaunchForTest(launch);
    cleanups.push(restoreLaunch);
    let observedContext: unknown = null;
    const body = await attachDemoBody((context) => {
      observedContext = context;
    });
    cleanups.push(() => body.close());

    const controller = createDemoController(scope, roots);
    const client = await controller.connect<DemoMethods>("daemon");

    await expect(client.probe()).resolves.toEqual({
      identity: { ...scope, service: "daemon" },
      projection: controller.projection,
    });
    await expect(client.call("echo", { value: "江湖" })).resolves.toEqual({
      value: "江湖",
    });
    const delegatedClient = await publicControl.connectSidecar<DemoMethods>(
      client.environment({ OD_TEST_DELEGATION: "preserved" }),
    );
    expect(client.environment({ OD_TEST_DELEGATION: "preserved" }).OD_TEST_DELEGATION).toBe("preserved");
    await expect(delegatedClient.call("echo", { value: "delegated" })).resolves.toEqual({
      value: "delegated",
    });
    expect(observedContext).toEqual({
      identity: { ...scope, service: "daemon" },
      projection: controller.projection,
      roots,
    });
  });

  it("fences a delayed client after a same-generation restart", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);

    const firstLaunch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "web",
    });
    const restoreFirst = installPrivateLaunchForTest(firstLaunch);
    const firstBody = await attachDemoBody(() => undefined);
    const staleClient = await controller.connect<DemoMethods>("web");
    await firstBody.close();
    restoreFirst();

    const secondLaunch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "web",
    });
    expect(secondLaunch.identity).toEqual(firstLaunch.identity);
    expect(secondLaunch.incarnation).not.toBe(firstLaunch.incarnation);
    const restoreSecond = installPrivateLaunchForTest(secondLaunch);
    cleanups.push(restoreSecond);
    const secondBody = await attachDemoBody(() => undefined);
    cleanups.push(() => secondBody.close());

    await expect(staleClient.call("echo", { value: "late" })).rejects.toThrow(
      /stale sidecar peer/,
    );

    const currentClient = await controller.connect<DemoMethods>("web");
    await expect(currentClient.call("echo", { value: "current" })).resolves.toEqual({
      value: "current",
    });
  });

  it("does not let a wrong scope satisfy or stop the requested peer", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    const restoreLaunch = installPrivateLaunchForTest(launch);
    cleanups.push(restoreLaunch);
    const body = await attachDemoBody(() => undefined);
    cleanups.push(() => body.close());

    const wrongChannel = createDemoController({ ...scope, channel: "stable" }, roots);
    const wrongNamespace = createDemoController({ ...scope, namespace: "release-stable" }, roots);
    const wrongGeneration = createDemoController({ ...scope, generation: 8 }, roots);

    await expect(wrongChannel.connect("daemon")).rejects.toThrow(/unavailable/);
    await expect(wrongNamespace.connect("daemon")).rejects.toThrow(/unavailable/);
    await expect(wrongGeneration.requestStop("daemon")).rejects.toThrow(/unavailable/);

    for (const identity of [
      { ...launch.identity, channel: "stable" },
      { ...launch.identity, namespace: "release-stable" },
      { ...launch.identity, generation: 8 },
    ]) {
      await expect(
        sendPrivateRequestForTest(launch, {
          identity,
          operation: { kind: "request-stop" },
        }),
      ).resolves.toMatchObject({
        error: { code: "peer-mismatch" },
        status: "error",
      });
    }

    const currentClient = await createDemoController(scope, roots).connect<DemoMethods>("daemon");
    await expect(currentClient.call("echo", { value: "still-running" })).resolves.toEqual({
      value: "still-running",
    });
  });

  it("does not report a fenced descriptor as already stopped", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    const restoreLaunch = installPrivateLaunchForTest(launch);
    cleanups.push(restoreLaunch);
    const body = await attachDemoBody(() => undefined);
    cleanups.push(() => body.close());

    const mismatchedRoots = { ...roots, dataRoot: `${roots.dataRoot}-other` };
    const mismatchedController = createDemoController(scope, mismatchedRoots);
    await expect(mismatchedController.stop("daemon")).rejects.toMatchObject({ code: "peer-mismatch" });
    await expect(createDemoController(scope, roots).connect("daemon")).resolves.toBeDefined();
  });

  it("does not force an acknowledged peer that remains alive past the grace period", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const childEntry = join(import.meta.dirname, "fixtures", "control-uncooperative-child.ts");
    const launch = await controller.launch<DemoMethods>({
      args: ["--import", "tsx", childEntry],
      executable: process.execPath,
      service: "daemon",
    });
    cleanups.push(async () => {
      await launch.stop();
    });

    const access = publicControl.accessControlPlane({ runtimeRoot: roots.runtimeRoot, scope });
    await expect(access.stop("daemon", { graceMs: 10 })).resolves.toEqual({
      forced: false,
      pid: launch.pid,
      stopped: false,
    });
    expect(() => process.kill(launch.pid, 0)).not.toThrow();
  });

  it("never signals a reused PID from a stale descriptor", async () => {
    const { roots, scope } = await createFixture();
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      unrelated.once("error", rejectSpawn);
      unrelated.once("spawn", resolveSpawn);
    });
    const pid = unrelated.pid;
    if (pid == null) throw new Error("unrelated fixture did not report a pid");
    cleanups.push(async () => {
      if (unrelated.exitCode == null && unrelated.signalCode == null) unrelated.kill("SIGKILL");
      await new Promise<void>((resolveExit) => {
        if (unrelated.exitCode != null || unrelated.signalCode != null) resolveExit();
        else unrelated.once("exit", () => resolveExit());
      });
    });

    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    await writePrivateReadyDescriptorForTest(launch, pid);

    const access = publicControl.accessControlPlane({ runtimeRoot: roots.runtimeRoot, scope });
    await expect(access.stop("daemon", { graceMs: 10 })).resolves.toEqual({
      forced: false,
      pid,
      stopped: false,
    });
    expect(() => process.kill(pid, 0)).not.toThrow();

    const bootstrap = createDemoController(scope, roots);
    await expect(bootstrap.stop("daemon", { graceMs: 10 })).resolves.toEqual({
      forced: false,
      pid,
      stopped: false,
    });
    expect(() => process.kill(pid, 0)).not.toThrow();
  });

  it("does not attach a controller with a different caller-owned projection", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    const restoreLaunch = installPrivateLaunchForTest(launch);
    cleanups.push(restoreLaunch);
    const body = await attachDemoBody(() => undefined);
    cleanups.push(() => body.close());

    const wrongProjection = { releaseVersion: "0.18.0-beta.5" } as const;
    const wrongController = publicControl.bootstrapControlPlane({
      projection: wrongProjection,
      roots,
      scope,
    });

    await expect(wrongController.connect("daemon")).rejects.toThrow(/unavailable/);
    await expect(createDemoController(scope, roots).connect("daemon")).resolves.toBeDefined();
  });
});
