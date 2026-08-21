import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { removeFile } from "../json-file.js";
import { isWindowsNamedPipePath } from "../ipc-path.js";
import { requestJsonIpc } from "../json-ipc.js";
import { SidecarControlError } from "./error.js";
import { attachSidecarWithMetadata } from "./body.js";
import {
  acquireControlLeaseLock,
  beginProcessLease,
  markStoppingLease,
  processAlive,
  readControlLease,
  removeControlLeaseIfCurrent,
  writeControlLease,
} from "./lease-store.js";
import {
  assertPrivateResponse,
  createPrivateLaunchEnv,
  createPrivateLaunchMetadata,
  createPrivateRequest,
  createControlProjection,
  forwardPrivateLaunchEnv,
  normalizeControlIdentity,
  normalizeControlRoots,
  normalizeControlRuntimeRoot,
  normalizeControlScope,
  normalizeControlProjection,
  normalizePrivateReadyDescriptor,
  privateControlPaths,
  readPrivateLaunchMetadata,
  sameControlIdentity,
  sameControlProjection,
  sameControlRoots,
  type PrivateControlResponse,
  type PrivateControlLease,
  type PrivateLaunchMetadata,
  type PrivateReadyDescriptor,
  withoutPrivateLaunchEnv,
} from "./private-protocol.js";
import type {
  AccessControlPlaneOptions,
  BootstrapControlPlaneOptions,
  SidecarControlAccess,
  SidecarControlClient,
  SidecarControlIdentity,
  SidecarControlContext,
  SidecarConvergeResult,
  SidecarControlProjection,
  SidecarControlPlane,
  SidecarExit,
  SidecarExposeOptions,
  SidecarLaunch,
  SidecarLaunchOptions,
  SidecarProbeResult,
  SidecarStopResult,
  SidecarStopOptions,
} from "./public-types.js";

const SEMANTIC_CALL_TIMEOUT_MS = 600_000;

async function waitForStopped(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  return !processAlive(pid);
}

function peerUnavailable(identity: SidecarControlIdentity): SidecarControlError {
  return new SidecarControlError(
    "peer-unavailable",
    `sidecar peer is unavailable: ${identity.channel}/${identity.namespace}/${identity.generation}/${identity.service}`,
  );
}

function assertFullLeaseMatch(
  lease: PrivateControlLease,
  identity: SidecarControlIdentity,
  roots: BootstrapControlPlaneOptions["roots"],
  projection?: SidecarControlProjection,
): void {
  if (
    !sameControlIdentity(lease.identity, identity)
    || !sameControlRoots(lease.roots, roots)
    || (projection != null && !sameControlProjection(lease.projection, projection))
  ) {
    throw new SidecarControlError(
      "peer-mismatch",
      "sidecar peer is unavailable because its descriptor does not match the requested control fencing",
    );
  }
}

async function readCurrentLease(
  identity: SidecarControlIdentity,
  roots: BootstrapControlPlaneOptions["roots"],
  projection?: SidecarControlProjection,
): Promise<PrivateControlLease> {
  const lease = await readControlLease(identity, roots);
  if (lease == null) throw peerUnavailable(identity);
  assertFullLeaseMatch(lease, identity, roots, projection);
  return lease;
}

async function readCurrentDescriptor(
  identity: SidecarControlIdentity,
  roots: BootstrapControlPlaneOptions["roots"],
  projection?: SidecarControlProjection,
): Promise<PrivateReadyDescriptor> {
  const lease = await readCurrentLease(identity, roots, projection);
  if (lease.state !== "ready") throw peerUnavailable(identity);
  return normalizePrivateReadyDescriptor(lease);
}

async function readAccessibleLease(
  identity: SidecarControlIdentity,
  runtimeRoot: string,
): Promise<PrivateControlLease> {
  const lease = await readControlLease(identity, { runtimeRoot });
  if (lease == null) throw peerUnavailable(identity);
  if (!sameControlIdentity(lease.identity, identity) || lease.roots.runtimeRoot !== runtimeRoot) {
    throw new SidecarControlError(
      "peer-mismatch",
      "sidecar peer is unavailable because its descriptor does not match the requested control fencing",
    );
  }
  return lease;
}

