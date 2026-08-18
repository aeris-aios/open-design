import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { readJsonFile, removeFile, writeJsonFile } from "@open-design/sidecar";
import type { OpenDesignRuntimeContext } from "@open-design/contracts/runtime/sidecars";

import type { PackagedNamespacePaths } from "./paths.js";

export type PackagedDesktopRootIdentity = {
  appPath: string;
  executablePath: string;
  logPath: string;
  namespaceRoot: string;
  pid: number;
  ppid: number;
  runtime: Pick<OpenDesignRuntimeContext, "channel" | "generation" | "namespace" | "source">;
  startedAt: string;
  updatedAt: string;
  version: 1;
};

export type PackagedWebRootIdentity = {
  namespace: string;
  pid: number;
  url: string;
  startedAt: string;
  version: 1;
};

export type PackagedDesktopIdentityHandle = {
  close(): Promise<void>;
  identity: PackagedDesktopRootIdentity;
};

export async function readPackagedDesktopControlIdentity(
  paths: PackagedNamespacePaths,
): Promise<PackagedDesktopRootIdentity | null> {
  let newest: { identity: PackagedDesktopRootIdentity; mtimeMs: number } | null = null;
  for (const identityPath of [paths.desktopIdentityPath, paths.headlessIdentityPath]) {
    try {
      const identity = await readJsonFile<PackagedDesktopRootIdentity>(identityPath);
      if (
        identity == null
        || identity.runtime.namespace !== basename(paths.namespaceRoot)
        || typeof identity.runtime.channel !== "string"
        || !Number.isSafeInteger(identity.runtime.generation)
        || identity.runtime.generation < 0
      ) {
        continue;
      }
      const { mtimeMs } = await stat(identityPath);
      if (newest == null || mtimeMs > newest.mtimeMs) newest = { identity, mtimeMs };
    } catch {
      // Missing or concurrently retired identities do not define a live owner.
    }
  }
  return newest?.identity ?? null;
}

function resolveCurrentMacAppPath(executablePath: string): string {
  return dirname(dirname(dirname(executablePath)));
}

function createPackagedDesktopRootIdentity(options: {
  paths: PackagedNamespacePaths;
  runtime: OpenDesignRuntimeContext;
}): PackagedDesktopRootIdentity {
  const now = new Date().toISOString();
  const executablePath = process.execPath;

  return {
    appPath: resolveCurrentMacAppPath(executablePath),
    executablePath,
    logPath: options.paths.desktopLogPath,
    namespaceRoot: options.paths.namespaceRoot,
    pid: process.pid,
    ppid: process.ppid,
    runtime: {
      channel: options.runtime.channel,
      generation: options.runtime.generation,
      namespace: options.runtime.namespace,
      source: options.runtime.source,
    },
    startedAt: now,
    updatedAt: now,
    version: 1,
  };
}

export async function writePackagedDesktopIdentity(options: {
  identityPath?: string;
  paths: PackagedNamespacePaths;
  runtime: OpenDesignRuntimeContext;
}): Promise<PackagedDesktopIdentityHandle> {
  const identity = createPackagedDesktopRootIdentity(options);
  const identityPath = options.identityPath ?? options.paths.desktopIdentityPath;

  const writeIdentity = async () => {
    identity.updatedAt = new Date().toISOString();
    await writeJsonFile(identityPath, identity);
  };

  await writeIdentity();
  const heartbeat = setInterval(() => {
    void writeIdentity().catch(() => undefined);
  }, 5000);
  heartbeat.unref();

  return {
    async close() {
      clearInterval(heartbeat);
      await removeFile(identityPath).catch(() => undefined);
    },
    identity,
  };
}

export async function writePackagedWebIdentity(options: {
  paths: PackagedNamespacePaths;
  pid: number;
  url: string;
}): Promise<void> {
  const identity: PackagedWebRootIdentity = {
    namespace: options.paths.namespaceRoot.split("/").pop() ?? "default",
    pid: options.pid,
    url: options.url,
    startedAt: new Date().toISOString(),
    version: 1,
  };
  await writeJsonFile(options.paths.webIdentityPath, identity);
}
