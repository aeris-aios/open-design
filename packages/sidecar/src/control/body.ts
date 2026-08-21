import { createJsonIpcServer } from "../json-ipc.js";
import { SidecarControlError } from "./error.js";
import { withLifecycleSession } from "./lifecycle-session.js";
import {
  publishReadyLease,
  readControlLease,
  retireControlLeaseIfCurrent,
} from "./lease-store.js";
import {
  PRIVATE_CONTROL_SCHEMA_VERSION,
  privateLifecycleEndpointPath,
  privateResponse,
  readPrivateLaunchMetadata,
  sameControlIdentity,
  type PrivateControlRequest,
  type PrivateControlResponse,
  type PrivateLaunchMetadata,
} from "./private-protocol.js";
import type {
  AttachedSidecar,
  AttachSidecarOptions,
  SidecarControlContext,
  SidecarMethodHandlers,
  SidecarProbeResult,
} from "./public-types.js";

function requestFailure(
  request: PrivateControlRequest,
  metadata: PrivateLaunchMetadata,
  code: "method-unavailable" | "peer-mismatch" | "request-failed",
  message: string,
): PrivateControlResponse {
  return privateResponse(request, metadata, { error: { code, message }, status: "error" });
}

function normalizeIncomingRequest(value: unknown): PrivateControlRequest | null {
  if (typeof value !== "object" || value == null) return null;
  const request = value as Partial<PrivateControlRequest>;
  if (
    request.schemaVersion !== PRIVATE_CONTROL_SCHEMA_VERSION ||
    typeof request.requestId !== "string" ||
    typeof request.incarnation !== "string" ||
    typeof request.operation !== "object" ||
    request.operation == null
  ) {
    return null;
  }
  return request as PrivateControlRequest;
}

export async function attachSidecar<TMethods>({
  ...options
}: AttachSidecarOptions<TMethods>): Promise<AttachedSidecar> {
  return await attachSidecarWithMetadata(readPrivateLaunchMetadata(), options);
}

/** Read validated caller identity/roots/projection without exposing private wire metadata. */
export function readSidecarContext(env: NodeJS.ProcessEnv = process.env): SidecarControlContext {
  const metadata = readPrivateLaunchMetadata(env);
  return Object.freeze({
    identity: metadata.identity,
    projection: metadata.projection,
    roots: metadata.roots,
  });
}

/** @internal Attach a caller-hosted semantic service to validated control metadata. */
export async function attachSidecarWithMetadata<TMethods>(
  metadata: PrivateLaunchMetadata,
  {
    handlers,
    lifecycle,
  }: AttachSidecarOptions<TMethods>,
  internal: Readonly<{
    releaseLeaseOnClose?: boolean;
  }> = {},
): Promise<AttachedSidecar> {
  const context: SidecarControlContext = Object.freeze({
    identity: metadata.identity,
    projection: metadata.projection,
    roots: metadata.roots,
  });
  let stopping: Promise<void> | null = null;
  let beginExternalStop: () => void = () => undefined;
  let stopRequested = false;
  let closeAttachment: () => Promise<void> = async () => undefined;
  let resolveClosed!: () => void;
  let rejectClosed!: (error: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  void closed.catch(() => undefined);

  const claim = await readControlLease(metadata.identity, metadata.roots);
  if (
    claim?.incarnation !== metadata.incarnation
    || claim.state === "claiming"
  ) {
    throw new SidecarControlError("peer-mismatch", "sidecar body requires its exact captured launch claim");
  }
  if (internal.releaseLeaseOnClose == null) {
    internal = { releaseLeaseOnClose: claim.terminal === "hosted" };
  }

  try {
    await lifecycle.initialize(context);
  } catch (error) {
    await Promise.resolve().then(() => lifecycle.stop()).catch(() => undefined);
    if (internal.releaseLeaseOnClose === true) {
      await retireControlLeaseIfCurrent(metadata).catch(() => undefined);
    }
    throw error;
  }

  const server = await createJsonIpcServer({
    socketPath: metadata.endpointPath,
    async handler(value) {
      const request = normalizeIncomingRequest(value);
      if (request == null) {
        throw new SidecarControlError("invalid-input", "invalid sidecar control request");
      }
      if (
        !sameControlIdentity(request.identity, metadata.identity) ||
        request.incarnation !== metadata.incarnation
      ) {
        return requestFailure(
          request,
          metadata,
          "peer-mismatch",
          "stale sidecar peer rejected by control fencing",
        );
      }

      if (request.operation.kind === "probe") {
        return privateResponse(request, metadata, {
          result: {
            identity: metadata.identity,
            projection: metadata.projection,
          } satisfies SidecarProbeResult,
          status: "ok",
        });
      }

      if (request.operation.kind === "request-stop") {
        if (!stopRequested) {
          stopRequested = true;
          beginExternalStop();
        }
        return privateResponse(request, metadata, {
          result: { accepted: true },
          status: "ok",
        });
      }

      const method = request.operation.method as keyof TMethods;
      const handler = (handlers as SidecarMethodHandlers<TMethods>)[method];
      if (typeof handler !== "function") {
        return requestFailure(
          request,
          metadata,
          "method-unavailable",
          `sidecar method is unavailable: ${request.operation.method}`,
        );
      }
      try {
        const result = await handler(request.operation.input as never, context);
        return privateResponse(request, metadata, { result, status: "ok" });
      } catch (error) {
        return requestFailure(
          request,
          metadata,
          "request-failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  }).catch(async (error: unknown) => {
    await Promise.resolve().then(() => lifecycle.stop()).catch(() => undefined);
    throw error;
  });

  const stopBodyAndCloseAttachment = async () => {
    await lifecycle.stop();
    await server.close();
    if (internal.releaseLeaseOnClose === true) await retireControlLeaseIfCurrent(metadata);
  };
  const stopOnce = (): Promise<void> => {
    if (stopping != null) return stopping;
    stopping = Promise.resolve()
      .then(stopBodyAndCloseAttachment)
      .then(resolveClosed, (error: unknown) => {
        rejectClosed(error);
        throw error;
      });
    void stopping.catch(() => undefined);
    return stopping;
  };
  beginExternalStop = () => {
    void stopOnce();
  };
  closeAttachment = async () => {
    if (stopping != null) return await stopping;
    return await withLifecycleSession(
      privateLifecycleEndpointPath(metadata.identity, metadata.roots),
      stopOnce,
    );
  };
  try {
    await publishReadyLease(metadata, process.pid);
  } catch (error) {
    await server.close();
    if (internal.releaseLeaseOnClose === true) {
      await retireControlLeaseIfCurrent(metadata).catch(() => undefined);
    }
    await Promise.resolve().then(() => lifecycle.stop()).catch(() => undefined);
    throw error;
  }

  return Object.freeze({
    closed,
    async close() {
      await closeAttachment();
    },
    context,
  });
}
