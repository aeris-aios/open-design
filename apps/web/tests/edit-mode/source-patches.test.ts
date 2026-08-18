import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  applyManualEditPatch,
  isManualEditFullHtmlDocument,
  readManualEditAttributes,
  readManualEditFields,
  readManualEditOuterHtml,
  readManualEditResponsiveSize,
  readManualEditStyles,
} from '../../src/edit-mode/source-patches';

const baseSource = `<!doctype html>
<html>
  <head>
    <style>:root { --brand: #111; }</style>
  </head>
  <body>
    <main>
      <h1 data-od-id="hero-title">Original title</h1>
      <a data-od-id="cta" href="/start">Start</a>
      <button data-od-id="button-cta">Start button</button>
      <a data-od-id="nested-cta" href="/nested"><span>Buy now</span><svg viewBox="0 0 1 1"></svg></a>
      <img data-od-id="hero-image" src="/old.png" alt="Old image">
      <section data-od-id="card" class="hero" style="color: red; padding: 8px;" data-keep="yes">Card</section>
      <p data-od-id="nested"><strong>Nested</strong> copy</p>
      <p>Generated path text</p>
      <a data-od-id="ambiguous-cta" href="/mixed">Go to <strong>Lab</strong> now</a>
      <button data-od-id="icon-label-button" data-od-edit="text"><svg viewBox="0 0 1 1"></svg><span>Filed</span></button>
    </main>
  </body>
</html>`;

const brandKitSource = `<!doctype html>
<html>
  <head>
    <script id="od-brand-payload" type="application/json">{"status":"ready","brand":{"name":"Acme","sourceUrl":"https://acme.test","colors":[{"hex":"#111111","name":"Ink","role":"foreground","usage":"body"}],"logo":{"primary":"logo.svg","alternates":["logo-alt.svg"],"notes":"Primary mark"},"voice":{"tone":"Direct","adjectives":["Useful"],"messagingPillars":["Ship fast"],"vocabulary":{"use":["clear"],"avoid":["vague"]}},"imagery":{"style":"Crisp UI","samples":[{"file":"imagery/a.png","caption":"Dashboard","kind":"product"}]}}}</script>
  </head>
  <body>
    <div id="root"></div>
    <script>document.getElementById('root').innerHTML = '<h1 data-od-id="brand-name" data-od-edit="text">Acme</h1>';</script>
  </body>
</html>`;

