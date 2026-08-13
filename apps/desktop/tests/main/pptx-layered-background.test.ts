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

  test('copies background blending onto the no-capture fallback layer', async () => {
    const slide = fakeElement();
    const panel = fakeElement();
    slide.prepend(panel);
    const styles = new Map<HTMLElement, Partial<ComputedStyle>>([
      [slide, { position: 'relative' }],
      [
        panel,
        {
          backgroundBlendMode: 'multiply, screen',
          backgroundImage: 'linear-gradient(white, transparent), radial-gradient(circle, white, black)',
          position: 'absolute',
        },
      ],
    ]);
    stubExportDom(slide, styles);

    let layeredBackground: HTMLElement | undefined;
    await runExport(() => {
      layeredBackground = Array.from(panel.children).find(
        (child) => child.getAttribute('data-od-pptx-layered-bg') === 'true',
      ) as HTMLElement | undefined;
    });

    expect((layeredBackground?.style as unknown as FakeStyle).getPropertyValue('background-blend-mode')).toBe(
      'multiply, screen',
    );
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
    expect(media.pseudo, JSON.stringify(media.pseudo)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
  }, 30_000);

  test('keeps layered pseudo backgrounds behind native pseudo content', async () => {
    const media = await probeLayeredBackgroundMedia();

    expect(media.pseudoLayerOrder.background, JSON.stringify(media.pseudoLayerOrder)).toBeGreaterThanOrEqual(0);
    expect(media.pseudoLayerOrder.content).toBeGreaterThanOrEqual(0);
    expect(media.pseudoLayerOrder.background).toBeLessThan(media.pseudoLayerOrder.content);
  }, 30_000);

  test('flattens a multiply-blended layered background against an authored pseudo backdrop', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.blended.pngs;

    expect(media.blended, JSON.stringify(media.blended)).toMatchObject({
      captures: 2,
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image?.centerRgb, JSON.stringify(image)).toEqual([64, 96, 64]);
  }, 30_000);

  test('flattens a multiply-blended layered background against nested backdrop descendants', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.nestedBlended.pngs;

    expect(media.nestedBlended, JSON.stringify(media.nestedBlended)).toMatchObject({
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image?.centerRgb, JSON.stringify(image)).toEqual([64, 96, 64]);
  }, 30_000);

  test('uses CSS paint order when selecting a blended background backdrop', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.paintOrderedBackdrop.pngs;

    expect(media.paintOrderedBackdrop, JSON.stringify(media.paintOrderedBackdrop)).toMatchObject({
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image?.centerRgb, JSON.stringify(image)).toEqual([64, 96, 64]);
  }, 30_000);

  test('includes an explicit slide background behind a materialized layered pseudo', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.stackingSlide.pngs;

    expect(media.stackingSlide, JSON.stringify(media.stackingSlide)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image?.centerRgb, JSON.stringify(image)).toEqual([64, 96, 64]);
  }, 30_000);

  test('aligns a captured layered background with native content after export normalization', async () => {
    const media = await probeLayeredBackgroundMedia();

    expect(media.alignmentGeometry, JSON.stringify(media.alignmentGeometry)).toEqual({
      background: { height: 971550, width: 2171700, x: 1314450, y: 1028700 },
      content: { height: 971550, width: 2171700, x: 1314450, y: 1028700 },
    });
  }, 30_000);

  test('flattens a backdrop-filtered layered background against its authored backdrop', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.backdropFiltered.pngs;

    expect(media.backdropFiltered, JSON.stringify(media.backdropFiltered)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
    // Chromium's backdrop-filter color rounding can differ by one channel
    // level across platforms while preserving the same rendered color.
    expect(
      image?.centerRgb.every((channel, index) => Math.abs(channel - [96, 223, 223][index]!) <= 1),
      JSON.stringify(image),
    ).toBe(true);
  }, 30_000);

  test('preserves background blending for standard and backdrop-dependent pseudos', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [standard] = media.backgroundBlendPseudo.pngs;
    const [materialized] = media.materializedBackgroundBlend.pngs;

    expect(standard?.centerRgb, JSON.stringify(standard)).toEqual([64, 96, 64]);
    expect(materialized?.centerRgb, JSON.stringify(materialized)).toEqual([64, 96, 64]);
  }, 30_000);

  test('captures only the layered background pixels from a replaced element', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.replaced.pngs;

    expect(media.replaced, JSON.stringify(media.replaced)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image).toBeDefined();
    expect(image?.transparentPixels, JSON.stringify(image)).toBeGreaterThan(0);
    expect(image?.translucentPixels, JSON.stringify(image)).toBeGreaterThan(0);
    expect(image?.opaquePixels, JSON.stringify(image)).toBe(0);
    expect(media.replacedForegroundMedia).toHaveLength(1);
  }, 30_000);

  test('keeps a slide-root layered pseudo background above the opaque slide background', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.rootPseudo.pngs;

    expect(media.rootPseudo, JSON.stringify(media.rootPseudo)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image?.transparentPixels, JSON.stringify(image)).toBeGreaterThan(0);
    expect(image?.translucentPixels, JSON.stringify(image)).toBeGreaterThan(0);
    expect(media.rootPseudoLayerOrder.slideBackground).toBeGreaterThanOrEqual(0);
    expect(media.rootPseudoLayerOrder.background).toBeGreaterThanOrEqual(0);
    expect(media.rootPseudoLayerOrder.content).toBeGreaterThanOrEqual(0);
    expect(media.rootPseudoLayerOrder.slideBackground).toBeLessThan(media.rootPseudoLayerOrder.background);
    expect(media.rootPseudoLayerOrder.background).toBeLessThan(media.rootPseudoLayerOrder.content);
  }, 30_000);

  test('skips hidden, zero-sized, and off-slide layered backgrounds without aborting export', async () => {
    const media = await probeLayeredBackgroundMedia();

    expect(media.skippedTargets).toBe(0);
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

  test('preserves mask geometry on a normal layered pseudo background', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.normalMaskedPseudo.pngs;

    expect(media.normalMaskedPseudo, JSON.stringify(media.normalMaskedPseudo)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image).toBeDefined();
    expect(image?.minAlpha).toBe(0);
    expect(image?.maxAlpha).toBe(255);
    expect(image?.transparentPixels, JSON.stringify(image)).toBeGreaterThan(image?.opaquePixels ?? 0);
  }, 30_000);

  test('preserves mask geometry on a background-blended layered pseudo', async () => {
    const media = await probeLayeredBackgroundMedia();
    const [image] = media.compositedMaskedPseudo.pngs;

    expect(media.compositedMaskedPseudo, JSON.stringify(media.compositedMaskedPseudo)).toMatchObject({
      captures: 1,
      media: [expect.stringMatching(/\.png$/)],
    });
    expect(image).toBeDefined();
    expect(image?.minAlpha).toBe(0);
    expect(image?.maxAlpha).toBe(255);
    expect(image?.transparentPixels, JSON.stringify(image)).toBeGreaterThan(image?.opaquePixels ?? 0);
  }, 30_000);
});

