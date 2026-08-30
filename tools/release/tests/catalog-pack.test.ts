import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { exportCatalog } from "../src/catalog/export.ts";
import { packCatalogSnapshot, verifyCatalogChecksums, writeCatalogJson } from "../src/catalog/pack.ts";
import {
  createPlaywrightPreviewRenderer,
  createStubPreviewRenderer,
  renderCatalogPreviews,
  SystemicPreviewError,
} from "../src/catalog/render-previews.ts";
import { MINIMAL_WEBP } from "../src/catalog/fallback-preview-card.ts";

const FIXTURE_ROOT = resolve(import.meta.dirname, "fixtures/catalog");
const SOURCE_COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function stageFixtureCatalog(): Promise<string> {
  const stagingDir = await mkdtemp(join(tmpdir(), "od-catalog-pack-"));
  const { catalog } = exportCatalog({
    repoRoot: FIXTURE_ROOT,
    sourceCommit: SOURCE_COMMIT,
    generatedAt: "2026-08-29T00:00:00.000Z",
  });
  writeCatalogJson(stagingDir, catalog);
  await renderCatalogPreviews({
    catalog,
    repoRoot: FIXTURE_ROOT,
    stagingDir,
    renderer: createStubPreviewRenderer(),
    requireComplete: true,
  });
  return stagingDir;
}

describe("catalog pack", () => {
  it("writes checksums, provenance, and bundle without html example files", async () => {
    const stagingDir = await stageFixtureCatalog();
    try {
      const result = packCatalogSnapshot({
        stagingDir,
        sourceCommit: SOURCE_COMMIT,
        exporterVersion: "tools-release@test",
        workflow: { runId: 1 },
      });

      expect(existsSync(join(stagingDir, "checksums.sha256"))).toBe(true);
      expect(existsSync(join(stagingDir, "provenance.json"))).toBe(true);
      expect(existsSync(join(stagingDir, "bundle.tar.zst"))).toBe(true);
      expect(result.bundleSha256).toMatch(/^[a-f0-9]{64}$/);

      const provenance = JSON.parse(await readFile(join(stagingDir, "provenance.json"), "utf8")) as {
        bundleSha256: string;
        exporterVersion: string;
        sourceCommit: string;
      };
      expect(provenance.bundleSha256).toBe(result.bundleSha256);
      expect(provenance.exporterVersion).toBe("tools-release@test");
      expect(provenance.sourceCommit).toBe(SOURCE_COMMIT);

      const checksums = await readFile(join(stagingDir, "checksums.sha256"), "utf8");
      expect(checksums).toContain("catalog.json");
      expect(checksums).toContain("previews/skills/alpha.webp");
      expect(checksums).not.toMatch(/\.html/);

      // No html files anywhere in the staging snapshot.
      const { readdirSync, statSync } = await import("node:fs");
      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) out.push(...walk(full));
          else out.push(full);
        }
        return out;
      };
      expect(walk(stagingDir).filter((f) => f.endsWith(".html"))).toEqual([]);

      // Preview bytes are the stub webp.
      expect(await readFile(join(stagingDir, "previews/skills/alpha.webp"))).toEqual(MINIMAL_WEBP);

      verifyCatalogChecksums(stagingDir);
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  });

  it("verify rejects tampering with catalog.json", async () => {
    const stagingDir = await stageFixtureCatalog();
    try {
      packCatalogSnapshot({
        stagingDir,
        sourceCommit: SOURCE_COMMIT,
        exporterVersion: "tools-release@test",
      });
      const catalogPath = join(stagingDir, "catalog.json");
      const original = await readFile(catalogPath, "utf8");
      await writeFile(catalogPath, original.replace("Alpha Skill", "Tampered Skill"), "utf8");
      expect(() => verifyCatalogChecksums(stagingDir)).toThrow(/checksum mismatch/);
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  });

  it("pack fails when a declared preview is missing", async () => {
    const stagingDir = await mkdtemp(join(tmpdir(), "od-catalog-incomplete-"));
    try {
      await mkdir(join(stagingDir, "previews/skills"), { recursive: true });
      const { catalog } = exportCatalog({
        repoRoot: FIXTURE_ROOT,
        sourceCommit: SOURCE_COMMIT,
      });
      writeCatalogJson(stagingDir, catalog);
      // Intentionally skip render — pack must fail closed.
      expect(() =>
        packCatalogSnapshot({
          stagingDir,
          sourceCommit: SOURCE_COMMIT,
          exporterVersion: "tools-release@test",
        }),
      ).toThrow(/incomplete bundle: missing preview/);
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  });
});

