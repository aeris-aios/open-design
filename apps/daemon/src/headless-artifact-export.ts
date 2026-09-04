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
import { fileURLToPath } from 'node:url';
import type {
  DesktopExportArtifactInput,
  DesktopExportArtifactResult,
  DesktopExportPdfInput,
  DesktopExportPdfResult,
} from '@open-design/sidecar-proto';
import {
  findRealElementRange,
  findRealTagEnd,
  findRealTagOffset,
  HTML_TAG_PATTERNS,
  prependAfterDoctype,
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

// ---------------------------------------------------------------------------
// Brand typeface
// ---------------------------------------------------------------------------
//
// Generated artifacts declare `font-family: "Poppins", ui-sans-serif, …` but
// frequently ship no `@font-face` and no font file (and when they do ship one
// it is a relative `assets/fonts/…` URL that only resolves next to the served
// project). A headless Chromium has no Poppins installed, so every such export
// silently rendered in the container's default sans — the PDFs came back with
// `NotoSans-Regular` / `NotoSans-Bold` in their font table and never Poppins.
//
// The faces are therefore injected into every exported document as base64
// data URIs: no network, no CORS, no dependency on what the artifact shipped.
//
// This only *provides* the family — it never sets `font-family` on anything —
// so an artifact that deliberately chose a different typeface is untouched.
// The rules carry a `unicode-range` matching the subset actually embedded, so
// an artifact that already embeds a fuller Poppins keeps supplying every
// codepoint outside that range.
const POPPINS_WEIGHTS = [400, 500, 600, 700] as const;

/** The exact ranges `assets/fonts/poppins-*.woff2` were subset to. */
const POPPINS_UNICODE_RANGE = [
  'U+0000-00FF',
  'U+0100-024F',
  'U+0259',
  'U+02BB-02BC',
  'U+02C6',
  'U+02DA',
  'U+02DC',
  'U+0304',
  'U+0308',
  'U+0329',
  'U+2000-206F',
  'U+20A0-20BF',
  'U+2100-214F',
  'U+2190-21BB',
  'U+2212',
  'U+2215',
  'U+2219-2223',
  'U+2248',
  'U+2260',
  'U+2264-2265',
  'U+25A0-25CF',
  'U+2605-2606',
  'U+2610-2611',
  'U+2713-2714',
  'U+2717',
  'U+FEFF',
  'U+FFFD',
].join(', ');

/**
 * Where `assets/fonts/poppins-<weight>.woff2` lives.
 *
 * Both `apps/daemon/src/…` (dev) and `apps/daemon/dist/…` (built + the
 * container's `/app/apps/daemon/dist`) sit three levels below the tree root
 * that holds `assets/`, so one module-relative hop covers every runtime. The
 * remaining candidates are belt-and-braces for unusual layouts.
 */
function exportFontDirCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const configured = process.env.OD_EXPORT_FONT_DIR;
  return [
    ...(configured ? [configured] : []),
    path.resolve(here, '../../../assets/fonts'),
    path.resolve(here, '../../../../assets/fonts'),
    path.resolve(process.cwd(), 'assets/fonts'),
  ];
}

let poppinsStyleCache: string | null | undefined;

/** `<style>` element embedding the brand faces, or null when none are on disk. */
export function poppinsFontFaceStyle(): string | null {
  if (poppinsStyleCache !== undefined) return poppinsStyleCache;
  for (const dir of exportFontDirCandidates()) {
    const faces: string[] = [];
    for (const weight of POPPINS_WEIGHTS) {
      let data: Buffer;
      try {
        data = fs.readFileSync(path.join(dir, `poppins-${weight}.woff2`));
      } catch {
        break;
      }
      if (data.length === 0) break;
      faces.push(
        `@font-face{font-family:"Poppins";font-style:normal;font-weight:${weight};` +
          `font-display:block;unicode-range:${POPPINS_UNICODE_RANGE};` +
          `src:url("data:font/woff2;base64,${data.toString('base64')}") format("woff2")}`,
      );
    }
    if (faces.length === POPPINS_WEIGHTS.length) {
      poppinsStyleCache = `<style data-od-export-fonts>${faces.join('')}</style>`;
      return poppinsStyleCache;
    }
  }
  // No brand fonts in this deployment — export exactly as before rather than
  // failing. Callers keep working; only the typeface degrades.
  poppinsStyleCache = null;
  return poppinsStyleCache;
}

/**
 * Splices `snippet` in at the end of `<head>` — after the artifact's own
 * styles, so an injected `@font-face` wins over a broken author rule with the
 * same descriptors. Falls back to opening a head, then to the top of the
 * document, so a fragment without `<head>` still receives it.
 */
