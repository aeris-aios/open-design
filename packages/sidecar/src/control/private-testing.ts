import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isWindowsNamedPipePath } from "../ipc-path.js";
import {
  createPrivateRequest,
  createPrivateLaunchMetadata,
  createControlProjection,
  installPrivateLaunchMetadata,
  privateControlPaths,
  type PrivateLaunchMetadata,
  type PrivateControlOperation,
  type PrivateControlResponse,
} from "./private-protocol.js";
import { requestJsonIpc } from "../json-ipc.js";
import {
  beginProcessLease,
  claimControlLease,
  retireControlLeaseIfCurrent,
} from "./lease-store.js";
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

export async function claimPrivateLaunchForTest(metadata: PrivateLaunchMetadata): Promise<void> {
  await claimControlLease(metadata, "hosted");
  await beginProcessLease(metadata, process.pid);
}

export async function retirePrivateLaunchForTest(metadata: PrivateLaunchMetadata): Promise<boolean> {
  return await retireControlLeaseIfCurrent(metadata);
}

export async function writePrivateReadyDescriptorForTest(
  metadata: PrivateLaunchMetadata,
  pid: number,
): Promise<void> {
  const paths = privateControlPaths(metadata.identity, metadata.roots);
  await mkdir(paths.leasePath, { recursive: true });
  await writeFile(
    paths.leaseMetadataPath,
    `${JSON.stringify({ ...metadata, ownerPid: process.pid, terminal: "process" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(paths.leaseProcessPath, `${JSON.stringify({ pid })}\n`, "utf8");
  await writeFile(paths.leaseBodyPath, `${JSON.stringify({ pid })}\n`, "utf8");
  await writeFile(paths.readyMarkerPath, "", "utf8");
}

export async function writePrivateDescriptorTextForTest(
  metadata: PrivateLaunchMetadata,
  text: string,
): Promise<void> {
  const { leaseMetadataPath, leasePath } = privateControlPaths(metadata.identity, metadata.roots);
  await mkdir(leasePath, { recursive: true });
  await writeFile(leaseMetadataPath, text, "utf8");
}

export async function writePrivateUnpublishedLeaseForTest(
  metadata: PrivateLaunchMetadata,
): Promise<void> {
  await mkdir(privateControlPaths(metadata.identity, metadata.roots).leasePath, { recursive: true });
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
    descriptorExists: await pathExists(paths.leasePath),
    endpointExists: isWindowsNamedPipePath(paths.endpointPath)
      ? false
      : await pathExists(paths.endpointPath),
  };
}