describe("catalog pack helpers", () => {
  it("hashes match checksums lines", async () => {
    const stagingDir = await stageFixtureCatalog();
    try {
      packCatalogSnapshot({
        stagingDir,
        sourceCommit: SOURCE_COMMIT,
        exporterVersion: "tools-release@test",
      });
      const lines = (await readFile(join(stagingDir, "checksums.sha256"), "utf8"))
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        const [hash, rel] = line.split("  ");
        const body = await readFile(join(stagingDir, rel!));
        expect(createHash("sha256").update(body).digest("hex")).toBe(hash);
      }
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  });
});

describe("playwright preview fail-closed", () => {
  it("throws when playwright cannot be imported", async () => {
    const renderer = createPlaywrightPreviewRenderer({
      importPlaywright: async () => {
        throw new Error("Cannot find package 'playwright'");
      },
    });
    await expect(
      renderer({
        bucket: "skills",
        stableId: "alpha",
        relativePath: "previews/skills/alpha.webp",
        htmlContent: "<html></html>",
        label: "skill:alpha",
      }),
    ).rejects.toThrow(SystemicPreviewError);
  });

  it("throws when chromium launch fails", async () => {
    const renderer = createPlaywrightPreviewRenderer({
      importPlaywright: async () => ({
        chromium: {
          launch: async () => {
            throw new Error("Executable doesn't exist");
          },
        },
      }),
    });
    await expect(
      renderer({
        bucket: "skills",
        stableId: "alpha",
        relativePath: "previews/skills/alpha.webp",
        htmlContent: "<html></html>",
        label: "skill:alpha",
      }),
    ).rejects.toThrow(/systemic preview failure: playwright browser launch failed/);
  });

  it("does not count launch failure as a successful stub preview", async () => {
    const stagingDir = await mkdtemp(join(tmpdir(), "od-catalog-playwright-fail-"));
    try {
      const { catalog } = exportCatalog({
        repoRoot: FIXTURE_ROOT,
        sourceCommit: SOURCE_COMMIT,
        generatedAt: "2026-08-29T00:00:00.000Z",
      });
      writeCatalogJson(stagingDir, catalog);
      await expect(
        renderCatalogPreviews({
          catalog,
          repoRoot: FIXTURE_ROOT,
          stagingDir,
          renderer: createPlaywrightPreviewRenderer({
            importPlaywright: async () => {
              throw new Error("Cannot find package 'playwright'");
            },
          }),
          requireComplete: true,
        }),
      ).rejects.toThrow(SystemicPreviewError);
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  });

  it("writes fallback webp when a single page capture fails", async () => {
    const renderer = createPlaywrightPreviewRenderer({
      importPlaywright: async () => ({
        chromium: {
          launch: async () => ({
            newContext: async () => ({
              newPage: async () => ({
                setContent: async () => {
                  throw new Error("bad html");
                },
                goto: async () => {
                  throw new Error("bad html");
                },
                evaluate: async () => undefined,
                waitForTimeout: async () => undefined,
                screenshot: async () => Buffer.from("png"),
              }),
              close: async () => undefined,
            }),
            close: async () => undefined,
          }),
        },
      }),
    });
    const result = await renderer({
      bucket: "skills",
      stableId: "alpha",
      relativePath: "previews/skills/alpha.webp",
      htmlContent: "<html></html>",
      label: "skill:alpha",
    });
    expect(result.source).toBe("fallback");
    expect(result.warning).toMatch(/bad html/);
    expect(result.bytes).toEqual(MINIMAL_WEBP);
  });
});
