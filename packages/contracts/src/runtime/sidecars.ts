import { z } from "zod";

export const OPEN_DESIGN_SERVICES = Object.freeze({
  DAEMON: "daemon",
  DESKTOP: "desktop",
  WEB: "web",
} as const);

export type OpenDesignService = (typeof OPEN_DESIGN_SERVICES)[keyof typeof OPEN_DESIGN_SERVICES];

export const OPEN_DESIGN_RUNTIME_MODES = Object.freeze({
  DEV: "dev",
  RUNTIME: "runtime",
} as const);

export type OpenDesignRuntimeMode =
  (typeof OPEN_DESIGN_RUNTIME_MODES)[keyof typeof OPEN_DESIGN_RUNTIME_MODES];

export const OPEN_DESIGN_RUNTIME_SOURCES = Object.freeze({
  PACKAGED: "packaged",
  TOOLS_DEV: "tools-dev",
  TOOLS_PACK: "tools-pack",
} as const);

export type OpenDesignRuntimeSource =
  (typeof OPEN_DESIGN_RUNTIME_SOURCES)[keyof typeof OPEN_DESIGN_RUNTIME_SOURCES];

export const OPEN_DESIGN_RUNTIME_DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  namespace: "default",
  projectTmpDirName: ".tmp",
} as const);

export function normalizeOpenDesignNamespace(value: unknown): string {
  return z.string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "namespace contains unsupported characters")
    .parse(value);
}

/** Product runtime configuration; generic Sidecar bootstrap metadata stays private. */
export const OPEN_DESIGN_RUNTIME_ENV = Object.freeze({
  DAEMON_CLI_PATH: "OD_DAEMON_CLI_PATH",
  DAEMON_PORT: "OD_PORT",
  TOOLS_DEV_PARENT_PID: "OD_TOOLS_DEV_PARENT_PID",
  WEB_DIST_DIR: "OD_WEB_DIST_DIR",
  WEB_PORT: "OD_WEB_PORT",
  WEB_TSCONFIG_PATH: "OD_WEB_TSCONFIG_PATH",
} as const);

const runtimeProjectionSchema = z.object({
  mode: z.enum([OPEN_DESIGN_RUNTIME_MODES.DEV, OPEN_DESIGN_RUNTIME_MODES.RUNTIME]),
  protocol: z.literal(1),
  source: z.enum([
    OPEN_DESIGN_RUNTIME_SOURCES.PACKAGED,
    OPEN_DESIGN_RUNTIME_SOURCES.TOOLS_DEV,
    OPEN_DESIGN_RUNTIME_SOURCES.TOOLS_PACK,
  ]),
}).strict();

export type OpenDesignRuntimeProjection = z.infer<typeof runtimeProjectionSchema>;

export type OpenDesignRuntimeContext = OpenDesignRuntimeProjection & Readonly<{
  channel: string;
  dataRoot: string;
  generation: number;
  logsRoot: string;
  namespace: string;
  resourceRoot: string;
  runtimeRoot: string;
}>;

export function createOpenDesignRuntimeProjection(
  mode: OpenDesignRuntimeMode,
  source: OpenDesignRuntimeSource,
): OpenDesignRuntimeProjection {
  return Object.freeze(runtimeProjectionSchema.parse({ mode, protocol: 1, source }));
}

export function parseOpenDesignRuntimeProjection(value: unknown): OpenDesignRuntimeProjection {
  return runtimeProjectionSchema.parse(value);
}

export function createOpenDesignRuntimeContext(input: Readonly<{
  identity: Readonly<{ channel: string; generation: number; namespace: string }>;
  projection: Readonly<{ value: unknown }>;
  roots: Readonly<{ dataRoot: string; logsRoot: string; resourceRoot: string; runtimeRoot: string }>;
}>): OpenDesignRuntimeContext {
  const projection = parseOpenDesignRuntimeProjection(input.projection.value);
  return Object.freeze({
    ...projection,
    channel: input.identity.channel,
    dataRoot: input.roots.dataRoot,
    generation: input.identity.generation,
    logsRoot: input.roots.logsRoot,
    namespace: input.identity.namespace,
    resourceRoot: input.roots.resourceRoot,
    runtimeRoot: input.roots.runtimeRoot,
  });
}

export type ServiceRuntimeState = "idle" | "running" | "starting" | "stopped" | "unknown";

export type DaemonStatusSnapshot = {
  desktopAuthGateActive: boolean;
  pid?: number | null;
  state: ServiceRuntimeState;
  trustedWebOriginPort?: number | null;
  updatedAt?: string;
  url: string | null;
};

export type WebStatusSnapshot = {
  pid?: number | null;
  state: ServiceRuntimeState;
  updatedAt?: string;
  url: string | null;
};

export type RegisterDesktopAuthInput = { secret: string };
export type RegisterDesktopAuthResult = { accepted: true };
export type MintImportTokenInput = { baseDir: string };
export type MintImportTokenResult =
  | { ok: true; expiresAt: string; token: string }
  | { ok: false; code: "DESKTOP_AUTH_INACTIVE"; message: string; retryable: false }
  | { ok: false; code: "DESKTOP_AUTH_PENDING"; message: string; retryable: true };
export type RegisterWebUrlInput = { url: string };
export type RegisterWebUrlResult = { accepted: true };

type Method<Input, Output> = Readonly<{ input: Input; output: Output }>;
type EmptyInput = Record<string, never>;

export type DaemonSidecarMethods = {
  mintImportToken: Method<MintImportTokenInput, MintImportTokenResult>;
  registerDesktopAuth: Method<RegisterDesktopAuthInput, RegisterDesktopAuthResult>;
  registerWebUrl: Method<RegisterWebUrlInput, RegisterWebUrlResult>;
  status: Method<EmptyInput, DaemonStatusSnapshot>;
};

export type WebSidecarMethods = {
  status: Method<EmptyInput, WebStatusSnapshot>;
};

const loopbackOrigin = z.string().url().transform((raw, context) => {
  const parsed = new URL(raw);
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "http:"
    || (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]")
    || parsed.port.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.pathname !== "/"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "url must be a bare loopback HTTP origin with an explicit port" });
    return z.NEVER;
  }
  return parsed.origin;
});

/** The sole runtime validators for daemon/web capability inputs. */
export const DAEMON_SIDECAR_INPUTS = Object.freeze({
  mintImportToken: z.object({ baseDir: z.string().min(1) }).strict(),
  registerDesktopAuth: z.object({
    secret: z.string().min(1).regex(/^[A-Za-z0-9+/_=-]+$/u, "secret must be base64-encoded"),
  }).strict(),
  registerWebUrl: z.object({ url: loopbackOrigin }).strict(),
  status: z.object({}).strict(),
});

export const WEB_SIDECAR_INPUTS = Object.freeze({
  status: z.object({}).strict(),
});
