import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildManualEditBridge,
  buildManualEditBridgeStyle,
  buildManualEditKeyboardGuard,
  isMeaningfulManualEditElement,
  isManualEditHostNode,
  isSourceMappableManualEditElement,
  manualEditDomPathForElement,
  manualEditKindForElement,
  manualEditStableIdForElement,
} from '../../src/edit-mode/bridge';

type ResizeBridgePost = {
  type?: string;
  id?: string;
  requestId?: string;
  viewport?: string;
  size?: {
    widthPercent?: number | null;
    minHeight?: number | null;
    leftPercent?: number | null;
    topPx?: number | null;
  };
};

function createResizeBridgeHarness(
  viewport: 'desktop' | 'tablet' | 'mobile' = 'desktop',
  options: {
    cardStyle?: string;
    cardRect?: { x: number; y: number; width: number; height: number };
    generation?: string;
  } = {},
) {
  const posts: ResizeBridgePost[] = [];
  const dom = new JSDOM(
    `<main data-od-id="layout" style="position:relative;width:400px;height:400px">
      <section data-od-id="resize-card" style="${options.cardStyle ?? 'width:200px;min-height:100px'}">
        <span data-od-id="resize-copy">Resizable content</span>
      </section>
      <section data-od-id="resize-card-b" style="width:160px;min-height:80px">
        <span data-od-id="resize-copy-b">Second resizable content</span>
      </section>
    </main>${buildManualEditBridge(true, options.generation ?? '')}`,
    { runScripts: 'dangerously', url: 'http://localhost' },
  );
  const layout = dom.window.document.querySelector('[data-od-id="layout"]') as HTMLElement;
  const card = dom.window.document.querySelector('[data-od-id="resize-card"]') as HTMLElement;
  const cardB = dom.window.document.querySelector('[data-od-id="resize-card-b"]') as HTMLElement;
  layout.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 400, height: 400,
    top: 0, right: 400, bottom: 400, left: 0,
    toJSON: () => ({}),
  } as DOMRect);
  card.getBoundingClientRect = () => {
    const rect = options.cardRect ?? { x: 20, y: 20, width: 200, height: 100 };
    return {
      ...rect,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      left: rect.x,
      toJSON: () => ({}),
    } as DOMRect;
  };
  cardB.getBoundingClientRect = () => ({
    x: 20, y: 160, width: 160, height: 80,
    top: 160, right: 180, bottom: 240, left: 20,
    toJSON: () => ({}),
  } as DOMRect);
  dom.window.parent.postMessage = ((message: unknown) => {
    posts.push(message as ResizeBridgePost);
  }) as typeof dom.window.parent.postMessage;

  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    data: {
      type: 'od-edit-mode',
      enabled: true,
      viewport,
      viewportWidth: viewport === 'mobile' ? 390 : 1440,
      viewportHeight: viewport === 'mobile' ? 844 : 900,
    },
  }));
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    data: { type: 'od-edit-selected-target', id: 'resize-card' },
  }));

  const handle = (corner: 'nw' | 'ne' | 'sw' | 'se') => {
    const value = dom.window.document.querySelector(
      `.od-edit-guide-handle[data-od-edit-resize-handle="${corner}"]`,
    );
    expect(value, `missing ${corner} resize handle`).not.toBeNull();
    return value as HTMLElement;
  };
  const pointer = (
    target: EventTarget,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
    x: number,
    y: number,
    options: { shiftKey?: boolean } = {},
  ) => {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      shiftKey: options.shiftKey,
    });
    Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
    target.dispatchEvent(event);
  };

  return { card, cardB, dom, handle, pointer, posts };
}

