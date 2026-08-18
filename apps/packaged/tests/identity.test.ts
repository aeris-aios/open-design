import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createPackagedControl } from "../src/control.js";
import { readPackagedDesktopControlIdentity, writePackagedDesktopIdentity } from "../src/identity.js";
import type { PackagedNamespacePaths } from "../src/paths.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function fakePaths(root: string): PackagedNamespacePaths {
  return {
    cacheRoot: join(root, "cache"),
    dataRoot: join(root, "data"),
    desktopIdentityPath: join(root, "runtime", "desktop-root.json"),
    desktopLogPath: join(root, "logs", "desktop", "latest.log"),
    desktopLogsRoot: join(root, "logs", "desktop"),
    electronSessionDataRoot: join(root, "user-data", "session"),
    electronUserDataRoot: join(root, "user-data"),
    headlessIdentityPath: join(root, "runtime", "headless-root.json"),
    installationRoot: join(root, ".."),
    installerObservationRoot: join(root, "data", "observations", "installer"),
    logsRoot: join(root, "logs"),
    namespaceRoot: root,
    resourceRoot: join(root, "resources"),
    runtimeRoot: join(root, "runtime"),
    updateRoot: join(root, "updates"),
    webIdentityPath: join(root, "runtime", "web-root.json"),
  };
}

describe("packaged identity markers", () => {
  it("keeps the selected payload generation in the control and runtime identities", () => {
    const paths = fakePaths(join(tmpdir(), `od-packaged-control-${process.pid}-${Date.now()}`));
    const result = createPackagedControl("0.19.4-beta.30", 7, "release-beta", paths);

    expect(result.control.scope).toEqual({
      channel: "beta",
      generation: 7,
      namespace: "release-beta",
    });
    expect(result.runtime).toMatchObject(result.control.scope);
  });

  it("can write and close the desktop identity shape at the headless marker path", async () => {
    const root = join(tmpdir(), `od-packaged-identity-${process.pid}-${Date.now()}`);
    const paths = fakePaths(root);
    const runtime = {
      channel: "beta",
      dataRoot: paths.dataRoot,
      generation: 0,
      logsRoot: paths.logsRoot,
      mode: "runtime" as const,
      namespace: "default",
      protocol: 1 as const,
      resourceRoot: paths.resourceRoot,
      runtimeRoot: paths.runtimeRoot,
      source: "packaged" as const,
    };

    try {
      const handle = await writePackagedDesktopIdentity({
        identityPath: paths.headlessIdentityPath,
        paths,
        runtime,
      });

      expect(await pathExists(paths.headlessIdentityPath)).toBe(true);
      expect(await pathExists(paths.desktopIdentityPath)).toBe(false);

      await handle.close();
      expect(await pathExists(paths.headlessIdentityPath)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("discovers a newer headless desktop over a stale GUI identity", async () => {
    const root = join(tmpdir(), `od-packaged-headless-identity-${process.pid}-${Date.now()}`);
    const paths = fakePaths(root);
    const identity = {
      appPath: "/tmp/Open Design.app",
      executablePath: "/tmp/Open Design.app/Contents/MacOS/Open Design",
      logPath: paths.desktopLogPath,
      namespaceRoot: paths.namespaceRoot,
      pid: process.pid,
      ppid: process.ppid,
      runtime: { channel: "beta", generation: 9, namespace: root.split("/").pop()!, source: "packaged" },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    } as const;

    try {
      await mkdir(join(root, "runtime"), { recursive: true });
      await writeFile(paths.desktopIdentityPath, JSON.stringify({
        ...identity,
        runtime: { ...identity.runtime, generation: 2 },
      }));
      await writeFile(paths.headlessIdentityPath, JSON.stringify(identity));
      await utimes(paths.desktopIdentityPath, new Date(1_000), new Date(1_000));
      await utimes(paths.headlessIdentityPath, new Date(2_000), new Date(2_000));
      expect(await readPackagedDesktopControlIdentity(paths)).toMatchObject({
        runtime: { channel: "beta", generation: 9, namespace: identity.runtime.namespace },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