type LayeredBackgroundProbe = {
  alignmentGeometry: {
    background: PptxGeometry | null;
    content: PptxGeometry | null;
  };
  backdropFiltered: LayeredBackgroundExport;
  backgroundBlendPseudo: LayeredBackgroundExport;
  blended: LayeredBackgroundExport;
  composited: LayeredBackgroundExport;
  compositedMaskedPseudo: LayeredBackgroundExport;
  masked: LayeredBackgroundExport;
  materializedBackgroundBlend: LayeredBackgroundExport;
  nestedBlended: LayeredBackgroundExport;
  normalMaskedPseudo: LayeredBackgroundExport;
  paintOrderedBackdrop: LayeredBackgroundExport;
  pseudo: LayeredBackgroundExport;
  pseudoLayerOrder: { background: number; content: number };
  replaced: LayeredBackgroundExport;
  replacedForegroundMedia: string[];
  rootPseudo: LayeredBackgroundExport;
  rootPseudoLayerOrder: { background: number; content: number; slideBackground: number };
  skippedTargets: number;
  stackingSlide: LayeredBackgroundExport;
  supported: LayeredBackgroundExport;
};

type PptxGeometry = { height: number; width: number; x: number; y: number };

type LayeredBackgroundExport = { captures: number; media: string[]; pngs: PngProbe[] };

