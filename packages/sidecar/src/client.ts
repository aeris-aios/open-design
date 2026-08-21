import { createJsonIpcServer, requestJsonIpc } from "./json-ipc.js";
import { normalizeSidecarStamp, readCurrentSidecarStamp, resolvePrivateIpcPath, type SidecarStamp } from "./stamp.js";

const RESOURCES_ENV = "OD_SIDECAR_RESOURCES";
const CONTROL_STATUS = "sidecar:status";
const CONTROL_STOP = "sidecar:stop";
const BUSINESS_INVOKE = "sidecar:invoke";
const INHERITED_ENDPOINT_ENV = "OD_SIDECAR_CLIENT_ENDPOINT";

export type SidecarResources = Readonly<{
  dataRoot: string;
  ownerPid: number | null;
  pid: number;
  port: number;
  runtimeRoot: string;
}>;

export type SidecarHandler = (input: unknown) => unknown | Promise<unknown>;
export type SidecarHandlers = Readonly<Record<string, SidecarHandler>>;

export type SidecarLifecycle<TRuntime> = {
  start(resources: SidecarResources): Promise<TRuntime>;
  status(runtime: TRuntime): unknown | Promise<unknown>;
  stop(runtime: TRuntime): Promise<void>;
};

export type SidecarClientOptions<TRuntime> = {
  handlers?: SidecarHandlers;
  lifecycle: SidecarLifecycle<TRuntime>;
};

export type SidecarConnection = {
  invoke<TResult = unknown>(app: string, action: string, input: unknown, options?: { timeoutMs?: number }): Promise<TResult>;
  status<TResult = unknown>(app: string, options?: { timeoutMs?: number }): Promise<TResult>;
};

type InvokeEnvelope = { action: string; app: string; input: unknown; type: typeof BUSINESS_INVOKE };
type ControlEnvelope = { type: typeof CONTROL_STATUS | typeof CONTROL_STOP };

function normalizeResources(input: unknown): SidecarResources {
  if (typeof input !== "object" || input == null || Array.isArray(input)) {
    throw new Error(`${RESOURCES_ENV} must contain a resource object`);
  }
  const value = input as Record<string, unknown>;
  if (typeof value.dataRoot !== "string" || value.dataRoot.length === 0) {
    throw new Error("sidecar dataRoot must be a non-empty string");
  }
  if (typeof value.runtimeRoot !== "string" || value.runtimeRoot.length === 0) {
    throw new Error("sidecar runtimeRoot must be a non-empty string");
  }
  const port = Number(value.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("sidecar port must be an integer between 0 and 65535");
  }
  const ownerPid = value.ownerPid == null ? null : Number(value.ownerPid);
  if (ownerPid != null && (!Number.isSafeInteger(ownerPid) || ownerPid <= 0)) {
    throw new Error("sidecar ownerPid must be null or a positive safe integer");
  }
  return Object.freeze({ dataRoot: value.dataRoot, ownerPid, pid: process.pid, port, runtimeRoot: value.runtimeRoot });
}