async function readAccessibleDescriptor(
  identity: SidecarControlIdentity,
  runtimeRoot: string,
): Promise<PrivateReadyDescriptor> {
  const lease = await readAccessibleLease(identity, runtimeRoot);
  if (lease.state !== "ready") throw peerUnavailable(identity);
  return normalizePrivateReadyDescriptor(lease);
}

function normalizeTimeout(value: number | undefined, fallback: number, label: string): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new SidecarControlError("invalid-input", `${label} must be a positive safe integer`);
  }
  return timeout;
}

function childExit(child: ReturnType<typeof spawn>): Promise<SidecarExit> {
  return new Promise<SidecarExit>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function stopDescriptorPeer(
  leaseFor: () => Promise<PrivateControlLease>,
  lock: Readonly<{
    identity: SidecarControlIdentity;
    roots: Pick<BootstrapControlPlaneOptions["roots"], "runtimeRoot">;
  }>,
  options: SidecarStopOptions = {},
): Promise<SidecarConvergeResult> {
  const graceMs = normalizeTimeout(options.graceMs, 5_000, "graceMs");
  const operation = await acquireControlLeaseLock(lock.identity, lock.roots, graceMs + 5_000);
  try {
    let lease: PrivateControlLease;
    try {
      lease = await leaseFor();
    } catch (error) {
      if (error instanceof SidecarControlError && error.code === "peer-unavailable") {
        return { forced: false, pid: null, state: "absent" };
      }
      throw error;
    }

    return await convergeLeaseWhileLocked(lease, graceMs);
  } finally {
    await operation.release();
  }
}

async function convergeLeaseWhileLocked(
  lease: PrivateControlLease,
  graceMs: number,
): Promise<SidecarConvergeResult> {
  if (lease.state === "claiming") {
    if (!processAlive(lease.ownerPid)) {
      await removeControlLeaseIfCurrent(lease);
      return { forced: false, pid: null, state: "absent" };
    }
    return { forced: false, pid: null, state: "alive" };
  }
  if (!processAlive(lease.pid)) {
    await convergeExitedLaunch(lease);
    return { forced: false, pid: lease.pid, state: "stopped" };
  }

  await markStoppingLease(lease);
  await createClient(lease).requestStop().catch(() => undefined);
  const stopped = await waitForStopped(lease.pid, graceMs);
  if (stopped) await convergeExitedLaunch(lease);
  return stopped
    ? { forced: false, pid: lease.pid, state: "stopped" }
    : { forced: false, pid: lease.pid, state: "alive" };
}

function createClient<TMethods>(descriptor: PrivateLaunchMetadata): SidecarControlClient<TMethods> {
  const invoke = async (
    operation: Parameters<typeof createPrivateRequest>[1],
    timeoutMs?: number | null,
  ): Promise<unknown> => {
    const request = createPrivateRequest(descriptor, operation);
    let response: PrivateControlResponse;
    try {
      response = await requestJsonIpc<PrivateControlResponse>(
        descriptor.endpointPath,
        request,
        timeoutMs === undefined ? {} : { timeoutMs },
      );
    } catch (error) {
      throw new SidecarControlError("peer-unavailable", "sidecar peer request failed", { cause: error });
    }
    return assertPrivateResponse(request, response);
  };

  return Object.freeze({
    async call(method, input, options) {
      const timeoutMs = options?.timeoutMs === undefined
        ? SEMANTIC_CALL_TIMEOUT_MS
        : options.timeoutMs;
      return (await invoke({ kind: "call", input, method }, timeoutMs)) as never;
    },
    environment(extraEnv) {
      return createPrivateLaunchEnv(descriptor, extraEnv);
    },
    identity: descriptor.identity,
    async probe() {
      return (await invoke({ kind: "probe" })) as SidecarProbeResult;
    },
    async requestStop() {
      return (await invoke({ kind: "request-stop" })) as SidecarStopResult;
    },
  });
}

/** Connect to the service identity carried opaquely in an inherited launch environment. */
export async function connectSidecar<TMethods>(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SidecarControlClient<TMethods>> {
  const client = createClient<TMethods>(readPrivateLaunchMetadata(env));
  await client.probe();
  return client;
}

/** Copy the opaque bootstrap capability into an explicitly constructed child environment. */
export function forwardSidecarEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return forwardPrivateLaunchEnv(env);
}

/** Remove an inherited bootstrap capability before spawning a new control-plane root. */
export function stripSidecarEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutPrivateLaunchEnv(env);
}

