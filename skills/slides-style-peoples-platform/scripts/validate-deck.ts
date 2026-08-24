import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node --experimental-strip-types scripts/validate-deck.ts <deck.html>');
  process.exit(2);
}

const deckPath = resolve(process.cwd(), fileArg);
const html = readFileSync(deckPath, 'utf8');
const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const layoutsPath = resolve(scriptDir, '../references/layouts.md');
const errors = [];
const warnings = [];

if (!/<!doctype html>/i.test(clean)) errors.push('Missing HTML doctype.');
if (!/<title>[\s\S]*?<\/title>/i.test(clean)) errors.push('Missing document title.');
if (/lorem ipsum|\[replace(?: me)?\]|todo:\s*(?:replace|write|add)/i.test(clean)) {
  errors.push('Found unresolved placeholder content.');
}
if (!/(ArrowRight|PageDown|keydown|deck-stage|slide-deck|hyper-deck)/i.test(clean)) {
  errors.push('No recognizable slide navigation runtime found.');
}

const density = clean.match(/<body\b[^>]*\bdata-density=["'](speaker|reader)["']/i)?.[1];
if (!density) errors.push('Body must declare data-density="speaker" or data-density="reader".');

const sectionTags = [...clean.matchAll(/<section\b([^>]*)>/gi)];
const authoredSlides = sectionTags.filter((match) => {
  const attrs = match[1];
  const cls = attrs.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
  return cls.split(/\s+/).includes('slide') || /\bdata-(?:slide-kind|screen-label|label|layout)\s*=/i.test(attrs);
});
if (authoredSlides.length < 3) errors.push(`Expected at least 3 authored slides; found ${authoredSlides.length}.`);

let allowedLayouts = new Set();
if (existsSync(layoutsPath)) {
  const registry = readFileSync(layoutsPath, 'utf8').match(/Registered layout IDs:\s*(.+)/i)?.[1] ?? '';
  allowedLayouts = new Set([...registry.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
}
if (!allowedLayouts.size) errors.push('Could not read registered layout IDs from references/layouts.md.');

authoredSlides.forEach((match, index) => {
  const layout = match[1].match(/\bdata-layout\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!layout) errors.push(`Slide ${index + 1}: missing data-layout.`);
  else if (!allowedLayouts.has(layout)) errors.push(`Slide ${index + 1}: unregistered data-layout="${layout}".`);
});

const fixedPairs = [...clean.matchAll(/width\s*:\s*(\d+)px[;\s][^{}]{0,180}?height\s*:\s*(\d+)px/gi)]
  .map((match) => [Number(match[1]), Number(match[2])]);
const fixedStageElement = /<(?:deck-stage|main|div)\b[^>]*\bwidth=["'](1600|1920)["'][^>]*\bheight=["'](900|1080)["']/i.test(clean);
const fixedStageConstants = /DESIGN_W(?:_DEFAULT)?\s*=\s*(1600|1920)[\s\S]{0,180}?DESIGN_H(?:_DEFAULT)?\s*=\s*(900|1080)/i.test(clean);
const hasFixedStage = fixedStageElement || fixedStageConstants || fixedPairs.some(([width, height]) => Math.abs(width / height - 16 / 9) < 0.002 && width >= 1200);
if (!hasFixedStage) warnings.push('Could not prove a fixed 16:9 stage from CSS; confirm uniform stage scaling in the rendered deck.');

const imageTags = [...clean.matchAll(/<img\b([^>]*)>/gi)];
imageTags.forEach((match, index) => {
  const slot = match[1].match(/\bdata-image-slot\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!slot) errors.push(`Image ${index + 1}: missing data-image-slot.`);
  else if (!/^[a-z][a-z0-9-]*-(?:native|21x9|16x10|16x9|4x3|3x2|1x1|3x4)$/i.test(slot)) {
    warnings.push(`Image ${index + 1}: data-image-slot="${slot}" should include a semantic role and ratio.`);
  }
});

async function loadPlaywright() {
  const requires = [createRequire(import.meta.url), createRequire(resolve(process.cwd(), 'package.json'))];
  for (const req of requires) {
    for (const name of ['playwright', '@playwright/test']) {
      try {
        const resolved = req.resolve(name);
        const module = await import(pathToFileURL(resolved).href);
        return module.default ?? module;
      } catch {}
    }
  }
  return null;
}

async function runRenderedChecks() {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    warnings.push('Rendered measurement skipped because Playwright is unavailable; render and inspect every slide manually.');
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (defaultError) {
    try {
      browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      warnings.push(`Rendered measurement skipped because no Playwright browser executable is available: ${defaultError.message?.split('\n')[0] ?? defaultError}`);
      return;
    }
  }
  try {
    for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(pathToFileURL(deckPath).href, { waitUntil: 'load' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(350);

      for (let index = 0; index < authoredSlides.length; index += 1) {
        const measurement = await page.evaluate(() => {
          const candidates = [...document.querySelectorAll('section[data-layout]')];
          const visible = candidates.filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01 && rect.width > 1 && rect.height > 1;
          });
          if (visible.length !== 1) return { visibleCount: visible.length };

          const slide = visible[0];
          const slideRect = slide.getBoundingClientRect();
          const textSelector = 'h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,figcaption,[data-text]';
          const ignored = '.counter,#nav,.nav,.deck-controls,[data-deck-controls],[aria-hidden="true"]';
          const content = [...slide.querySelectorAll(`${textSelector},img,video,svg,canvas`)].filter((element) => {
            if (element.closest(ignored)) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01 && rect.width > 1 && rect.height > 1;
          });
          const overflow = content.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              node: element.tagName.toLowerCase() + (element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''),
              left: Math.max(0, slideRect.left - rect.left),
              top: Math.max(0, slideRect.top - rect.top),
              right: Math.max(0, rect.right - slideRect.right),
              bottom: Math.max(0, rect.bottom - slideRect.bottom),
            };
          }).filter((item) => Math.max(item.left, item.top, item.right, item.bottom) > 3);

          const smallText = [...slide.querySelectorAll(textSelector)].filter((element) => !element.closest(ignored)).map((element) => {
            const style = getComputedStyle(element);
            const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
            return { text, size: Number.parseFloat(style.fontSize) };
          }).filter((item) => item.text.length >= 40 && item.size < 16);

          const controls = [...document.querySelectorAll('.counter,#nav,.nav,.deck-controls,[data-deck-controls]')].filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }).map((element) => element.getBoundingClientRect());
          const controlIntrusions = content.filter((element) => {
            const rect = element.getBoundingClientRect();
            return controls.some((control) => Math.min(rect.right, control.right) - Math.max(rect.left, control.left) > 2 && Math.min(rect.bottom, control.bottom) - Math.max(rect.top, control.top) > 2);
          }).length;

          return {
            visibleCount: 1,
            layout: slide.getAttribute('data-layout'),
            ratio: slideRect.width / slideRect.height,
            overflow,
            smallText,
            controlIntrusions,
          };
        });

        const prefix = `${viewport.width}x${viewport.height} slide ${index + 1}`;
        if (measurement.visibleCount !== 1) {
          errors.push(`${prefix}: expected one visible slide; found ${measurement.visibleCount}.`);
          break;
        }
        if (Math.abs(measurement.ratio - 16 / 9) > 0.025) errors.push(`${prefix}: visible stage is not 16:9.`);
        measurement.overflow.forEach((item) => errors.push(`${prefix} (${measurement.layout}): ${item.node} exceeds slide bounds.`));
        measurement.smallText.forEach((item) => warnings.push(`${prefix} (${measurement.layout}): ${item.size}px text contains ${item.text.length} characters; check readability.`));
        if (measurement.controlIntrusions) warnings.push(`${prefix} (${measurement.layout}): ${measurement.controlIntrusions} content element(s) intersect navigation controls.`);
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(80);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await runRenderedChecks();

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`PASS: ${authoredSlides.length} registered slides · ${imageTags.length} image slots · ${density ?? 'unknown'} density · ${deckPath}`);