describe('manual edit bridge target normalization', () => {
  it('prefers explicit data-od-id over generated ids', () => {
    const dom = new JSDOM('<main><h1 data-od-id="hero">Title</h1></main>');
    const target = dom.window.document.querySelector('h1')!;

    expect(manualEditStableIdForElement(target)).toBe('hero');
    expect(target.getAttribute('data-od-runtime-id')).toBeNull();
  });

  it('generates stable DOM path ids for unannotated elements', () => {
    const dom = new JSDOM('<main><section><p>First</p><p>Second</p></section></main>');
    const target = dom.window.document.querySelectorAll('p')[1]!;

    expect(manualEditDomPathForElement(target)).toBe('path-0-0-1');
    expect(manualEditStableIdForElement(target)).toBe('path-0-0-1');
    expect(manualEditStableIdForElement(target)).toBe('path-0-0-1');
    expect(target.getAttribute('data-od-runtime-id')).toBe('path-0-0-1');
  });

  it('generates DOM path ids against source-shaped children, ignoring host shim nodes', () => {
    const dom = new JSDOM(
      '<script data-od-sandbox-shim></script><main><section><p>First</p><p>Second</p></section></main><script data-od-edit-bridge></script>',
    );
    const target = dom.window.document.querySelectorAll('p')[1]!;

    expect(isManualEditHostNode(dom.window.document.querySelector('[data-od-sandbox-shim]')!)).toBe(true);
    expect(manualEditDomPathForElement(target)).toBe('path-0-0-1');
  });

  it('namespaces a generated source path when an authored id owns the same string', () => {
    const dom = new JSDOM(
      '<main data-od-source-path="path-0"><section data-od-id="path-0">Authored identity</section></main>',
    );
    const main = dom.window.document.querySelector('main')!;

    expect(manualEditStableIdForElement(main)).toBe('source-path:path-0');
    expect(manualEditStableIdForElement(dom.window.document.querySelector('section')!)).toBe('path-0');
  });

  it('adds locator namespaces until no authored id can collide with a generated path', () => {
    const dom = new JSDOM(
      '<main data-od-source-path="path-0"><section data-od-id="path-0">Raw owner</section><section data-od-id="source-path:path-0">Locator owner</section></main>',
    );
    const main = dom.window.document.querySelector('main')!;

    expect(manualEditStableIdForElement(main)).toBe('source-path:source-path:path-0');
  });

  it('discovers meaningful elements and ignores tiny or irrelevant elements', () => {
    const dom = new JSDOM('<main><h1 data-od-source-path="path-0-0">Title</h1><script>1</script></main>');
    const title = dom.window.document.querySelector('h1')!;
    const script = dom.window.document.querySelector('script')!;

    expect(isMeaningfulManualEditElement(title, { width: 80, height: 24 })).toBe(true);
    expect(isMeaningfulManualEditElement(title, { width: 3, height: 24 })).toBe(false);
    expect(isMeaningfulManualEditElement(script, { width: 80, height: 24 })).toBe(false);
  });

  it('classifies native and ARIA buttons as navigation actions', () => {
    const dom = new JSDOM('<button>Native</button><div role="button">ARIA</div><span>Copy</span>');

    expect(manualEditKindForElement(dom.window.document.querySelector('button')!)).toBe('action');
    expect(manualEditKindForElement(dom.window.document.querySelector('[role="button"]')!)).toBe('action');
    expect(manualEditKindForElement(dom.window.document.querySelector('span')!)).toBe('text');

    dom.window.close();
  });

  it('keeps source-mappable display:none targets available for the layers panel', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <h1 data-od-source-path="path-0-0">Visible title</h1>
        <section data-od-source-path="path-0-1" style="display:none">
          <p data-od-source-path="path-0-1-0">Hidden author notes</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const visible = dom.window.document.querySelector('h1')!;
    const hiddenSection = dom.window.document.querySelector('section')!;
    const hiddenParagraph = dom.window.document.querySelector('p')!;
    visible.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    hiddenSection.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    hiddenParagraph.getBoundingClientRect = hiddenSection.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.map((target) => target.id)).toEqual([
      'path-0-0',
      'path-0-1',
      'path-0-1-0',
    ]);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-1')?.isHidden).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-1-0')?.isHidden).toBe(true);

    dom.window.close();
  });

  it('treats hidden containers as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="display:none">
          <p data-od-source-path="path-0-0-0">Hidden layout copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const paragraph = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    paragraph.getBoundingClientRect = section.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0');
    const hiddenParagraph = targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(true);
    expect(hiddenParagraph?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('includes computed four-side style values in manual edit targets', async () => {
    const posts: Array<{
      type?: string;
      targets?: Array<{
        id: string;
        styles?: Record<string, string>;
        computedSummary?: Record<string, string>;
      }>;
    }> = [];
    const dom = new JSDOM(
      `<main>
        <section
          data-od-id="card"
          style="padding: 8px 12px 16px 20px; margin: 1px 2px 3px 4px; border: 5px dashed rgb(10, 20, 30); opacity: 0.75"
        >Card</section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const card = dom.window.document.querySelector('[data-od-id="card"]') as HTMLElement;
    card.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 80,
      top: 0, right: 160, bottom: 80, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as (typeof posts)[number]);
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const target = posts.find((message) => message.type === 'od-edit-targets')
      ?.targets?.find((item) => item.id === 'card');
    expect(target?.styles?.paddingTop).toBe('8px');
    expect(target?.styles?.marginLeft).toBe('4px');
    expect(target?.styles?.borderTopWidth).toBe('5px');
    expect(target?.styles?.borderStyle).toBe('dashed');
    expect(target?.styles?.opacity).toBe('0.75');
    expect(target?.computedSummary?.paddingTop).toBe('8px');
    expect(target?.computedSummary?.marginLeft).toBe('4px');
    expect(target?.computedSummary?.borderTopWidth).toBe('5px');
    expect(target?.computedSummary?.borderStyle).toBe('dashed');
    expect(target?.computedSummary?.opacity).toBe('0.75');

    dom.window.close();
  });

  it('does not treat visibility-hidden block containers as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="visibility:hidden">
          <p data-od-source-path="path-0-0-0">Hidden block copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const paragraph = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    paragraph.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 140, height: 20,
      top: 8, right: 148, bottom: 28, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not treat block containers hidden only by an ancestor as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-source-path="path-0-0" style="display:none">
          <section data-od-source-path="path-0-0-0">Nested hidden section</section>
        </div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const wrapper = dom.window.document.querySelector('div')!;
    const section = dom.window.document.querySelector('section')!;
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    section.getBoundingClientRect = wrapper.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not mark visibility:visible descendants as hidden', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="visibility:hidden">
          <p data-od-source-path="path-0-0-0" style="visibility:visible">Visible child copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const visibleChild = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    visibleChild.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 140, height: 20,
      top: 8, right: 148, bottom: 28, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0')?.isHidden).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0')?.isHidden).toBe(false);

    dom.window.close();
  });

  it('does not expose runtime-only path targets unless they carry a source marker', () => {
    const dom = new JSDOM('<main><h1>Runtime title</h1><p data-od-source-path="path-0-1">Source text</p></main>');
    const runtimeTitle = dom.window.document.querySelector('h1')!;
    const sourceText = dom.window.document.querySelector('p')!;

    expect(isSourceMappableManualEditElement(runtimeTitle)).toBe(false);
    expect(isSourceMappableManualEditElement(sourceText)).toBe(true);
    expect(isMeaningfulManualEditElement(runtimeTitle, { width: 80, height: 24 })).toBe(false);
  });

  it('omits selected outerHTML from bulk target posts but includes it for selected targets', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain('targets.push(targetFrom(nodes[i], false))');
    expect(bridge).toContain('targetFrom(el, true)');
    expect(bridge).toContain('if (!isSourceMappable(nodes[i])) continue;');
    expect(bridge).toContain('return el;');
    expect(bridge).not.toContain('if (isPrimaryTarget(el)) return el;');
  });

  it('preserves authored path-shaped ids while stripping generated preview annotations', () => {
    const dom = new JSDOM(
      `<main data-od-id="path-0" data-od-source-path="path-0" data-od-edit-selected="true">
        <span data-od-id="path-0-0" data-od-generated-id="true" data-od-source-path="path-0-0">Copy</span>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const main = dom.window.document.querySelector('main') as HTMLElement;
    main.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 240, height: 80,
      top: 0, right: 240, bottom: 80, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    main.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    const selectMessage = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: { outerHtml?: string } })
      .find((message) => message.type === 'od-edit-select');
    expect(selectMessage?.target?.outerHtml).toContain('data-od-id="path-0"');
    expect(selectMessage?.target?.outerHtml).not.toContain('data-od-id="path-0-0"');
    expect(selectMessage?.target?.outerHtml).not.toContain('data-od-source-path');
    expect(selectMessage?.target?.outerHtml).not.toContain('data-od-generated-id');
    expect(selectMessage?.target?.outerHtml).not.toContain('data-od-edit-selected');

    dom.window.close();
  });

  it('selects and announces ordinary HTML elements after srcdoc source-path annotation', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><section data-od-source-path="path-0-0"><h1 data-od-source-path="path-0-0-0">Plain title</h1><p data-od-source-path="path-0-0-1">Plain body</p></section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 36,
      top: 0, right: 160, bottom: 36, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(title.getAttribute('data-od-runtime-id')).toBe('path-0-0-0');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-hover',
      target: expect.objectContaining({ id: 'path-0-0-0', label: 'Plain title' }),
    }, '*');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({ id: 'path-0-0-0', kind: 'text' }),
    }, '*');

    dom.window.close();
  });

  it('captures edit-mode wheel gestures before artifact deck listeners can navigate slides', () => {
    const posts: unknown[] = [];
    const dom = new JSDOM(
      `${buildManualEditKeyboardGuard()}
      <script>
        window.__artifactWheelCount = 0;
        window.addEventListener('wheel', function(){
          window.__artifactWheelCount += 1;
        }, { capture: true });
      </script>
      <main data-od-source-path="path-0">Deck slide</main>
      ${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message);
    }) as typeof dom.window.parent.postMessage;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-mode',
        enabled: true,
        viewport: 'desktop',
        viewportWidth: 1440,
        viewportHeight: 900,
      },
    }));

    const event = new dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 64,
      clientY: 80,
      deltaY: 120,
    });
    dom.window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect((dom.window as unknown as { __artifactWheelCount: number }).__artifactWheelCount).toBe(0);
    expect(posts).toContainEqual({
      type: 'od-edit-canvas-wheel',
      clientX: 64,
      clientY: 80,
      ctrlKey: true,
      metaKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 120,
    });

    dom.window.close();
  });

  it('promotes a nested label click to its source-mapped button action', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><button data-od-source-path="path-0-0"><svg viewBox="0 0 1 1"></svg><span data-od-source-path="path-0-0-1">Explore</span></button></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const button = dom.window.document.querySelector('button') as HTMLElement;
    const label = dom.window.document.querySelector('span') as HTMLElement;
    button.getBoundingClientRect = () => ({
      x: 8, y: 12, width: 120, height: 40,
      top: 12, right: 128, bottom: 52, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    label.getBoundingClientRect = () => ({
      x: 40, y: 20, width: 64, height: 20,
      top: 20, right: 104, bottom: 40, left: 40,
      toJSON: () => ({}),
    } as DOMRect);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    label.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({ id: 'path-0-0', kind: 'action', tagName: 'button' }),
    }, '*');
    expect(postMessage).not.toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({ id: 'path-0-0-1' }),
    }, '*');

    dom.window.close();
  });

  it('ignores runtime-inserted elements that are not present in source', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Source title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const runtimePill = dom.window.document.createElement('span');
    runtimePill.className = 'status-pill ready';
    runtimePill.textContent = 'Brand ready';
    dom.window.document.body.appendChild(runtimePill);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    runtimePill.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    runtimePill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(runtimePill.hasAttribute('data-od-runtime-id')).toBe(false);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-hover',
    }), '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-background' }, '*');

    dom.window.close();
  });

  it('selects runtime-inserted brand kit elements that carry stable data-od-id markers', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><div id="root"></div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.createElement('h1');
    title.setAttribute('data-od-id', 'brand-name');
    title.setAttribute('data-od-edit', 'text');
    title.textContent = 'Runtime brand';
    title.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 180, height: 42,
      top: 0, right: 180, bottom: 42, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.document.getElementById('root')?.appendChild(title);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-hover',
      target: expect.objectContaining({ id: 'brand-name', label: 'Runtime brand' }),
    }, '*');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({ id: 'brand-name', kind: 'text' }),
    }, '*');

    dom.window.close();
  });

  it('adds stable ids to legacy runtime brand kit elements before selection', () => {
    const dom = new JSDOM(
      `<script id="od-brand-payload" type="application/json">{"brand":{"name":"Runtime brand"}}</script><main data-od-source-path="path-0"><div id="root"></div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.createElement('h1');
    title.className = 'kit-title';
    title.textContent = 'Runtime brand';
    title.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 180, height: 42,
      top: 0, right: 180, bottom: 42, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.document.getElementById('root')?.appendChild(title);
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(title.getAttribute('data-od-id')).toBe('brand-name');
    expect(title.getAttribute('data-od-edit')).toBe('text');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-hover',
      target: expect.objectContaining({ id: 'brand-name', label: 'Runtime brand' }),
    }, '*');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({ id: 'brand-name', kind: 'text' }),
    }, '*');

    dom.window.close();
  });

  it('draws hover reference guides through the hovered element edges without a selection', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer).not.toBeNull();
    const box = layer.querySelector('.od-edit-guide-box-hover') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.left).toBe('10px');
    expect(box.style.top).toBe('20px');
    expect(box.style.width).toBe('160px');
    expect(box.style.height).toBe('36px');
    const verticals = Array.from(
      layer.querySelectorAll('.od-edit-guide-line-v.od-edit-guide-line-reference'),
    ) as HTMLElement[];
    expect(verticals.map((line) => line.style.left)).toEqual(['10px', '170px']);
    const horizontals = Array.from(
      layer.querySelectorAll('.od-edit-guide-line-h.od-edit-guide-line-reference'),
    ) as HTMLElement[];
    expect(horizontals.map((line) => line.style.top)).toEqual(['20px', '56px']);

    dom.window.close();
  });

  it('draws the same element hover guides again after edit mode exits and re-enters', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer.children.length).toBeGreaterThan(0);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    expect(layer.children.length).toBe(0);

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    expect(layer.querySelector('.od-edit-guide-box-hover')).not.toBeNull();

    dom.window.close();
  });

  it('recovers hover guides from pointer movement inside an element after edit mode re-enters', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    expect(layer.children.length).toBe(0);

    // Electron can preserve the iframe's pointer hit target while the toolbar
    // toggles edit mode. In that case movement within the same element emits
    // pointermove but no fresh pointerover.
    title.dispatchEvent(new dom.window.Event('pointermove', { bubbles: true }));
    expect(layer.querySelector('.od-edit-guide-box-hover')).not.toBeNull();

    dom.window.close();
  });

  it('hands same-project HTML links to the host instead of losing the srcDoc edit bridge', () => {
    const posts: Array<{ type?: string; fileName?: string }> = [];
    const dom = new JSDOM(
      `<base href="http://localhost/api/projects/project-1/raw/today.html"><main data-od-source-path="path-0"><a href="discover.html?variant=a">Discover</a></main>${buildManualEditBridge(false)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; fileName?: string });
    }) as typeof dom.window.parent.postMessage;
    const link = dom.window.document.querySelector('a')!;
    const click = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(posts).toContainEqual({
      type: 'od:preview-open-file',
      fileName: 'discover.html',
      search: '?variant=a',
      hash: '',
    });

    dom.window.close();
  });

  it('reports natural document size while editing', async () => {
    const posts: Array<{ type?: string; width?: number; height?: number }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><section data-od-source-path="path-0-0">Long page</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    Object.defineProperty(dom.window.document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2380,
    });
    Object.defineProperty(dom.window.document.body, 'offsetHeight', {
      configurable: true,
      value: 2380,
    });
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; width?: number; height?: number });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));

    expect(posts).toContainEqual(expect.objectContaining({
      type: 'od-edit-document-size',
      height: 2380,
    }));

    dom.window.close();
  });

  it('shrinks an expanded edit viewport to the intrinsic body height without dropping body padding', async () => {
    const posts: Array<{ type?: string; height?: number }> = [];
    const dom = new JSDOM(
      `<body style="margin:0;padding-bottom:100px"><main data-od-source-path="path-0">Long page</main>${buildManualEditBridge(true)}</body>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const root = dom.window.document.documentElement;
    const body = dom.window.document.body;
    const main = dom.window.document.querySelector('main')!;
    Object.defineProperties(root, {
      clientHeight: { configurable: true, value: 3000 },
      scrollHeight: { configurable: true, value: 3000 },
    });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 3000 });
    Object.defineProperty(body, 'offsetHeight', { configurable: true, value: 1100 });
    main.getBoundingClientRect = () => ({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; height?: number });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-mode',
        enabled: true,
        viewportWidth: 1440,
        viewportHeight: 800,
      },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));

    expect(posts).toContainEqual(expect.objectContaining({
      type: 'od-edit-document-size',
      height: 1100,
    }));

    dom.window.close();
  });

  it('freezes authored viewport units before the host expands a long edit artboard', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0" style="min-height:calc(100vh - 140px);width:25vw">Long page</main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const main = dom.window.document.querySelector('main') as HTMLElement;
    // Simulate re-entering Edit after the host already expanded the iframe.
    // The stable design viewport sent by the host must win over innerHeight,
    // otherwise each 100vh section makes the artboard grow again.
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 26000 });
    dom.window.document.documentElement.scrollTop = 120;
    dom.window.document.body.scrollTop = 120;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-mode',
        enabled: true,
        viewportWidth: 1200,
        viewportHeight: 700,
      },
    }));

    expect(main.style.minHeight).toBe('calc(560px)');
    expect(main.style.width).toBe('300px');
    expect(dom.window.document.documentElement.scrollTop).toBe(0);
    expect(dom.window.document.body.scrollTop).toBe(0);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    expect(main.style.minHeight).toBe('calc(100vh - 140px)');
    expect(main.style.width).toBe('25vw');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    expect(main.style.minHeight).toBe('calc(560px)');
    expect(main.style.width).toBe('300px');

    dom.window.close();
  });

  it('hands non-edit button navigation to the host without replacing the bridge iframe', () => {
    const posts: Array<{ type?: string; fileName?: string; search?: string; hash?: string }> = [];
    const dom = new JSDOM(
      `<base href="http://localhost/api/projects/project-1/raw/today.html"><main><button data-od-action="navigate" data-od-href="discover.html?variant=a#work"><span>Discover</span></button></main>${buildManualEditBridge(false)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; fileName?: string; search?: string; hash?: string });
    }) as typeof dom.window.parent.postMessage;
    const label = dom.window.document.querySelector('button span')!;
    const click = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    label.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(posts).toContainEqual({
      type: 'od:preview-open-file',
      fileName: 'discover.html',
      search: '?variant=a',
      hash: '#work',
    });

    dom.window.close();
  });

  it('snaps a dragged element to a structural sibling slot', () => {
    const posts: Array<{ type?: string; id?: string; parentId?: string; beforeId?: string | null; generation?: string; requestId?: string }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0" style="display:grid"><h1 data-od-id="title">Drag me</h1><h2 data-od-id="subtitle">Drop after me</h2></main>${buildManualEditBridge(true, 'preview-generation-1')}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    const subtitle = dom.window.document.querySelector('h2') as HTMLElement;
    const main = dom.window.document.querySelector('main') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36, top: 20, right: 170, bottom: 56, left: 10, toJSON: () => ({}),
    } as DOMRect);
    subtitle.getBoundingClientRect = () => ({
      x: 10, y: 80, width: 160, height: 36, top: 80, right: 170, bottom: 116, left: 10, toJSON: () => ({}),
    } as DOMRect);
    main.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 140, top: 0, right: 200, bottom: 140, left: 0, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [subtitle, main],
    });
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; parentId?: string; beforeId?: string | null; generation?: string; requestId?: string });
    }) as typeof dom.window.parent.postMessage;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      // A later mode replay must not upgrade an old document to a new source
      // generation while its replacement navigation is still pending.
      data: { type: 'od-edit-mode', enabled: true, generation: 'preview-generation-2' },
    }));

    const pointer = (type: string, x: number, y: number) =>
      title.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    pointer('pointerdown', 20, 30);
    pointer('pointermove', 100, 110); // below subtitle center → append after it
    expect(dom.window.document.querySelector('.od-edit-guide-box-drop')).not.toBeNull();
    expect(dom.window.document.querySelector('.od-edit-guide-drop-line')).not.toBeNull();
    pointer('pointerup', 100, 110);

    // The element stays in normal flow while dragging, then moves immediately
    // into the resolved DOM slot while the host persists the same reorder.
    expect(title.style.transform).toBe('');
    expect(Array.from(main.children)).toEqual([subtitle, title]);
    const commit = posts.find((message) => message.type === 'od-edit-drag-commit');
    expect(commit).toEqual(expect.objectContaining({
      type: 'od-edit-drag-commit',
      id: 'title',
      parentId: 'path-0',
      beforeId: null,
      generation: 'preview-generation-1',
      requestId: expect.any(String),
    }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-drag-result', requestId: commit?.requestId, accepted: true },
    }));
    expect(Array.from(main.children)).toEqual([subtitle, title]);

    dom.window.close();
  });

  it('drops a long text row into an empty visual box and removes stale blank-space layout', () => {
    const posts: Array<{ type?: string; id?: string; parentId?: string; requestId?: string }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><p data-od-source-path="path-0-0" style="position:absolute;left:40px;width:720px;height:180px;min-height:120px;margin:48px;padding:24px;transform:translate(20px, 10px);white-space:pre">  Long     text   with     spaces  </p><ul data-od-source-path="path-0-1"><li data-od-source-path="path-0-1-0" style="display:flex"></li></ul></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const text = dom.window.document.querySelector('p') as HTMLElement;
    const box = dom.window.document.querySelector('li') as HTMLElement;
    const main = dom.window.document.querySelector('main') as HTMLElement;
    text.getBoundingClientRect = () => ({
      x: 10, y: 10, width: 240, height: 40, top: 10, right: 250, bottom: 50, left: 10, toJSON: () => ({}),
    } as DOMRect);
    box.getBoundingClientRect = () => ({
      x: 10, y: 90, width: 260, height: 100, top: 90, right: 270, bottom: 190, left: 10, toJSON: () => ({}),
    } as DOMRect);
    main.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 300, height: 220, top: 0, right: 300, bottom: 220, left: 0, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [box, main],
    });
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; parentId?: string; requestId?: string });
    }) as typeof dom.window.parent.postMessage;

    const pointer = (type: string, x: number, y: number) =>
      text.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    pointer('pointerdown', 20, 20);
    pointer('pointermove', 120, 140);
    pointer('pointerup', 120, 140);

    const commit = posts.find((message) => message.type === 'od-edit-drag-commit');
    expect(commit).toEqual(expect.objectContaining({
      id: 'path-0-0',
      parentId: 'path-0-1-0',
      requestId: expect.any(String),
    }));
    expect(text.parentElement).toBe(box);
    expect(text.textContent).toBe('Long text with spaces');
    expect(text.style.position).toBe('static');
    expect(text.style.width).toBe('auto');
    expect(text.style.height).toBe('auto');
    expect(text.style.minHeight).toBe('0px');
    expect(text.style.maxWidth).toBe('100%');
    expect(text.style.margin).toBe('0px');
    expect(text.style.padding).toBe('0px');
    expect(text.style.whiteSpace).toBe('normal');
    expect(text.style.overflowWrap).toBe('anywhere');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-drag-result', requestId: commit?.requestId, accepted: true },
    }));
    // Generated paths remain preview metadata. The host rebuilds the document
    // from the saved source so every node receives a fresh structural path.
    expect(text.hasAttribute('data-od-id')).toBe(false);
    expect(box.hasAttribute('data-od-id')).toBe(false);
    expect(main.hasAttribute('data-od-id')).toBe(false);
    expect(dom.window.document.querySelector('ul')?.hasAttribute('data-od-id')).toBe(false);
    dom.window.close();
  });

  it('skips an incompatible HTML container and snaps to its nearest valid component frame', () => {
    const posts: Array<{ type?: string; id?: string; parentId?: string; beforeId?: string | null; requestId?: string }> = [];
    const dom = new JSDOM(
      `<section data-od-id="frame"><div data-od-id="card">Drag me</div><ul data-od-id="list"><li data-od-id="item">Item</li></ul></section>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const card = dom.window.document.querySelector('[data-od-id="card"]') as HTMLElement;
    const list = dom.window.document.querySelector('[data-od-id="list"]') as HTMLElement;
    const frame = dom.window.document.querySelector('[data-od-id="frame"]') as HTMLElement;
    card.getBoundingClientRect = () => ({
      x: 10, y: 10, width: 180, height: 40, top: 10, right: 190, bottom: 50, left: 10, toJSON: () => ({}),
    } as DOMRect);
    list.getBoundingClientRect = () => ({
      x: 10, y: 70, width: 180, height: 100, top: 70, right: 190, bottom: 170, left: 10, toJSON: () => ({}),
    } as DOMRect);
    frame.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 190, top: 0, right: 200, bottom: 190, left: 0, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [list, frame],
    });
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; parentId?: string; beforeId?: string | null; requestId?: string });
    }) as typeof dom.window.parent.postMessage;

    const pointer = (type: string, x: number, y: number) =>
      card.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    pointer('pointerdown', 20, 20);
    pointer('pointermove', 100, 160);
    pointer('pointerup', 100, 160);

    expect(posts.find((message) => message.type === 'od-edit-drag-commit')).toEqual(expect.objectContaining({
      type: 'od-edit-drag-commit',
      id: 'card',
      parentId: 'frame',
      beforeId: null,
      requestId: expect.any(String),
    }));

    dom.window.close();
  });

  it('rolls an optimistic structural move back when persistence fails', () => {
    const posts: Array<{ type?: string; requestId?: string }> = [];
    const dom = new JSDOM(
      `<main data-od-id="frame"><div data-od-id="first">First</div><div data-od-id="second">Second</div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const frame = dom.window.document.querySelector('main') as HTMLElement;
    const first = dom.window.document.querySelector('[data-od-id="first"]') as HTMLElement;
    const second = dom.window.document.querySelector('[data-od-id="second"]') as HTMLElement;
    first.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 180, height: 40, top: 0, right: 180, bottom: 40, left: 0, toJSON: () => ({}),
    } as DOMRect);
    second.getBoundingClientRect = () => ({
      x: 0, y: 60, width: 180, height: 40, top: 60, right: 180, bottom: 100, left: 0, toJSON: () => ({}),
    } as DOMRect);
    frame.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 180, height: 120, top: 0, right: 180, bottom: 120, left: 0, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [second, frame],
    });
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; requestId?: string });
    }) as typeof dom.window.parent.postMessage;

    const pointer = (type: string, x: number, y: number) =>
      first.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    pointer('pointerdown', 20, 20);
    pointer('pointermove', 90, 95);
    pointer('pointerup', 90, 95);

    const commit = posts.find((message) => message.type === 'od-edit-drag-commit');
    expect(Array.from(frame.children)).toEqual([second, first]);
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-drag-result', requestId: commit?.requestId, accepted: false },
    }));
    expect(Array.from(frame.children)).toEqual([first, second]);

    dom.window.close();
  });

  function createSideDropHarness(markup: string) {
    const posts: Array<{
      type?: string;
      id?: string;
      parentId?: string;
      beforeId?: string | null;
      placement?: string;
      anchorId?: string;
      groupId?: string;
      requestId?: string;
    }> = [];
    const dom = new JSDOM(`${markup}${buildManualEditBridge(true)}`, {
      runScripts: 'dangerously',
      url: 'http://localhost',
    });
    const byId = (id: string) => dom.window.document.querySelector(`[data-od-id="${id}"]`) as HTMLElement;
    const rect = (el: HTMLElement, x: number, y: number, width: number, height: number) => {
      el.getBoundingClientRect = () => ({
        x, y, width, height, top: y, right: x + width, bottom: y + height, left: x, toJSON: () => ({}),
      } as DOMRect);
    };
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as (typeof posts)[number]);
    }) as typeof dom.window.parent.postMessage;
    const drag = (el: HTMLElement, from: [number, number], to: [number, number]) => {
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
      pointer('pointerdown', from[0], from[1]);
      pointer('pointermove', to[0], to[1]);
      pointer('pointerup', to[0], to[1]);
    };
    return { byId, dom, drag, posts, rect };
  }

  it('creates a horizontal group when dropping on the right side of a vertical sibling', () => {
    const harness = createSideDropHarness(
      '<main data-od-id="frame"><div data-od-id="first">First</div><div data-od-id="second">Second</div></main>',
    );
    const frame = harness.byId('frame');
    const first = harness.byId('first');
    const second = harness.byId('second');
    harness.rect(frame, 0, 0, 180, 120);
    harness.rect(first, 0, 0, 180, 40);
    harness.rect(second, 0, 60, 180, 40);
    Object.defineProperty(harness.dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [second, frame],
    });

    // Right outer third of the anchor row (x ≥ 120 of its 180px width).
    harness.drag(first, [20, 20], [170, 80]);
    const commit = harness.posts.find((message) => message.type === 'od-edit-drag-commit');
    expect(commit).toEqual(expect.objectContaining({
      type: 'od-edit-drag-commit',
      id: 'first',
      parentId: 'frame',
      beforeId: null,
      placement: 'right',
      anchorId: 'second',
      groupId: expect.stringMatching(/^od-group-/),
      requestId: expect.any(String),
    }));

    // The optimistic preview already shows the horizontal group.
    const group = frame.firstElementChild as HTMLElement;
    expect(group.tagName).toBe('DIV');
    expect(group.getAttribute('data-od-id')).toBe(commit?.groupId);
    expect(group.getAttribute('style')).toBe('display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px');
    expect(Array.from(frame.children)).toEqual([group]);
    expect(Array.from(group.children)).toEqual([second, first]);

    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: { type: 'od-edit-drag-result', requestId: commit?.requestId, accepted: true },
    }));
    expect(Array.from(group.children)).toEqual([second, first]);
    harness.dom.window.close();
  });

  it('rolls a rejected side-group drop back to the original vertical structure', () => {
    const harness = createSideDropHarness(
      '<main data-od-id="frame"><div data-od-id="first">First</div><div data-od-id="second">Second</div></main>',
    );
    const frame = harness.byId('frame');
    const first = harness.byId('first');
    const second = harness.byId('second');
    harness.rect(frame, 0, 0, 180, 120);
    harness.rect(first, 0, 0, 180, 40);
    harness.rect(second, 0, 60, 180, 40);
    Object.defineProperty(harness.dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [second, frame],
    });

    // Left outer third of the anchor row (x ≤ 60 of its 180px width).
    harness.drag(first, [90, 20], [30, 80]);
    const commit = harness.posts.find((message) => message.type === 'od-edit-drag-commit');
    expect(commit).toEqual(expect.objectContaining({ placement: 'left', anchorId: 'second' }));
    const group = frame.firstElementChild as HTMLElement;
    expect(Array.from(group.children)).toEqual([first, second]);

    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: { type: 'od-edit-drag-result', requestId: commit?.requestId, accepted: false },
    }));
    expect(Array.from(frame.children)).toEqual([first, second]);
    expect(first.getAttribute('style')).toBeNull();
    expect(harness.dom.window.document.querySelector(`[data-od-id="${commit?.groupId}"]`)).toBeNull();
    harness.dom.window.close();
  });

  it('keeps vertical insertion for side pointers where a wrapper div would be invalid HTML', () => {
    const harness = createSideDropHarness(
      '<ul data-od-id="list"><li data-od-id="item-a">A</li><li data-od-id="item-b">B</li></ul>',
    );
    const list = harness.byId('list');
    const itemA = harness.byId('item-a');
    const itemB = harness.byId('item-b');
    harness.rect(list, 0, 0, 180, 140);
    harness.rect(itemA, 0, 10, 180, 40);
    harness.rect(itemB, 0, 60, 180, 40);
    Object.defineProperty(harness.dom.window.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [itemB, list],
    });

    // Right outer third of the sibling row, but list items cannot be wrapped.
    harness.drag(itemA, [20, 20], [170, 85]);
    const commit = harness.posts.find((message) => message.type === 'od-edit-drag-commit');
    expect(commit).toEqual(expect.objectContaining({
      id: 'item-a',
      parentId: 'list',
      beforeId: null,
    }));
    expect(commit?.placement).toBeUndefined();
    expect(Array.from(list.children)).toEqual([itemB, itemA]);
    harness.dom.window.close();
  });

  it('treats a sub-threshold press as a click, not a drag (no transform, no commit)', () => {
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Tap me</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36, top: 20, right: 170, bottom: 56, left: 10, toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    const pointer = (type: string, x: number, y: number) =>
      title.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 102, 101); // 2px — under the threshold
    pointer('pointerup', 102, 101);

    expect(title.style.transform).toBe('');
    expect(posts.some((message) => message.type === 'od-edit-drag-commit')).toBe(false);

    dom.window.close();
  });

  it('clears hover reference guides when the pointer leaves all targets', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer.children.length).toBeGreaterThan(0);

    dom.window.document.body.dispatchEvent(new dom.window.Event('pointermove', { bubbles: true }));
    expect(layer.children.length).toBe(0);

    dom.window.close();
  });

  it('clears hover reference guides on the host hover-reset signal', () => {
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer.children.length).toBeGreaterThan(0);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-hover-reset' },
    }));
    expect(layer.children.length).toBe(0);

    dom.window.close();
  });

  it('restores the last hover reference guides for capture via od-edit-guides-restore', () => {
    const posts: Array<{ type?: string; id?: string | null; restored?: boolean }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string | null; restored?: boolean });
    }) as typeof dom.window.parent.postMessage;

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-hover-reset' } }));
    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer.children.length).toBe(0);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-guides-restore', id: 'cap-1', maxAgeMs: 60000 },
    }));

    expect(layer.querySelectorAll('.od-edit-guide-line-reference').length).toBe(4);
    expect(layer.querySelector('.od-edit-guide-box-hover')).not.toBeNull();
    const result = posts.find((message) => message.type === 'od-edit-guides-restore:result');
    // Restored from memory (hover already cleared) → not live: the host owes
    // a post-capture hover-reset.
    expect(result).toMatchObject({ id: 'cap-1', restored: true, live: false });

    // The host's post-capture hover-reset must clear the restored guides again.
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-hover-reset' } }));
    expect(layer.children.length).toBe(0);

    dom.window.close();
  });

  it('does not restore guides when the hover memory is older than maxAgeMs', async () => {
    const posts: Array<{ type?: string; restored?: boolean }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; restored?: boolean });
    }) as typeof dom.window.parent.postMessage;

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'od-edit-hover-reset' } }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-guides-restore', maxAgeMs: 5 },
    }));

    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer.children.length).toBe(0);
    const result = posts.find((message) => message.type === 'od-edit-guides-restore:result');
    expect(result).toMatchObject({ restored: false });

    dom.window.close();
  });

  it('reports restored:false when no hover ever happened', () => {
    const posts: Array<{ type?: string; restored?: boolean }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; restored?: boolean });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-guides-restore', maxAgeMs: 60000 },
    }));

    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]');
    expect(layer?.children.length ?? 0).toBe(0);
    const result = posts.find((message) => message.type === 'od-edit-guides-restore:result');
    expect(result).toMatchObject({ restored: false });

    dom.window.close();
  });

  it('re-renders guides on restore while a hover is still live', () => {
    const posts: Array<{ type?: string; restored?: boolean }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('h1') as HTMLElement;
    title.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 160, height: 36,
      top: 20, right: 170, bottom: 56, left: 10,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; restored?: boolean });
    }) as typeof dom.window.parent.postMessage;

    title.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-guides-restore', maxAgeMs: 60000 },
    }));

    const layer = dom.window.document.querySelector('[data-od-edit-guides-layer]')!;
    expect(layer.querySelectorAll('.od-edit-guide-line-reference').length).toBe(4);
    const result = posts.find((message) => message.type === 'od-edit-guides-restore:result');
    // Hover is still active → live: the host must NOT clear the guides after
    // the capture or they'd vanish under the stationary cursor.
    expect(result).toMatchObject({ restored: true, live: true });

    dom.window.close();
  });

  it('posts the screenshot hotkey on a double Command tap but not on the both-Metas chord', () => {
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main data-od-source-path="path-0"><h1 data-od-source-path="path-0-0">Plain title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;
    // Real key events target the focused element and pass documentElement on
    // the way — the detector deliberately sits there to escape the keyboard
    // guard's window/document wrapping, so dispatch from <body>, not window.
    const keydown = (key: string, code: string) =>
      dom.window.document.body.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, code, bubbles: true }),
      );
    const keyup = (code: string) =>
      dom.window.document.body.dispatchEvent(
        new dom.window.KeyboardEvent('keyup', { key: 'Meta', code, bubbles: true }),
      );

    // Both-Metas chord (module capture gesture) must NOT fire the hotkey.
    keydown('Meta', 'MetaLeft');
    keydown('Meta', 'MetaRight');
    keyup('MetaLeft');
    keyup('MetaRight');
    expect(posts.some((message) => message.type === 'od-edit-screenshot-hotkey')).toBe(false);

    // A Meta chord like ⌘C cancels the pending tap.
    keydown('Meta', 'MetaLeft');
    keydown('c', 'KeyC');
    keyup('MetaLeft');
    keydown('Meta', 'MetaLeft');
    keyup('MetaLeft');
    expect(posts.some((message) => message.type === 'od-edit-screenshot-hotkey')).toBe(false);

    // Clear the pending tap left by the block above before the real gesture.
    keydown('Escape', 'Escape');

    // Two quick bare taps fire exactly once.
    keydown('Meta', 'MetaLeft');
    keyup('MetaLeft');
    keydown('Meta', 'MetaLeft');
    keyup('MetaLeft');
    expect(posts.filter((message) => message.type === 'od-edit-screenshot-hotkey').length).toBe(1);

    dom.window.close();
  });

  it('prefers the deepest source-mapped child over an annotated group on hover', async () => {
    const posts: Array<{ type?: string; target?: { id: string; label?: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero-group">
          <span data-od-source-path="path-0-0-0">Small label</span>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const span = dom.window.document.querySelector('span')!;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string; label?: string } });
    }) as typeof dom.window.parent.postMessage;

    span.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    const hover = posts.find((message) => message.type === 'od-edit-hover');
    expect(hover?.target?.id).toBe('path-0-0-0');
    expect(hover?.target?.label).toBe('Small label');

    dom.window.close();
  });

  it('acks live preview style patches by id and version', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain("type: 'od-edit-preview-style-applied'");
    expect(bridge).toContain('version: Number(version) || 0, ok: true');
    expect(bridge).toContain("ok: false, error: 'Target not found'");
  });

  it('renders selection chrome through the guides layer instead of element outlines', () => {
    const style = buildManualEditBridgeStyle();

    // Hover/selection feedback moved off per-element outlines (which artifact
    // CSS resets could override) and onto a fixed, top-of-stack guides layer.
    expect(style).toContain('html[data-od-edit-mode] [data-od-edit-selected] {\n  outline: none !important;');
    expect(style).toContain(
      'html[data-od-edit-mode] [data-od-edit-dragging="true"],\n'
      + 'html[data-od-edit-mode] [data-od-edit-dragging="true"] * {\n'
      + '  cursor: grabbing !important;',
    );
    expect(style).toContain('[data-od-edit-guides-layer] {');
    expect(style).toContain('z-index: 2147483646');
    expect(style).toContain('pointer-events: none');
    expect(style).toContain('[data-od-edit-guides-layer] .od-edit-guide-box-hover');
    expect(style).toContain('[data-od-edit-guides-layer] .od-edit-guide-box-selected');
    expect(style).toContain('[data-od-edit-guides-layer] .od-edit-guide-box-drop');
    expect(style).toContain('[data-od-edit-guides-layer] .od-edit-guide-drop-line');
    expect(style).toContain('[data-od-edit-guides-layer] .od-edit-guide-handle');
    expect(style).toContain('.od-edit-guide-handle[data-od-edit-resize-handle] {');
    expect(style).toContain('pointer-events: auto');
    expect(style).toContain('touch-action: none');
    expect(style).toContain('[data-od-edit-guides-layer] .od-edit-guide-measure');
  });

  it('offers exactly four interactive corner handles for a source-mapped container', () => {
    const { dom } = createResizeBridgeHarness();
    const handles = Array.from(dom.window.document.querySelectorAll(
      '.od-edit-guide-handle[data-od-edit-resize-handle]',
    ));

    expect(handles.map((handle) => handle.getAttribute('data-od-edit-resize-handle')).sort()).toEqual([
      'ne',
      'nw',
      'se',
      'sw',
    ]);
    expect(dom.window.document.querySelectorAll('.od-edit-guide-handle')).toHaveLength(4);

    dom.window.close();

    const inline = createResizeBridgeHarness('desktop', {
      cardStyle: 'display:inline;width:200px;min-height:100px',
    });
    expect(inline.dom.window.document.querySelectorAll('.od-edit-guide-handle')).toHaveLength(0);
    expect(inline.dom.window.document.querySelector('.od-edit-guide-box-selected')).not.toBeNull();
    inline.dom.window.close();
  });

  it('resizes freely by default, preserves ratio with Shift, and commits each gesture once', async () => {
    const free = createResizeBridgeHarness('mobile', { generation: 'resize-generation-1' });
    const freeHandle = free.handle('se');
    free.pointer(freeHandle, 'pointerdown', 220, 120);
    free.pointer(free.dom.window.document, 'pointermove', 260, 150);
    free.pointer(free.dom.window.document, 'pointermove', 260, 150);
    await new Promise((resolve) => free.dom.window.setTimeout(resolve, 20));
    expect(free.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).not.toBeNull();
    free.pointer(free.dom.window.document, 'pointerup', 260, 150);
    // A duplicate release from a capture boundary must not create a second save.
    free.pointer(free.dom.window.document, 'pointerup', 260, 150);

    const freeCommits = free.posts.filter((post) => post.type === 'od-edit-resize-commit');
    expect(freeCommits).toHaveLength(1);
    expect(freeCommits[0]).toEqual(expect.objectContaining({
      id: 'resize-card',
      generation: 'resize-generation-1',
      requestId: expect.any(String),
      viewport: 'mobile',
      size: expect.objectContaining({
        widthPercent: 60,
        minHeight: 130,
      }),
    }));
    expect(freeCommits[0]?.size).not.toHaveProperty('leftPercent');
    expect(freeCommits[0]?.size).not.toHaveProperty('topPx');
    expect(free.posts.some((post) => post.type === 'od-edit-drag-commit')).toBe(false);

    free.dom.window.dispatchEvent(new free.dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-resize-result',
        requestId: freeCommits[0]?.requestId,
        accepted: true,
      },
    }));
    // The retained iframe keeps the accepted viewport rule live until an
    // intentional reload rebuilds it from the newly persisted source.
    expect(free.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).not.toBeNull();
    free.dom.window.close();

    const proportional = createResizeBridgeHarness();
    const proportionalHandle = proportional.handle('se');
    proportional.pointer(proportionalHandle, 'pointerdown', 220, 120);
    proportional.pointer(proportional.dom.window.document, 'pointermove', 280, 140, { shiftKey: true });
    proportional.pointer(proportional.dom.window.document, 'pointerup', 280, 140, { shiftKey: true });

    const proportionalCommit = proportional.posts.find((post) => post.type === 'od-edit-resize-commit');
    expect(proportionalCommit).toEqual(expect.objectContaining({
      viewport: 'desktop',
      size: expect.objectContaining({
        widthPercent: expect.any(Number),
        minHeight: expect.any(Number),
      }),
    }));
    const proportionalWidthPx = (proportionalCommit?.size?.widthPercent ?? 0) * 4;
    expect(proportionalWidthPx / (proportionalCommit?.size?.minHeight ?? 1)).toBeCloseTo(2, 5);
    proportional.dom.window.close();

    const rounded = createResizeBridgeHarness();
    const roundedHandle = rounded.handle('se');
    rounded.pointer(roundedHandle, 'pointerdown', 220, 120);
    rounded.pointer(rounded.dom.window.document, 'pointermove', 253.337, 147.6);
    rounded.pointer(rounded.dom.window.document, 'pointerup', 253.337, 147.6);
    expect(rounded.posts.find((post) => post.type === 'od-edit-resize-commit')?.size).toEqual(
      expect.objectContaining({
        widthPercent: 58.33,
        minHeight: 128,
      }),
    );
    rounded.dom.window.close();
  });

  it('clamps both dimensions to 16px and rolls previews back on cancel or a failed save', async () => {
    const minimum = createResizeBridgeHarness();
    const minimumHandle = minimum.handle('se');
    minimum.pointer(minimumHandle, 'pointerdown', 220, 120);
    minimum.pointer(minimum.dom.window.document, 'pointermove', -100, -100);
    minimum.pointer(minimum.dom.window.document, 'pointerup', -100, -100);
    const minimumCommit = minimum.posts.find((post) => post.type === 'od-edit-resize-commit');
    expect(minimumCommit?.size).toEqual(expect.objectContaining({
      widthPercent: 4,
      minHeight: 16,
    }));
    minimum.dom.window.close();

    const cancelled = createResizeBridgeHarness();
    const cancelledHandle = cancelled.handle('sw');
    cancelled.pointer(cancelledHandle, 'pointerdown', 20, 120);
    cancelled.pointer(cancelled.dom.window.document, 'pointermove', 60, 150);
    await new Promise((resolve) => cancelled.dom.window.setTimeout(resolve, 20));
    expect(cancelled.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).not.toBeNull();
    cancelled.pointer(cancelled.dom.window.document, 'pointercancel', 60, 150);
    expect(cancelled.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).toBeNull();
    expect(cancelled.posts.some((post) => post.type === 'od-edit-resize-commit')).toBe(false);
    cancelled.dom.window.close();

    const rejected = createResizeBridgeHarness();
    const originalStyle = rejected.card.getAttribute('style');
    const rejectedHandle = rejected.handle('ne');
    rejected.pointer(rejectedHandle, 'pointerdown', 220, 20);
    rejected.pointer(rejected.dom.window.document, 'pointermove', 260, 0);
    rejected.pointer(rejected.dom.window.document, 'pointerup', 260, 0);
    const rejectedCommit = rejected.posts.find((post) => post.type === 'od-edit-resize-commit');
    expect(rejectedCommit?.requestId).toEqual(expect.any(String));
    expect(rejected.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).not.toBeNull();

    rejected.dom.window.dispatchEvent(new rejected.dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-resize-result',
        requestId: rejectedCommit?.requestId,
        accepted: false,
      },
    }));
    expect(rejected.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).toBeNull();
    expect(rejected.card.getAttribute('style')).toBe(originalStyle);
    rejected.dom.window.close();
  });

  it('persists position only for absolute modules and clears opposing preview insets', () => {
    const absolute = createResizeBridgeHarness('desktop', {
      cardStyle: 'position:absolute;left:20px;top:20px;width:200px;min-height:100px',
    });
    const absoluteHandle = absolute.handle('nw');
    absolute.pointer(absoluteHandle, 'pointerdown', 20, 20);
    absolute.pointer(absolute.dom.window.document, 'pointermove', 40, 50);
    absolute.pointer(absolute.dom.window.document, 'pointerup', 40, 50);

    expect(absolute.posts.find((post) => post.type === 'od-edit-resize-commit')?.size).toEqual({
      widthPercent: 45,
      minHeight: 70,
      leftPercent: 10,
      topPx: 50,
    });
    const absolutePreview = absolute.dom.window.document.querySelector(
      'style[data-od-responsive-size-preview]',
    )?.textContent ?? '';
    expect(absolutePreview).toContain('left:10% !important;right:auto !important');
    expect(absolutePreview).toContain('top:50px !important;bottom:auto !important');
    absolute.dom.window.close();

    const negativeTop = createResizeBridgeHarness('desktop', {
      cardStyle: 'position:absolute;left:20px;top:-20px;width:200px;min-height:100px',
      cardRect: { x: 20, y: -20, width: 200, height: 100 },
    });
    const negativeTopHandle = negativeTop.handle('ne');
    negativeTop.pointer(negativeTopHandle, 'pointerdown', 220, -20);
    negativeTop.pointer(negativeTop.dom.window.document, 'pointermove', 240, -40);
    negativeTop.pointer(negativeTop.dom.window.document, 'pointerup', 240, -40);
    const negativeTopCommit = negativeTop.posts.find((post) => post.type === 'od-edit-resize-commit');
    expect(negativeTopCommit?.size?.topPx).toBe(-40);
    expect(negativeTop.dom.window.document.querySelector(
      'style[data-od-responsive-size-preview]',
    )?.textContent).toContain('top:-40px !important;bottom:auto !important');
    negativeTop.dom.window.close();

    const relative = createResizeBridgeHarness('desktop', {
      cardStyle: 'position:relative;left:20px;top:20px;width:200px;min-height:100px',
    });
    const relativeHandle = relative.handle('nw');
    relative.pointer(relativeHandle, 'pointerdown', 20, 20);
    relative.pointer(relative.dom.window.document, 'pointermove', 40, 50);
    relative.pointer(relative.dom.window.document, 'pointerup', 40, 50);
    const relativeSize = relative.posts.find((post) => post.type === 'od-edit-resize-commit')?.size;
    expect(relativeSize).not.toHaveProperty('leftPercent');
    expect(relativeSize).not.toHaveProperty('topPx');
    relative.dom.window.close();
  });

  it('isolates accepted preview rules by target and viewport when another resize rolls back', async () => {
    const harness = createResizeBridgeHarness('mobile');

    const firstHandle = harness.handle('se');
    harness.pointer(firstHandle, 'pointerdown', 220, 120);
    harness.pointer(harness.dom.window.document, 'pointermove', 260, 150);
    harness.pointer(harness.dom.window.document, 'pointerup', 260, 150);
    const firstCommit = harness.posts.find((post) => post.type === 'od-edit-resize-commit');
    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-resize-result',
        requestId: firstCommit?.requestId,
        accepted: true,
      },
    }));

    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'resize-card-b' },
    }));
    const secondHandle = harness.handle('se');
    harness.pointer(secondHandle, 'pointerdown', 180, 240);
    harness.pointer(harness.dom.window.document, 'pointermove', 200, 260);
    harness.pointer(harness.dom.window.document, 'pointerup', 200, 260);
    const commits = harness.posts.filter((post) => post.type === 'od-edit-resize-commit');
    const secondCommit = commits[1];
    let preview = harness.dom.window.document.querySelector(
      'style[data-od-responsive-size-preview]',
    )?.textContent ?? '';
    expect(preview).toContain('[data-od-id="resize-card"]');
    expect(preview).toContain('[data-od-id="resize-card-b"]');

    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-resize-result',
        requestId: secondCommit?.requestId,
        accepted: false,
      },
    }));
    preview = harness.dom.window.document.querySelector(
      'style[data-od-responsive-size-preview]',
    )?.textContent ?? '';
    expect(preview).toContain('[data-od-id="resize-card"]');
    expect(preview).not.toContain('[data-od-id="resize-card-b"]');

    // A cancelled live gesture for B restores only B's key as well.
    const cancelledHandle = harness.handle('se');
    harness.pointer(cancelledHandle, 'pointerdown', 180, 240);
    harness.pointer(harness.dom.window.document, 'pointermove', 190, 250);
    await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20));
    harness.pointer(harness.dom.window.document, 'pointercancel', 190, 250);
    preview = harness.dom.window.document.querySelector(
      'style[data-od-responsive-size-preview]',
    )?.textContent ?? '';
    expect(preview).toContain('[data-od-id="resize-card"]');
    expect(preview).not.toContain('[data-od-id="resize-card-b"]');

    // The same target in desktop is a separate key from its accepted mobile
    // rule, so both gates remain live in the retained iframe.
    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-mode',
        enabled: true,
        viewport: 'desktop',
        viewportWidth: 1440,
        viewportHeight: 900,
      },
    }));
    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'resize-card' },
    }));
    const desktopHandle = harness.handle('se');
    harness.pointer(desktopHandle, 'pointerdown', 220, 120);
    harness.pointer(harness.dom.window.document, 'pointermove', 240, 140);
    harness.pointer(harness.dom.window.document, 'pointerup', 240, 140);
    const desktopCommit = harness.posts.filter((post) => post.type === 'od-edit-resize-commit').at(-1);
    harness.dom.window.dispatchEvent(new harness.dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-resize-result',
        requestId: desktopCommit?.requestId,
        accepted: true,
      },
    }));
    preview = harness.dom.window.document.querySelector(
      'style[data-od-responsive-size-preview]',
    )?.textContent ?? '';
    expect(preview).toContain('html[data-od-edit-viewport="mobile"] [data-od-id="resize-card"]');
    expect(preview).toContain('html[data-od-edit-viewport="desktop"] [data-od-id="resize-card"]');

    harness.dom.window.close();
  });

  it('rolls a live resize back on Escape without posting a resize or structural commit', async () => {
    const harness = createResizeBridgeHarness();
    const handle = harness.handle('nw');
    harness.pointer(handle, 'pointerdown', 20, 20);
    harness.pointer(harness.dom.window.document, 'pointermove', 40, 50);
    await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20));
    expect(harness.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).not.toBeNull();

    harness.dom.window.document.documentElement.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }));

    expect(harness.dom.window.document.querySelector('style[data-od-responsive-size-preview]')).toBeNull();
    expect(harness.posts.some((post) => post.type === 'od-edit-resize-commit')).toBe(false);
    expect(harness.posts.some((post) => post.type === 'od-edit-drag-commit')).toBe(false);
    harness.dom.window.close();
  });

  it('moves the runtime selected marker between selected targets', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <p data-od-id="body">Body</p>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]')!;
    const body = dom.window.document.querySelector('[data-od-id="body"]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'title' },
    }));
    expect(title.getAttribute('data-od-edit-selected')).toBe('true');
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));
    expect(title.hasAttribute('data-od-edit-selected')).toBe(false);
    expect(body.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.close();
  });

  it('clears runtime selected markers for null selection and edit-mode exit', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <p data-od-id="body" data-od-edit-selected="true">Body</p>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const body = dom.window.document.querySelector('[data-od-id="body"]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: null },
    }));
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));
    expect(body.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.close();
  });

  it('keeps runtime selection marker out of source-shaped target data', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain("attr.name === 'data-od-edit-selected'");
    expect(bridge).toContain("node.removeAttribute('data-od-edit-selected')");
    expect(bridge).toContain('[data-od-edit-selected]');
  });

  it('marks flex/grid targets as layout containers', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain('isLayoutContainer: isLayoutContainer(el)');
    expect(bridge).toContain("display.indexOf('flex') >= 0 || display.indexOf('grid') >= 0");
  });

  it('turns text targets into inline editors and commits changed text on explicit finish', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(title.getAttribute('data-od-editing')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'title',
        kind: 'text',
      }),
    }, '*');

    title.textContent = 'Edited title';

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-text-finish', commit: true },
    }));

    expect(title.hasAttribute('contenteditable')).toBe(false);
    expect(title.hasAttribute('data-od-editing')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'title',
      value: 'Edited title',
    }, '*');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-session',
      id: 'title',
      active: false,
      committed: true,
      changed: true,
    }, '*');

    dom.window.close();
  });

  it('forwards a pinch from a selected inline editor to the canvas', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 16,
    }));
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    postMessage.mockClear();

    const pinch = new dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 40,
      clientY: 48,
      deltaY: -24,
    });
    title.dispatchEvent(pinch);

    expect(pinch.defaultPrevented).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-canvas-wheel',
      clientX: 40,
      clientY: 48,
      ctrlKey: true,
      metaKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: -24,
    }, '*');

    postMessage.mockClear();
    const commandWheel = new dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      clientX: 44,
      clientY: 52,
      deltaY: 32,
    });
    title.dispatchEvent(commandWheel);

    expect(commandWheel.defaultPrevented).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-canvas-wheel',
      clientX: 44,
      clientY: 52,
      ctrlKey: false,
      metaKey: true,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 32,
    }, '*');

    dom.window.close();
  });

  // #3646 focus-loss half: once editing, blurring the iframe (e.g. moving the
  // pointer to the host's floating inspector) must NOT end the session or
  // commit. Only an explicit finish (Enter/Escape/od-edit-text-finish) commits.
  it('keeps the inline edit active on blur and commits only on explicit finish', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    title.textContent = 'Edited title';
    title.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    // Blur is no longer a commit trigger — the session stays live.
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(title.getAttribute('data-od-editing')).toBe('true');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-text-commit',
    }), '*');

    // The host drives the commit explicitly.
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-text-finish', commit: true },
    }));

    expect(title.hasAttribute('contenteditable')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'title',
      value: 'Edited title',
    }, '*');

    dom.window.close();
  });

  // #3646 / review fix: clicking empty background while editing must commit and
  // end the session (and tell the host), so host and iframe never desync.
  it('commits an in-flight inline edit when clicking empty background', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    title.textContent = 'Edited';
    dom.window.document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'title',
      value: 'Edited',
    }, '*');
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-text-session',
      id: 'title',
      active: false,
    }), '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-background' }, '*');
    expect(title.hasAttribute('contenteditable')).toBe(false);

    dom.window.close();
  });

  it('cancels inline text edits with Escape without posting a commit', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="body">Original body</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const body = dom.window.document.querySelector('[data-od-id="body"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    body.textContent = 'Draft body';
    body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));

    expect(body.textContent).toBe('Original body');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-text-commit',
    }), '*');

    dom.window.close();
  });

  it('delegates Command/Ctrl+Z from the non-editable iframe canvas to the host', () => {
    const dom = new JSDOM(
      `<main data-od-id="canvas">Canvas</main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const canvas = dom.window.document.querySelector('main')!;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    for (const modifier of ['metaKey', 'ctrlKey'] as const) {
      postMessage.mockClear();
      const event = new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'z',
        [modifier]: true,
      });
      canvas.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-undo-hotkey' }, '*');
    }

    dom.window.close();
  });

  it('skips an unchanged inline text session but preserves native undo after typing or in form controls', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="body">Original body</p><textarea>Draft</textarea></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const paragraph = dom.window.document.querySelector('[data-od-id="body"]') as HTMLElement;
    const textarea = dom.window.document.querySelector('textarea') as HTMLTextAreaElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    paragraph.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    postMessage.mockClear();
    const unchangedInlineUndo = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      metaKey: true,
    });
    paragraph.dispatchEvent(unchangedInlineUndo);
    expect(unchangedInlineUndo.defaultPrevented).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-text-session',
      active: false,
      changed: false,
    }), '*');
    expect(postMessage).toHaveBeenCalledWith({ type: 'od-edit-undo-hotkey' }, '*');

    paragraph.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    paragraph.textContent = 'Changed body';
    postMessage.mockClear();
    const changedInlineUndo = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      metaKey: true,
    });
    paragraph.dispatchEvent(changedInlineUndo);
    expect(changedInlineUndo.defaultPrevented).toBe(false);
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'od-edit-undo-hotkey' }, '*');

    textarea.focus();
    const textareaUndo = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      metaKey: true,
    });
    textarea.dispatchEvent(textareaUndo);
    expect(textareaUndo.defaultPrevented).toBe(false);
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'od-edit-undo-hotkey' }, '*');

    dom.window.close();
  });

  it('removes a window keydown listener registered with the original callback, so the wrapper is not left firing', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();

    dom.window.addEventListener('keydown', listener);
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);

    dom.window.removeEventListener('keydown', listener);
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);

    dom.window.close();
  });

  it('removes a document keydown listener registered with the original callback, so the wrapper is not left firing', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();

    dom.window.document.addEventListener('keydown', listener);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);

    dom.window.document.removeEventListener('keydown', listener);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);

    dom.window.close();
  });

  it('treats duplicate addEventListener with the same callback and capture as a no-op, matching native behavior', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();

    dom.window.addEventListener('keydown', listener, true);
    dom.window.addEventListener('keydown', listener, true); // duplicate — should be no-op
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1); // fires once, not twice

    dom.window.removeEventListener('keydown', listener, true); // single remove clears it
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1); // no longer fires

    dom.window.close();
  });

  it('matches the capture flag when removing a wrapped keydown listener', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const bubbleListener = vi.fn();
    const captureListener = vi.fn();

    dom.window.addEventListener('keydown', bubbleListener, false);
    dom.window.addEventListener('keydown', captureListener, true);

    dom.window.removeEventListener('keydown', bubbleListener, false);
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(bubbleListener).not.toHaveBeenCalled();
    expect(captureListener).toHaveBeenCalledTimes(1);

    dom.window.close();
  });

  it('cleans up wrapped entry after a once:true listener fires, allowing re-registration', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();

    dom.window.addEventListener('keydown', listener, { once: true, capture: true });
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1); // once fires once

    // After once fires, the browser removed the handler; re-adding the same callback should work
    dom.window.addEventListener('keydown', listener, { once: true, capture: true });
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b' }));
    expect(listener).toHaveBeenCalledTimes(2); // re-registered and fired again

    dom.window.close();
  });

  it('cleans up wrapped entry when an AbortSignal aborts, allowing re-registration', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();
    const controller = new dom.window.AbortController();

    dom.window.addEventListener('keydown', listener, { signal: controller.signal, capture: true });
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).toHaveBeenCalledTimes(1);

    controller.abort(); // browser removes the handler; our bookkeeping must also drop the entry

    // Re-adding the same callback/capture should now succeed (not be treated as a duplicate)
    const controller2 = new dom.window.AbortController();
    dom.window.addEventListener('keydown', listener, { signal: controller2.signal, capture: true });
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b' }));
    expect(listener).toHaveBeenCalledTimes(2);

    dom.window.close();
  });

  it('allows re-adding a once listener after it was suppressed by the edit guard', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();

    // Set editingEl so shouldBlock() returns true for events inside it
    const editable = dom.window.document.createElement('div');
    editable.setAttribute('data-od-editing', 'true');
    dom.window.document.body.appendChild(editable);
    (dom.window as any).__odEditGuard.editingEl = editable;

    // Register a once listener on window (capture phase) — dispatch from inside editable so guard suppresses it
    dom.window.addEventListener('keydown', listener, { once: true, capture: true });
    editable.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(listener).not.toHaveBeenCalled(); // suppressed by guard

    // The once handler was consumed (both by browser and our bookkeeping)
    // Re-adding the same callback should work
    (dom.window as any).__odEditGuard.editingEl = null; // clear guard so next event fires
    dom.window.addEventListener('keydown', listener, { once: true, capture: true });
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b' }));
    expect(listener).toHaveBeenCalledTimes(1); // re-registered and fired

    dom.window.close();
  });

  it('does not leave a stale entry when addEventListener is called with an already-aborted signal', () => {
    const guardHtml = buildManualEditKeyboardGuard();
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${guardHtml}</body></html>`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const listener = vi.fn();
    const controller = new dom.window.AbortController();
    controller.abort(); // already aborted before registration

    // Registering with an already-aborted signal should not leave a stale entry
    dom.window.addEventListener('keydown', listener, { signal: controller.signal, capture: true });

    // The listener should not fire (browser ignores registration with aborted signal)
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(listener).not.toHaveBeenCalled();

    // Re-registering the same callback/capture should succeed (not be blocked by a stale dedup entry)
    dom.window.addEventListener('keydown', listener, { capture: true });
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b' }));
    expect(listener).toHaveBeenCalledTimes(1);

    dom.window.close();
  });

  it('blocks clicks on unmapped elements while edit mode is enabled', () => {
    const dom = new JSDOM(
      `<main><button id="cta">Launch</button></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const button = dom.window.document.getElementById('cta') as HTMLButtonElement;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);

    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    const result = button.dispatchEvent(event);

    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();

    dom.window.close();
  });
});