describe('manual edit source patches', () => {
  beforeEach(() => {
    const dom = new JSDOM('');
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.CSS = { escape: (value: string) => value.replace(/"/g, '\\"') } as typeof CSS;
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'DOMParser');
    Reflect.deleteProperty(globalThis, 'CSS');
  });

  it('updates only the selected text target', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-text', id: 'hero-title', value: 'Edited title' });

    expect(result.ok).toBe(true);
    expect(readManualEditFields(result.source, 'hero-title').text).toBe('Edited title');
    expect(readManualEditFields(result.source, 'cta').text).toBe('Start');
  });

  it('updates link label and href', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-link', id: 'cta', text: 'Buy now', href: '/buy' });

    expect(result.ok).toBe(true);
    expect(readManualEditFields(result.source, 'cta')).toEqual({ text: 'Buy now', href: '/buy' });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<h1>unsafe</h1>'])(
    'rejects unsafe link destinations: %s',
    (href) => {
      const result = applyManualEditPatch(baseSource, {
        kind: 'set-link',
        id: 'cta',
        text: 'Unsafe link',
        href,
      });

      expect(result.ok).toBe(false);
      expect(result.source).toBe(baseSource);
      expect(result.error).toContain('http(s)');
    },
  );

  it('still permits label-only text patches on buttons without inventing navigation attributes', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-text', id: 'button-cta', value: 'Buy button' });

    expect(result.ok).toBe(true);
    const html = readManualEditOuterHtml(result.source, 'button-cta');
    expect(html).toContain('Buy button');
    expect(html).not.toContain('href=');
    expect(readManualEditFields(result.source, 'button-cta')).toEqual({
      text: 'Buy button',
      href: '',
      target: '_self',
    });
  });

  it('writes and clears safe button navigation while preserving nested icon markup', () => {
    const actionSource = '<button data-od-id="action-cta"><svg viewBox="0 0 1 1"></svg><span>Start action</span></button>';
    const linked = applyManualEditPatch(actionSource, {
      kind: 'set-action',
      id: 'action-cta',
      text: 'Explore work',
      href: '/discover.html?variant=a#work',
      target: '_blank',
    });

    expect(linked.ok).toBe(true);
    const linkedHtml = readManualEditOuterHtml(linked.source, 'action-cta');
    expect(linkedHtml).toContain('data-od-action="navigate"');
    expect(linkedHtml).toContain('data-od-href="/discover.html?variant=a#work"');
    expect(linkedHtml).toContain('data-od-target="_blank"');
    expect(linkedHtml).toContain('<span>Explore work</span>');
    expect(linkedHtml).toContain('<svg');
    expect(readManualEditFields(linked.source, 'action-cta')).toEqual({
      text: 'Explore work',
      href: '/discover.html?variant=a#work',
      target: '_blank',
    });

    const cleared = applyManualEditPatch(linked.source, {
      kind: 'set-action',
      id: 'action-cta',
      text: 'Explore work',
      href: '   ',
      target: '_self',
    });

    expect(cleared.ok).toBe(true);
    const clearedHtml = readManualEditOuterHtml(cleared.source, 'action-cta');
    expect(clearedHtml).not.toContain('data-od-action');
    expect(clearedHtml).not.toContain('data-od-href');
    expect(clearedHtml).not.toContain('data-od-target');
    expect(clearedHtml).toContain('<span>Explore work</span>');
    expect(clearedHtml).toContain('<svg');
  });

  it('edits a direct button label without overwriting its nested count', () => {
    const actionSource = '<button data-od-id="filter">All<span class="count">31</span></button>';
    expect(readManualEditFields(actionSource, 'filter').text).toBe('All');

    const result = applyManualEditPatch(actionSource, {
      kind: 'set-action',
      id: 'filter',
      text: 'Everything',
      href: '#all',
      target: '_self',
    });

    expect(result.ok).toBe(true);
    expect(readManualEditOuterHtml(result.source, 'filter')).toContain('Everything<span class="count">31</span>');
    expect(readManualEditFields(result.source, 'filter').text).toBe('Everything');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<h1>unsafe</h1>'])(
    'rejects unsafe button navigation href %s',
    (href) => {
      const actionSource = '<button data-od-id="action-cta"><span>Start action</span></button>';
      const result = applyManualEditPatch(actionSource, {
        kind: 'set-action',
        id: 'action-cta',
        text: 'Unsafe action',
        href,
        target: '_self',
      });

      expect(result.ok).toBe(false);
      expect(result.source).toBe(actionSource);
      expect(result.error).toContain('http(s), mailto, or tel URL');
    },
  );

  it('preserves nested link markup when only href changes', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-link', id: 'nested-cta', text: 'Buy now', href: '/buy' });

    expect(result.ok).toBe(true);
    const html = readManualEditOuterHtml(result.source, 'nested-cta');
    expect(html).toContain('href="/buy"');
    expect(html).toContain('<span>Buy now</span>');
    expect(html).toContain('<svg');
  });

  it('replaces the sole label text node on a link with a decorative icon', () => {
    // nested-cta is the icon-span + label-span shape reported in
    // recvqafedTcNQF: a real label edit must not be rejected just because
    // the link also carries a decorative <svg> sibling.
    const result = applyManualEditPatch(baseSource, { kind: 'set-link', id: 'nested-cta', text: 'Purchase', href: '/buy' });

    expect(result.ok).toBe(true);
    const html = readManualEditOuterHtml(result.source, 'nested-cta');
    expect(html).toContain('href="/buy"');
    expect(html).toContain('<span>Purchase</span>');
    expect(html).toContain('<svg');
  });

  it('rejects label edits for links with genuinely ambiguous nested markup', () => {
    // ambiguous-cta has three meaningful text nodes ("Go to ", "Lab", " now")
    // straddling an inline <strong>, so there is no single unambiguous node
    // to route a flat text edit to — the guard must still refuse this one.
    const result = applyManualEditPatch(baseSource, { kind: 'set-link', id: 'ambiguous-cta', text: 'Go there', href: '/mixed' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('nested markup');
  });

  it('replaces the sole label text node on a text target with a decorative icon', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-text', id: 'icon-label-button', value: 'Saved' });

    expect(result.ok).toBe(true);
    const html = readManualEditOuterHtml(result.source, 'icon-label-button');
    expect(html).toContain('<span>Saved</span>');
    expect(html).toContain('<svg');
  });

  it('updates image src and alt', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-image', id: 'hero-image', src: '/new.png', alt: 'New image' });

    expect(result.ok).toBe(true);
    expect(readManualEditFields(result.source, 'hero-image')).toEqual({ src: '/new.png', alt: 'New image' });
  });

  it('adds and removes inline style properties', () => {
    const result = applyManualEditPatch(baseSource, {
      kind: 'set-style',
      id: 'card',
      styles: {
        color: '',
        backgroundColor: '#ff0000',
        fontSize: '24px',
        paddingTop: '12px',
        marginLeft: '4px',
        borderTopWidth: '2px',
        borderStyle: 'solid',
        borderColor: '#000000',
        borderRadius: '8px',
        opacity: '0.5',
      },
    });

    expect(result.ok).toBe(true);
    const styles = readManualEditStyles(result.source, 'card');
    expect(styles.color).toBe('');
    expect(styles.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(styles.fontSize).toBe('24px');
    expect(styles.padding).toBe('12px 8px 8px');
    expect(styles.paddingTop).toBe('12px');
    expect(styles.marginLeft).toBe('4px');
    expect(styles.borderTopWidth).toBe('2px');
    expect(styles.borderStyle).toBe('solid');
    expect(styles.borderColor).toBe('rgb(0, 0, 0)');
    expect(styles.borderRadius).toBe('8px');
    expect(styles.opacity).toBe('0.5');
  });

  it('persists a generated target id without exposing it through editable HTML or attributes', () => {
    const source = '<section class="card featured" style="width: 320px; color: red">Card</section>';
    const result = applyManualEditPatch(source, {
      kind: 'set-responsive-size',
      id: 'path-0',
      viewport: 'mobile',
      size: { widthPercent: 162.5, minHeight: 144, leftPercent: -12.5, topPx: -8 },
    });

    expect(result.ok).toBe(true);
    const target = readManualEditOuterHtml(result.source, 'path-0');
    expect(target).toBe(source);
    expect(target).not.toContain('data-od-id');
    expect(target).not.toContain('data-od-responsive-generated-id');
    expect(readManualEditAttributes(result.source, 'path-0')).toEqual({
      class: 'card featured',
      style: 'width: 320px; color: red',
    });
    expect(readManualEditResponsiveSize(result.source, 'path-0', 'mobile')).toEqual({
      widthPercent: 162.5,
      minHeight: 144,
      leftPercent: -12.5,
      topPx: -8,
    });
    expect(readManualEditResponsiveSize(result.source, 'od-responsive-path-0', 'mobile'))
      .toEqual(readManualEditResponsiveSize(result.source, 'path-0', 'mobile'));

    const dom = new JSDOM(result.source);
    const persistedTarget = dom.window.document.querySelector('section');
    expect(persistedTarget?.getAttribute('data-od-id')).toBe('od-responsive-path-0');
    expect(persistedTarget?.hasAttribute('data-od-responsive-generated-id')).toBe(true);
    const responsiveStyle = dom.window.document.querySelector('style[data-od-responsive-size]');
    expect(responsiveStyle).toBeTruthy();
    expect(responsiveStyle?.textContent).toContain('@media (max-width: 599px)');
    expect(responsiveStyle?.textContent).toContain('[data-od-id="od-responsive-path-0"]');
    expect(responsiveStyle?.textContent).toContain('width: 162.50% !important');
    expect(responsiveStyle?.textContent).toContain('min-height: 144px !important');
    expect(responsiveStyle?.textContent).toContain('left: -12.50% !important');
    expect(responsiveStyle?.textContent).toContain('right: auto !important');
    expect(responsiveStyle?.textContent).toContain('top: -8px !important');
    expect(responsiveStyle?.textContent).toContain('bottom: auto !important');

    const followUp = applyManualEditPatch(result.source, {
      kind: 'set-text',
      id: 'od-responsive-path-0',
      value: 'Updated card',
    });
    expect(followUp.ok).toBe(true);
    expect(readManualEditOuterHtml(followUp.source, 'od-responsive-path-0'))
      .toBe('<section class="card featured" style="width: 320px; color: red">Updated card</section>');
    expect(readManualEditResponsiveSize(followUp.source, 'od-responsive-path-0', 'mobile'))
      .toEqual({ widthPercent: 162.5, minHeight: 144, leftPercent: -12.5, topPx: -8 });
  });

  it('preserves a generated responsive id when replacing user-visible outer HTML', () => {
    const resized = applyManualEditPatch('<section class="card">Card</section>', {
      kind: 'set-responsive-size',
      id: 'path-0',
      viewport: 'mobile',
      size: { widthPercent: 80 },
    });
    const replaced = applyManualEditPatch(resized.source, {
      kind: 'set-outer-html',
      id: 'od-responsive-path-0',
      html: '<article class="replacement">Updated</article>',
    });

    expect(replaced.ok).toBe(true);
    expect(readManualEditOuterHtml(replaced.source, 'od-responsive-path-0'))
      .toBe('<article class="replacement">Updated</article>');
    expect(readManualEditResponsiveSize(replaced.source, 'od-responsive-path-0', 'mobile'))
      .toEqual({ widthPercent: 80 });
    const persistedTarget = new JSDOM(replaced.source).window.document.querySelector('article');
    expect(persistedTarget?.getAttribute('data-od-id')).toBe('od-responsive-path-0');
    expect(persistedTarget?.hasAttribute('data-od-responsive-generated-id')).toBe(true);
  });

  it('uses a deterministic non-path responsive id when the preferred stable id already exists', () => {
    const source = [
      '<div data-od-id="od-responsive-path-1">Existing</div>',
      '<section>Resize me</section>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'set-responsive-size',
      id: 'path-1',
      viewport: 'mobile',
      size: { widthPercent: 40 },
    });

    expect(result.ok).toBe(true);
    expect(readManualEditOuterHtml(result.source, 'path-1')).toBe('<section>Resize me</section>');
    expect(new JSDOM(result.source).window.document.querySelectorAll('section')[0]?.getAttribute('data-od-id'))
      .toBe('od-responsive-path-1-2');
    expect(readManualEditResponsiveSize(result.source, 'od-responsive-path-1-2', 'mobile'))
      .toEqual({ widthPercent: 40 });
    expect(new JSDOM(result.source).window.document.querySelector('style[data-od-responsive-size]')?.textContent)
      .toContain('[data-od-id="od-responsive-path-1-2"]');
  });

  it('removes a generated responsive id after its final viewport rule is reset', () => {
    const source = '<section>Resize me</section>';
    const resized = applyManualEditPatch(source, {
      kind: 'set-responsive-size',
      id: 'path-0',
      viewport: 'mobile',
      size: { widthPercent: 48 },
    });
    expect(readManualEditOuterHtml(resized.source, 'od-responsive-path-0')).toBe('<section>Resize me</section>');
    expect(new JSDOM(resized.source).window.document.querySelector('section')
      ?.hasAttribute('data-od-responsive-generated-id')).toBe(true);

    const reset = applyManualEditPatch(resized.source, {
      kind: 'set-responsive-size',
      id: 'od-responsive-path-0',
      viewport: 'mobile',
      size: { widthPercent: null },
    });

    expect(reset.ok).toBe(true);
    expect(reset.source).toBe(source);
    expect(reset.source).not.toContain('data-od-id');
    expect(reset.source).not.toContain('data-od-responsive-generated-id');
    expect(reset.source).not.toContain('data-od-responsive-size');
  });

  it('keeps a source-path collision resize reversible without polluting authored ids', () => {
    const source = '<main><section>Resize me</section><aside data-od-id="path-0-0">Authored</aside></main>';
    const resized = applyManualEditPatch(source, {
      kind: 'set-responsive-size',
      id: 'source-path:path-0-0',
      viewport: 'desktop',
      size: { widthPercent: 75 },
    });

    expect(resized.ok).toBe(true);
    const resizedDocument = new JSDOM(resized.source).window.document;
    expect(resizedDocument.querySelector('section')?.getAttribute('data-od-id'))
      .toBe('od-responsive-path-0-0');
    expect(resizedDocument.querySelector('aside')?.getAttribute('data-od-id'))
      .toBe('path-0-0');

    const reset = applyManualEditPatch(resized.source, {
      kind: 'set-responsive-size',
      id: 'od-responsive-path-0-0',
      viewport: 'desktop',
      size: { widthPercent: null },
    });

    expect(reset.ok).toBe(true);
    expect(reset.source).toBe(source);
  });

  it('keeps responsive targets and viewport buckets independent while merging only dirty axes', () => {
    const mobileCard = applyManualEditPatch(baseSource, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'mobile',
      size: { widthPercent: 50, minHeight: 120 },
    });
    const desktopCard = applyManualEditPatch(mobileCard.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'desktop',
      size: { widthPercent: 80 },
    });
    const tabletCard = applyManualEditPatch(desktopCard.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'tablet',
      size: { widthPercent: 70, topPx: 24 },
    });
    const mobileTitle = applyManualEditPatch(tabletCard.source, {
      kind: 'set-responsive-size',
      id: 'hero-title',
      viewport: 'mobile',
      size: { widthPercent: 90 },
    });
    const mergedCard = applyManualEditPatch(mobileTitle.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'mobile',
      size: { minHeight: 164, leftPercent: 5.25 },
    });

    expect(mergedCard.ok).toBe(true);
    expect(readManualEditResponsiveSize(mergedCard.source, 'card', 'mobile')).toEqual({
      widthPercent: 50,
      minHeight: 164,
      leftPercent: 5.25,
    });
    expect(readManualEditResponsiveSize(mergedCard.source, 'card', 'tablet')).toEqual({
      widthPercent: 70,
      topPx: 24,
    });
    expect(readManualEditResponsiveSize(mergedCard.source, 'card', 'desktop')).toEqual({ widthPercent: 80 });
    expect(readManualEditResponsiveSize(mergedCard.source, 'hero-title', 'mobile')).toEqual({ widthPercent: 90 });
    expect(readManualEditResponsiveSize(mergedCard.source, 'hero-title', 'desktop')).toBeNull();

    const dom = new JSDOM(mergedCard.source);
    expect(dom.window.document.querySelectorAll('style[data-od-responsive-size]')).toHaveLength(1);
    const css = dom.window.document.querySelector('style[data-od-responsive-size]')?.textContent ?? '';
    expect(css).toContain('@media (max-width: 599px)');
    expect(css).toContain('@media (min-width: 600px) and (max-width: 1023px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(readManualEditStyles(mergedCard.source, 'card').width).toBe('');
    expect(readManualEditStyles(mergedCard.source, 'card').padding).toBe('8px');
    expect(readManualEditAttributes(mergedCard.source, 'card').class).toBe('hero');
  });

  it('deletes only null responsive axes and removes the dedicated style after the last rule', () => {
    const mobile = applyManualEditPatch(baseSource, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'mobile',
      size: { widthPercent: 50, minHeight: 120 },
    });
    const withDesktop = applyManualEditPatch(mobile.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'desktop',
      size: { widthPercent: 75 },
    });
    const withoutMobileWidth = applyManualEditPatch(withDesktop.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'mobile',
      size: { widthPercent: null },
    });

    expect(readManualEditResponsiveSize(withoutMobileWidth.source, 'card', 'mobile')).toEqual({ minHeight: 120 });
    expect(readManualEditResponsiveSize(withoutMobileWidth.source, 'card', 'desktop')).toEqual({ widthPercent: 75 });

    const withoutMobile = applyManualEditPatch(withoutMobileWidth.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'mobile',
      size: { minHeight: null },
    });
    expect(readManualEditResponsiveSize(withoutMobile.source, 'card', 'mobile')).toBeNull();
    expect(readManualEditResponsiveSize(withoutMobile.source, 'card', 'desktop')).toEqual({ widthPercent: 75 });

    const cleared = applyManualEditPatch(withoutMobile.source, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'desktop',
      size: { widthPercent: null },
    });
    expect(readManualEditResponsiveSize(cleared.source, 'card', 'desktop')).toBeNull();
    expect(new JSDOM(cleared.source).window.document.querySelector('style[data-od-responsive-size]')).toBeNull();
    expect(readManualEditAttributes(cleared.source, 'card')['data-od-id']).toBe('card');
  });

  it.each([
    [{ widthPercent: 33.333 }, 'widthPercent'],
    [{ widthPercent: 10_000.01 }, 'widthPercent'],
    [{ widthPercent: Number.NaN }, 'widthPercent'],
    [{ minHeight: 12.5 }, 'minHeight'],
    [{ minHeight: -1 }, 'minHeight'],
    [{ leftPercent: -10_000.01 }, 'leftPercent'],
    [{ leftPercent: 10.001 }, 'leftPercent'],
    [{ topPx: 2.5 }, 'topPx'],
    [{ topPx: -250_001 }, 'topPx'],
    [{ topPx: 250_001 }, 'topPx'],
    [{ widthPercent: '50' }, 'widthPercent'],
    [{ unsupported: 1 }, 'unsupported'],
    [{}, 'at least one'],
  ] as Array<[Record<string, unknown>, string]>)('rejects invalid structured responsive size values %#', (size, error) => {
    const result = applyManualEditPatch(baseSource, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'mobile',
      size,
    } as unknown as Parameters<typeof applyManualEditPatch>[1]);

    expect(result.ok).toBe(false);
    expect(result.source).toBe(baseSource);
    expect(result.error).toContain(error);
  });

  it('rejects unknown responsive viewport values without mutating source', () => {
    const result = applyManualEditPatch(baseSource, {
      kind: 'set-responsive-size',
      id: 'card',
      viewport: 'watch',
      size: { widthPercent: 50 },
    } as unknown as Parameters<typeof applyManualEditPatch>[1]);

    expect(result.ok).toBe(false);
    expect(result.source).toBe(baseSource);
    expect(result.error).toContain('viewport');
  });

  it('applies attributes additively and preserves class/style unless explicitly updated', () => {
    const result = applyManualEditPatch(baseSource, {
      kind: 'set-attributes',
      id: 'card',
      attributes: { 'aria-label': 'Hero card', 'data-empty': '', 'data-od-id': 'blocked' },
    });

    expect(result.ok).toBe(true);
    const attrs = readManualEditAttributes(result.source, 'card');
    expect(attrs['aria-label']).toBe('Hero card');
    expect(attrs.class).toBe('hero');
    expect(attrs.style).toContain('color: red');
    expect(attrs['data-od-id']).toBe('card');
    expect(attrs['data-empty']).toBeUndefined();
  });

  it('preserves data-od-id when selected outerHTML omits it', () => {
    const result = applyManualEditPatch(baseSource, {
      kind: 'set-outer-html',
      id: 'card',
      html: '<section class="replacement">Replaced</section>',
    });

    expect(result.ok).toBe(true);
    const html = readManualEditOuterHtml(result.source, 'card');
    expect(html).toContain('data-od-id="card"');
    expect(html).toContain('class="replacement"');
  });

  it('replaces full source for snapshot-based undo history', () => {
    const source = '<!doctype html><html><body><h1 data-od-id="hero-title">Snapshot</h1></body></html>';
    const result = applyManualEditPatch(baseSource, { kind: 'set-full-source', source });

    expect(result).toEqual({ ok: true, source });
  });

  it('updates CSS tokens in style tags', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-token', token: '--brand', value: '#f00' });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('--brand: #f00;');
  });

  it('preserves fragment-shaped HTML when saving patches', () => {
    const source = '<main><h1 data-od-id="hero-title">Original title</h1></main>';
    const result = applyManualEditPatch(source, { kind: 'set-text', id: 'hero-title', value: 'Edited title' });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('<main><h1 data-od-id="hero-title">Edited title</h1></main>');
    expect(result.source).not.toContain('<!doctype');
    expect(result.source).not.toContain('<html');
    expect(result.source).not.toContain('<body');
  });

  it('detects full documents after leading comments and keeps fragments distinct', () => {
    expect(isManualEditFullHtmlDocument('<!-- generated -->\n<!doctype html><html></html>')).toBe(true);
    expect(isManualEditFullHtmlDocument('<?xml version="1.0"?>\n<html></html>')).toBe(true);
    expect(isManualEditFullHtmlDocument('<main><h1>Fragment</h1></main>')).toBe(false);
  });

  it('preserves full documents with leading comments when saving patches', () => {
    const source = [
      '<!-- generated by open design -->',
      '<!doctype html><html><head><style>:root { --brand: #111; }</style></head>',
      '<body><main><h1 data-od-id="hero-title">Original title</h1></main></body></html>',
    ].join('\n');
    const result = applyManualEditPatch(source, { kind: 'set-text', id: 'hero-title', value: 'Edited title' });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('<!doctype html>');
    expect(result.source).toContain('<html>');
    expect(result.source).toContain('<head><style>:root { --brand: #111; }</style></head>');
    expect(result.source).toContain('<h1 data-od-id="hero-title">Edited title</h1>');
  });

  it('moves an element between HTML component containers at a sibling slot', () => {
    const source = [
      '<main data-od-id="page">',
      '<section data-od-id="source"><article data-od-id="card-a">A</article></section>',
      '<section data-od-id="target"><article data-od-id="card-b">B</article></section>',
      '</main>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'card-a',
      parentId: 'target',
      beforeId: 'card-b',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toContain(
      '<section data-od-id="target"><article data-od-id="card-a">A</article><article data-od-id="card-b">B</article></section>',
    );
    expect(result.source).toContain('<section data-od-id="source"></section>');
  });

  it('wraps a right-side placement into a horizontal group beside the anchor', () => {
    const source = [
      '<main data-od-id="page">',
      '<article data-od-id="card">Card</article>',
      '<button data-od-id="cta">Go</button>',
      '</main>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'cta',
      parentId: 'page',
      beforeId: null,
      placement: 'right',
      anchorId: 'card',
      groupId: 'od-group-a1',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toContain(
      '<div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px" data-od-id="od-group-a1">'
      + '<article data-od-id="card">Card</article><button data-od-id="cta">Go</button></div>',
    );
  });

  it('orders a left-side placement as dragged element before the anchor', () => {
    const source = [
      '<main data-od-id="page">',
      '<article data-od-id="card">Card</article>',
      '<button data-od-id="cta">Go</button>',
      '</main>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'cta',
      parentId: 'page',
      beforeId: null,
      placement: 'left',
      anchorId: 'card',
      groupId: 'od-group-a2',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toContain(
      '<button data-od-id="cta">Go</button><article data-od-id="card">Card</article></div>',
    );
  });

  it('suffixes the group id when the requested id already exists in the source', () => {
    const source = [
      '<main data-od-id="page">',
      '<div data-od-id="od-group-a1">Existing</div>',
      '<article data-od-id="card">Card</article>',
      '<button data-od-id="cta">Go</button>',
      '</main>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'cta',
      parentId: 'page',
      beforeId: null,
      placement: 'right',
      anchorId: 'card',
      groupId: 'od-group-a1',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('data-od-id="od-group-a1">Existing</div>');
    expect(result.source).toContain('data-od-id="od-group-a1-2"><article data-od-id="card">');
  });

  it('refuses side placement where the wrapper div would be invalid HTML', () => {
    const listSource = [
      '<ul data-od-id="list">',
      '<li data-od-id="item-a">A</li>',
      '<li data-od-id="item-b">B</li>',
      '</ul>',
    ].join('');
    const listResult = applyManualEditPatch(listSource, {
      kind: 'move-element',
      id: 'item-b',
      parentId: 'list',
      beforeId: null,
      placement: 'right',
      anchorId: 'item-a',
      groupId: 'od-group-a3',
    });
    expect(listResult.ok).toBe(false);
    expect(listResult.error).toBe('A side-by-side group cannot be created inside that HTML container.');

    const mixedSource = [
      '<main data-od-id="page"><ul data-od-id="list"><li data-od-id="item">A</li></ul>',
      '<li data-od-id="stray">B</li></main>',
    ].join('');
    const mixedResult = applyManualEditPatch(mixedSource, {
      kind: 'move-element',
      id: 'stray',
      parentId: 'page',
      beforeId: null,
      placement: 'left',
      anchorId: 'list',
      groupId: 'od-group-a4',
    });
    expect(mixedResult.ok).toBe(false);
    expect(mixedResult.error).toBe('These elements cannot be placed side by side.');
  });

  it('reports a missing side-placement anchor as a not-found preflight error', () => {
    const source = '<main data-od-id="page"><button data-od-id="cta">Go</button></main>';
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'cta',
      parentId: 'page',
      beforeId: null,
      placement: 'right',
      anchorId: 'path-0-9',
      groupId: 'od-group-a5',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Drop anchor not found in container: path-0-9');
  });

  it('fits long text into any valid empty box and uses its refreshed path after the move', () => {
    const source = [
      '<main>',
      '<section><p style="position:absolute;left:40px;width:720px;height:180px;min-height:120px;margin:48px;padding:24px;transform:translate(20px, 10px);white-space:pre">  Long     text   with     spaces  </p></section>',
      '<ul><li style="display:flex"></li></ul>',
      '</main>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'path-0-0-0',
      parentId: 'path-0-1-0',
      beforeId: null,
    });

    expect(result.ok).toBe(true);
    expect(result.source).not.toContain('data-od-id="path-');
    expect(result.source).toContain('>Long text with spaces</p>');
    expect(result.source).toContain('position: static');
    expect(result.source).toContain('width: auto');
    expect(result.source).toContain('height: auto');
    expect(result.source).toContain('min-height: 0');
    expect(result.source).toContain('max-width: 100%');
    expect(result.source).toContain('margin: 0');
    expect(result.source).toContain('padding: 0');
    expect(result.source).toContain('white-space: normal');
    expect(result.source).toContain('overflow-wrap: anywhere');

    const followUp = applyManualEditPatch(result.source, {
      kind: 'set-text',
      id: 'path-0-1-0-0',
      value: 'Still editable',
    });
    expect(followUp.ok).toBe(true);
    expect(followUp.source).toContain('>Still editable</p>');
  });

  it('keeps consecutive same-container moves accurate after paths are refreshed', () => {
    const source = '<main><div>A</div><div>B</div><div>C</div><div>D</div></main>';
    const first = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'path-0-0',
      parentId: 'path-0',
      beforeId: null,
    });

    expect(first.ok).toBe(true);
    expect(first.source).toBe('<main><div>B</div><div>C</div><div>D</div><div>A</div></main>');

    // The rebuilt iframe addresses D and C by their new structural paths.
    const second = applyManualEditPatch(first.source, {
      kind: 'move-element',
      id: 'path-0-2',
      parentId: 'path-0',
      beforeId: 'path-0-1',
    });

    expect(second.ok).toBe(true);
    expect(second.source).toBe('<main><div>B</div><div>D</div><div>C</div><div>A</div></main>');
  });

  it('keeps deeply nested sibling paths accurate after a parent reorder', () => {
    const fillers = '<i>0</i><i>1</i><i>2</i><i>3</i><i>4</i>';
    const group = (name: string) => (
      `<div><span>${name}0</span><span>${name}1</span><span>${name}2</span></div>`
    );
    const source = '<header>chrome</header><main><aside>rail</aside><section><div>'
      + `${fillers}<article>${group('A')}${group('B')}</article>`
      + '</div></section></main>';
    const first = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'path-1-1-0-5-0',
      parentId: 'path-1-1-0-5',
      beforeId: null,
    });

    expect(first.ok).toBe(true);
    const second = applyManualEditPatch(first.source, {
      kind: 'move-element',
      id: 'path-1-1-0-5-1-2',
      parentId: 'path-1-1-0-5-1',
      beforeId: 'path-1-1-0-5-1-1',
    });

    expect(second.ok).toBe(true);
    expect(second.error).toBeUndefined();
    const document = new JSDOM(second.source).window.document;
    expect(Array.from(document.querySelectorAll('article > div')).map((node) => node.textContent)).toEqual([
      'B0B1B2',
      'A0A2A1',
    ]);
  });

  it('preserves authored path-like ids and their CSS or script references', () => {
    const source = [
      '<!doctype html><html><head><style>[data-od-id="path-0"] { color: red; }</style></head><body>',
      '<main data-od-id="path-0">Authored identity</main>',
      '<p data-od-id="copy">Original</p>',
      '<script>document.querySelector(\'[data-od-id="path-0"]\')</script>',
      '</body></html>',
    ].join('');
    const result = applyManualEditPatch(source, {
      kind: 'set-text',
      id: 'copy',
      value: 'Edited',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('<main data-od-id="path-0">Authored identity</main>');
    expect(result.source).toContain('[data-od-id="path-0"] { color: red; }');
    expect(result.source).toContain('document.querySelector(\'[data-od-id="path-0"]\')');
    expect(result.source).toContain('<p data-od-id="copy">Edited</p>');
  });

  it('uses an explicit source-path locator when an authored id owns the same path string', () => {
    const source = '<main><div>B</div><div data-od-id="path-0-0">Authored A</div></main>';
    const result = applyManualEditPatch(source, {
      kind: 'set-text',
      id: 'source-path:path-0-0',
      value: 'B edited',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('<main><div>B edited</div><div data-od-id="path-0-0">Authored A</div></main>');
  });

  it('edits an authored id that happens to use the source-path namespace', () => {
    const source = '<main><p data-od-id="source-path:path-0-1">Authored target</p><p>Other</p></main>';
    const result = applyManualEditPatch(source, {
      kind: 'set-text',
      id: 'source-path:path-0-1',
      value: 'Authored edited',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('<main><p data-od-id="source-path:path-0-1">Authored edited</p><p>Other</p></main>');
  });

  it('uses a repeated source-path namespace when both shorter locators are authored ids', () => {
    const source = '<main><p>Generated target</p><p data-od-id="path-0-0">Raw owner</p><p data-od-id="source-path:path-0-0">Locator owner</p></main>';
    const result = applyManualEditPatch(source, {
      kind: 'set-text',
      id: 'source-path:source-path:path-0-0',
      value: 'Generated edited',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('<main><p>Generated edited</p><p data-od-id="path-0-0">Raw owner</p><p data-od-id="source-path:path-0-0">Locator owner</p></main>');
  });

  it('resolves raw generated paths against current structure instead of stale source annotations', () => {
    const source = '<main><p data-od-source-path="path-0-1">A stale</p><p>B current</p></main>';
    const result = applyManualEditPatch(source, {
      kind: 'set-text',
      id: 'path-0-1',
      value: 'B edited',
    });

    expect(result.ok).toBe(true);
    const document = new JSDOM(result.source).window.document;
    expect(Array.from(document.querySelectorAll('p')).map((node) => node.textContent)).toEqual([
      'A stale',
      'B edited',
    ]);
  });

  it('rejects drops that violate the HTML list content model', () => {
    const source = '<main data-od-id="page"><div data-od-id="card">Card</div><ul data-od-id="list"><li data-od-id="item">Item</li></ul></main>';
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'card',
      parentId: 'list',
      beforeId: 'item',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('This element cannot be placed inside that HTML container.');
    expect(result.source).toBe(source);
  });

  it('rejects block components inside phrasing-only HTML containers', () => {
    const source = '<main data-od-id="page"><div data-od-id="card">Card</div><p data-od-id="copy"><span data-od-id="label">Copy</span></p></main>';
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'card',
      parentId: 'copy',
      beforeId: 'label',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('This element cannot be placed inside that HTML container.');
    expect(result.source).toBe(source);
  });

  it('allows reordering compatible list items', () => {
    const source = '<ul data-od-id="list"><li data-od-id="first">First</li><li data-od-id="second">Second</li></ul>';
    const result = applyManualEditPatch(source, {
      kind: 'move-element',
      id: 'second',
      parentId: 'list',
      beforeId: 'first',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe('<ul data-od-id="list"><li data-od-id="second">Second</li><li data-od-id="first">First</li></ul>');
  });

  it('rejects removing the only rendered body element even when scripts remain', () => {
    const source = [
      '<!doctype html><html><body>',
      '<main data-od-id="app-root">App</main>',
      '<script>window.bootApp && window.bootApp();</script>',
      '</body></html>',
    ].join('');
    const result = applyManualEditPatch(source, { kind: 'remove-element', id: 'app-root' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Cannot remove the last rendered element in the document.');
    expect(result.source).toContain('data-od-id="app-root"');
  });

  it('addresses unannotated elements with generated DOM path ids', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-text', id: 'path-0-7', value: 'Path target' });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('Path target');
  });

  it('rejects text patches for nested markup', () => {
    const result = applyManualEditPatch(baseSource, { kind: 'set-text', id: 'nested', value: 'Flat text' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('nested markup');
  });

  it('writes dynamic brand-kit text targets back to the embedded payload', () => {
    const result = applyManualEditPatch(brandKitSource, { kind: 'set-text', id: 'brand-name', value: 'Nexu' });

    expect(result.ok).toBe(true);
    const payload = readBrandPayload(result.source);
    expect(payload.brand.name).toBe('Nexu');
    expect(result.source).not.toContain('Target not found');
  });

  it('writes dynamic brand-kit palette and imagery fields back to the embedded payload', () => {
    const color = applyManualEditPatch(brandKitSource, { kind: 'set-text', id: 'brand-color-hex-0', value: '#FF5500' });
    expect(color.ok).toBe(true);
    const [updatedColor] = readBrandPayload(color.source).brand.colors;
    expect(updatedColor).toMatchObject({ hex: '#FF5500' });

    const image = applyManualEditPatch(color.source, {
      kind: 'set-image',
      id: 'brand-image-img-0',
      src: 'imagery/b.png',
      alt: 'Updated dashboard',
    });
    expect(image.ok).toBe(true);
    const [updatedImage] = readBrandPayload(image.source).brand.imagery.samples;
    expect(updatedImage).toMatchObject({
      file: 'imagery/b.png',
      caption: 'Updated dashboard',
    });
  });

  it('maps dynamic brand-kit logo thumbnails to primary and alternate logo slots', () => {
    const primary = applyManualEditPatch(brandKitSource, {
      kind: 'set-image',
      id: 'brand-logo-thumb-0',
      src: 'logos/primary-new.svg',
      alt: 'Updated primary',
    });
    expect(primary.ok).toBe(true);
    expect(readBrandPayload(primary.source).brand.logo).toMatchObject({
      primary: 'logos/primary-new.svg',
      notes: 'Updated primary',
    });

    const alternate = applyManualEditPatch(primary.source, {
      kind: 'set-image',
      id: 'brand-logo-thumb-1',
      src: 'logos/alternate-new.svg',
      alt: '',
    });
    expect(alternate.ok).toBe(true);
    expect(readBrandPayload(alternate.source).brand.logo.alternates[0]).toBe('logos/alternate-new.svg');
  });

  it('persists dynamic brand-kit static copy through runtime overrides', () => {
    const result = applyManualEditPatch(brandKitSource, {
      kind: 'set-text',
      id: 'brand-system-title',
      value: 'Component library',
    });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('id="od-manual-edit-runtime-overrides"');
    expect(result.source).toContain('id="od-manual-edit-runtime-apply"');
    expect(result.source).toContain('if (el && el.textContent !== value) el.textContent = value');
    expect(readRuntimeOverrides(result.source).text?.['brand-system-title']).toBe('Component library');
  });

  it('hides dynamic brand-kit targets instead of reporting target not found on delete', () => {
    const result = applyManualEditPatch(brandKitSource, { kind: 'remove-element', id: 'brand-system-section' });

    expect(result.ok).toBe(true);
    expect(result.source).toContain('[data-od-id="brand-system-section"]');
    expect(result.source).toContain('display: none !important');
  });
});

function readBrandPayload(source: string): {
  brand: {
    name?: string;
    colors: Array<{ hex?: string }>;
    logo: { primary?: string; alternates: string[]; notes?: string };
    imagery: { samples: Array<{ file?: string; caption?: string }> };
  };
} {
  const dom = new JSDOM(source);
  return JSON.parse(dom.window.document.getElementById('od-brand-payload')?.textContent || '{}');
}

function readRuntimeOverrides(source: string): {
  text?: Record<string, string>;
} {
  const dom = new JSDOM(source);
  return JSON.parse(dom.window.document.getElementById('od-manual-edit-runtime-overrides')?.textContent || '{}');
}
