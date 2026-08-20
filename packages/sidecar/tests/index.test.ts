import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { allocatePort, readJsonFile, removePointerIfCurrent, writeJsonFile } from "../src/index.js";

describe("sidecar public utilities", () => {
  it("allocates and reserves a dynamic port", async () => {
    const reserved = new Set<number>();
    const allocation = await allocatePort({ label: "test", reserved });
    expect(allocation.source).toBe("dynamic");
    expect(reserved.has(allocation.port)).toBe(true);
  });

  it("round-trips atomic JSON files", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-sidecar-json-"));
    try {
      const path = join(root, "state", "pointer.json");
      await writeJsonFile(path, { runId: "current", value: 1 });
      await expect(readJsonFile(path)).resolves.toEqual({ runId: "current", value: 1 });
      await writeJsonFile(path, { runId: "current", value: 2 });
      await expect(readJsonFile(path)).resolves.toEqual({ runId: "current", value: 2 });
      await removePointerIfCurrent(path, "stale");
      await expect(readJsonFile(path)).resolves.not.toBeNull();
      await removePointerIfCurrent(path, "current");
      await expect(readJsonFile(path)).resolves.toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
