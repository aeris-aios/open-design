import { afterEach, describe, expect, test, vi } from 'vitest';

import { runDomToPptx } from '../../src/main/deck-capture.js';

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

function fakeElement(): HTMLElement {
  const attributes = new Map<string, string>();
  return {
    children: [],
    childNodes: [],
    className: '',
    closest: () => null,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    innerText: '',
    parentElement: null,
    prepend: () => undefined,
    querySelectorAll: () => [],
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: new FakeStyle(),
    textContent: '',
  } as unknown as HTMLElement;
}

describe('editable PPTX layered backgrounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('isolates all authored gradient layers for Chromium capture before native conversion', async () => {
    const slide = fakeElement();
    const paper = fakeElement();
    slide.querySelectorAll = ((selector: string) =>
      selector === '*' ? [paper] : []) as unknown as HTMLElement['querySelectorAll'];

    const body = fakeElement();
    const documentElement = fakeElement();
    let layeredBackground: HTMLElement | undefined;
    let exportedLayerBackground = '';
    let exportedPaperBackground = '';
    paper.prepend = ((child: HTMLElement) => {
      layeredBackground = child;
    }) as HTMLElement['prepend'];

    const fakeDocument = {
      body,
      createElement: (tagName: string) => {
        expect(tagName).toBe('od-pptx-layered-background');
        return fakeElement();
      },
      createTreeWalker: () => ({ nextNode: () => null }),
      documentElement,
      querySelectorAll: (selector: string) => selector === '.slide' ? [slide] : selector === '*' ? [slide, paper] : [],
    };

    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('getComputedStyle', (element: HTMLElement) => {
      if (element === paper) {
        return {
          backgroundClip: 'border-box, border-box',
          backgroundColor: 'rgb(248, 246, 241)',
          backgroundImage:
            'linear-gradient(rgba(26, 26, 26, 0.018) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(rgb(248, 246, 241), rgb(248, 246, 241))',
          backgroundOrigin: 'padding-box, padding-box',
          backgroundPosition: '0% 0%, 0% 0%',
          backgroundRepeat: 'repeat, repeat',
          backgroundSize: '100% 44px, 100% 100%',
          fontFamily: 'sans-serif',
          position: 'absolute',
          zIndex: 'auto',
        };
      }
      return {
        backgroundClip: 'border-box',
        backgroundColor: 'transparent',
        backgroundImage: 'none',
        backgroundOrigin: 'padding-box',
        backgroundPosition: '0% 0%',
        backgroundRepeat: 'repeat',
        backgroundSize: 'auto',
        fontFamily: 'sans-serif',
        position: 'relative',
        zIndex: 'auto',
      };
    });
    vi.stubGlobal('Node', class FakeNode { static readonly TEXT_NODE = 3; });
    vi.stubGlobal('NodeFilter', class FakeNodeFilter { static readonly SHOW_TEXT = 4; });
    vi.stubGlobal('window', {
      domToPptx: {
        exportToPptx: async () => {
          exportedPaperBackground = (paper.style as unknown as FakeStyle).getPropertyValue('background-image');
          exportedLayerBackground = (layeredBackground?.style as unknown as FakeStyle).getPropertyValue(
            'background-image',
          );
          return new Blob(['pptx']);
        },
      },
    });

    const result = await runDomToPptx('.slide');

    expect(result.error).toBeUndefined();
    expect(exportedPaperBackground).toBe('none');
    expect(exportedLayerBackground).toBe(
      'linear-gradient(rgba(26, 26, 26, 0.018) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(rgb(248, 246, 241), rgb(248, 246, 241))',
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
    expect(layeredBackground?.getAttribute('data-od-pptx-layered-bg')).toBe('true');
  });
});