export function injectAtHeadEnd(doc: string, snippet: string): string {
  const headClose = findRealTagOffset(doc, HTML_TAG_PATTERNS.headClose);
  if (headClose >= 0) return doc.slice(0, headClose) + snippet + doc.slice(headClose);
  const bodyOpen = findRealTagOffset(doc, HTML_TAG_PATTERNS.bodyOpen);
  if (bodyOpen >= 0) return `${doc.slice(0, bodyOpen)}<head>${snippet}</head>${doc.slice(bodyOpen)}`;
  const headEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.headOpen);
  if (headEnd >= 0) return doc.slice(0, headEnd) + snippet + doc.slice(headEnd);
  const htmlEnd = findRealTagEnd(doc, HTML_TAG_PATTERNS.htmlOpen);
  if (htmlEnd >= 0) return `${doc.slice(0, htmlEnd)}<head>${snippet}</head>${doc.slice(htmlEnd)}`;
  return prependAfterDoctype(doc, `<head>${snippet}</head>`);
}

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
  const fonts = poppinsFontFaceStyle();
  if (fonts) doc = injectAtHeadEnd(doc, fonts);
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
/** `artboard` when the measured box is a real artboard, `page` otherwise. */
const MEASURED_MODE_ATTRIBUTE = 'data-od-export-mode';

