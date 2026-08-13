import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  cjkPromotedFontFamily,
  collectLayeredPptxBackgroundTargets,
  isolateLayeredPptxBackground,
  restoreLayeredPptxBackgroundIsolation,
  runDomToPptx,
} from '../../src/main/deck-capture.js';

const execFileP = promisify(execFile);
const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));

class FakeStyle {
  private readonly values = new Map<string, { priority: string; value: string }>();

  getPropertyPriority(name: string): string {
    return this.values.get(name)?.priority ?? '';
  }

  getPropertyValue(name: string): string {
    return this.values.get(name)?.value ?? '';
  }

  setProperty(name: string, value: string, priority = ''): void {
    this.values.set(name, { priority, value });
  }
}

function fakeElement(tagName = 'DIV'): HTMLElement {
  const attributes = new Map<string, string>();
  const children: HTMLElement[] = [];
  const element = {
    children,
    childNodes: children,
    className: '',
    closest: () => null,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    innerText: '',
    offsetHeight: 80,
    offsetLeft: 24,
    offsetTop: 32,
    offsetWidth: 160,
    parentElement: null,
    append: (child: HTMLElement) => {
      (child as unknown as { parentElement: HTMLElement | null }).parentElement = element as unknown as HTMLElement;
      children.push(child);
    },
    insertBefore: (child: HTMLElement, before: HTMLElement) => {
      (child as unknown as { parentElement: HTMLElement | null }).parentElement = element as unknown as HTMLElement;
      const index = children.indexOf(before);
      if (index < 0) children.push(child);
      else children.splice(index, 0, child);
    },
    prepend: (child: HTMLElement) => {
      (child as unknown as { parentElement: HTMLElement | null }).parentElement = element as unknown as HTMLElement;
      children.unshift(child);
    },
    querySelectorAll: (selector: string) => {
      if (selector === ':scope > [data-od-pptx-bg]') {
        return children.filter((child) => child.getAttribute('data-od-pptx-bg') === 'true');
      }
      if (selector !== '*') return [];
      const result: HTMLElement[] = [];
      const visit = (parent: HTMLElement) => {
        Array.from(parent.children).forEach((child) => {
          result.push(child as HTMLElement);
          visit(child as HTMLElement);
        });
      };
      visit(element as unknown as HTMLElement);
      return result;
    },
    remove: () => {
      const parent = element.parentElement as HTMLElement | null;
      if (!parent) return;
      const siblings = parent.children as unknown as HTMLElement[];
      const index = siblings.indexOf(element as unknown as HTMLElement);
      if (index >= 0) siblings.splice(index, 1);
      element.parentElement = null;
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: new FakeStyle(),
    tagName,
    textContent: '',
  };
  return element as unknown as HTMLElement;
}

type ComputedStyle = Record<string, string>;

function computedStyle(element: HTMLElement, overrides: Partial<ComputedStyle> = {}): ComputedStyle {
  const inline = element.style as unknown as FakeStyle;
  const value = (name: string, fallback: string) => inline.getPropertyValue(name) || fallback;
  return {
    backgroundClip: value('background-clip', 'border-box'),
    backgroundColor: value('background-color', 'transparent'),
    backgroundImage: value('background-image', 'none'),
    backgroundOrigin: value('background-origin', 'padding-box'),
    backgroundPosition: value('background-position', '0% 0%'),
    backgroundRepeat: value('background-repeat', 'repeat'),
    backgroundSize: value('background-size', 'auto'),
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderRadius: '0px',
    borderRightWidth: '0px',
    borderTopWidth: '0px',
    content: 'none',
    display: 'block',
    maskImage: 'none',
    webkitMaskImage: 'none',
    fontFamily: 'sans-serif',
    overflow: 'visible',
    paddingBottom: '0px',
    paddingLeft: '0px',
    paddingRight: '0px',
    paddingTop: '0px',
    position: value('position', 'static'),
    zIndex: value('z-index', 'auto'),
    ...overrides,
  };
}

function descendants(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>('*'));
}

