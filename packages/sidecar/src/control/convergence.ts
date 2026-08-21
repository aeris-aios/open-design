import type {
  SidecarControlAccess,
  SidecarConvergenceProof,
  SidecarServiceStopAttempt,
  SidecarServiceStopRequest,
  SidecarServicesConvergence,
} from "./public-types.js";

/** Attempt every requested identity in order and return proof only when all are gone. */
export async function stopSidecarServices(
  control: Pick<SidecarControlAccess, "stop">,
  requests: readonly SidecarServiceStopRequest[],
): Promise<SidecarServicesConvergence> {
  const attempts: SidecarServiceStopAttempt[] = [];
  for (const request of requests) {
    try {
      attempts.push({
        result: request.options == null
          ? await control.stop(request.service)
          : await control.stop(request.service, request.options),
        service: request.service,
        status: "fulfilled",
      });
    } catch (error) {
      attempts.push({ error, service: request.service, status: "rejected" });
    }
  }
  if (attempts.every((attempt) => attempt.status === "fulfilled" && attempt.result.state !== "alive")) {
    const proof = Object.freeze({ attempts }) as unknown as SidecarConvergenceProof;
    return Object.freeze({ attempts, proof, state: "complete" });
  }
  return Object.freeze({ attempts, state: "incomplete" });
}
