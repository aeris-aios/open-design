import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

import { SidecarControlError, type SidecarControlErrorCode } from "./error.js";
import type {
  SidecarControlIdentity,
  SidecarControlJsonValue,
  SidecarControlProjection,
  SidecarControlRoots,
  SidecarControlScope,
} from "./public-types.js";

export const PRIVATE_CONTROL_SCHEMA_VERSION = 3 as const;
const CONTROL_SCHEMA_VERSION = PRIVATE_CONTROL_SCHEMA_VERSION;
const CONTROL_BOOTSTRAP_ENV = "OD_SIDECAR_CONTROL_BOOTSTRAP_V3";
// Launch environments may be exact allowlists, so endpoint identity cannot depend on TMPDIR.
const POSIX_CONTROL_ROOT = "/tmp";
const CONTROL_TOKEN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const CONTROL_NAMESPACE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export type PrivateLaunchMetadata = Readonly<{
  endpointPath: string;
  identity: SidecarControlIdentity;
  incarnation: string;
  projection: SidecarControlProjection;
  roots: SidecarControlRoots;
  schemaVersion: typeof CONTROL_SCHEMA_VERSION;
}>;

export type PrivateControlOperation =
  | Readonly<{ kind: "call"; input: unknown; method: string }>
  | Readonly<{ kind: "probe" }>
  | Readonly<{ kind: "request-stop" }>;

export type PrivateControlRequest = Readonly<{
  identity: SidecarControlIdentity;
  incarnation: string;
  operation: PrivateControlOperation;
  requestId: string;
  schemaVersion: typeof CONTROL_SCHEMA_VERSION;
}>;

export type PrivateControlResponse = Readonly<{
  error?: Readonly<{ code: SidecarControlErrorCode; message: string }>;
  identity: SidecarControlIdentity;
  incarnation: string;
  requestId: string;
  result?: unknown;
  schemaVersion: typeof CONTROL_SCHEMA_VERSION;
  status: "error" | "ok";
}>;

export type PrivateLeaseMetadata = PrivateLaunchMetadata & Readonly<{
  ownerPid: number;
  terminal: "hosted" | "process";
}>;

type PrivateProcessLeaseFor<TState extends "ready" | "starting" | "stopping"> =
  PrivateLeaseMetadata & Readonly<{
    pid: number;
    processPid: number;
    state: TState;
}>;

export type PrivateReadyDescriptor = PrivateProcessLeaseFor<"ready">;
export type PrivateProcessLease =
  | PrivateReadyDescriptor
  | PrivateProcessLeaseFor<"starting">
  | PrivateProcessLeaseFor<"stopping">;
export type PrivateClaimingLease = PrivateLeaseMetadata & Readonly<{ state: "claiming" }>;
export type PrivateControlLease = PrivateClaimingLease | PrivateProcessLease;

function invalid(label: string, detail: string): never {
  throw new SidecarControlError("invalid-input", `${label} ${detail}`);
}

function normalizeToken(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(label, "must be a string");
  if (!CONTROL_TOKEN.test(value)) invalid(label, "must be a control token");
  return value;
}

function normalizeNamespace(value: unknown): string {
  if (typeof value !== "string" || !CONTROL_NAMESPACE.test(value)) {
    invalid("sidecar namespace", "must be a control namespace");
  }
  return value;
}

export function normalizeControlRuntimeRoot(value: unknown): string {
  return normalizeRoot(value, "sidecar runtimeRoot");
}

function normalizeRoot(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(label, "must be a string");
  if (value.length === 0 || value.trim() !== value || value.includes("\0")) {
    invalid(label, "must be a non-empty canonical path");
  }
  if (!isAbsolute(value)) invalid(label, "must be absolute");
  return resolve(value);
}

export function normalizeControlScope(value: SidecarControlScope): SidecarControlScope {
  if (!Number.isSafeInteger(value.generation) || value.generation < 0) {
    invalid("sidecar generation", "must be a non-negative safe integer");
  }
  return Object.freeze({
    channel: normalizeToken(value.channel, "sidecar channel"),
    generation: value.generation,
    namespace: normalizeNamespace(value.namespace),
  });
}