function stubExportDom(slide: HTMLElement, styles: Map<HTMLElement, Partial<ComputedStyle>>) {
  const body = fakeElement('BODY');
  const documentElement = fakeElement('HTML');
  const created: HTMLElement[] = [];
  const fakeDocument = {
    body,
    createElement: (tagName: string) => {
      const element = fakeElement(tagName.toUpperCase());
      created.push(element);
      return element;
    },
    createTreeWalker: () => ({ nextNode: () => null }),
    documentElement,
    querySelectorAll: (selector: string) =>
      selector === '.slide' ? [slide] : selector === '*' ? [slide, ...descendants(slide)] : [],
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('getComputedStyle', (element: HTMLElement, pseudo?: string) =>
    pseudo ? computedStyle(element, { backgroundImage: 'none', content: 'none' }) : computedStyle(element, styles.get(element)),
  );
  vi.stubGlobal('Node', class FakeNode { static readonly TEXT_NODE = 3; });
  vi.stubGlobal('NodeFilter', class FakeNodeFilter { static readonly SHOW_TEXT = 4; });

  return created;
}

async function runExport(
  onExport?: () => void,
  layeredBackgrounds?: Parameters<typeof runDomToPptx>[1],
): Promise<void> {
  vi.stubGlobal('window', {
    domToPptx: {
      exportToPptx: async () => {
        onExport?.();
        return new Blob(['pptx']);
      },
    },
  });

  const result = await runDomToPptx('.slide', layeredBackgrounds);
  expect(result.error).toBeUndefined();
}

describe('editable PPTX layered backgrounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('isolates supported authored gradient layers for Chromium capture before native conversion', async () => {
    const slide = fakeElement();
    const paper = fakeElement();
    slide.prepend(paper);
    const backgroundImage =
      'linear-gradient(rgba(26, 26, 26, 0.018) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(rgb(248, 246, 241), rgb(248, 246, 241))';
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [slide, { position: 'absolute' }],
      [
        paper,
        {
          backgroundColor: 'rgb(248, 246, 241)',
          backgroundImage,
          backgroundPosition: '0% 0%, 0% 0%',
          backgroundRepeat: 'repeat, repeat',
          backgroundSize: '100% 44px, 100% 100%',
          position: 'absolute',
        },
      ],
    ]);
    stubExportDom(slide, styles);

    let layeredBackground: HTMLElement | undefined;
    await runExport(() => {
      layeredBackground = Array.from(paper.children).find(
        (child) => child.getAttribute('data-od-pptx-layered-bg') === 'true',
      ) as HTMLElement | undefined;
    });

    expect((paper.style as unknown as FakeStyle).getPropertyValue('background-image')).toBe('none');
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('background-image')).toBe(
      backgroundImage,
    );
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('background-color')).toBe(
      'rgb(248, 246, 241)',
    );
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('background-size')).toBe(
      '100% 44px, 100% 100%',
    );
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('background-repeat')).toBe(
      'repeat, repeat',
    );
  });

  test.each([
    'repeating-linear-gradient(90deg, red 0 8px, blue 8px 16px), linear-gradient(white, black)',
    'conic-gradient(from 45deg, red, blue), radial-gradient(white, black)',
  ])('leaves html2canvas-unsupported layers on the authored element: %s', async (backgroundImage) => {
    const slide = fakeElement();
    const panel = fakeElement();
    slide.prepend(panel);
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [slide, { position: 'absolute' }],
      [panel, { backgroundImage, position: 'absolute' }],
    ]);
    const created = stubExportDom(slide, styles);

    await runExport();

    expect(created.filter((element) => element.tagName === 'OD-PPTX-LAYERED-BACKGROUND')).toHaveLength(0);
    expect((panel.style as unknown as FakeStyle).getPropertyValue('background-image')).toBe('');
  });

  test('rasterizes a static layered panel without changing its containing block semantics', async () => {
    const slide = fakeElement();
    const panel = fakeElement();
    const outerAnchoredChild = fakeElement();
    panel.prepend(outerAnchoredChild);
    slide.prepend(panel);
    const backgroundImage = 'linear-gradient(white, transparent), radial-gradient(circle, white, black)';
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [slide, { position: 'relative' }],
      [
        panel,
        {
          backgroundImage,
          position: 'static',
        },
      ],
      [outerAnchoredChild, { position: 'absolute' }],
    ]);
    stubExportDom(slide, styles);

    let layeredBackground: HTMLElement | undefined;
    await runExport(() => {
      layeredBackground = Array.from(panel.children).find(
        (child) => child.getAttribute('data-od-pptx-layered-bg') === 'true',
      ) as HTMLElement | undefined;
    });

    expect((panel.style as unknown as FakeStyle).getPropertyValue('background-image')).toBe('none');
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('background-image')).toBe(
      backgroundImage,
    );
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('inset')).toBe('auto');
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('left')).toBe('24px');
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('top')).toBe('32px');
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('width')).toBe('160px');
    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('height')).toBe('80px');
    expect((panel.style as unknown as FakeStyle).getPropertyValue('position')).toBe('');
    expect((outerAnchoredChild.style as unknown as FakeStyle).getPropertyValue('position')).toBe('');
  });

  test('does not turn static content wrappers into containing blocks', async () => {
    const slide = fakeElement();
    const panel = fakeElement();
    const wrapper = fakeElement();
    const outerAnchoredChild = fakeElement();
    wrapper.prepend(outerAnchoredChild);
    panel.prepend(wrapper);
    slide.prepend(panel);
    panel.setAttribute('data-od-pptx-layer-capture-id', 'layer-1');
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [slide, { position: 'relative' }],
      [
        panel,
        {
          backgroundImage: 'linear-gradient(white, transparent), radial-gradient(circle, white, black)',
          position: 'relative',
        },
      ],
      [wrapper, { position: 'static' }],
      [outerAnchoredChild, { position: 'absolute' }],
    ]);
    stubExportDom(slide, styles);

    await runExport(undefined, {
      'layer-1': {
        dataUrl: 'data:image/png;base64,cG5n',
        height: 80,
        left: 24,
        slideIndex: 0,
        top: 32,
        width: 160,
      },
    });

    expect(slide.children[0]?.getAttribute('data-od-pptx-layered-bg')).toBe('true');
    expect(slide.children[1]).toBe(panel);
    expect((wrapper.style as unknown as FakeStyle).getPropertyValue('position')).toBe('');
    expect((wrapper.style as unknown as FakeStyle).getPropertyValue('z-index')).toBe('');
    expect((outerAnchoredChild.style as unknown as FakeStyle).getPropertyValue('position')).toBe('');
  });

  test.each([
    { clip: { backgroundClip: 'text' }, name: 'standard' },
    { clip: { webkitBackgroundClip: 'text' }, name: 'WebKit' },
  ])('keeps a $name text-clipped layered gradient on the authored text path', async ({ clip }) => {
    const slide = fakeElement();
    const title = fakeElement();
    title.textContent = 'Gradient title';
    slide.prepend(title);
    const backgroundImage = 'linear-gradient(90deg, red, blue), linear-gradient(white, black)';
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [slide, { position: 'relative' }],
      [
        title,
        {
          backgroundImage,
          color: 'transparent',
          position: 'absolute',
          ...clip,
        },
      ],
    ]);
    const created = stubExportDom(slide, styles);

    let exportedBackgroundOverride = '';
    await runExport(() => {
      exportedBackgroundOverride = (title.style as unknown as FakeStyle).getPropertyValue('background-image');
    });

    expect(exportedBackgroundOverride).toBe('');
    expect(created.filter((element) => element.tagName === 'OD-PPTX-LAYERED-BACKGROUND')).toHaveLength(0);
  });

  test('emits one Chromium capture layer for a slide with a supported layered background', async () => {
    const slide = fakeElement();
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [
        slide,
        {
          backgroundColor: 'rgb(248, 246, 241)',
          backgroundImage: 'linear-gradient(transparent, white), radial-gradient(circle, white, transparent)',
          position: 'absolute',
        },
      ],
    ]);
    const created = stubExportDom(slide, styles);

    await runExport();

    expect(created.filter((element) => element.tagName === 'OD-PPTX-LAYERED-BACKGROUND')).toHaveLength(1);
    expect(created.filter((element) => element.getAttribute('data-od-pptx-bg') === 'true')).toHaveLength(0);
  });

  test('emits PNG media for standard and pseudo layered backgrounds', async () => {
    const media = await probeLayeredBackgroundMedia();

    expect(media.supported).toMatchObject({ captures: 1, media: [expect.stringMatching(/\.png$/)] });
    expect(media.pseudo).toMatchObject({ captures: 1, media: [expect.stringMatching(/\.png$/)] });
  }, 30_000);

  test('preserves clipping and effective opacity in the exported layered-background pixels', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.composited.pngs;

    expect(media.composited.captures).toBe(1);
    expect(image).toBeDefined();
    expect(image?.transparentPixels, JSON.stringify(image)).toBeGreaterThan(0);
    expect(image?.maxAlpha).toBeGreaterThanOrEqual(120);
    expect(image?.maxAlpha).toBeLessThanOrEqual(136);
  }, 30_000);

  test('preserves a CSS mask as decoded alpha in the exported PNG', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.masked.pngs;

    expect(media.masked.captures).toBe(1);
    expect(media.masked.media).toEqual([expect.stringMatching(/\.png$/)]);
    expect(image).toBeDefined();
    expect(image?.transparentPixels).toBeGreaterThan(0);
    expect(image?.translucentPixels).toBeGreaterThan(0);
    expect(image?.maxAlpha).toBeGreaterThan(50);
    expect(image?.maxAlpha).toBeLessThan(128);
  }, 30_000);
});

