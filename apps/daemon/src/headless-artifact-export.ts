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
// The measure pass only needs layout, not a settled paint, so it gets a much
// smaller budget — it runs before every auto-sized image export.
const MEASURE_VIRTUAL_TIME_BUDGET_MS = 4_000;
const MAX_IMAGE_EXPORT_HEIGHT_PX = 20_000;
const MAX_IMAGE_EXPORT_WIDTH_PX = 10_000;
const MIN_IMAGE_EXPORT_PX = 16;
const DEFAULT_PAGE_WIDTH_PX = 1440;
const DEFAULT_PAGE_HEIGHT_PX = 900;
const DEFAULT_DECK_WIDTH_PX = 1920;
const DEFAULT_DECK_HEIGHT_PX = 1080;

/** Candidate binaries, in preference order. OD_BROWSER_EXECUTABLE_PATH wins. */
function resolveBrowser(): string | null {
  const configured = process.env.OD_BROWSER_EXECUTABLE_PATH;
  if (configured) return fs.existsSync(configured) ? configured : null;
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // macOS dev boxes: same headless switches, so a local daemon exports
    // exactly like the Linux container it ships to.
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
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

/** Same launcher as `runBrowser`, but keeps stdout (used by `--dump-dom`). */
function runBrowserCapturingStdout(browser: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      // The DOM dump is bounded by the artifact source; cap it anyway so a
      // pathological document cannot balloon the daemon's heap.
      if (out.length < 8_000_000) out += chunk;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`headless measure timed out after ${RENDER_TIMEOUT_MS}ms`));
    }, RENDER_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/**
 * Stamped onto `<html>` by the measure pass so the size survives `--dump-dom`
 * (Chromium's headless switches give us no other channel back from the page).
 */
const MEASURED_SIZE_ATTRIBUTE = 'data-od-export-size';

// Measures the artifact's OWN canvas rather than the throwaway probe viewport.
//
// The union of body's laid-out children is the artifact's real extent: a fixed
// canvas (a 1080x1080 social square, a poster) reports 1080x1080 even though
// the probe window is 1440x900, while a responsive page's children stretch to
// fill the probe and report the probe's size — so responsive artifacts keep the
// default viewport and only fixed-canvas ones shrink to themselves.
//
// `documentElement.scrollWidth/Height` is deliberately NOT used as a floor: it
// is never smaller than the initial containing block, so folding it in would
// pin every artifact back to the probe size and re-crop the very squares this
// exists to fix. It is used only as a ceiling — content that OVERFLOWS the
// probe must not be cropped either.
const MEASURE_SCRIPT = `(function(){
  function measure(){
    var doc = document.documentElement;
    var body = document.body;
    if (!doc || !body) return;
    var w = 0, h = 0;
    var kids = body.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'TEMPLATE') continue;
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      w = Math.max(w, r.left + window.scrollX + r.width);
      h = Math.max(h, r.top + window.scrollY + r.height);
    }
    var overflowW = Math.max(doc.scrollWidth, body.scrollWidth);
    var overflowH = Math.max(doc.scrollHeight, body.scrollHeight);
    if (overflowW > window.innerWidth) w = Math.max(w, overflowW);
    if (overflowH > window.innerHeight) h = Math.max(h, overflowH);
    if (w <= 0) w = window.innerWidth;
    if (h <= 0) h = window.innerHeight;
    doc.setAttribute('${MEASURED_SIZE_ATTRIBUTE}', Math.round(w) + 'x' + Math.round(h));
  }
  measure();
  document.addEventListener('DOMContentLoaded', measure);
  window.addEventListener('load', measure);
  // Re-stamp while virtual time advances so late webfonts / images / entrance
  // animations are reflected; --dump-dom serialises the LAST state.
  setInterval(measure, 200);
})();`;

export function clampExportWidth(value: number): number {
  return Math.max(MIN_IMAGE_EXPORT_PX, Math.min(MAX_IMAGE_EXPORT_WIDTH_PX, Math.round(value)));
}

