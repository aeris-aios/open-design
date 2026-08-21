import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as publicControl from "../src/control/index.js";
import {
  createPrivateLaunchForTest,
  claimPrivateLaunchForTest,
  installPrivateLaunchForTest,
  privateLaunchStateForTest,
  retirePrivateLaunchForTest,
  sendPrivateRequestForTest,
  writePrivateDescriptorTextForTest,
  writePrivateReadyDescriptorForTest,
  writePrivateUnpublishedLeaseForTest,
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
      async withLifecycleSession<T>(callback: () => Promise<T>) { return await callback(); },
      async stop(service: string) {
        calls.push(service);
        if (service !== "daemon") throw new Error(`${service} failed`);
        return { pid: 42, state: "stopped" as const };
      },
    };

    await expect(publicControl.stopSidecarServices(control, [
      { service: "desktop" },
      { service: "web" },
      { service: "daemon" },
    ])).resolves.toMatchObject({
      attempts: [
        { service: "desktop", status: "rejected" },
        { service: "web", status: "rejected" },
        { result: { state: "stopped" }, service: "daemon", status: "fulfilled" },
      ],
      state: "incomplete",
    });
    expect(calls).toEqual(["desktop", "web", "daemon"]);
  });

  it("reports completion only while every requested service is absent or stopped", async () => {
    const convergence = await publicControl.stopSidecarServices({
      async withLifecycleSession<T>(callback: () => Promise<T>) { return await callback(); },
      async stop(service: string) {
        return service === "desktop"
          ? { pid: 42, state: "stopped" as const }
          : { pid: null, state: "absent" as const };
      },
    }, [
      { service: "desktop" },
      { service: "daemon" },
    ]);

    expect(convergence).toMatchObject({ state: "complete" });
    expect(convergence).not.toHaveProperty("proof");
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

  it("serializes lifecycle mutation across generations in one namespace", async () => {
    const { roots, scope } = await createFixture();
    const oldGeneration = createDemoController(scope, roots);
    const nextGeneration = createDemoController({ ...scope, generation: scope.generation + 1 }, roots);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let nextEntered = false;

    const first = oldGeneration.withLifecycleSession(async () => {
      await gate;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const second = nextGeneration.withLifecycleSession(async () => {
      nextEntered = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    expect(nextEntered).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(nextEntered).toBe(true);
  });
});

describe("independent sidecar controller and body", { timeout: 10_000 }, () => {
  it("rejects a body that has no exact controller-created claim", async () => {
    const { roots, scope } = await createFixture();
    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "web",
    });
    const restore = installPrivateLaunchForTest(launch);
    cleanups.push(restore);
    await expect(attachDemoBody(() => undefined)).rejects.toMatchObject({ code: "peer-mismatch" });
  });

  it("never lets an old incarnation retire its successor", async () => {
    const { roots, scope } = await createFixture();
    const oldLease = createPrivateLaunchForTest({ projection: demoProjection, roots, scope, service: "web" });
    await claimPrivateLaunchForTest(oldLease);
    await expect(retirePrivateLaunchForTest(oldLease)).resolves.toBe(true);
    const successor = createPrivateLaunchForTest({ projection: demoProjection, roots, scope, service: "web" });
    await claimPrivateLaunchForTest(successor);

    await expect(retirePrivateLaunchForTest(oldLease)).resolves.toBe(false);
    await expect(privateLaunchStateForTest(successor)).resolves.toMatchObject({ descriptorExists: true });
    await retirePrivateLaunchForTest(successor);
  });

  it("exposes a caller-hosted semantic service through the same fenced control plane", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    expect(controller).not.toHaveProperty("requestStop");
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
    expect(client).not.toHaveProperty("requestStop");
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

  it("treats hosted shutdown, endpoint close and lease retirement as terminal stop", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    let shutdownFinished = false;
    await controller.expose<DemoMethods>({
      handlers: {
        context(_input, context) { return context; },
        echo(input) { return input; },
      },
      async onStopRequested() {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        shutdownFinished = true;
      },
      service: "shell",
    });

    await expect(controller.stop("shell")).resolves.toMatchObject({ state: "stopped" });
    expect(shutdownFinished).toBe(true);
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
    await claimPrivateLaunchForTest(launch);
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
    await claimPrivateLaunchForTest(launch);
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

  it("executes cold-start initialization once when two launchers race", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const markerPath = join(roots.runtimeRoot, "initialization-pids.txt");
    const childEntry = join(import.meta.dirname, "fixtures", "control-counted-delayed-child.ts");
    const launchOptions = {
      args: ["--import", "tsx", childEntry, markerPath],
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
    const initializedPids = (await readFile(markerPath, "utf8")).trim().split("\n");
    expect(initializedPids).toEqual([String(left.pid)]);
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

  it("removes an exact stale descriptor when stop observes its process has exited", async () => {
    const { roots, scope } = await createFixture();
    const metadata = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    const deadPid = 2_147_483_647;
    await writePrivateReadyDescriptorForTest(metadata, deadPid);

    await expect(createDemoController(scope, roots).stop("daemon")).resolves.toEqual({
      pid: deadPid,
      state: "stopped",
    });
    await expect(privateLaunchStateForTest(metadata)).resolves.toEqual({
      descriptorExists: false,
      endpointExists: false,
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
    await claimPrivateLaunchForTest(launch);
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
    await claimPrivateLaunchForTest(firstLaunch);
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
    await claimPrivateLaunchForTest(secondLaunch);
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
    await claimPrivateLaunchForTest(launch);
    const body = await attachDemoBody(() => undefined);
    cleanups.push(() => body.close());

    const wrongChannel = createDemoController({ ...scope, channel: "stable" }, roots);
    const wrongNamespace = createDemoController({ ...scope, namespace: "release-stable" }, roots);
    const wrongGeneration = createDemoController({ ...scope, generation: 8 }, roots);

    await expect(wrongChannel.connect("daemon")).rejects.toThrow(/unavailable/);
    await expect(wrongNamespace.connect("daemon")).rejects.toThrow(/unavailable/);
    await expect(wrongGeneration.stop("daemon")).resolves.toMatchObject({ state: "absent" });

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
    await claimPrivateLaunchForTest(launch);
    const body = await attachDemoBody(() => undefined);
    cleanups.push(() => body.close());

    const mismatchedRoots = { ...roots, dataRoot: `${roots.dataRoot}-other` };
    const mismatchedController = createDemoController(scope, mismatchedRoots);
    await expect(mismatchedController.stop("daemon")).rejects.toMatchObject({ code: "peer-mismatch" });
    await expect(createDemoController(scope, roots).connect("daemon")).resolves.toBeDefined();
  });

  it("does not report malformed authority as an empty control slot", async () => {
    const { roots, scope } = await createFixture();
    const metadata = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    await writePrivateDescriptorTextForTest(metadata, "{ malformed");

    const access = publicControl.accessControlPlane({ runtimeRoot: roots.runtimeRoot, scope });
    await expect(access.stop("daemon")).rejects.toMatchObject({ code: "peer-mismatch" });
    await expect(createDemoController(scope, roots).stop("daemon")).rejects.toMatchObject({
      code: "peer-mismatch",
    });
  });

  it("keeps an interrupted unpublished lease authoritative until session recovery", async () => {
    const { roots, scope } = await createFixture();
    const metadata = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    await writePrivateUnpublishedLeaseForTest(metadata);

    await expect(privateLaunchStateForTest(metadata)).resolves.toMatchObject({ descriptorExists: true });
    await expect(createDemoController(scope, roots).connect("daemon")).rejects.toMatchObject({
      code: "peer-mismatch",
    });
    await expect(createDemoController(scope, roots).stop("daemon")).resolves.toEqual({
      pid: null,
      state: "absent",
    });
  });

  it("does not launch a replacement while a captured peer is still stopping", async () => {
    const { roots, scope } = await createFixture();
    const controller = createDemoController(scope, roots);
    const first = await controller.launch<DemoMethods>({
      args: ["--import", "tsx", join(import.meta.dirname, "fixtures", "control-closing-live-child.ts")],
      executable: process.execPath,
      service: "daemon",
      stopTimeoutMs: 50,
    });
    cleanups.push(async () => {
      await first.stop();
    });

    const stopping = publicControl.accessControlPlane({ runtimeRoot: roots.runtimeRoot, scope })
      .stop("daemon", { graceMs: 300 });
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 175));

    await expect(controller.launch<DemoMethods>({
      args: ["--import", "tsx", join(import.meta.dirname, "fixtures", "control-child.ts")],
      executable: process.execPath,
      existing: "adopt",
      readyTimeoutMs: 500,
      service: "daemon",
    })).rejects.toMatchObject({ code: "peer-unavailable" });
    await expect(stopping).resolves.toMatchObject({ pid: first.pid, state: "alive" });
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
      pid: launch.pid,
      state: "alive",
    });
    expect(() => process.kill(launch.pid, 0)).not.toThrow();
  });

  it("waits for a captured peer to exit when its stop endpoint is already closing", async () => {
    const { roots, scope } = await createFixture();
    const exiting = spawn(process.execPath, ["-e", "setTimeout(() => {}, 250)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      exiting.once("error", rejectSpawn);
      exiting.once("spawn", resolveSpawn);
    });
    const pid = exiting.pid;
    if (pid == null) throw new Error("closing peer fixture did not report a pid");
    cleanups.push(async () => {
      if (exiting.exitCode == null && exiting.signalCode == null) exiting.kill("SIGKILL");
      await new Promise<void>((resolveExit) => {
        if (exiting.exitCode != null || exiting.signalCode != null) resolveExit();
        else exiting.once("exit", () => resolveExit());
      });
    });

    const launch = createPrivateLaunchForTest({
      projection: demoProjection,
      roots,
      scope,
      service: "daemon",
    });
    await writePrivateReadyDescriptorForTest(launch, pid);

    await expect(createDemoController(scope, roots).stop("daemon", { graceMs: 2_000 })).resolves.toEqual({
      pid,
      state: "stopped",
    });
    await expect(privateLaunchStateForTest(launch)).resolves.toEqual({
      descriptorExists: false,
      endpointExists: false,
    });
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
      pid,
      state: "alive",
    });
    expect(() => process.kill(pid, 0)).not.toThrow();

    const bootstrap = createDemoController(scope, roots);
    await expect(bootstrap.stop("daemon", { graceMs: 10 })).resolves.toEqual({
      pid,
      state: "alive",
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
    await claimPrivateLaunchForTest(launch);
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
