import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    const preparation = { status: "current" as const, generationId: "generation-2" };
    await expect(applyTerminalUpdate({ applyNow } as never, {} as never, preparation)).resolves.toEqual({ preparation, lifecycle });
    expect(applyNow).toHaveBeenCalledOnce();
  });

  it("preserves a shell reinstall requirement without applying a stale attempt", async () => {
    const applyNow = vi.fn();
    const preparation = { status: "shell-reinstall-required" as const, releaseVersion: "0.1.0-betahyx.2" };
    await expect(applyTerminalUpdate({ applyNow } as never, {} as never, preparation)).resolves.toEqual({ preparation });
    expect(applyNow).not.toHaveBeenCalled();
  });
});
