/**
 * @module @open-design/sidecar
 *
 * Public barrel for the generic sidecar runtime package. Re-exports the exact
 * prior public surface — the data types, IPC-path validators, namespace/runtime
 * path resolvers, launch-env + bootstrap, port allocation, JSON file helpers, and
 * the JSON-IPC server/client. This file contains no logic; every implementation
 * lives in a concern module beside it.
 */

export type {
  AppIpcPathRequest,
  AppRuntimePathRequest,
  BaseResolutionOptions,
  BootstrapSidecarRuntimeOptions,
  JsonIpcHandler,
  JsonIpcServerHandle,
  NamespaceResolutionOptions,
  PortAllocation,
  PortRequest,
  ProjectRuntimePathRequest,
  RuntimePathRequest,
  RuntimeRootRequest,
  SidecarContractDescriptor,
  SidecarLaunchEnvRequest,
  SidecarRuntimeContext,
  SidecarStampShape,
} from "./types.js";
export { isWindowsNamedPipePath, normalizeIpcPath } from "./ipc-path.js";
export {
  resolveAppIpcPath,
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
export { bootstrapSidecarRuntime, createSidecarLaunchEnv } from "./bootstrap.js";
export { allocatePort } from "./port.js";
export { readJsonFile, removeFile, removePointerIfCurrent, writeJsonFile } from "./json-file.js";
export { createJsonIpcServer, requestJsonIpc } from "./json-ipc.js";
export type {
  SidecarClientOptions,
  SidecarHandler,
  SidecarHandlers,
  SidecarLifecycle,
  SidecarResources,
} from "./client.js";
export { SidecarClient, SidecarFactory } from "./client.js";
export type { SidecarStamp, SidecarStampField } from "./stamp.js";
export {
  normalizeSidecarStamp,
  readCurrentSidecarStamp,
  SIDECAR_STAMP_FIELDS,
  SIDECAR_STAMP_FLAGS,
} from "./stamp.js";
export type { SidecarLaunchRequest, SidecarStopResult } from "./operations.js";
export { findSidecarProcesses, getSidecarStatus, invokeSidecar, launchSidecar, stopSidecar } from "./operations.js";
