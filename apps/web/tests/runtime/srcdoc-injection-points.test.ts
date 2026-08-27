import { describe, expect, it } from 'vitest';

import { buildSrcdoc } from '../../src/runtime/srcdoc';

// These specs deliberately run with no `DOMParser` on globalThis (the web
// suite's default environment is node, and only the specs that need one stub
// it). That matters: `annotateMissingOdIds` early-returns without a parser, so
// nothing upstream normalizes the document into `<html><head>…`. What is left
// is each injector locating its own boundary — which is the property under
// test. Relying on an upstream round-trip to synthesize a `<head>` is exactly
// how the daemon copies of this logic stayed broken until #7410.
describe('buildSrcdoc injection points', () => {
  it('leaves a script that builds an HTML document string intact', () => {
    const authored = 'const doc = `<head><title>Slip</title></head><body>slip</body>`;';
    const html = `<!doctype html><html><body><script>${authored}<\/script><p>hi</p></body></html>`;

    const srcdoc = buildSrcdoc(html);

    expect(srcdoc).toContain(authored);
  });

  it('leaves markup stored on an attribute intact', () => {
    const authored = 'data-tpl="<head></head><body>slip</body>"';
    const html = `<!doctype html><html><body><div ${authored}></div><p>hi</p></body></html>`;

    const srcdoc = buildSrcdoc(html);

    expect(srcdoc).toContain(authored);
  });

  it('does not mistake `<header>` for the document head', () => {
    const html = '<!doctype html><html><body><header>nav</header><p>hi</p></body></html>';

    const srcdoc = buildSrcdoc(html);

    expect(srcdoc).toContain('<header>nav</header>');
  });

  it('keeps a deck bridge out of a script that writes `</body>`', () => {
    const authored = 'const doc = `<body>slip</body>`;';
    const html = `<!doctype html><html><head></head><body><script>${authored}<\/script><p>hi</p></body></html>`;

    const srcdoc = buildSrcdoc(html, { deck: true });

    expect(srcdoc).toContain(authored);
  });

  it('sanitizes a title whose open tag carries a quoted `>`', () => {
    // The open tag ends at the real `>`, not the one inside the attribute
    // value; ending early would swallow part of the title text.
    const html = '<!doctype html><html><head><title data-x="a>b">Invoice Q1</title></head>'
      + '<body><p>hi</p></body></html>';

    const srcdoc = buildSrcdoc(html);

    expect(srcdoc).toContain('<title data-x="a>b">Invoice Q1</title>');
  });

  it('keeps every injected bridge outside the authored script', () => {
    const authored = 'const doc = `<head></head><body>slip</body>`;';
    const html = `<!doctype html><html><body><script>${authored}<\/script><p>hi</p></body></html>`;

    const srcdoc = buildSrcdoc(html, {
      deck: true,
      editBridge: true,
      selectionBridge: true,
      previewFocusGuard: true,
      previewObservability: true,
    });

    const scriptStart = srcdoc.indexOf('const doc = `');
    const scriptEnd = srcdoc.indexOf('<\/script>', scriptStart);
    const authoredScript = srcdoc.slice(scriptStart, scriptEnd);
    expect(authoredScript).not.toMatch(/data-od-/);
  });
});