type PngProbe = {
  centerRgb: [number, number, number];
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
    return (${runDomToPptx.toString()})(".slide", captures, "export-prepared");
  })`;
  const prepareSource = `(() => {
    const cjkPromotedFontFamily = ${cjkPromotedFontFamily.toString()};
    return (${runDomToPptx.toString()})(".slide", {}, "prepare");
  })()`;
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
  blended: '<div class="blended-backdrop"></div><div class="blended"></div>',
  nestedBlended: '<div class="nested-blended-backdrop"><div class="nested-blended-texture"></div></div><div class="nested-blended"></div>',
  normalMaskedPseudo: '<div class="normal-masked-pseudo"></div>',
  compositedMaskedPseudo: '<div class="composited-masked-pseudo"></div>',
  paintOrderedBackdrop: '<div class="paint-above"></div><div class="paint-target"></div><div class="paint-below"></div>',
  replaced: '<img class="replaced" alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%2260%22%3E%3Crect width=%22120%22 height=%2260%22 fill=%22%23ff00ff%22/%3E%3C/svg%3E">',
  masked: '<div class="masked"></div>',
  composited: '<div class="card"><div class="composited"></div><div class="label">Native label</div></div>',
  skipped: '<div class="display-none"><div class="hidden-layer"></div></div><div class="visibility-hidden"><div class="hidden-layer"></div></div><div class="zero-sized"></div><div class="off-slide"></div>',
  backdropFiltered: '<div class="filtered-backdrop"></div><div class="backdrop-filtered"></div>',
  backgroundBlendPseudo: '<div class="background-blend-pseudo"></div>',
  materializedBackgroundBlend: '<div class="materialized-background-blend"></div>',
  alignment: '<div class="alignment-layer"><div class="alignment-native">Alignment native</div></div>',
};
const styles = \`
  html, body { margin: 0; }
  .slide { position: relative; width: 320px; height: 180px; overflow: hidden; background: #0d1117; }
  .slide::before {
    content: 'Root layered pseudo content';
    position: absolute;
    inset: 0;
    z-index: 0;
    color: white;
    background-image: radial-gradient(circle at 20% 20%, rgba(88,166,255,.5), transparent 30%), radial-gradient(circle at 80% 80%, rgba(163,113,247,.5), transparent 30%);
  }
  [data-od-probe="alignment"] {
    width: 96px;
    height: 54px;
    margin-left: 36px;
    margin-top: 24px;
  }
  .alignment-layer {
    position: absolute;
    left: 10px;
    top: 12px;
    width: 76px;
    height: 34px;
    background-image: linear-gradient(rgb(44, 82, 130), rgb(44, 82, 130)), linear-gradient(transparent, transparent);
  }
  .alignment-native {
    position: absolute;
    inset: 0;
    color: white;
  }
  .card { position: absolute; left: 170px; top: 90px; width: 140px; height: 80px; background: #24506f; }
  .supported, .pseudo, .masked, .composited { position: absolute; width: 120px; height: 60px; }
  .label { position: absolute; right: 8px; bottom: 8px; color: white; }
  .supported {
    left: 16px;
    top: 12px;
    background-image: linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .pseudo { left: 176px; top: 12px; }
  .pseudo::after {
    content: 'Layered pseudo content';
    position: absolute;
    inset: 0;
    z-index: 5;
    border: 2px solid white;
    color: white;
    background-image: linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .blended-backdrop {
    position: absolute;
    left: 120px;
    top: 64px;
    width: 84px;
    height: 44px;
  }
  .blended-backdrop::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgb(128, 192, 128), rgb(128, 192, 128)), linear-gradient(transparent, transparent);
  }
  .blended {
    position: absolute;
    left: 122px;
    top: 66px;
    width: 80px;
    height: 40px;
    background-image: linear-gradient(rgb(128, 128, 128), rgb(128, 128, 128)), linear-gradient(transparent, transparent);
    mix-blend-mode: multiply;
  }
  .nested-blended-backdrop,
  .nested-blended {
    position: absolute;
    left: 36px;
    top: 68px;
    width: 72px;
    height: 36px;
  }
  .nested-blended-backdrop { background: rgb(20, 40, 60); }
  .nested-blended-texture {
    position: absolute;
    inset: 0;
    background: rgb(128, 192, 128);
  }
  .nested-blended {
    background-image: linear-gradient(rgb(128, 128, 128), rgb(128, 128, 128)), linear-gradient(transparent, transparent);
    mix-blend-mode: multiply;
  }
  .paint-above,
  .paint-target,
  .paint-below {
    position: absolute;
    left: 218px;
    top: 112px;
    width: 78px;
    height: 38px;
  }
  .paint-above { z-index: 2; background: rgb(255, 64, 64); }
  .paint-target {
    z-index: 0;
    background-image: linear-gradient(rgb(128, 128, 128), rgb(128, 128, 128)), linear-gradient(transparent, transparent);
    mix-blend-mode: multiply;
  }
  .paint-below { z-index: -1; background: rgb(128, 192, 128); }
  .normal-masked-pseudo {
    position: absolute;
    left: 8px;
    top: 138px;
    width: 62px;
    height: 34px;
  }
  .normal-masked-pseudo::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255)), linear-gradient(transparent, transparent);
    -webkit-mask-image: linear-gradient(black, black);
    mask-image: linear-gradient(black, black);
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: 50% 50%;
    mask-size: 50% 50%;
  }
  .composited-masked-pseudo {
    position: absolute;
    left: 76px;
    top: 136px;
    width: 64px;
    height: 36px;
  }
  .composited-masked-pseudo::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgb(128, 128, 128), rgb(128, 128, 128)), linear-gradient(rgb(128, 192, 128), rgb(128, 192, 128));
    background-blend-mode: multiply;
    -webkit-mask-image: linear-gradient(black, black);
    mask-image: linear-gradient(black, black);
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: 50% 50%;
    mask-size: 50% 50%;
  }
  .filtered-backdrop,
  .backdrop-filtered {
    position: absolute;
    left: 240px;
    top: 76px;
    width: 66px;
    height: 32px;
  }
  .filtered-backdrop { background: rgb(200, 40, 40); }
  .backdrop-filtered {
    background-image: linear-gradient(rgba(255, 255, 255, .2), rgba(255, 255, 255, .2)), linear-gradient(transparent, transparent);
    -webkit-backdrop-filter: invert(1);
    backdrop-filter: invert(1);
  }
  .background-blend-pseudo,
  .materialized-background-blend {
    position: absolute;
    top: 140px;
    background: white;
  }
  .background-blend-pseudo { left: 122px; width: 54px; height: 28px; }
  .materialized-background-blend { left: 180px; width: 58px; height: 30px; }
  .background-blend-pseudo::after,
  .materialized-background-blend::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgb(128, 128, 128), rgb(128, 128, 128)), linear-gradient(rgb(128, 192, 128), rgb(128, 192, 128));
    background-blend-mode: multiply;
  }
  .materialized-background-blend::after { mix-blend-mode: multiply; }
  .replaced {
    position: absolute;
    left: 160px;
    top: 102px;
    width: 150px;
    height: 60px;
    background-image: linear-gradient(90deg, rgba(52,199,89,.6), transparent), radial-gradient(circle, rgba(10,132,255,.5), transparent 65%);
  }
  .masked {
    left: 16px;
    top: 102px;
    width: 100px;
    height: 50px;
    background-image: linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(circle at center, black 30%, transparent 80%);
    mask-image: radial-gradient(circle at center, black 30%, transparent 80%);
  }
  .composited {
    inset: 10px;
    background-image: linear-gradient(#ff3b30, #ff3b30), linear-gradient(#ff3b30, #ff3b30);
    clip-path: polygon(0 0, 100% 0, 0 100%);
    filter: drop-shadow(0 10px 12px rgba(0, 0, 0, .45));
    opacity: .5;
    transform: translate(-12px, 0) rotate(8deg) scale(.9);
  }
  .hidden-layer, .zero-sized, .off-slide {
    position: absolute;
    width: 40px;
    height: 40px;
    background-image: linear-gradient(red, blue), radial-gradient(circle, white, black);
  }
  .display-none { display: none; }
  .visibility-hidden { visibility: hidden; }
  .zero-sized { width: 0; height: 0; }
  .off-slide { left: 400px; top: 20px; }
  .stacking-slide {
    background-color: rgb(20, 40, 60);
    background-image: linear-gradient(rgb(128, 192, 128), rgb(128, 192, 128));
  }
  .stacking-slide::before {
    content: '';
    position: absolute;
    left: 60px;
    top: 40px;
    width: 82px;
    height: 42px;
    z-index: 0;
    background-image: linear-gradient(rgb(128, 128, 128), rgb(128, 128, 128)), linear-gradient(transparent, transparent);
    mix-blend-mode: multiply;
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

function inspectMedia(pptxBase64) {
  return zipEntries(pptxBase64)
    .filter(({ name }) => /^ppt\\/media\\/.+\\.(?:gif|jpe?g|png|svg)$/.test(name))
    .map(({ data, name }) => ({ name, png: name.endsWith('.png') ? inspectPng(data, name) : null }));
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
  const centerOffset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  const centerRgb = [bitmap[centerOffset + 2], bitmap[centerOffset + 1], bitmap[centerOffset]];
  return { centerRgb, height, maxAlpha, minAlpha, name, opaquePixels, translucentPixels, transparentPixels, width };
}

function inspectPseudoLayerOrder(entries, mediaName) {
  const slideXml = entries.find(({ name }) => name === 'ppt/slides/slide1.xml')?.data.toString('utf8') || '';
  const relationships = entries
    .find(({ name }) => name === 'ppt/slides/_rels/slide1.xml.rels')
    ?.data.toString('utf8') || '';
  const targetName = mediaName.split('/').pop() || '';
  const relationship = relationships
    .match(/<Relationship\\b[^>]*>/g)
    ?.find((entry) => entry.includes(targetName)) || '';
  const relationshipId = relationship.match(/\\bId="([^"]+)"/)?.[1] || '';
  return {
    background: relationshipId ? slideXml.indexOf('r:embed="' + relationshipId + '"') : -1,
    content: slideXml.indexOf('Layered pseudo content'),
  };
}

function inspectRootPseudoLayerOrder(entries, mediaName) {
  const order = inspectPseudoLayerOrder(entries, mediaName);
  const slideXml = entries.find(({ name }) => name === 'ppt/slides/slide1.xml')?.data.toString('utf8') || '';
  return {
    ...order,
    content: slideXml.indexOf('Root layered pseudo content'),
    // The slide's native fill and the explicit child shim can both carry this
    // color. The last occurrence is the topmost opaque background shape.
    slideBackground: slideXml.lastIndexOf('val="0D1117"'),
  };
}

function inspectAlignmentGeometry(entries, mediaName) {
  const slideXml = entries.find(({ name }) => name === 'ppt/slides/slide1.xml')?.data.toString('utf8') || '';
  const relationships = entries
    .find(({ name }) => name === 'ppt/slides/_rels/slide1.xml.rels')
    ?.data.toString('utf8') || '';
  const targetName = mediaName.split('/').pop() || '';
  const relationship = relationships
    .match(/<Relationship\\b[^>]*>/g)
    ?.find((entry) => entry.includes(targetName)) || '';
  const relationshipId = relationship.match(/\\bId="([^"]+)"/)?.[1] || '';
  const picture = relationshipId
    ? slideXml.match(/<p:pic>[\\s\\S]*?<\\/p:pic>/g)?.find((entry) => entry.includes('r:embed="' + relationshipId + '"')) || ''
    : '';
  const content = slideXml.match(/<p:sp>[\\s\\S]*?<\\/p:sp>/g)?.find((entry) => entry.includes('Alignment native')) || '';
  const geometry = (xml) => {
    const offset = xml.match(/<a:off x="(\\d+)" y="(\\d+)"\\/>/);
    const extent = xml.match(/<a:ext cx="(\\d+)" cy="(\\d+)"\\/>/);
    return offset && extent
      ? { height: Number(extent[2]), width: Number(extent[1]), x: Number(offset[1]), y: Number(offset[2]) }
      : null;
  };
  return { background: geometry(picture), content: geometry(content) };
}

let probeStage = 'startup';
app.whenReady().then(async () => {
  const bundle = gunzipSync(await readFile(process.env.OD_PPTX_LAYER_BUNDLE)).toString('utf8');
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true },
  });
  let probeResult;
  try {
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + styles + '</style></head><body></body></html>';
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Match the production render-window lifecycle so Chromium paints frames
    // under Linux/Xvfb instead of suspending rAF for a hidden window.
    window.setOpacity(0);
    window.showInactive();
    await window.webContents.executeJavaScript(bundle, true);
    const dbg = window.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    // Keep one slide and one real exporter invocation: serial slide conversion
    // made this probe hit its Linux workspace-test timeout under concurrent load.
    const fixtureEntries = Object.entries(fixtures);
    const fixtureMarkup = fixtureEntries
      .map(([name, markup]) => '<div data-od-probe="' + name + '">' + markup + '</div>')
      .join('');
    const slide = '<section class="slide">' + fixtureMarkup + '</section>'
      + '<section class="slide stacking-slide" data-od-probe="stackingSlide"></section>';
    await window.webContents.executeJavaScript('document.body.innerHTML = ' + JSON.stringify(slide), true);
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
    probeStage = 'normalize export DOM';
    const prepared = await window.webContents.executeJavaScript(${JSON.stringify(prepareSource)}, true);
    if (!prepared?.prepared || prepared.error) throw new Error(prepared?.error || 'PPTX DOM normalization failed');
    await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
    const targets = await window.webContents.executeJavaScript(${JSON.stringify(collectSource)}, true);
    const captures = {};
    const targetCounts = await window.webContents.executeJavaScript(
      'Object.fromEntries(Array.from(document.querySelectorAll("[data-od-probe]"), (probe) => [probe.getAttribute("data-od-probe"), probe.querySelectorAll("[data-od-pptx-layer-capture-id]").length]))',
      true,
    );
    const probeByTarget = await window.webContents.executeJavaScript(
      'Object.fromEntries(Array.from(document.querySelectorAll("[data-od-pptx-layer-capture-id]"), (target) => [target.getAttribute("data-od-pptx-layer-capture-id"), target.closest("[data-od-probe]").getAttribute("data-od-probe")]))',
      true,
    );
    for (const target of targets) {
      probeStage = 'isolate target ' + target.id;
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
    probeStage = 'export deck';
    const exported = await window.webContents.executeJavaScript(${JSON.stringify(invocationSource)} + '(' + JSON.stringify(captures) + ')', true);
    if (!exported || exported.error || !exported.b64) throw new Error(exported?.error || 'PPTX export returned no bytes');
    const captureCounts = await window.webContents.executeJavaScript(
      'Object.fromEntries(Array.from(document.querySelectorAll("[data-od-probe]"), (probe) => [probe.getAttribute("data-od-probe"), probe.querySelectorAll("[data-od-pptx-layered-bg]").length]))',
      true,
    );
    const rootPseudoCaptureCount = await window.webContents.executeJavaScript(
      'Array.from(document.querySelector(".slide").children).filter((child) => child.getAttribute("data-od-pptx-pseudo") === "::before").length',
      true,
    );
    const entries = zipEntries(exported.b64);
    const media = inspectMedia(exported.b64);
    const usedMedia = new Set();
    const result = {};
    for (const [targetId, capture] of Object.entries(captures)) {
      const exportedImage = media.find(({ name, png }) =>
        !usedMedia.has(name)
        && Math.abs((png?.width ?? 0) - capture.width * 2) <= 1
        && Math.abs((png?.height ?? 0) - capture.height * 2) <= 1);
      if (!exportedImage) {
        throw new Error('PPTX did not contain capture-sized media for ' + targetId + ': ' + JSON.stringify({
          capture: { height: capture.height, width: capture.width },
          media: media.map(({ name, png }) => ({ name, height: png?.height, width: png?.width })),
        }));
      }
      const name = probeByTarget[targetId];
      usedMedia.add(exportedImage.name);
      result[name] = {
        captures: captureCounts[name],
        media: [exportedImage.name],
        pngs: exportedImage.png ? [exportedImage.png] : [],
      };
    }
    if (!result.normalMaskedPseudo) {
      result.normalMaskedPseudo = {
        captures: captureCounts.normalMaskedPseudo,
        media: [],
        pngs: [],
      };
    }
    if (!result.blended) {
      const blendedMedia = media.find(({ name, png }) =>
        !usedMedia.has(name)
        && (png?.width === 80 || png?.width === 160)
        && (png?.height === 40 || png?.height === 80));
      if (blendedMedia) usedMedia.add(blendedMedia.name);
      result.blended = {
        captures: captureCounts.blended,
        media: blendedMedia ? [blendedMedia.name] : [],
        pngs: blendedMedia?.png ? [blendedMedia.png] : [],
      };
    }
    const replacedCapture = Object.entries(captures)
      .find(([targetId]) => probeByTarget[targetId] === 'replaced')?.[1];
    const replacedForegroundMedia = replacedCapture ? media.filter(({ name, png }) =>
      !usedMedia.has(name)
      && Math.abs((png?.width ?? 0) - replacedCapture.width * 2) <= 1
      && Math.abs((png?.height ?? 0) - replacedCapture.height * 2) <= 1
      && png.opaquePixels === png.width * png.height) : [];
    replacedForegroundMedia.forEach(({ name }) => usedMedia.add(name));
    result.replacedForegroundMedia = replacedForegroundMedia.map(({ name }) => name);
    if (!result.backgroundBlendPseudo) {
      const backgroundBlendPseudoMedia = media.find(({ name, png }) =>
        !usedMedia.has(name) && png?.width === 54 && png?.height === 28);
      if (backgroundBlendPseudoMedia) usedMedia.add(backgroundBlendPseudoMedia.name);
      result.backgroundBlendPseudo = {
        captures: captureCounts.backgroundBlendPseudo,
        media: backgroundBlendPseudoMedia ? [backgroundBlendPseudoMedia.name] : [],
        pngs: backgroundBlendPseudoMedia?.png ? [backgroundBlendPseudoMedia.png] : [],
      };
    }
    const pseudoMedia = media.filter(
      ({ name, png }) => !usedMedia.has(name) && (png?.width ?? 0) > 100 && (png?.height ?? 0) > 40
        && (png?.width ?? 0) < 300 && (png?.height ?? 0) < 170,
    );
    result.pseudo = {
      captures: captureCounts.pseudo,
      media: pseudoMedia.map(({ name }) => name).sort(),
      pngs: pseudoMedia.flatMap(({ png }) => png ? [png] : []),
    };
    result.pseudoLayerOrder = inspectPseudoLayerOrder(entries, pseudoMedia[0]?.name || '');
    const rootPseudoMedia = media.filter(
      ({ name, png }) => !usedMedia.has(name) && (png?.width ?? 0) >= 300 && (png?.height ?? 0) >= 170,
    ).filter(
      ({ name }) => inspectPseudoLayerOrder(entries, name).background >= 0,
    );
    result.rootPseudo = {
      captures: rootPseudoCaptureCount,
      media: rootPseudoMedia.map(({ name }) => name).sort(),
      pngs: rootPseudoMedia.flatMap(({ png }) => png ? [png] : []),
    };
    result.rootPseudoLayerOrder = inspectRootPseudoLayerOrder(entries, rootPseudoMedia[0]?.name || '');
    result.alignmentGeometry = inspectAlignmentGeometry(entries, result.alignment?.media?.[0] || '');
    result.skippedTargets = targetCounts.skipped;
    probeResult = result;
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
  await new Promise((resolve, reject) => {
    process.stdout.write('OD_PPTX_LAYER_PROBE:' + JSON.stringify(probeResult) + '\\n', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  // dom-to-pptx can leave renderer work queued after the result is complete.
  // Exit the disposable probe explicitly instead of waiting for Electron's
  // graceful shutdown to drain those test-only handles under Linux CI load.
  app.exit(0);
}).catch((error) => {
  process.stderr.write(probeStage + ': ' + String(error && error.stack ? error.stack : error) + '\\n');
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
    let stderr: string;
    let stdout: string;
    try {
      ({ stderr, stdout } = await execFileP(command, args, { env, timeout: 20_000 }));
    } catch (error) {
      const failure = error as Error & { stderr?: string; stdout?: string };
      throw new Error(
        [
          failure.message,
          failure.stdout ? `stdout:\n${failure.stdout}` : '',
          failure.stderr ? `stderr:\n${failure.stderr}` : '',
        ].filter(Boolean).join('\n'),
      );
    }
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
    || !('blended' in value)
    || !('backdropFiltered' in value)
    || !('backgroundBlendPseudo' in value)
    || !('materializedBackgroundBlend' in value)
    || !('nestedBlended' in value)
    || !('normalMaskedPseudo' in value)
    || !('paintOrderedBackdrop' in value)
    || !('alignmentGeometry' in value)
    || typeof value.alignmentGeometry !== 'object'
    || value.alignmentGeometry === null
    || !('supported' in value)
    || !('pseudo' in value)
    || !('replaced' in value)
    || !('replacedForegroundMedia' in value)
    || !Array.isArray(value.replacedForegroundMedia)
    || !value.replacedForegroundMedia.every((item) => typeof item === 'string')
    || !('masked' in value)
    || !('composited' in value)
    || !('compositedMaskedPseudo' in value)
    || !('pseudoLayerOrder' in value)
    || typeof value.pseudoLayerOrder !== 'object'
    || value.pseudoLayerOrder === null
    || !('background' in value.pseudoLayerOrder)
    || typeof value.pseudoLayerOrder.background !== 'number'
    || !('content' in value.pseudoLayerOrder)
    || typeof value.pseudoLayerOrder.content !== 'number'
    || !('rootPseudo' in value)
    || !('rootPseudoLayerOrder' in value)
    || typeof value.rootPseudoLayerOrder !== 'object'
    || value.rootPseudoLayerOrder === null
    || !('background' in value.rootPseudoLayerOrder)
    || typeof value.rootPseudoLayerOrder.background !== 'number'
    || !('content' in value.rootPseudoLayerOrder)
    || typeof value.rootPseudoLayerOrder.content !== 'number'
    || !('slideBackground' in value.rootPseudoLayerOrder)
    || typeof value.rootPseudoLayerOrder.slideBackground !== 'number'
    || !('skippedTargets' in value)
    || typeof value.skippedTargets !== 'number'
    || !('stackingSlide' in value)
  ) {
    throw new Error(`Electron renderer probe returned an invalid result: ${JSON.stringify(value)}`);
  }
  return {
    alignmentGeometry: value.alignmentGeometry as LayeredBackgroundProbe['alignmentGeometry'],
    backdropFiltered: parseLayeredBackgroundExport(value.backdropFiltered),
    backgroundBlendPseudo: parseLayeredBackgroundExport(value.backgroundBlendPseudo),
    blended: parseLayeredBackgroundExport(value.blended),
    composited: parseLayeredBackgroundExport(value.composited),
    compositedMaskedPseudo: parseLayeredBackgroundExport(value.compositedMaskedPseudo),
    masked: parseLayeredBackgroundExport(value.masked),
    materializedBackgroundBlend: parseLayeredBackgroundExport(value.materializedBackgroundBlend),
    nestedBlended: parseLayeredBackgroundExport(value.nestedBlended),
    normalMaskedPseudo: parseLayeredBackgroundExport(value.normalMaskedPseudo),
    paintOrderedBackdrop: parseLayeredBackgroundExport(value.paintOrderedBackdrop),
    pseudo: parseLayeredBackgroundExport(value.pseudo),
    pseudoLayerOrder: {
      background: value.pseudoLayerOrder.background,
      content: value.pseudoLayerOrder.content,
    },
    replaced: parseLayeredBackgroundExport(value.replaced),
    replacedForegroundMedia: value.replacedForegroundMedia,
    rootPseudo: parseLayeredBackgroundExport(value.rootPseudo),
    rootPseudoLayerOrder: {
      background: value.rootPseudoLayerOrder.background,
      content: value.rootPseudoLayerOrder.content,
      slideBackground: value.rootPseudoLayerOrder.slideBackground,
    },
    skippedTargets: value.skippedTargets,
    stackingSlide: parseLayeredBackgroundExport(value.stackingSlide),
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
