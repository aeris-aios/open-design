/**
 * @module @open-design/sidecar
 *
 * Small public utilities shared by Sidecar consumers. Atomic lifecycle and
 * capability methods live under `@open-design/sidecar/control`; private
 * transport and identity mechanics are intentionally not exported here.
 */

export { allocatePort, type PortAllocation, type PortRequest } from "./port.js";
export { readJsonFile, removeFile, removePointerIfCurrent, writeJsonFile } from "./json-file.js";
