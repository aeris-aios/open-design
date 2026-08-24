import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FossilBootloader, StandaloneStore, VersionedLauncher, sha256Hex, signStandaloneMetadata, type GenerationRecord, type LifecyclePort, type LifecycleStatus, type StandaloneMetadata } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function metadata(bytes: Uint8Array): StandaloneMetadata {
  return {
    schemaVersion: 1,
    channel: "betahyx",
    releaseVersion: "0.1.0-betahyx.1",
    standaloneVersion: "0.1.0",
    sourceCommit: "7a4175c86fe305b6432081c3dc269cd4bd4ec04d",
    publishedAt: "2026-08-24T00:00:00.000Z",
    components: [{ name: "closure-fixture", mode: "required", artifact: { entrypoint: "fixture.mjs", sha256: sha256Hex(bytes), size: bytes.byteLength, url: "https://fixtures.invalid/closure.mjs" } }],
    shells: (["darwin-arm64", "win32-x64"] as const).map((target) => ({ shell: "terminal", target, shellVersion: "0.1.0", nodeVersion: "24.18.0", artifacts: [
      { kind: "official-node" as const, sha256: "a".repeat(64), size: 1, url: "https://fixtures.invalid/node.tar.gz" },
      { kind: "terminal-shell" as const, sha256: "b".repeat(64), size: 1, url: "https://fixtures.invalid/terminal.mjs" },
    ] })),
  };
}

class FixturePort implements LifecyclePort {
  private current: LifecycleStatus = { state: "stopped", generationId: null };
  async start(generation: GenerationRecord): Promise<LifecycleStatus> { return this.current = { state: "running", generationId: generation.id }; }
  async status(): Promise<LifecycleStatus> { return this.current; }
  async stop(): Promise<LifecycleStatus> { return this.current = { state: "stopped", generationId: this.current.generationId }; }
}

describe("standalone exact skeleton", () => {
  it("verifies, prepares, commits, boots, and records success", async () => {
    const root = await mkdtemp(join(tmpdir(), "standalone-store-")); roots.push(root);
    const bytes = Buffer.from("export default 'closure fixture';\n");
    const keys = generateKeyPairSync("ed25519");
    const envelope = signStandaloneMetadata(metadata(bytes), "test-key", keys.privateKey);
    const store = new StandaloneStore(root, "terminal-betahyx");
    const generation = await store.prepare(envelope, keys.publicKey, async () => bytes);
    await store.commit(generation.id);
    const port = new FixturePort();
    const fossil = new FossilBootloader(async () => new VersionedLauncher(store, port));
    await expect(fossil.start()).resolves.toEqual({ state: "running", generationId: generation.id });
    expect(await store.readState()).toEqual({ schemaVersion: 1, active: generation.id, attempt: null, lastSuccessful: generation.id });
    expect(await readFile(generation.components["closure-fixture"]!.path, "utf8")).toContain("closure fixture");
  });

  it("fails closed before materializing tampered metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "standalone-tamper-")); roots.push(root);
    const bytes = Buffer.from("fixture");
    const keys = generateKeyPairSync("ed25519");
    const envelope = signStandaloneMetadata(metadata(bytes), "test-key", keys.privateKey);
    envelope.metadata.releaseVersion = "0.1.0-betahyx.2";
    const store = new StandaloneStore(root, "terminal-betahyx");
    await expect(store.prepare(envelope, keys.publicKey, async () => bytes)).rejects.toThrow("signature verification failed");
  });
});
