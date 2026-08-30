import { mkdirSync, writeFileSync, existsSync, cpSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { MINIMAL_WEBP, renderCardFromExternal, renderFallbackCard } from "./fallback-preview-card.ts";
import type { CatalogDocument, CatalogRecord } from "./schema.ts";

export type PreviewJob = {
  bucket: "skills" | "templates" | "plugins";
  stableId: string;
  /** Relative path inside staging dir. */
  relativePath: string;
  /** Optional file:// HTML source (example.html / index.html). */
  htmlPath?: string;
  /** In-memory HTML (fallback card). */
  htmlContent?: string;
  /** Ready-made image to copy (png/webp). */
  reuseFrom?: string;
  label: string;
};

export type PreviewCaptureResult = {
  bytes: Buffer;
  source: "render" | "reuse" | "fallback";
  warning?: string;
};

export type PreviewRenderer = (job: PreviewJob) => Promise<PreviewCaptureResult>;

export type RenderPreviewsOptions = {
  catalog: CatalogDocument;
  repoRoot: string;
  stagingDir: string;
  /** Injected renderer; defaults to deterministic minimal-webp stub (no browser). */
  renderer?: PreviewRenderer;
  /** When true, fail if any job cannot produce bytes. Default true for pack readiness. */
  requireComplete?: boolean;
};

export type RenderPreviewsResult = {
  written: string[];
  warnings: string[];
  failed: string[];
};

/** Browser import/launch failed. Must abort the snapshot — not a per-job fallback. */
export class SystemicPreviewError extends Error {
  override name = "SystemicPreviewError";
}

function previewJobsForRecord(record: CatalogRecord, repoRoot: string, index: number): PreviewJob | null {
  if (record.type === "craft" || record.type === "system") return null;
  const previewPath = record.preview?.path;
  if (!previewPath) return null;

  if (record.type === "skill") {
    const example = join(repoRoot, "skills", record.id, "example.html");
    if (existsSync(example)) {
      return {
        bucket: "skills",
        stableId: record.id,
        relativePath: previewPath,
        htmlPath: example,
        label: `skill:${record.id}`,
      };
    }
    return {
      bucket: "skills",
      stableId: record.id,
      relativePath: previewPath,
      htmlContent: renderFallbackCard(
        {
          slug: record.id,
          displayName: record.name,
          description: record.description,
          mode: record.mode,
          category: record.category,
          attribution: record.upstream,
        },
        index + 1,
      ),
      label: `skill-fallback:${record.id}`,
    };
  }

  if (record.type === "template") {
    if (record.origin === "design-template") {
      const dir = join(repoRoot, "design-templates", record.id);
      const ready = join(dir, "preview.png");
      const example = join(dir, "example.html");
      if (existsSync(ready)) {
        return {
          bucket: "templates",
          stableId: record.id,
          relativePath: previewPath,
          reuseFrom: ready,
          label: `template-reuse:${record.id}`,
        };
      }
      if (existsSync(example)) {
        return {
          bucket: "templates",
          stableId: record.id,
          relativePath: previewPath,
          htmlPath: example,
          label: `template:${record.id}`,
        };
      }
      return {
        bucket: "templates",
        stableId: record.id,
        relativePath: previewPath,
        htmlContent: renderFallbackCard(
          {
            slug: record.id,
            displayName: record.name,
            description: record.description,
            mode: record.mode,
          },
          index + 1,
        ),
        label: `template-fallback:${record.id}`,
      };
    }

    const folder = record.id.replace(/^live-/, "");
    const dir = join(repoRoot, "templates/live-artifacts", folder);
    const ready = join(dir, "preview.png");
    const indexHtml = join(dir, "index.html");
    if (existsSync(ready)) {
      return {
        bucket: "templates",
        stableId: record.id,
        relativePath: previewPath,
        reuseFrom: ready,
        label: `live-reuse:${record.id}`,
      };
    }
    if (existsSync(indexHtml)) {
      return {
        bucket: "templates",
        stableId: record.id,
        relativePath: previewPath,
        htmlPath: indexHtml,
        label: `live:${record.id}`,
      };
    }
    return {
      bucket: "templates",
      stableId: record.id,
      relativePath: previewPath,
      htmlContent: renderFallbackCard(
        {
          slug: record.id,
          displayName: record.name,
          description: record.description,
        },
        index + 1,
      ),
      label: `live-fallback:${record.id}`,
    };
  }

  if (record.type === "plugin") {
    // Remote poster/video already on CDN — still emit a local webp so the
    // snapshot is self-describing; prefer fallback card over shipping mp4.
    return {
      bucket: "plugins",
      stableId: record.id,
      relativePath: previewPath,
      htmlContent: renderCardFromExternal(
        {
          slug: record.id,
          title: record.name,
          description: record.description,
          mode: record.mode,
          category: record.scenario,
          attribution: record.authorName,
        },
        index + 1,
      ),
      label: `plugin:${record.id}`,
    };
  }

  return null;
}

/**
 * Deterministic stub renderer — always writes MINIMAL_WEBP.
 * Unit tests and environments without Playwright use this by default.
 */
export function createStubPreviewRenderer(): PreviewRenderer {
  return async (job) => {
    if (job.reuseFrom && existsSync(job.reuseFrom)) {
      return { bytes: readFileSync(job.reuseFrom), source: "reuse" };
    }
    return { bytes: Buffer.from(MINIMAL_WEBP), source: "fallback", warning: `stub preview for ${job.label}` };
  };
}

type PlaywrightBrowser = {
  newContext(options: Record<string, unknown>): Promise<{
    newPage(): Promise<{
      setContent(html: string, options: Record<string, unknown>): Promise<void>;
      goto(url: string, options: Record<string, unknown>): Promise<unknown>;
      evaluate(fn: string): Promise<unknown>;
      waitForTimeout(ms: number): Promise<void>;
      screenshot(options: Record<string, unknown>): Promise<Buffer>;
    }>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
};

/**
 * Isolated Playwright renderer. Import/launch failures are systemic and throw.
 * Individual example.html failures still return fallback bytes + warning.
 */
export type PlaywrightPreviewRendererOptions = {
  /** Test seam. Defaults to resolving the optional `playwright` package. */
  importPlaywright?: () => Promise<{
    chromium: { launch(options: { headless: boolean }): Promise<PlaywrightBrowser> };
  }>;
};

async function importPlaywrightPackage(): Promise<{
  chromium: { launch(options: { headless: boolean }): Promise<PlaywrightBrowser> };
}> {
  // Optional peer: playwright is not a hard runtime dep of tools-release.
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("playwright");
    return (await import(pathToFileURL(resolved).href)) as {
      chromium: { launch(options: { headless: boolean }): Promise<PlaywrightBrowser> };
    };
  } catch {
    const importer = new Function("m", "return import(m)") as (m: string) => Promise<{
      chromium: { launch(options: { headless: boolean }): Promise<PlaywrightBrowser> };
    }>;
    return importer("playwright");
  }
}

export function createPlaywrightPreviewRenderer(
  options: PlaywrightPreviewRendererOptions = {},
): PreviewRenderer {
  let browserPromise: Promise<PlaywrightBrowser> | null = null;

  async function getBrowser(): Promise<PlaywrightBrowser> {
    if (!browserPromise) {
      browserPromise = (async () => {
        try {
          const playwright = options.importPlaywright
            ? await options.importPlaywright()
            : await importPlaywrightPackage();
          return await playwright.chromium.launch({ headless: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new SystemicPreviewError(
            `systemic preview failure: playwright browser launch failed: ${message}`,
            { cause: error },
          );
        }
      })();
    }
    try {
      return await browserPromise;
    } catch (error) {
      if (error instanceof SystemicPreviewError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new SystemicPreviewError(
        `systemic preview failure: playwright browser launch failed: ${message}`,
        { cause: error },
      );
    }
  }

  return async (job) => {
    if (job.reuseFrom && existsSync(job.reuseFrom)) {
      try {
        const raw = readFileSync(job.reuseFrom);
        return { bytes: raw, source: "reuse" };
      } catch (error) {
        return {
          bytes: Buffer.from(MINIMAL_WEBP),
          source: "fallback",
          warning: `reuse failed for ${job.label}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const browser = await getBrowser();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      try {
        const page = await context.newPage();
        if (job.htmlContent) {
          await page.setContent(job.htmlContent, { waitUntil: "load", timeout: 30_000 });
          await page.evaluate("document.fonts.ready");
        } else if (job.htmlPath) {
          await page.goto(pathToFileURL(resolve(job.htmlPath)).toString(), {
            waitUntil: "load",
            timeout: 30_000,
          });
        } else {
          throw new Error("preview job has neither htmlPath nor htmlContent");
        }
        await page.waitForTimeout(800);
        const png = await page.screenshot({
          type: "png",
          fullPage: false,
          clip: { x: 0, y: 0, width: 1440, height: 900 },
        });
        try {
          const importer = new Function("m", "return import(m)") as (m: string) => Promise<{
            default: (input: Buffer) => {
              webp: (o: { quality: number }) => { toBuffer: () => Promise<Buffer> };
            };
          }>;
          const sharpMod = await importer("sharp");
          const webp = await sharpMod.default(png).webp({ quality: 80 }).toBuffer();
          return { bytes: webp, source: "render" };
        } catch {
          return {
            bytes: Buffer.from(png),
            source: "render",
            warning: `sharp unavailable; stored png bytes as webp for ${job.label}`,
          };
        }
      } finally {
        await context.close();
      }
    } catch (error) {
      return {
        bytes: Buffer.from(MINIMAL_WEBP),
        source: "fallback",
        warning: `preview failed for ${job.label}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/**
 * Render previews into the snapshot staging directory.
 * Incomplete output (missing files for required paths) fails when requireComplete.
 */
export async function renderCatalogPreviews(options: RenderPreviewsOptions): Promise<RenderPreviewsResult> {
  const renderer = options.renderer ?? createStubPreviewRenderer();
  const requireComplete = options.requireComplete !== false;
  const written: string[] = [];
  const warnings: string[] = [];
  const failed: string[] = [];

  const jobs: PreviewJob[] = [];
  options.catalog.records.forEach((record, index) => {
    const job = previewJobsForRecord(record, options.repoRoot, index);
    if (job) jobs.push(job);
  });

  let okCount = 0;
  for (const job of jobs) {
    const target = join(options.stagingDir, job.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    try {
      const result = await renderer(job);
      if (result.warning) warnings.push(result.warning);
      if (result.source === "reuse" && job.reuseFrom) {
        // Prefer writing renderer bytes so conversion path is uniform.
        writeFileSync(target, result.bytes);
      } else {
        writeFileSync(target, result.bytes);
      }
      if (result.bytes.length === 0) {
        failed.push(job.label);
        continue;
      }
      written.push(job.relativePath);
      okCount += 1;
    } catch (error) {
      if (error instanceof SystemicPreviewError) throw error;
      failed.push(job.label);
      warnings.push(
        `systemic preview error for ${job.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Still write fallback so partial inspection is possible, but pack will fail.
      writeFileSync(target, MINIMAL_WEBP);
    }
  }

  if (jobs.length > 0 && okCount === 0) {
    throw new Error(`systemic preview failure: all ${jobs.length} preview job(s) failed`);
  }

  if (requireComplete) {
    for (const job of jobs) {
      const target = join(options.stagingDir, job.relativePath);
      if (!existsSync(target)) {
        throw new Error(`incomplete preview bundle: missing ${job.relativePath}`);
      }
    }
  }

  if (failed.length > 0 && failed.length === jobs.length) {
    throw new Error(`systemic preview failure: ${failed.join(", ")}`);
  }

  return { written, warnings, failed };
}

/** Copy helper kept for callers that already have a png on disk. */
export function copyPreviewAsset(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}