export function normalizeControlIdentity(value: SidecarControlIdentity): SidecarControlIdentity {
  return Object.freeze({
    ...normalizeControlScope(value),
    service: normalizeToken(value.service, "sidecar service"),
  });
}

export function normalizeControlRoots(value: SidecarControlRoots): SidecarControlRoots {
  return Object.freeze({
    dataRoot: normalizeRoot(value.dataRoot, "sidecar dataRoot"),
    logsRoot: normalizeRoot(value.logsRoot, "sidecar logsRoot"),
    resourceRoot: normalizeRoot(value.resourceRoot, "sidecar resourceRoot"),
    runtimeRoot: normalizeControlRuntimeRoot(value.runtimeRoot),
  });
}

function normalizeJsonValue(value: unknown, label: string, seen = new Set<object>()): SidecarControlJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(label, "must contain only finite JSON numbers");
    return value;
  }
  if (typeof value !== "object") invalid(label, "must contain only JSON values");
  if (seen.has(value)) invalid(label, "must not contain cycles");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry, index) =>
        normalizeJsonValue(entry, `${label}[${index}]`, seen),
      ));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid(label, "objects must be plain JSON records");
    }
    return Object.freeze(Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJsonValue(entry, `${label}.${key}`, seen)]),
    ));
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value: SidecarControlJsonValue): string {
  return JSON.stringify(value);
}

export function createControlProjection(value: SidecarControlJsonValue): SidecarControlProjection {
  const normalizedValue = normalizeJsonValue(value, "sidecar projection value");
  const digest = `sha256:${createHash("sha256").update(canonicalJson(normalizedValue)).digest("hex")}` as const;
  return Object.freeze({ digest, value: normalizedValue });
}

export function normalizeControlProjection(value: SidecarControlProjection): SidecarControlProjection {
  if (typeof value !== "object" || value == null) invalid("sidecar projection", "must be present");
  const normalizedValue = normalizeJsonValue(value.value, "sidecar projection value");
  if (typeof value.digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.digest)) {
    invalid("sidecar projection digest", "must be a lowercase sha256 digest");
  }
  const { digest } = createControlProjection(normalizedValue);
  if (value.digest !== digest) invalid("sidecar projection digest", "does not match its value");
  return Object.freeze({ digest, value: normalizedValue });
}

export function sameControlProjection(
  left: SidecarControlProjection,
  right: SidecarControlProjection,
): boolean {
  return left.digest === right.digest;
}

export function sameControlIdentity(
  left: SidecarControlIdentity,
  right: SidecarControlIdentity,
): boolean {
  return (
    left.channel === right.channel &&
    left.namespace === right.namespace &&
    left.generation === right.generation &&
    left.service === right.service
  );
}

export function sameControlRoots(left: SidecarControlRoots, right: SidecarControlRoots): boolean {
  return (
    left.dataRoot === right.dataRoot &&
    left.logsRoot === right.logsRoot &&
    left.resourceRoot === right.resourceRoot &&
    left.runtimeRoot === right.runtimeRoot
  );
}

function controlKey(
  identity: SidecarControlIdentity,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.channel,
        identity.namespace,
        identity.generation,
        identity.service,
        roots.runtimeRoot,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

function lifecycleKey(
  scope: Pick<SidecarControlScope, "channel" | "namespace">,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([scope.channel, scope.namespace, roots.runtimeRoot]))
    .digest("hex")
    .slice(0, 32);
}

export function privateControlPaths(
  identity: SidecarControlIdentity,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): Readonly<{
  endpointPath: string;
  leaseBodyPath: string;
  leaseMetadataPath: string;
  leasePath: string;
  leaseProcessPath: string;
  readyMarkerPath: string;
  retiredRoot: string;
  stoppingMarkerPath: string;
}> {
  const key = controlKey(identity, roots);
  const controlRoot = join(roots.runtimeRoot, ".sidecar-control");
  const leasePath = join(controlRoot, `${key}.lease`);
  return {
    endpointPath:
      process.platform === "win32"
        ? `\\\\.\\pipe\\open-design-sidecar-${key}`
        : join(POSIX_CONTROL_ROOT, `od-sidecar-${key}.sock`),
    leaseBodyPath: join(leasePath, "body.json"),
    leaseMetadataPath: join(leasePath, "metadata.json"),
    leasePath,
    leaseProcessPath: join(leasePath, "process.json"),
    readyMarkerPath: join(leasePath, "ready"),
    retiredRoot: join(controlRoot, "retired"),
    stoppingMarkerPath: join(leasePath, "stopping"),
  };
}