/** Re-enter the same control plane from a body-owned validated context. */
export function resumeControlPlane(context: SidecarControlContext): SidecarControlPlane {
  return bootstrapControlPlane({
    projection: context.projection.value,
    roots: context.roots,
    scope: {
      channel: context.identity.channel,
      generation: context.identity.generation,
      namespace: context.identity.namespace,
    },
  });
}

export function accessControlPlane(options: AccessControlPlaneOptions): SidecarControlAccess {
  const scope = normalizeControlScope(options.scope);
  const runtimeRoot = normalizeControlRuntimeRoot(options.runtimeRoot);
  const descriptorFor = async (service: string) => {
    const identity = normalizeControlIdentity({ ...scope, service });
    return await readAccessibleDescriptor(identity, runtimeRoot);
  };
  const connect = async <TMethods>(service: string): Promise<SidecarControlClient<TMethods>> => {
    const client = createClient<TMethods>(await descriptorFor(service));
    await client.probe();
    return client;
  };
  return Object.freeze({
    connect,
    async probe(service) {
      return await (await connect(service)).probe();
    },
    async requestStop(service) {
      return await (await connect(service)).requestStop();
    },
    scope,
    async stop(service, stopOptions = {}) {
      const identity = normalizeControlIdentity({ ...scope, service });
      return await stopDescriptorPeer(
        () => readAccessibleLease(identity, runtimeRoot),
        { identity, roots: { runtimeRoot } },
        stopOptions,
      );
    },
  });
}

async function convergeExitedLaunch(descriptor: PrivateLaunchMetadata): Promise<void> {
  const { endpointPath } = privateControlPaths(descriptor.identity, descriptor.roots);
  const current = await readControlLease(descriptor.identity, descriptor.roots);
  if (current?.incarnation !== descriptor.incarnation) return;
  if (!isWindowsNamedPipePath(endpointPath)) await removeFile(endpointPath);
  await removeControlLeaseIfCurrent(descriptor);
}

type ReadyPeer<TMethods> = Readonly<{
  client: SidecarControlClient<TMethods>;
  descriptor: PrivateReadyDescriptor;
}>;