// Shared page-side logic for both passes.
//
// ARTBOARD MODE — `--screenshot` captures the WINDOW, so an artifact whose
// design sits inside page padding used to export as "design + page background
// on every side": a 1080x1080 social post came out 1260x1144 with a cream
// border baked in, which Instagram then crops. When body has exactly one
// dominant laid-out child that contains every other child, that child IS the
// artboard, and the export must be its border box and nothing else. The page's
// own padding/margin is neutralised (so the artboard lands at the origin and
// its width stops depending on how much padding the page had) and the window
// is scrolled onto the artboard as a belt-and-braces second alignment.
//
// PAGE MODE — a document with several top-level blocks (a docs page, an email,
// a report) has no artboard; those keep the original union-of-children measure
// and are never normalised, so their export is byte-for-byte what it was.
//
// The union measure itself is unchanged: `documentElement.scrollWidth/Height`
// is used only as a CEILING (content that overflows the probe must not be
// cropped), never as a floor — folding it in would pin every artifact back to
// the probe size.
const ARTBOARD_RUNTIME = `
  var OD_NORMALIZE_ID = 'od-export-normalize';
  var odBoard = null;
  function odSkip(tag){
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'TEMPLATE'
      || tag === 'META' || tag === 'BASE' || tag === 'NOSCRIPT';
  }
  // "Explicitly sized" is read off the CASCADE, not off the used value: every
  // computed width is a px number, so only the author's own declarations say
  // whether a box is a designed canvas or just a block that filled its parent.
  function odScanRules(rules, el, seen){
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.style && rule.selectorText) {
        var matched = false;
        try { matched = el.matches(rule.selectorText); } catch (e) { matched = false; }
        if (matched) odTakeSizing(rule.style, seen);
        continue;
      }
      if (!rule.cssRules) continue;
      // Only descend into conditional groups that apply right now — a
      // print-only or narrow-viewport override is not this artifact's design.
      if (rule.media) {
        try { if (!window.matchMedia(rule.media.mediaText).matches) continue; } catch (e) { continue; }
      }
      odScanRules(rule.cssRules, el, seen);
    }
  }
  function odIsAbsoluteLength(value){
    return /^\\s*\\+?\\d*\\.?\\d+(px|pt|pc|in|cm|mm|q)\\s*$/i.test(value || '');
  }
  function odTakeSizing(style, seen){
    if (odIsAbsoluteLength(style.getPropertyValue('width'))
      || odIsAbsoluteLength(style.getPropertyValue('max-width'))) seen.width = true;
    if (odIsAbsoluteLength(style.getPropertyValue('height'))
      || odIsAbsoluteLength(style.getPropertyValue('max-height'))) seen.height = true;
    var ratio = style.getPropertyValue('aspect-ratio');
    if (ratio && ratio !== 'auto') seen.ratio = true;
  }
  function odIsArtboardSized(el){
    var seen = { width: false, height: false, ratio: false };
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules = null;
      try { rules = sheets[i].cssRules; } catch (e) { rules = null; }
      if (rules) odScanRules(rules, el, seen);
    }
    odTakeSizing(el.style, seen);
    // An aspect ratio pins the design's shape on its own; otherwise both axes
    // have to be authored, which is what separates a 1080x1080 canvas from a
    // \`max-width\` reading column that merely happens to be narrower than the page.
    if (seen.ratio || (seen.width && seen.height)) return true;
    // Artifacts that put the canvas size on the PAGE (\`html,body{width:1080px;
    // height:1080px}\`) and let the wrapper fill it are just as explicit.
    var page = { width: false, height: false, ratio: false };
    for (var j = 0; j < sheets.length; j++) {
      var pageRules = null;
      try { pageRules = sheets[j].cssRules; } catch (e) { pageRules = null; }
      if (!pageRules) continue;
      odScanRules(pageRules, document.documentElement, page);
      odScanRules(pageRules, document.body, page);
    }
    if (!(page.width && page.height)) return false;
    var box = document.body.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0
      && r.width >= box.width - 1 && r.height >= box.height - 1;
  }
  function odFindArtboard(){
    var body = document.body;
    if (!body) return null;
    var kids = [];
    for (var i = 0; i < body.children.length; i++) {
      var el = body.children[i];
      if (odSkip(el.tagName)) continue;
      if (el.id === OD_NORMALIZE_ID) continue;
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      // A fixed-position layer is chrome painted over the design (a toolbar, a
      // toast), never the design itself.
      if (cs.position === 'fixed') continue;
      var r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      kids.push({ el: el, rect: r });
    }
    if (kids.length === 0) return null;
    var best = kids[0];
    for (var j = 1; j < kids.length; j++) {
      if (kids[j].rect.width * kids[j].rect.height > best.rect.width * best.rect.height) best = kids[j];
    }
    // Every sibling has to live INSIDE the winner, otherwise cropping to it
    // would silently drop part of the document.
    for (var k = 0; k < kids.length; k++) {
      var r2 = kids[k].rect;
      if (r2.left < best.rect.left - 1 || r2.top < best.rect.top - 1
        || r2.right > best.rect.right + 1 || r2.bottom > best.rect.bottom + 1) return null;
    }
    return best.el;
  }
  // Removes the page frame around the artboard: its padding/margin/border is
  // what the capture was baking in, and it is also what makes a percentage-
  // width artboard measure differently once the window shrinks to it.
  function odNormalize(el){
    el.setAttribute('data-od-artboard', '');
    if (document.getElementById(OD_NORMALIZE_ID)) return;
    var style = document.createElement('style');
    style.id = OD_NORMALIZE_ID;
    style.textContent = 'html,body{margin:0 !important;padding:0 !important;border:0 !important;'
      + 'min-height:0 !important}[data-od-artboard]{margin:0 !important;float:none !important}';
    (document.head || document.documentElement).appendChild(style);
  }
  function odUnionSize(){
    var doc = document.documentElement;
    var body = document.body;
    var w = 0, h = 0;
    var kids = body.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (odSkip(el.tagName)) continue;
      if (el.id === OD_NORMALIZE_ID) continue;
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
    return { width: w, height: h };
  }
  // \`requireSized\` is only asked at MEASURE time: that pass decides whether the
  // document has an artboard at all. The render pass re-finds the same element
  // structurally, because by then the window has already been resized to the
  // artboard — which can flip a viewport media query and make the very rule
  // that qualified it (an \`aspect-ratio\`) stop applying.
  function odResolveBoard(requireSized){
    if (!document.body) return null;
    if (!odBoard || !odBoard.isConnected) {
      var found = odFindArtboard();
      if (found && requireSized && !odIsArtboardSized(found)) found = null;
      odBoard = found;
    }
    if (odBoard) odNormalize(odBoard);
    return odBoard;
  }
`;

const MEASURE_SCRIPT = `(function(){${ARTBOARD_RUNTIME}
  function measure(){
    var doc = document.documentElement;
    if (!doc || !document.body) return;
    var board = odResolveBoard(true);
    var size = board ? board.getBoundingClientRect() : odUnionSize();
    doc.setAttribute('${MEASURED_SIZE_ATTRIBUTE}', Math.round(size.width) + 'x' + Math.round(size.height));
    doc.setAttribute('${MEASURED_MODE_ATTRIBUTE}', board ? 'artboard' : 'page');
  }
  measure();
  document.addEventListener('DOMContentLoaded', measure);
  window.addEventListener('load', measure);
  // Re-stamp while virtual time advances so late webfonts / images / entrance
  // animations are reflected; --dump-dom serialises the LAST state.
  setInterval(measure, 200);
})();`;