export function clampExportHeight(value: number): number {
  return Math.max(MIN_IMAGE_EXPORT_PX, Math.min(MAX_IMAGE_EXPORT_HEIGHT_PX, Math.round(value)));
}

/** Reads the `<html data-od-export-size="WxH">` stamp out of a `--dump-dom` dump. */
export function parseMeasuredArtifactSize(
  dom: string,
): { width: number; height: number } | null {
  const match = new RegExp(`${MEASURED_SIZE_ATTRIBUTE}="(\\d+)x(\\d+)"`).exec(dom);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: clampExportWidth(width), height: clampExportHeight(height) };
}

/** File extension Chromium infers the encoder from (`--screenshot=out.jpg`). */
export function imageExtensionFor(imageFormat: string | undefined): 'png' | 'jpg' {
  return imageFormat === 'jpeg' ? 'jpg' : 'png';
}

export function imageMimeFor(imageFormat: string | undefined): string {
  return imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
}

async function measureArtifactSize(
  browser: string,
  dir: string,
  document_: string,
  probe: { width: number; height: number },
): Promise<{ width: number; height: number } | null> {
  const measurePath = path.join(dir, 'measure.html');
  await fs.promises.writeFile(measurePath, `${document_}\n<script>${MEASURE_SCRIPT}</script>\n`, 'utf8');
  try {
    const dom = await runBrowserCapturingStdout(browser, [
      ...headlessCommonArgs(probe.width, probe.height, MEASURE_VIRTUAL_TIME_BUDGET_MS),
      '--dump-dom',
      `file://${measurePath}`,
    ]);
    return parseMeasuredArtifactSize(dom);
  } catch {
    // A failed measurement must never fail the export — fall back to defaults.
    return null;
  }
}

function headlessCommonArgs(width: number, height: number, budgetMs: number): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    // Containers run unprivileged without the SUID sandbox helper.
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `--virtual-time-budget=${budgetMs}`,
    `--window-size=${Math.round(width)},${Math.round(height)}`,
  ];
}

export async function exportArtifactHeadless(
  input: DesktopExportArtifactInput,
): Promise<DesktopExportArtifactResult> {
  const browser = resolveBrowser();
  if (!browser) return { error: 'no headless browser binary available', ok: false };

  const isPdf = input.format === 'pdf';
  // `--screenshot=<file>` picks its encoder from the extension, so the
  // requested image format has to reach the OUTPUT PATH — writing PNG bytes
  // into a `.jpg` (or ignoring `imageFormat` entirely) is what made every
  // export come back `image/png` regardless of what the caller asked for.
  const imageExt = imageExtensionFor(input.imageFormat);
  const ext = isPdf ? 'pdf' : imageExt;
  const defaultWidth = input.deck ? DEFAULT_DECK_WIDTH_PX : DEFAULT_PAGE_WIDTH_PX;
  const defaultHeight = input.deck ? DEFAULT_DECK_HEIGHT_PX : DEFAULT_PAGE_HEIGHT_PX;

  let dir: string | null = null;
  try {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'od-export-'));
    const htmlPath = path.join(dir, 'artifact.html');
    const outPath = path.join(dir, `artifact.${ext}`);
    const document_ = buildDocument(input);
    await fs.promises.writeFile(htmlPath, document_, 'utf8');

    let width = input.width != null ? clampExportWidth(input.width) : defaultWidth;
    let height = input.height != null ? clampExportHeight(input.height) : defaultHeight;
    // Auto-size an image export to the artifact's own canvas. Skipped for PDF
    // (print-to-pdf paginates), for decks (fixed slide geometry), and whenever
    // the caller already pinned BOTH dimensions to a preview preset.
    if (!isPdf && !input.deck && (input.width == null || input.height == null)) {
      const measured = await measureArtifactSize(browser, dir, document_, {
        width: defaultWidth,
        height: defaultHeight,
      });
      if (measured) {
        if (input.width == null) width = measured.width;
        if (input.height == null) height = measured.height;
      }
    }

    const common = headlessCommonArgs(width, height, VIRTUAL_TIME_BUDGET_MS);
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
      mime: isPdf ? 'application/pdf' : imageMimeFor(input.imageFormat),
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