async function waitForReadyPeer<TMethods>(input: {
  acceptIncarnation: (incarnation: string) => boolean;
  descriptor: PrivateLaunchMetadata;
  exited?: Promise<SidecarExit>;
  timeoutMs: number;
}): Promise<ReadyPeer<TMethods>> {
  const { descriptorPath } = privateControlPaths(input.descriptor.identity, input.descriptor.roots);
  const descriptorRoot = dirname(descriptorPath);
  await mkdir(descriptorRoot, { recursive: true });

  return await new Promise<ReadyPeer<TMethods>>((resolveReady, rejectReady) => {
    let checking = false;
    let checkAgain = false;
    let poll: NodeJS.Timeout | null = null;
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let watcher: FSWatcher | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout != null) clearTimeout(timeout);
      if (poll != null) clearInterval(poll);
      watcher?.close();
      callback();
    };
    const check = async () => {
      if (settled) return;
      if (checking) {
        checkAgain = true;
        return;
      }
      checking = true;
      try {
        const descriptor = await readCurrentDescriptor(
          input.descriptor.identity,
          input.descriptor.roots,
          input.descriptor.projection,
        );
        if (!input.acceptIncarnation(descriptor.incarnation)) return;
        const client = createClient<TMethods>(descriptor);
        await client.probe();
        settle(() => resolveReady({ client, descriptor }));
      } catch {
        // Descriptor creation and socket readiness are separate writes. A later
        // filesystem event, child exit, or the deadline gives the next signal.
      } finally {
        checking = false;
        if (checkAgain && !settled) {
          checkAgain = false;
          void check();
        }
      }
    };
    watcher = watch(descriptorRoot, () => void check());
    watcher.once("error", (error) => settle(() => rejectReady(error)));
    // fs.watch can coalesce or drop a Windows directory event while an async
    // descriptor probe is already in flight. The coalesced retry above closes
    // that window; this bounded poll is the backstop for an event the OS never
    // delivers at all. Both paths still require an exact fenced descriptor and
    // a successful peer probe before readiness resolves.
    poll = setInterval(() => void check(), 100);
    timeout = setTimeout(() => {
      settle(() =>
        rejectReady(
          new SidecarControlError(
            "peer-unavailable",
            `sidecar ${input.descriptor.identity.service} launch readiness timed out after ${input.timeoutMs}ms`,
          ),
        ),
      );
    }, input.timeoutMs);
    if (input.exited != null) {
      void input.exited.then(
        (exit) => {
          settle(() =>
            rejectReady(
              new SidecarControlError(
                "peer-unavailable",
                `sidecar exited before readiness: code=${String(exit.code)} signal=${String(exit.signal)}`,
              ),
            ),
          );
        },
        (error) => settle(() => rejectReady(error)),
      );
    }
    void check();
  });
}

function waitForPeerDeparture(descriptor: PrivateReadyDescriptor): Promise<SidecarExit> {
  return new Promise<SidecarExit>((resolveExit) => {
    let settled = false;
    const check = async () => {
      if (settled) return;
      if (!processAlive(descriptor.pid)) {
        settled = true;
        resolveExit({ code: null, signal: null });
        return;
      }
      try {
        const current = await readCurrentDescriptor(
          descriptor.identity,
          descriptor.roots,
          descriptor.projection,
        );
        if (current.incarnation === descriptor.incarnation) await createClient(current).probe();
      } catch {
        // Descriptor/control departure can precede process exit. Keep
        // observing the captured PID, but never signal it from an adopted
        // handle because PID liveness alone is not an ownership witness.
      }
      const timer = setTimeout(() => void check(), 100);
      timer.unref();
    };
    void check();
  });
}

function adoptedLaunch<TMethods>(input: {
  peer: ReadyPeer<TMethods>;
  stopPeer: () => Promise<SidecarConvergeResult>;
  stopTimeoutMs: number;
}): SidecarLaunch<TMethods> {
  const exited = waitForPeerDeparture(input.peer.descriptor);
  let stopping: Promise<SidecarExit> | null = null;
  return Object.freeze({
    client: input.peer.client,
    exited,
    identity: input.peer.descriptor.identity,
    pid: input.peer.descriptor.pid,
    async stop() {
      if (stopping != null) return await stopping;
      stopping = (async () => {
        const convergence = await input.stopPeer();
        if (convergence.state === "alive") {
          throw new SidecarControlError(
            "peer-unavailable",
            `adopted sidecar ${input.peer.descriptor.identity.service} did not stop within ${input.stopTimeoutMs}ms`,
          );
        }
        let timeout: NodeJS.Timeout | null = null;
        try {
          return await Promise.race([
            exited,
            new Promise<SidecarExit>((_resolveExit, rejectExit) => {
              timeout = setTimeout(() => rejectExit(new SidecarControlError(
                "peer-unavailable",
                `adopted sidecar ${input.peer.descriptor.identity.service} did not stop within ${input.stopTimeoutMs}ms`,
              )), input.stopTimeoutMs);
            }),
          ]);
        } finally {
          if (timeout != null) clearTimeout(timeout);
        }
      })();
      return await stopping;
    },
  });
}

