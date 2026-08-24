import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StandaloneStore, StandaloneUpdater, VersionedLauncher, canonicalJson, sha256Hex, signStandaloneChannelHead, signStandaloneMetadata, type StandaloneMetadata } from "@open-design/standalone";
import { FileFixtureLifecyclePort, OFFICIAL_NODE_VERSION, applyTerminalUpdate, assertOfficialNodeVersion } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))); });

describe("Terminal shell skeleton", () => {
  it("pins the exact official Node carrier", () => {
    expect(OFFICIAL_NODE_VERSION).toBe("24.18.0");
    expect(() => assertOfficialNodeVersion("24.18.0")).not.toThrow();
    expect(() => assertOfficialNodeVersion("24.18.1")).toThrow("requires official Node 24.18.0");
  });

  it("persists the Web/daemon-independent lifecycle fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "terminal-fixture-")); roots.push(root);
    const port = new FileFixtureLifecyclePort(root, "betahyx-local");
    const generation = { schemaVersion: 1 as const, id: "generation-1", channel: "betahyx", releaseVersion: "0.1.0-betahyx.1", standaloneVersion: "0.1.0", sourceCommit: "a".repeat(40), components: {} };
    await expect(port.start(generation)).resolves.toEqual({ state: "running", generationId: "generation-1" });
    await expect(new FileFixtureLifecyclePort(root, "betahyx-local").status()).resolves.toEqual({ state: "running", generationId: "generation-1" });
    await expect(port.stop()).resolves.toEqual({ state: "stopped", generationId: "generation-1" });
  });

  it("applies an already-prepared update returned as current", async () => {
    const lifecycle = { state: "running" as const, generationId: "generation-2" };
    const applyNow = vi.fn(async () => lifecycle);
    const preparation = { status: "current" as const, generationId: "generation-2", applyRequired: true };
    await expect(applyTerminalUpdate({ applyNow } as never, {} as never, preparation)).resolves.toEqual({ preparation, lifecycle });
    expect(applyNow).toHaveBeenCalledOnce();
  });

  it("returns lifecycle status when an already-active update is applied again", async () => {
    const lifecycle = { state: "running" as const, generationId: "generation-2" };
    const applyNow = vi.fn();
    const status = vi.fn(async () => lifecycle);
    const preparation = { status: "current" as const, generationId: "generation-2", applyRequired: false };
    await expect(applyTerminalUpdate({ applyNow } as never, { status } as never, preparation)).resolves.toEqual({ preparation, lifecycle });
    expect(applyNow).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledOnce();
  });

  it("replays apply-update against a real already-active generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "terminal-replay-")); roots.push(root);
    const artifact = Buffer.from("closure-update");
    const keys = generateKeyPairSync("ed25519");
    const metadata: StandaloneMetadata = {
      schemaVersion: 1,
      channel: "betahyx",
      releaseVersion: "0.1.0-betahyx.1",
      standaloneVersion: "0.1.0",
      sourceCommit: "a".repeat(40),
      publishedAt: "2026-08-24T00:00:00.000Z",
      components: [{ name: "closure-fixture", mode: "required", artifact: { entrypoint: "fixture.mjs", sha256: sha256Hex(artifact), size: artifact.byteLength, url: "https://fixtures.invalid/closure.mjs" } }],
      shellCompatibility: [{ shell: "terminal", target: "darwin-arm64", shellVersion: "0.1.0", runtime: { name: "node", version: OFFICIAL_NODE_VERSION } }],
    };
    const envelope = signStandaloneMetadata(metadata, "test-key", keys.privateKey);
    const metadataBytes = Buffer.from(canonicalJson(envelope));
    const head = signStandaloneChannelHead({
      schemaVersion: 1,
      channel: "betahyx",
      publishedAt: "2026-08-24T00:00:00.000Z",
      lanes: { closure: { releaseVersion: metadata.releaseVersion, url: "https://fixtures.invalid/metadata.json", sha256: sha256Hex(metadataBytes), size: metadataBytes.byteLength } },
    }, [{ keyId: "test-key", privateKey: keys.privateKey }]);
    const store = new StandaloneStore(root, "terminal-betahyx");
    const updater = new StandaloneUpdater(
      "betahyx",
      "closure",
      { shell: "terminal", target: "darwin-arm64", shellVersion: "0.1.0", runtime: { name: "node", version: OFFICIAL_NODE_VERSION } },
      new Map([["test-key", keys.publicKey]]),
      store,
      { readChannelHead: async () => head, readArtifact: async (url) => url.endsWith("metadata.json") ? metadataBytes : artifact },
    );
    const launcher = new VersionedLauncher(store, new FileFixtureLifecyclePort(root, "terminal-betahyx"));

    const prepared = await updater.prepareLatest();
    expect(prepared.status).toBe("prepared");
    await expect(applyTerminalUpdate(updater, launcher, prepared)).resolves.toMatchObject({ lifecycle: { state: "running" } });
    const current = await updater.prepareLatest();
    expect(current).toMatchObject({ status: "current", applyRequired: false });
    await expect(applyTerminalUpdate(updater, launcher, current)).resolves.toMatchObject({ lifecycle: { state: "running" } });
    expect(await store.readState()).toMatchObject({ active: current.status === "current" ? current.generationId : null, attempt: null });
  });

  it("rejects a foreign Node carrier before parsing commands or opening a store", () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx",
      "--eval", "Object.defineProperty(process.versions, 'node', { value: '24.18.1' }); await import('./src/cli.ts');",
    ], { cwd: join(import.meta.dirname, ".."), encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Terminal carrier requires official Node 24.18.0; got 24.18.1");
    expect(result.stderr).not.toContain("missing --root");
  });

  it("preserves a shell reinstall requirement without applying a stale attempt", async () => {
    const applyNow = vi.fn();
    const preparation = { status: "shell-reinstall-required" as const, releaseVersion: "0.1.0-betahyx.2" };
    await expect(applyTerminalUpdate({ applyNow } as never, {} as never, preparation)).resolves.toEqual({ preparation });
    expect(applyNow).not.toHaveBeenCalled();
  });
});
