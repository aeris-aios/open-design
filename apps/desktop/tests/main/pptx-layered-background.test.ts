import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { cjkPromotedFontFamily, runDomToPptx } from '../../src/main/deck-capture.js';

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

async function runExport(onExport?: () => void): Promise<void> {
  vi.stubGlobal('window', {
    domToPptx: {
      exportToPptx: async () => {
        onExport?.();
        return new Blob(['pptx']);
      },
    },
  });

  const result = await runDomToPptx('.slide');
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

  test('emits fidelity-preserving PPTX media for layered, pseudo, and masked backgrounds', async () => {
    const media = await probeLayeredBackgroundMedia();

    expect(media.supported).toEqual({ captures: 1, media: [expect.stringMatching(/\.png$/)] });
    expect(media.pseudo).toEqual({ captures: 1, media: [expect.stringMatching(/\.png$/)] });
    expect(media.masked.captures).toBe(0);
    expect(media.masked.media).toContainEqual(expect.stringMatching(/\.svg$/));
  }, 30_000);
});

type LayeredBackgroundProbe = {
  masked: LayeredBackgroundExport;
  pseudo: LayeredBackgroundExport;
  supported: LayeredBackgroundExport;
};

type LayeredBackgroundExport = { captures: number; media: string[] };

async function probeLayeredBackgroundMedia(): Promise<LayeredBackgroundProbe> {
  const probeDir = await mkdtemp(join(tmpdir(), 'od-pptx-layered-probe-'));
  const invocationSource = `(() => {
    const cjkPromotedFontFamily = ${cjkPromotedFontFamily.toString()};
    return (${runDomToPptx.toString()})(".slide");
  })()`;
  await writeFile(join(probeDir, 'package.json'), '{"main":"main.cjs"}\n');
  await writeFile(
    join(probeDir, 'main.cjs'),
    `
const { app, BrowserWindow } = require('electron');
const { readFile } = require('node:fs/promises');
const { gunzipSync } = require('node:zlib');

const fixtures = {
  supported: '<div class="supported"></div>',
  pseudo: '<div class="pseudo"></div>',
  masked: '<div class="masked"></div>',
};
const styles = \`
  html, body { margin: 0; }
  .slide { position: relative; width: 320px; height: 180px; overflow: hidden; background: #111; }
  .supported, .pseudo, .masked { position: absolute; inset: 20px; }
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
\`;

function mediaNames(pptxBase64) {
  const archive = Buffer.from(pptxBase64, 'base64').toString('latin1');
  return [...new Set(archive.match(/ppt\\/media\\/[A-Za-z0-9_-]+\\.(?:gif|jpe?g|png|svg)/g) || [])].sort();
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
    const result = {};
    for (const [name, markup] of Object.entries(fixtures)) {
      await window.webContents.executeJavaScript('document.body.innerHTML = ' + JSON.stringify('<section class="slide">' + markup + '</section>'), true);
      await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
      const exported = await window.webContents.executeJavaScript(${JSON.stringify(invocationSource)}, true);
      if (!exported || exported.error || !exported.b64) throw new Error(exported?.error || 'PPTX export returned no bytes');
      result[name] = {
        captures: await window.webContents.executeJavaScript('document.querySelectorAll("[data-od-pptx-layered-bg]").length', true),
        media: mediaNames(exported.b64),
      };
    }
    process.stdout.write('OD_PPTX_LAYER_PROBE:' + JSON.stringify(result) + '\\n');
  } finally {
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
  ) {
    throw new Error('Electron renderer probe returned an invalid result');
  }
  return {
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
  ) {
    throw new Error('Electron renderer probe returned an invalid export');
  }
  return { captures: value.captures, media: value.media };
}
