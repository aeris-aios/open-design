export type SidecarControlScope = Readonly<{
  channel: string;
  generation: number;
  namespace: string;
}>;

export type SidecarControlIdentity = SidecarControlScope &
  Readonly<{
    service: string;
  }>;

export type SidecarControlRoots = Readonly<{
  dataRoot: string;
  logsRoot: string;
  resourceRoot: string;
  runtimeRoot: string;
}>;

export type SidecarControlJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly SidecarControlJsonValue[]
  | Readonly<{ [key: string]: SidecarControlJsonValue }>;

/**
 * Caller-owned, immutable truth projected through the control plane. Sidecar
 * validates and fences the digest but never interprets the value.
 */
export type SidecarControlProjection = Readonly<{
  digest: `sha256:${string}`;
  value: SidecarControlJsonValue;
}>;

export type SidecarControlContext = Readonly<{
  identity: SidecarControlIdentity;
  projection: SidecarControlProjection;
  roots: SidecarControlRoots;
}>;

export type SidecarMethod<Input, Output> = Readonly<{
  input: Input;
  output: Output;
}>;

type MethodInput<TMethods, TMethod extends keyof TMethods> = TMethods[TMethod] extends Readonly<{
  input: infer Input;
}>
  ? Input
  : never;

type MethodOutput<TMethods, TMethod extends keyof TMethods> = TMethods[TMethod] extends Readonly<{
  output: infer Output;
}>
  ? Output
  : never;

export type SidecarMethodHandlers<TMethods> = {
  [TMethod in keyof TMethods]: (
    input: MethodInput<TMethods, TMethod>,
    context: SidecarControlContext,
  ) => MethodOutput<TMethods, TMethod> | Promise<MethodOutput<TMethods, TMethod>>;
};

export type SidecarProbeResult = Readonly<{
  identity: SidecarControlIdentity;
  projection: SidecarControlProjection;
}>;

export type SidecarConvergeResult =
  | Readonly<{ pid: null; state: "absent" }>
  | Readonly<{ pid: number; state: "stopped" }>
  | Readonly<{ pid: number | null; state: "alive" }>;

export type SidecarStopOptions = Readonly<{ graceMs?: number }>;

export type SidecarServiceStopRequest = Readonly<{
  options?: SidecarStopOptions;
  service: string;
}>;

export type SidecarServiceStopAttempt =
  | Readonly<{
      result: SidecarConvergeResult;
      service: string;
      status: "fulfilled";
    }>
  | Readonly<{
      error: unknown;
      service: string;
      status: "rejected";
    }>;

export type SidecarServicesConvergence =
  | Readonly<{
      attempts: readonly SidecarServiceStopAttempt[];
      state: "complete";
    }>
  | Readonly<{
      attempts: readonly SidecarServiceStopAttempt[];
      state: "incomplete";
    }>;

export type SidecarCallOptions = Readonly<{
  /** `null` disables the semantic call deadline. */
  timeoutMs?: number | null;
}>;

export type SidecarControlClient<TMethods> = Readonly<{
  identity: SidecarControlIdentity;
  /** Delegate this exact opaque service capability; a provided env is the complete base. */
  environment(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  call<TMethod extends Extract<keyof TMethods, string>>(
    method: TMethod,
    input: MethodInput<TMethods, TMethod>,
    options?: SidecarCallOptions,
  ): Promise<MethodOutput<TMethods, TMethod>>;
  probe(): Promise<SidecarProbeResult>;
}>;

export type SidecarControlPlane = Readonly<{
  projection: SidecarControlProjection;
  roots: SidecarControlRoots;
  scope: SidecarControlScope;
  connect<TMethods>(service: string): Promise<SidecarControlClient<TMethods>>;
  expose<TMethods>(options: SidecarExposeOptions<TMethods>): Promise<AttachedSidecar>;
  launch<TMethods>(options: SidecarLaunchOptions): Promise<SidecarLaunch<TMethods>>;
  probe(service: string): Promise<SidecarProbeResult>;
  stop(service: string, options?: SidecarStopOptions): Promise<SidecarConvergeResult>;
  withLifecycleSession<T>(callback: () => Promise<T>): Promise<T>;
}>;

export type AccessControlPlaneOptions = Readonly<{
  runtimeRoot: string;
  scope: SidecarControlScope;
}>;

/** Existing-plane access without authority to launch or expose a service body. */
export type SidecarControlAccess = Readonly<{
  scope: SidecarControlScope;
  connect<TMethods>(service: string): Promise<SidecarControlClient<TMethods>>;
  probe(service: string): Promise<SidecarProbeResult>;
  stop(service: string, options?: SidecarStopOptions): Promise<SidecarConvergeResult>;
  withLifecycleSession<T>(callback: () => Promise<T>): Promise<T>;
}>;

export type SidecarExposeOptions<TMethods> = AttachSidecarOptions<TMethods> & Readonly<{
  service: string;
}>;

export type SidecarLaunchOptions = Readonly<{
  args?: readonly string[];
  cwd?: string;
  detached?: boolean;
  /** Complete child environment when provided; omission inherits the controller environment. */
  env?: NodeJS.ProcessEnv;
  executable: string;
  /** Adopt an exact healthy peer for idempotent starts, or replace it. */
  existing?: "adopt" | "replace";
  /** Inherit, ignore, or route stdout/stderr to an already-open file descriptor. */
  output?: "ignore" | "inherit" | number;
  readyTimeoutMs?: number;
  service: string;
  stopTimeoutMs?: number;
}>;

export type SidecarExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export type SidecarLaunch<TMethods> = Readonly<{
  client: SidecarControlClient<TMethods>;
  exited: Promise<SidecarExit>;
  identity: SidecarControlIdentity;
  pid: number;
  stop(): Promise<SidecarExit>;
}>;

export type AttachSidecarOptions<TMethods> = Readonly<{
  handlers: SidecarMethodHandlers<TMethods>;
  /**
   * Complete body-owned startup after the package has decoded and validated
   * caller identity/roots, but before the ready descriptor becomes visible.
   * This is the only bootstrap seam a real Web/daemon body needs.
   */
  initialize?: (context: SidecarControlContext) => void | Promise<void>;
  onStopRequested?: () => void | Promise<void>;
}>;

export type AttachedSidecar = Readonly<{
  context: SidecarControlContext;
  close(): Promise<void>;
}>;

export type BootstrapControlPlaneOptions = Readonly<{
  /** Caller-owned immutable JSON truth. Sidecar alone canonicalizes and hashes it. */
  projection: SidecarControlJsonValue;
  roots: SidecarControlRoots;
  scope: SidecarControlScope;
}>;