function readCurrentResources(): SidecarResources {
  const serialized = process.env[RESOURCES_ENV];
  if (serialized == null) throw new Error(`${RESOURCES_ENV} is required`);
  try {
    return normalizeResources(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${RESOURCES_ENV} must contain valid JSON`, { cause: error });
    throw error;
  }
}

function assertEnvelope(message: unknown): InvokeEnvelope | ControlEnvelope {
  if (typeof message !== "object" || message == null || Array.isArray(message)) {
    throw new Error("invalid sidecar request");
  }
  const request = message as Record<string, unknown>;
  if (request.type === CONTROL_STATUS || request.type === CONTROL_STOP) return { type: request.type };
  if (request.type !== BUSINESS_INVOKE || typeof request.app !== "string" || typeof request.action !== "string") {
    throw new Error("invalid sidecar request");
  }
  return { action: request.action, app: request.app, input: request.input, type: BUSINESS_INVOKE };
}

export class SidecarClient<TRuntime> {
  readonly resources: SidecarResources;
  readonly stamp: SidecarStamp;

  readonly #handlers: SidecarHandlers;
  readonly #lifecycle: SidecarLifecycle<TRuntime>;
  #ipcServer: Awaited<ReturnType<typeof createJsonIpcServer>> | null = null;
  #runtime: TRuntime | null = null;
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #ownerTimer: NodeJS.Timeout | null = null;
  readonly #signalHandler = () => { this.#stopAndExit(); };
  #resolveStopped!: () => void;
  readonly #stopped = new Promise<void>((resolve) => { this.#resolveStopped = resolve; });

  constructor(options: SidecarClientOptions<TRuntime>) {
    this.stamp = readCurrentSidecarStamp();
    this.resources = readCurrentResources();
    process.env[INHERITED_ENDPOINT_ENV] = resolvePrivateIpcPath(this.stamp);
    this.#handlers = options.handlers ?? {};
    this.#lifecycle = options.lifecycle;
  }

  start(): Promise<void> {
    if (this.#stopPromise != null) return Promise.reject(new Error("sidecar client is stopping"));
    this.#startPromise ??= this.#start();
    return this.#startPromise;
  }

  async #start(): Promise<void> {
    const runtime = await this.#lifecycle.start(this.resources);
    this.#runtime = runtime;
    try {
      this.#ipcServer = await createJsonIpcServer({
        socketPath: resolvePrivateIpcPath(this.stamp),
        handler: async (message) => {
          const request = assertEnvelope(message);
          if (request.type === CONTROL_STATUS) return await this.#lifecycle.status(runtime);
          if (request.type === CONTROL_STOP) {
            setImmediate(() => { this.#stopAndExit(); });
            return { accepted: true };
          }
          if (request.type !== BUSINESS_INVOKE) throw new Error("invalid sidecar request");
          if (request.app !== this.stamp.app) throw new Error(`sidecar request targets ${request.app}, not ${this.stamp.app}`);
          const handler = this.#handlers[request.action];
          if (handler == null) throw new Error(`unknown ${this.stamp.app} action: ${request.action}`);
          return await handler(request.input);
        },
      });
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, this.#signalHandler);
      if (this.resources.ownerPid != null) {
        this.#ownerTimer = setInterval(() => {
          try {
            process.kill(this.resources.ownerPid as number, 0);
          } catch {
            if (this.#ownerTimer != null) clearInterval(this.#ownerTimer);
            this.#ownerTimer = null;
            this.#stopAndExit();
          }
        }, 1_000);
        this.#ownerTimer.unref();
      }
    } catch (error) {
      this.#runtime = null;
      await this.#lifecycle.stop(runtime).catch(() => undefined);
      throw error;
    }
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  #stopAndExit(): void {
    void this.stop().finally(() => process.exit(0));
  }

  async #stop(): Promise<void> {
    try {
      await this.#startPromise?.catch(() => undefined);
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.off(signal, this.#signalHandler);
      if (this.#ownerTimer != null) clearInterval(this.#ownerTimer);
      this.#ownerTimer = null;
      await this.#ipcServer?.close();
      this.#ipcServer = null;
      if (this.#runtime != null) await this.#lifecycle.stop(this.#runtime);
      this.#runtime = null;
    } finally {
      if (process.env[INHERITED_ENDPOINT_ENV] === resolvePrivateIpcPath(this.stamp)) {
        delete process.env[INHERITED_ENDPOINT_ENV];
      }
      this.#resolveStopped();
    }
  }

  waitUntilStopped(): Promise<void> {
    return this.#stopped;
  }

  async invoke<TResult = unknown>(app: string, action: string, input: unknown, options?: { timeoutMs?: number }): Promise<TResult> {
    const target = normalizeSidecarStamp({ ...this.stamp, app });
    return await requestJsonIpc<TResult>(
      resolvePrivateIpcPath(target),
      { action, app: target.app, input, type: BUSINESS_INVOKE },
      options,
    );
  }

  async status<TResult = unknown>(app: string, options?: { timeoutMs?: number }): Promise<TResult> {
    const target = normalizeSidecarStamp({ ...this.stamp, app });
    return await requestJsonIpc<TResult>(resolvePrivateIpcPath(target), { type: CONTROL_STATUS }, options);
  }
}

export const SidecarFactory = Object.freeze({
  connectInherited(env: NodeJS.ProcessEnv = process.env): SidecarConnection | null {
    const endpoint = env[INHERITED_ENDPOINT_ENV];
    if (endpoint == null || endpoint.length === 0) return null;
    return {
      async invoke<TResult = unknown>(app: string, action: string, input: unknown, options?: { timeoutMs?: number }) {
        return await requestJsonIpc<TResult>(endpoint, { action, app, input, type: BUSINESS_INVOKE }, options);
      },
      async status<TResult = unknown>(_app: string, options?: { timeoutMs?: number }) {
        return await requestJsonIpc<TResult>(endpoint, { type: CONTROL_STATUS }, options);
      },
    };
  },
  create<TRuntime>(options: SidecarClientOptions<TRuntime>): SidecarClient<TRuntime> {
    return new SidecarClient(options);
  },
  inheritedEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const endpoint = env[INHERITED_ENDPOINT_ENV];
    return endpoint == null || endpoint.length === 0 ? {} : { [INHERITED_ENDPOINT_ENV]: endpoint };
  },
});

export const sidecarProtocol = Object.freeze({
  resourcesEnv: RESOURCES_ENV,
  status: CONTROL_STATUS,
  stop: CONTROL_STOP,
});