async function awaitExitOrTerminate(input: {
  child: ReturnType<typeof spawn>;
  exited: Promise<SidecarExit>;
  timeoutMs: number;
}): Promise<SidecarExit> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      input.exited,
      new Promise<SidecarExit>((resolveExit) => {
        timeout = setTimeout(() => {
          input.child.kill("SIGKILL");
          void input.exited.then(resolveExit);
        }, input.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}

export function bootstrapControlPlane({
  projection: projectionInput,
  roots: rootsInput,
  scope: scopeInput,
}: BootstrapControlPlaneOptions): SidecarControlPlane {
  const roots = normalizeControlRoots(rootsInput);
  const projection = createControlProjection(projectionInput);
  const scope = normalizeControlScope(scopeInput);
  const connect = async <TMethods>(service: string): Promise<SidecarControlClient<TMethods>> => {
    const identity = normalizeControlIdentity({ ...scope, service });
    const client = createClient<TMethods>(await readCurrentDescriptor(identity, roots, projection));
    await client.probe();
    return client;
  };
  const stop = async (
    service: string,
    options: SidecarStopOptions = {},
  ): Promise<SidecarConvergeResult> => {
    const identity = normalizeControlIdentity({ ...scope, service });
    return await stopDescriptorPeer(
      () => readCurrentLease(identity, roots, projection),
      { identity, roots },
      options,
    );
  };
  const launch = async <TMethods>(options: SidecarLaunchOptions): Promise<SidecarLaunch<TMethods>> => {
    if (typeof options.executable !== "string" || options.executable.length === 0) {
      throw new SidecarControlError("invalid-input", "sidecar executable must be present");
    }
    const readyTimeoutMs = normalizeTimeout(options.readyTimeoutMs, 5_000, "readyTimeoutMs");
    const stopTimeoutMs = normalizeTimeout(options.stopTimeoutMs, 1_500, "stopTimeoutMs");
    const descriptor = createPrivateLaunchMetadata({
      projection,
      roots,
      scope,
      service: options.service,
    });
    const existing = options.existing ?? "replace";
    if (existing !== "adopt" && existing !== "replace") {
      throw new SidecarControlError("invalid-input", "sidecar existing launch mode must be adopt or replace");
    }
    const operation = await acquireControlLeaseLock(
      descriptor.identity,
      roots,
      readyTimeoutMs + stopTimeoutMs + 5_000,
    );
    try {
      let current: PrivateControlLease | null = null;
      try {
        current = await readCurrentLease(
          descriptor.identity,
          descriptor.roots,
          descriptor.projection,
        );
      } catch (error) {
        if (!(error instanceof SidecarControlError) || error.code !== "peer-unavailable") throw error;
      }
      if (current?.state === "claiming" && !processAlive(current.ownerPid)) {
        await removeControlLeaseIfCurrent(current);
        current = null;
      } else if (current != null && current.state !== "claiming" && !processAlive(current.pid)) {
        await convergeExitedLaunch(current);
        current = null;
      }

      if (current != null) {
        if (existing === "adopt") {
          if (current.state !== "ready") throw peerUnavailable(descriptor.identity);
          const client = createClient<TMethods>(current);
          await client.probe();
          return adoptedLaunch({
            peer: { client, descriptor: current },
            stopPeer: () => stopDescriptorPeer(
              () => readCurrentLease(descriptor.identity, roots, projection),
              { identity: descriptor.identity, roots },
              { graceMs: stopTimeoutMs },
            ),
            stopTimeoutMs,
          });
        }
        const converged = await convergeLeaseWhileLocked(current, stopTimeoutMs);
        if (converged.state === "alive") {
          throw new SidecarControlError(
            "peer-unavailable",
            `sidecar ${options.service} could not be converged before launch`,
          );
        }
      }
      await writeControlLease({ ...descriptor, ownerPid: process.pid, state: "claiming" });

      const child = spawn(options.executable, [...(options.args ?? [])], {
        cwd: options.cwd,
        detached: options.detached ?? false,
        env: createPrivateLaunchEnv(descriptor, options.env),
        stdio: typeof options.output === "number"
          ? ["ignore", options.output, options.output]
          : options.output ?? "ignore",
        // Sidecars are background services. Without this, a packaged Windows
        // Shell that inherits stdio from the generation bootloader receives a
        // visible conhost window for the lifetime of the daemon/web child.
        windowsHide: true,
      });
      if (options.detached === true) child.unref();
      const exited = childExit(child).then(async (exit) => {
        await convergeExitedLaunch(descriptor);
        return exit;
      });
      let readyPeer: ReadyPeer<TMethods>;
      try {
        if (child.pid == null) {
          throw new SidecarControlError("peer-unavailable", "sidecar process did not receive a pid");
        }
        await beginProcessLease(descriptor, child.pid);
        readyPeer = await waitForReadyPeer<TMethods>({
          acceptIncarnation: (incarnation) => incarnation === descriptor.incarnation,
          descriptor,
          exited,
          timeoutMs: readyTimeoutMs,
        });
      } catch (error) {
        child.kill("SIGKILL");
        await exited.catch(() => undefined);
        await removeControlLeaseIfCurrent(descriptor).catch(() => undefined);
        throw error;
      }
      let stopping: Promise<SidecarExit> | null = null;
      return Object.freeze({
        client: readyPeer.client,
        exited,
        identity: descriptor.identity,
        pid: readyPeer.descriptor.pid,
        async stop() {
          if (stopping != null) return await stopping;
          stopping = (async () => {
            if (!processAlive(readyPeer.descriptor.pid)) return await exited;
            const stopOperation = await acquireControlLeaseLock(
              descriptor.identity,
              roots,
              stopTimeoutMs + 5_000,
            );
            try {
              let lease: PrivateControlLease;
              try {
                lease = await readCurrentLease(descriptor.identity, roots, projection);
              } catch (error) {
                if (!processAlive(readyPeer.descriptor.pid)) return await exited;
                throw error;
              }
              if (lease.incarnation !== descriptor.incarnation) throw peerUnavailable(descriptor.identity);
              await markStoppingLease(lease);
              await readyPeer.client.requestStop().catch(() => undefined);
              return await awaitExitOrTerminate({ child, exited, timeoutMs: stopTimeoutMs });
            } finally {
              await stopOperation.release();
            }
          })();
          return await stopping;
        },
      });
    } finally {
      await operation.release();
    }
  };

  return Object.freeze({
    connect,
    async expose<TMethods>(options: SidecarExposeOptions<TMethods>) {
      const metadata = createPrivateLaunchMetadata({
        projection,
        roots,
        scope,
        service: options.service,
      });
      const operation = await acquireControlLeaseLock(metadata.identity, roots, 10_000);
      try {
        const current = await readControlLease(metadata.identity, roots);
        if (current != null) {
          const alive = current.state === "claiming"
            ? processAlive(current.ownerPid)
            : processAlive(current.pid);
          if (alive) throw peerUnavailable(metadata.identity);
          await convergeExitedLaunch(current);
        }
        await writeControlLease({ ...metadata, ownerPid: process.pid, state: "claiming" });
        return await attachSidecarWithMetadata(metadata, options, {
          claimOwnedByBody: true,
          releaseLeaseOnClose: true,
        });
      } catch (error) {
        await removeControlLeaseIfCurrent(metadata).catch(() => undefined);
        throw error;
      } finally {
        await operation.release();
      }
    },
    launch,
    projection,
    roots,
    scope,
    async probe(service) {
      return await (await connect(service)).probe();
    },
    async requestStop(service) {
      return await (await connect(service)).requestStop();
    },
    stop,
  });
}
