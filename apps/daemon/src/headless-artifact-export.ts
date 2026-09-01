// Headless-Chromium artifact exporter for server deployments.
//
// Upstream routes "Export as image" / "Export as PDF" through the Electron
// desktop shell (apps/desktop/src/main/artifact-export.ts). A daemon-only
// deployment has no Electron, so those routes answer 501 "only available in
// the desktop runtime" and the client-side fallback times out. This module
// supplies the same DesktopArtifactExporter contract using a plain headless
// Chromium binary, so a self-hosted server exports the same formats.
//
// Chromium's own `--print-to-pdf` / `--screenshot` switches are used rather
// than a CDP client, keeping this dependency-free. It is wired in only when a
// browser binary is actually present (see daemon-startup.ts), so a host
// without Chromium behaves exactly as before.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  DesktopExportArtifactInput,
  DesktopExportArtifactResult,
  DesktopExportPdfInput,
  DesktopExportPdfResult,
} from '@open-design/sidecar-proto';
import {
  findRealElementRange,
  findRealTagEnd,
  HTML_TAG_PATTERNS,
} from '@open-design/contracts/runtime/html-injection-points';

const RENDER_TIMEOUT_MS = 60_000;
// Chromium advances timers/animations up to this budget, then renders. Gives
// webfonts, images, and entrance animations time to settle before capture.
const VIRTUAL_TIME_BUDGET_MS = 8_000;
const MAX_IMAGE_EXPORT_HEIGHT_PX = 20_000;

/** Candidate binaries, in preference order. OD_BROWSER_EXECUTABLE_PATH wins. */
function resolveBrowser(): string | null {
  const configured = process.env.OD_BROWSER_EXECUTABLE_PATH;
  if (configured) return fs.existsSync(configured) ? configured : null;
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function headlessArtifactExportAvailable(): boolean {
  return resolveBrowser() != null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mirrors the desktop exporter's document preparation so both runtimes render
// the same bytes: structural <base>/<title> injection that ignores tags an
// author merely wrote inside a script string.
function buildDocument(input: DesktopExportArtifactInput): string {
  let doc = input.html;
  if (input.baseHref) {
    const tag = `<base href="${escapeAttr(input.baseHref)}">`;
    const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
    if (headEnd >= 0) {
      doc = doc.slice(0, headEnd) + tag + doc.slice(headEnd);
    } else {
      const htmlEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.htmlOpen);
      doc =
        htmlEnd >= 0
          ? `${doc.slice(0, htmlEnd)}<head>${tag}</head>${doc.slice(htmlEnd)}`
          : `<!doctype html><html><head>${tag}</head><body>${doc}</body></html>`;
    }
  }
  const titleTag = `<title>${escapeText(input.title)}</title>`;
  const existing = findRealElementRange(doc, HTML_TAG_PATTERNS.titleOpen, 'title');
  if (existing) {
    doc = doc.slice(0, existing.start) + titleTag + doc.slice(existing.end);
  } else {
    const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
    if (headEnd >= 0) doc = doc.slice(0, headEnd) + titleTag + doc.slice(headEnd);
  }
  return doc;
}

function runBrowser(browser: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`headless render timed out after ${RENDER_TIMEOUT_MS}ms`));
    }, RENDER_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Chromium can exit non-zero after writing a perfectly good file; the
      // caller decides success by whether the artifact exists and is non-empty.
      if (code === 0 || code == null) resolve();
      else resolve();
    });
  });
}

export async function exportArtifactHeadless(
  input: DesktopExportArtifactInput,
): Promise<DesktopExportArtifactResult> {
  const browser = resolveBrowser();
  if (!browser) return { error: 'no headless browser binary available', ok: false };

  const width = input.width ?? (input.deck ? 1920 : 1440);
  const height = Math.min(
    input.height ?? (input.deck ? 1080 : 900),
    MAX_IMAGE_EXPORT_HEIGHT_PX,
  );
  const isPdf = input.format === 'pdf';
  const imageExt = input.imageFormat === 'jpeg' ? 'jpg' : 'png';
  const ext = isPdf ? 'pdf' : imageExt;

  let dir: string | null = null;
  try {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'od-export-'));
    const htmlPath = path.join(dir, 'artifact.html');
    const outPath = path.join(dir, `artifact.${ext}`);
    await fs.promises.writeFile(htmlPath, buildDocument(input), 'utf8');

    const common = [
      '--headless=new',
      '--disable-gpu',
      // Containers run unprivileged without the SUID sandbox helper.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      `--virtual-time-budget=${VIRTUAL_TIME_BUDGET_MS}`,
      `--window-size=${Math.round(width)},${Math.round(height)}`,
    ];
    const args = isPdf
      ? [...common, '--no-pdf-header-footer', `--print-to-pdf=${outPath}`]
      : [...common, `--screenshot=${outPath}`];
    await runBrowser(browser, [...args, `file://${htmlPath}`]);

    const stat = await fs.promises.stat(outPath).catch(() => null);
    if (!stat || stat.size === 0) {
      return { error: 'headless renderer produced no output', ok: false };
    }
    // The daemon streams these bytes then deletes the file, so hand back a
    // path that outlives this temp dir cleanup.
    const handoff = path.join(os.tmpdir(), `od-export-${Date.now()}-${path.basename(outPath)}`);
    await fs.promises.rename(outPath, handoff);
    return {
      bytes: stat.size,
      mime: isPdf ? 'application/pdf' : imageExt === 'jpg' ? 'image/jpeg' : 'image/png',
      ok: true,
      path: handoff,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  } finally {
    if (dir) await fs.promises.rm(dir, { force: true, recursive: true }).catch(() => {});
  }
}

/**
 * The separate "export PDF" hook the desktop shell also provides. Same render
 * path as above; without this the PDF route answers 501 "only available in the
 * desktop runtime" even when the artifact exporter is wired.
 */
export async function exportPdfHeadless(
  input: DesktopExportPdfInput,
): Promise<DesktopExportPdfResult> {
  const result = await exportArtifactHeadless({
    deck: input.deck,
    format: 'pdf',
    html: input.html,
    title: input.title,
    ...(input.baseHref !== undefined ? { baseHref: input.baseHref } : {}),
  });
  return result.ok && result.path
    ? { ok: true, path: result.path }
    : { ok: false, error: result.error ?? 'headless PDF export failed' };
}
