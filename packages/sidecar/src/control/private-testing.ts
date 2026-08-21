import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isWindowsNamedPipePath } from "../ipc-path.js";
import { writeJsonFile } from "../json-file.js";
import {
  createPrivateRequest,
  createPrivateLaunchMetadata,
  createControlProjection,
  installPrivateLaunchMetadata,
  privateControlPaths,
  type PrivateLaunchMetadata,
  type PrivateControlOperation,
  type PrivateControlResponse,
  type PrivateReadyDescriptor,
} from "./private-protocol.js";
import { requestJsonIpc } from "../json-ipc.js";
import type {
  SidecarControlIdentity,
  SidecarControlJsonValue,
  SidecarControlRoots,
  SidecarControlScope,
} from "./public-types.js";

export function createPrivateLaunchForTest(input: {
  projection: SidecarControlJsonValue;
  roots: SidecarControlRoots;
  scope: SidecarControlScope;
  service: string;
}): PrivateLaunchMetadata {
  return createPrivateLaunchMetadata({ ...input, projection: createControlProjection(input.projection) });
}

export function installPrivateLaunchForTest(metadata: PrivateLaunchMetadata): () => void {
  return installPrivateLaunchMetadata(metadata);
}

export async function writePrivateReadyDescriptorForTest(
  metadata: PrivateLaunchMetadata,
  pid: number,
): Promise<void> {
  const { descriptorPath } = privateControlPaths(metadata.identity, metadata.roots);
  await writeJsonFile(descriptorPath, { ...metadata, pid, state: "ready" } satisfies PrivateReadyDescriptor);
}

export async function writePrivateDescriptorTextForTest(
  metadata: PrivateLaunchMetadata,
  text: string,
): Promise<void> {
  const { descriptorPath } = privateControlPaths(metadata.identity, metadata.roots);
  await mkdir(dirname(descriptorPath), { recursive: true });
  await writeFile(descriptorPath, text, "utf8");
}

export async function sendPrivateRequestForTest(
  metadata: PrivateLaunchMetadata,
  input: {
    identity?: SidecarControlIdentity;
    operation: PrivateControlOperation;
  },
): Promise<PrivateControlResponse> {
  const request = {
    ...createPrivateRequest(metadata, input.operation),
    identity: input.identity ?? metadata.identity,
  };
  return await requestJsonIpc<PrivateControlResponse>(metadata.endpointPath, request);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function privateLaunchStateForTest(metadata: PrivateLaunchMetadata): Promise<{
  descriptorExists: boolean;
  endpointExists: boolean;
}> {
  const paths = privateControlPaths(metadata.identity, metadata.roots);
  return {
    descriptorExists: await pathExists(paths.descriptorPath),
    endpointExists: isWindowsNamedPipePath(paths.endpointPath)
      ? false
      : await pathExists(paths.endpointPath),
  };
}
