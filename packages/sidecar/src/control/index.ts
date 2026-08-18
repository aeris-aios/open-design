export { SidecarControlError } from "./error.js";
export { attachSidecar, readSidecarContext } from "./body.js";
export {
  accessControlPlane,
  bootstrapControlPlane,
  connectSidecar,
  forwardSidecarEnvironment,
  resumeControlPlane,
  stripSidecarEnvironment,
} from "./controller.js";
export type {
  AccessControlPlaneOptions,
  AttachedSidecar,
  AttachSidecarOptions,
  BootstrapControlPlaneOptions,
  SidecarControlClient,
  SidecarControlAccess,
  SidecarControlContext,
  SidecarControlIdentity,
  SidecarControlJsonValue,
  SidecarControlPlane,
  SidecarControlProjection,
  SidecarControlRoots,
  SidecarControlScope,
  SidecarConvergeResult,
  SidecarExit,
  SidecarExposeOptions,
  SidecarLaunch,
  SidecarLaunchOptions,
  SidecarMethod,
  SidecarMethodHandlers,
  SidecarProbeResult,
  SidecarStopResult,
} from "./public-types.js";
