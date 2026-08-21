import type {
  SidecarControlAccess,
  SidecarServiceStopAttempt,
  SidecarServiceStopRequest,
  SidecarServicesConvergence,
} from "./public-types.js";

/** Attempt every requested identity while the namespace lifecycle session is held. */
export async function stopSidecarServices(
  control: Pick<SidecarControlAccess, "stop" | "withLifecycleSession">,
  requests: readonly SidecarServiceStopRequest[],
): Promise<SidecarServicesConvergence> {
  return await control.withLifecycleSession(async () => {
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
    return attempts.every((attempt) => attempt.status === "fulfilled" && attempt.result.state !== "alive")
      ? Object.freeze({ attempts, state: "complete" as const })
      : Object.freeze({ attempts, state: "incomplete" as const });
  });
}