type LayeredBackgroundProbe = {
  composited: LayeredBackgroundExport;
  masked: LayeredBackgroundExport;
  pseudo: LayeredBackgroundExport;
  supported: LayeredBackgroundExport;
};

type LayeredBackgroundExport = { captures: number; media: string[]; pngs: PngProbe[] };

type PngProbe = {
  height: number;
  maxAlpha: number;
  minAlpha: number;
  name: string;
  opaquePixels: number;
  translucentPixels: number;
  transparentPixels: number;
  width: number;
};

let layeredBackgroundProbePromise: Promise<LayeredBackgroundProbe> | undefined;

function probeLayeredBackgroundMedia(): Promise<LayeredBackgroundProbe> {
  layeredBackgroundProbePromise ??= runLayeredBackgroundMediaProbe();
  return layeredBackgroundProbePromise;
}

async function runLayeredBackgroundMediaProbe(): Promise<LayeredBackgroundProbe> {
  const probeDir = await mkdtemp(join(tmpdir(), 'od-pptx-layered-probe-'));
  const invocationSource = `(captures => {
    const cjkPromotedFontFamily = ${cjkPromotedFontFamily.toString()};
    return (${runDomToPptx.toString()})(".slide", captures);
  })`;
  const collectSource = `(${collectLayeredPptxBackgroundTargets.toString()})(".slide")`;
  const isolateSource = `(id => {
    const restoreLayeredPptxBackgroundIsolation = ${restoreLayeredPptxBackgroundIsolation.toString()};
    return (${isolateLayeredPptxBackground.toString()})(".slide", id);
  })`;
  const restoreSource = `(${restoreLayeredPptxBackgroundIsolation.toString()})()`;
  await writeFile(join(probeDir, 'package.json'), '{"main":"main.cjs"}\n');
  await writeFile(
    join(probeDir, 'main.cjs'),
    `
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFile } = require('node:fs/promises');
const { gunzipSync, inflateRawSync } = require('node:zlib');

const fixtures = {
  supported: '<div class="supported"></div>',
  pseudo: '<div class="pseudo"></div>',
  masked: '<div class="masked"></div>',
  composited: '<div class="card"><div class="composited"></div><div class="label">Native label</div></div>',
};
const styles = \`
  html, body { margin: 0; }
  .slide { position: relative; width: 320px; height: 180px; overflow: hidden; background: #111; }
  .card { position: absolute; inset: 10px; background: #24506f; }
  .supported, .pseudo, .masked, .composited { position: absolute; inset: 20px; }
  .label { position: absolute; right: 8px; bottom: 8px; color: white; }
  .supported {
    background-image: linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .pseudo::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .masked {
    background-image: linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(circle at center, black 30%, transparent 80%);
    mask-image: radial-gradient(circle at center, black 30%, transparent 80%);
  }
  .composited {
    background-image: linear-gradient(#ff3b30, #ff3b30), linear-gradient(#ff3b30, #ff3b30);
    clip-path: polygon(0 0, 100% 0, 0 100%);
    filter: drop-shadow(0 10px 12px rgba(0, 0, 0, .45));
    opacity: .5;
    transform: translate(-12px, 0) rotate(8deg) scale(.9);
  }
\`;

function zipEntries(pptxBase64) {
  const archive = Buffer.from(pptxBase64, 'base64');
  let eocd = archive.length - 22;
  while (eocd >= 0 && archive.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('PPTX central directory was not found');
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid PPTX central directory entry');
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (data) entries.push({ data, name });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inspectSlideMedia(pptxBase64) {
  const entries = zipEntries(pptxBase64);
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  return entries
    .map(({ name }) => /^ppt\\/slides\\/slide(\\d+)\\.xml$/.exec(name))
    .filter(Boolean)
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => {
      const relationships = entriesByName.get('ppt/slides/_rels/slide' + match[1] + '.xml.rels');
      const media = relationships
        ? Array.from(relationships.data.toString('utf8').matchAll(/Target="([^"]+)"/g), (target) => target[1])
            .filter((target) => target.startsWith('../media/'))
            .map((target) => entriesByName.get('ppt/media/' + target.slice('../media/'.length)))
            .filter(Boolean)
        : [];
      const pngs = media
        .filter(({ name }) => name.endsWith('.png'))
        .map(({ data, name }) => inspectPng(data, name));
      return { media: media.map(({ name }) => name).sort(), pngs };
    });
}

function inspectPng(data, name) {
  const image = nativeImage.createFromBuffer(data);
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let minAlpha = 255;
  let maxAlpha = 0;
  let opaquePixels = 0;
  let translucentPixels = 0;
  let transparentPixels = 0;
  for (let offset = 3; offset < bitmap.length; offset += 4) {
    const alpha = bitmap[offset];
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (alpha < 16) transparentPixels += 1;
    else if (alpha < 240) translucentPixels += 1;
    else opaquePixels += 1;
  }
  return { height, maxAlpha, minAlpha, name, opaquePixels, translucentPixels, transparentPixels, width };
}

app.whenReady().then(async () => {
  const bundle = gunzipSync(await readFile(process.env.OD_PPTX_LAYER_BUNDLE)).toString('utf8');
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true },
  });
  try {
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + styles + '</style></head><body></body></html>';
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await window.webContents.executeJavaScript(bundle, true);
    const dbg = window.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    // Keep one real exporter invocation: four serial PPTX archive builds made
    // this probe hit its Linux workspace-test timeout under concurrent load.
    const fixtureEntries = Object.entries(fixtures);
    const slides = fixtureEntries
      .map(([name, markup]) => '<section class="slide" data-od-probe="' + name + '">' + markup + '</section>')
      .join('');
    await window.webContents.executeJavaScript('document.body.innerHTML = ' + JSON.stringify(slides), true);
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
    const targets = await window.webContents.executeJavaScript(${JSON.stringify(collectSource)}, true);
    const captures = {};
    for (const target of targets) {
      const geometry = await window.webContents.executeJavaScript(${JSON.stringify(isolateSource)} + '(' + JSON.stringify(target.id) + ')', true);
      await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
      const screenshot = await dbg.sendCommand('Page.captureScreenshot', {
        captureBeyondViewport: true,
        clip: { x: geometry.pageX, y: geometry.pageY, width: geometry.width, height: geometry.height, scale: 2 },
        format: 'png',
        fromSurface: true,
      });
      captures[target.id] = { ...geometry, dataUrl: 'data:image/png;base64,' + screenshot.data };
      await window.webContents.executeJavaScript(${JSON.stringify(restoreSource)}, true);
    }
    const exported = await window.webContents.executeJavaScript(${JSON.stringify(invocationSource)} + '(' + JSON.stringify(captures) + ')', true);
    if (!exported || exported.error || !exported.b64) throw new Error(exported?.error || 'PPTX export returned no bytes');
    const captureCounts = await window.webContents.executeJavaScript(
      'Array.from(document.querySelectorAll("[data-od-probe]"), (slide) => slide.querySelectorAll("[data-od-pptx-layered-bg]").length)',
      true,
    );
    const slideMedia = inspectSlideMedia(exported.b64);
    const result = Object.fromEntries(fixtureEntries.map(([name], index) => [
      name,
      { captures: captureCounts[index], ...slideMedia[index] },
    ]));
    process.stdout.write('OD_PPTX_LAYER_PROBE:' + JSON.stringify(result) + '\\n');
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\\n');
  app.exit(1);
});
`,
  );

  try {
    const electronRelativePath = (await readFile(
      join(desktopRoot, 'node_modules', 'electron', 'path.txt'),
      'utf8',
    )).trim();
    const electronPath = join(desktopRoot, 'node_modules', 'electron', 'dist', electronRelativePath);
    const electronArgs = [probeDir, '--no-sandbox', '--disable-gpu'];
    const command = process.platform === 'linux' ? 'xvfb-run' : electronPath;
    const args = process.platform === 'linux' ? ['-a', electronPath, ...electronArgs] : electronArgs;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OD_PPTX_LAYER_BUNDLE: join(desktopRoot, 'vendor', 'dom-to-pptx', 'dom-to-pptx.bundle.js.gz'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stderr, stdout } = await execFileP(command, args, { env, timeout: 20_000 });
    const marker = stdout.split(/\r?\n/).find((line) => line.startsWith('OD_PPTX_LAYER_PROBE:'));
    if (!marker) throw new Error(`Electron renderer probe returned no result: ${stdout || stderr}`);
    return parseLayeredBackgroundProbe(JSON.parse(marker.slice('OD_PPTX_LAYER_PROBE:'.length)));
  } finally {
    await rm(probeDir, { force: true, recursive: true });
  }
}

function parseLayeredBackgroundProbe(value: unknown): LayeredBackgroundProbe {
  if (
    typeof value !== 'object'
    || value === null
    || !('supported' in value)
    || !('pseudo' in value)
    || !('masked' in value)
    || !('composited' in value)
  ) {
    throw new Error('Electron renderer probe returned an invalid result');
  }
  return {
    composited: parseLayeredBackgroundExport(value.composited),
    masked: parseLayeredBackgroundExport(value.masked),
    pseudo: parseLayeredBackgroundExport(value.pseudo),
    supported: parseLayeredBackgroundExport(value.supported),
  };
}

function parseLayeredBackgroundExport(value: unknown): LayeredBackgroundExport {
  if (
    typeof value !== 'object'
    || value === null
    || !('captures' in value)
    || typeof value.captures !== 'number'
    || !('media' in value)
    || !Array.isArray(value.media)
    || !value.media.every((item) => typeof item === 'string')
    || !('pngs' in value)
    || !Array.isArray(value.pngs)
  ) {
    throw new Error('Electron renderer probe returned an invalid export');
  }
  return {
    captures: value.captures,
    media: value.media,
    pngs: value.pngs as PngProbe[],
  };
}
