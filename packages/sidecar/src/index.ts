/**
 * @module @open-design/sidecar
 *
 * Public boundary for sidecar clients and server-side process atomics. Transport,
 * endpoint derivation, and identity persistence are deliberately private package
 * details; callers share only the five-field argv stamp and these operations.
 */

export type {
  AppRuntimePathRequest,
  BaseResolutionOptions,
  NamespaceResolutionOptions,
  PortAllocation,
  PortRequest,
  ProjectRuntimePathRequest,
  RuntimePathRequest,
  RuntimeRootRequest,
  SidecarRuntimeContext,
} from "./types.js";
export {
  resolveAppRuntimeDir,
  resolveAppRuntimePath,
  resolveLogFilePath,
  resolveLogsDir,
  resolveManifestPath,
  resolveNamespace,
  resolveNamespaceRoot,
  resolvePointerPath,
  resolveProjectRoot,
  resolveProjectTmpRoot,
  resolveRuntimeNamespaceRoot,
  resolveRuntimeRoot,
  resolveSidecarBase,
  resolveSourceRuntimeRoot,
} from "./paths.js";
export { allocatePort } from "./port.js";
export type {
  SidecarClientOptions,
  SidecarConnection,
  SidecarHandler,
  SidecarHandlers,
  SidecarLifecycle,
  SidecarResources,
} from "./client.js";
export { SidecarClient, SidecarFactory } from "./client.js";
export type { SidecarStamp, SidecarStampField } from "./stamp.js";
export {
  normalizeSidecarStamp,
  isCurrentSidecarLauncher,
  readCurrentSidecarStamp,
  SIDECAR_STAMP_FIELDS,
  SIDECAR_STAMP_FLAGS,
} from "./stamp.js";
export type {
  SidecarLaunchRequest,
  SidecarLaunchConvergenceOptions,
  SidecarLaunchConvergenceResult,
  SidecarRestartOptions,
  SidecarRestartResult,
  SidecarStopResult,
  SpawnedSidecar,
} from "./operations.js";
export {
  bootstrapSidecarProcess,
  convergeSidecarLaunch,
  findSidecarProcesses,
  getSidecarStatus,
  invokeSidecar,
  launchSidecar,
  registerSidecarProcess,
  restartSidecar,
  resolveSidecarLauncherExitCode,
  SidecarLaunchConvergenceError,
  spawnSidecarLauncher,
  spawnSidecar,
  stopSidecar,
} from "./operations.js";