// Render-pass counterpart: same detection, but instead of reporting a size it
// parks the artboard under the window that `exportArtifactHeadless` already
// sized to it. Injected ONLY when the measure pass reported `artboard`, so a
// page-mode artifact renders exactly as it did before.
const CAPTURE_SCRIPT = `(function(){${ARTBOARD_RUNTIME}
  function align(){
    var board = odResolveBoard(false);
    if (!board) return;
    var r = board.getBoundingClientRect();
    var x = Math.round(r.left + window.scrollX);
    var y = Math.round(r.top + window.scrollY);
    if (x !== 0 || y !== 0) window.scrollTo(x, y);
  }
  align();
  document.addEventListener('DOMContentLoaded', align);
  window.addEventListener('load', align);
  setInterval(align, 100);
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
): { width: number; height: number; artboard: boolean } | null {
  const match = new RegExp(`${MEASURED_SIZE_ATTRIBUTE}="(\\d+)x(\\d+)"`).exec(dom);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    artboard: new RegExp(`${MEASURED_MODE_ATTRIBUTE}="artboard"`).test(dom),
    height: clampExportHeight(height),
    width: clampExportWidth(width),
  };
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
): Promise<{ width: number; height: number; artboard: boolean } | null> {
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

/** CSS px per CSS inch — the unit `@page { size }` has to be expressed in. */
const CSS_PX_PER_IN = 96;
/** PDF's own page-box limit is 200in; stay inside it or Chromium clamps. */
const MAX_PDF_PAGE_PX = 200 * CSS_PX_PER_IN;
/**
 * Beyond this the artboard is a long scrolling document, not a single sheet;
 * those keep Chromium's default paginated Letter output.
 */
const MAX_SINGLE_PAGE_PDF_ASPECT = 5;

export function pdfPageStyleFor(size: { width: number; height: number }): string | null {
  const { height, width } = size;
  if (!(width > 0) || !(height > 0)) return null;
  if (width > MAX_PDF_PAGE_PX || height > MAX_PDF_PAGE_PX) return null;
  if (height / width > MAX_SINGLE_PAGE_PDF_ASPECT) return null;
  const inches = (px: number): string => (px / CSS_PX_PER_IN).toFixed(4);
  // `size` is the whole point: without it Chromium prints US Letter, so a
  // square social post came out 612x792pt with the art clipped off the right
  // edge. `margin:0` keeps the sheet edge-to-edge, and the print-colour
  // override stops Chromium dropping the design's backgrounds.
  return (
    '<style data-od-export-page>' +
    `@page{size:${inches(width)}in ${inches(height)}in;margin:0}` +
    '@media print{html,body{margin:0 !important;padding:0 !important;' +
    'min-height:0 !important;overflow:visible !important}' +
    '*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}}' +
    '</style>'
  );
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

    let width = input.width != null ? clampExportWidth(input.width) : defaultWidth;
    let height = input.height != null ? clampExportHeight(input.height) : defaultHeight;
    // Measure the artifact's own canvas. Skipped for decks (fixed slide
    // geometry) and, for images, whenever the caller already pinned BOTH
    // dimensions to a preview preset — a pinned size always wins. PDF measures
    // too, but only to derive its page box: without that Chromium prints US
    // Letter and clips a square or portrait design.
    let measured: { width: number; height: number; artboard: boolean } | null = null;
    if (!input.deck && (isPdf || input.width == null || input.height == null)) {
      measured = await measureArtifactSize(browser, dir, document_, {
        width: defaultWidth,
        height: defaultHeight,
      });
      if (measured && !isPdf) {
        if (input.width == null) width = measured.width;
        if (input.height == null) height = measured.height;
      }
    }

    // A PDF only leaves Letter behind when the artboard fits on one sheet;
    // a long scrolling artboard keeps Chromium's pagination.
    const pageStyle =
      isPdf && measured?.artboard === true ? pdfPageStyleFor(measured) : null;
    // Only an artifact that HAS an artboard gets the page frame stripped and
    // the window parked on it; everything else renders exactly as before.
    const onArtboard = measured?.artboard === true && (!isPdf || pageStyle != null);

    let renderDocument = document_;
    if (pageStyle) renderDocument = injectAtHeadEnd(renderDocument, pageStyle);
    if (onArtboard) renderDocument = `${renderDocument}\n<script>${CAPTURE_SCRIPT}</script>\n`;
    await fs.promises.writeFile(htmlPath, renderDocument, 'utf8');

    // A PDF is paginated by `@page`, not by the window, but the window is still
    // the layout viewport — so print the artboard at its own width instead of
    // laying the design out at 1440 and then squeezing it onto the sheet.
    if (isPdf && measured && onArtboard) {
      width = measured.width;
      height = measured.height;
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