export function privateLifecycleEndpointPath(
  scope: Pick<SidecarControlScope, "channel" | "namespace">,
  roots: Pick<SidecarControlRoots, "runtimeRoot">,
): string {
  const key = lifecycleKey(scope, roots);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\open-design-sidecar-session-${key}`
    : join(POSIX_CONTROL_ROOT, `od-sidecar-session-${key}.sock`);
}

export function createPrivateLaunchMetadata(input: {
  projection: SidecarControlProjection;
  roots: SidecarControlRoots;
  scope: SidecarControlScope;
  service: string;
}): PrivateLaunchMetadata {
  const roots = normalizeControlRoots(input.roots);
  const identity = normalizeControlIdentity({
    ...normalizeControlScope(input.scope),
    service: input.service,
  });
  return Object.freeze({
    endpointPath: privateControlPaths(identity, roots).endpointPath,
    identity,
    incarnation: randomUUID(),
    projection: normalizeControlProjection(input.projection),
    roots,
    schemaVersion: CONTROL_SCHEMA_VERSION,
  });
}

export function encodePrivateLaunchMetadata(metadata: PrivateLaunchMetadata): string {
  return Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
}

export function decodePrivateLaunchMetadata(value: unknown): PrivateLaunchMetadata {
  if (typeof value !== "string" || value.length === 0) {
    invalid("sidecar launch metadata", "is unavailable");
  }
  let parsed: Partial<PrivateLaunchMetadata>;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<PrivateLaunchMetadata>;
  } catch (error) {
    throw new SidecarControlError("invalid-input", "sidecar launch metadata is invalid", { cause: error });
  }
  if (parsed.schemaVersion !== CONTROL_SCHEMA_VERSION) {
    invalid("sidecar launch metadata schemaVersion", "is unsupported");
  }
  if (typeof parsed.identity !== "object" || parsed.identity == null) {
    invalid("sidecar launch identity", "must be present");
  }
  if (typeof parsed.roots !== "object" || parsed.roots == null) {
    invalid("sidecar launch roots", "must be present");
  }
  if (typeof parsed.projection !== "object" || parsed.projection == null) {
    invalid("sidecar launch projection", "must be present");
  }
  if (typeof parsed.incarnation !== "string" || parsed.incarnation.length === 0) {
    invalid("sidecar launch incarnation", "must be present");
  }
  const identity = normalizeControlIdentity(parsed.identity as SidecarControlIdentity);
  const projection = normalizeControlProjection(parsed.projection as SidecarControlProjection);
  const roots = normalizeControlRoots(parsed.roots as SidecarControlRoots);
  const expectedEndpoint = privateControlPaths(identity, roots).endpointPath;
  if (parsed.endpointPath !== expectedEndpoint) {
    invalid("sidecar launch endpoint", "does not match the normalized identity");
  }
  return Object.freeze({
    endpointPath: expectedEndpoint,
    identity,
    incarnation: parsed.incarnation,
    projection,
    roots,
    schemaVersion: CONTROL_SCHEMA_VERSION,
  });
}

export function readPrivateLaunchMetadata(env: NodeJS.ProcessEnv = process.env): PrivateLaunchMetadata {
  return decodePrivateLaunchMetadata(env[CONTROL_BOOTSTRAP_ENV]);
}

export function installPrivateLaunchMetadata(
  metadata: PrivateLaunchMetadata,
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  const previous = env[CONTROL_BOOTSTRAP_ENV];
  env[CONTROL_BOOTSTRAP_ENV] = encodePrivateLaunchMetadata(metadata);
  return () => {
    if (previous == null) delete env[CONTROL_BOOTSTRAP_ENV];
    else env[CONTROL_BOOTSTRAP_ENV] = previous;
  };
}

export function createPrivateLaunchEnv(
  metadata: PrivateLaunchMetadata,
  extraEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...(extraEnv ?? process.env),
    [CONTROL_BOOTSTRAP_ENV]: encodePrivateLaunchMetadata(metadata),
  };
}

export function forwardPrivateLaunchEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const value = env[CONTROL_BOOTSTRAP_ENV];
  return value == null ? {} : { [CONTROL_BOOTSTRAP_ENV]: value };
}

export function withoutPrivateLaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result[CONTROL_BOOTSTRAP_ENV];
  return result;
}

export function createPrivateRequest(
  metadata: PrivateLaunchMetadata,
  operation: PrivateControlOperation,
): PrivateControlRequest {
  return {
    identity: metadata.identity,
    incarnation: metadata.incarnation,
    operation,
    requestId: randomUUID(),
    schemaVersion: CONTROL_SCHEMA_VERSION,
  };
}

export function privateResponse(
  request: PrivateControlRequest,
  metadata: PrivateLaunchMetadata,
  value:
    | Readonly<{ error: Readonly<{ code: SidecarControlErrorCode; message: string }>; status: "error" }>
    | Readonly<{ result: unknown; status: "ok" }>,
): PrivateControlResponse {
  return {
    ...value,
    identity: metadata.identity,
    incarnation: metadata.incarnation,
    requestId: request.requestId,
    schemaVersion: CONTROL_SCHEMA_VERSION,
  };
}

export function normalizePrivateControlLease(value: unknown): PrivateControlLease {
  const record = typeof value === "object" && value != null
    ? value as Record<string, unknown>
    : null;
  const descriptor = decodePrivateLaunchMetadata(
    record != null
      ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
      : value,
  );
  if (!Number.isSafeInteger(record?.ownerPid) || (record?.ownerPid as number) <= 0) {
    invalid("sidecar claim ownerPid", "must be a positive safe integer");
  }
  if (record?.terminal !== "hosted" && record?.terminal !== "process") {
    invalid("sidecar lease terminal", "is unsupported");
  }
  const metadata = {
    ...descriptor,
    ownerPid: record.ownerPid as number,
    terminal: record.terminal,
  } as const;
  if (record?.state === "claiming") {
    return Object.freeze({ ...metadata, state: "claiming" });
  }
  if (record?.state !== "starting" && record?.state !== "ready" && record?.state !== "stopping") {
    invalid("sidecar lease state", "is unsupported");
  }
  if (!Number.isSafeInteger(record.pid) || (record.pid as number) <= 0) {
    invalid("sidecar lease pid", "must be a positive safe integer");
  }
  if (!Number.isSafeInteger(record.processPid) || (record.processPid as number) <= 0) {
    invalid("sidecar lease processPid", "must be a positive safe integer");
  }
  return Object.freeze({
    ...metadata,
    pid: record.pid as number,
    processPid: record.processPid as number,
    state: record.state,
  });
}

export function normalizePrivateReadyDescriptor(value: unknown): PrivateReadyDescriptor {
  const lease = normalizePrivateControlLease(value);
  if (lease.state !== "ready") invalid("sidecar ready lease", "must be ready");
  return lease as PrivateReadyDescriptor;
}

export function assertPrivateResponse(
  request: PrivateControlRequest,
  response: PrivateControlResponse,
): unknown {
  if (
    typeof response !== "object" ||
    response == null ||
    response.schemaVersion !== CONTROL_SCHEMA_VERSION ||
    response.requestId !== request.requestId ||
    !sameControlIdentity(response.identity, request.identity) ||
    response.incarnation !== request.incarnation
  ) {
    throw new SidecarControlError("peer-mismatch", "stale sidecar peer rejected by control fencing");
  }
  if (response.status === "error") {
    throw new SidecarControlError(
      response.error?.code ?? "request-failed",
      response.error?.message ?? "sidecar control request failed",
    );
  }
  return response.result;
}
