import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanHtmlHeadForStreamingInjection } from '../../src/http/html-stream-injection.js';

describe('scanHtmlHeadForStreamingInjection', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function scan(source: string | Buffer) {
    const dir = await mkdtemp(path.join(tmpdir(), 'od-html-stream-scan-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'index.html');
    await writeFile(filePath, source);
    return {
      source: Buffer.isBuffer(source) ? source : Buffer.from(source),
      result: await scanHtmlHeadForStreamingInjection(filePath),
    };
  }

  it('inserts after an explicit head without disturbing a BOM, doctype, or leading comments', async () => {
    const fixture = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<!doctype html><!-- lead --><HTML><HEAD data-x=">">'),
      Buffer.from('<script src="./support.js"></script></HEAD><BODY>ok</BODY></HTML>'),
    ]);
    const { source, result } = await scan(fixture);
    expect(source.subarray(0, result.insertionOffset).toString('utf8')).toBe(
      '\uFEFF<!doctype html><!-- lead --><HTML><HEAD data-x=">">',
    );
    expect(result.hasAuthoredBase).toBe(false);
  });

  it('recognizes an authored base but ignores base-shaped text in comments and scripts', async () => {
    const fake = await scan([
      '<!doctype html><html><head>',
      '<!-- <base href="/comment/"> -->',
      '<script>const sample = `<base href="/script/">`;</script>',
      '</head><body></body></html>',
    ].join(''));
    expect(fake.result.hasAuthoredBase).toBe(false);

    const real = await scan([
      '<!doctype html><html><head>',
      '<!-- <base href="/comment/"> -->',
      '<base href="/authored/">',
      '</head><body></body></html>',
    ].join(''));
    expect(real.result.hasAuthoredBase).toBe(true);
  });

  it('ignores inert base-shaped markup inside templates and noscript text', async () => {
    const fixture = await scan([
      '<html><head>',
      '<template><base href="/template/"><body>template body</body></template>',
      '<noscript><base href="/noscript/"></noscript>',
      '</head><body>real body</body></html>',
    ].join(''));
    expect(fixture.result.hasAuthoredBase).toBe(false);
  });

  it('uses the implicit head after html when the document omits a head tag', async () => {
    const { source, result } = await scan('<!doctype html><html><meta charset="utf-8"><body>ok</body></html>');
    expect(source.subarray(0, result.insertionOffset).toString()).toBe('<!doctype html><html>');
  });

  it('inserts after a doctype when both html and head tags are omitted', async () => {
    const { source, result } = await scan('<!doctype html>\n<main>ok</main>');
    expect(source.subarray(0, result.insertionOffset).toString()).toBe('<!doctype html>\n');
  });

  it('finds head tags and redirect signals split across read chunks', async () => {
    const padding = ' '.repeat((64 * 1024) - '<!doctype html><html>'.length - 2);
    const fixture = `<!doctype html><html>${padding}<head><script>location.replace('./next.html')</script></head><body/>`;
    const { source, result } = await scan(fixture);
    expect(source.subarray(0, result.insertionOffset).toString().endsWith('<head>')).toBe(true);
    expect(result.hasLoadTimeLocationNavigation).toBe(true);
  });

  it('keeps scanning body scripts after the head insertion point is known', async () => {
    const fixture = await scan([
      '<!doctype html><html><head><title>Preview</title></head>',
      '<body><main>Visible content</main>',
      '<script>location.replace("./next.html")</script>',
      '</body></html>',
    ].join(''));
    expect(fixture.result.hasLoadTimeLocationNavigation).toBe(true);
  });

  it('does not close raw-text elements on end-tag-name prefixes', async () => {
    const fixture = await scan([
      '<html><head><script>',
      'const samples = "</scripture><base href=/fake-a/>";',
      'const other = "</script-not-a-tag><base href=/fake-b/>";',
      '</script></head><body>ok</body></html>',
    ].join(''));
    expect(fixture.result.hasAuthoredBase).toBe(false);
  });

  it('waits for the raw-text end-tag delimiter across read chunks', async () => {
    const prefix = '<html><head><script>';
    const splitCandidate = '</script';
    const padding = 'x'.repeat((64 * 1024) - prefix.length - splitCandidate.length);
    const fixture = await scan([
      prefix,
      padding,
      splitCandidate,
      'ure><base href=/fake/>',
      '</script><base href=/real/></head><body>ok</body></html>',
    ].join(''));
    expect(fixture.result.hasAuthoredBase).toBe(true);
  });

  it('treats self-closing syntax on raw-text elements as an opening tag', async () => {
    for (const [open, close] of [
      ['<script/>', '</script>'],
      ['<style />', '</style>'],
    ]) {
      const fixture = await scan([
        '<html><head>',
        open,
        '<base href=/fake/>',
        close,
        '</head><body>ok</body></html>',
      ].join(''));
      expect(fixture.result.hasAuthoredBase).toBe(false);
    }
  });

  it('recognizes a self-closing raw-text start tag split across read chunks', async () => {
    const prefix = '<html><head>';
    const splitCandidate = '<style ';
    const padding = ' '.repeat((64 * 1024) - prefix.length - splitCandidate.length);
    const fixture = await scan([
      prefix,
      padding,
      splitCandidate,
      '/><base href=/fake/></style>',
      '</head><body>ok</body></html>',
    ].join(''));
    expect(fixture.result.hasAuthoredBase).toBe(false);
  });

  it('keeps malformed attacker-sized tags bounded and returns a parser-safe fallback', async () => {
    const fixture = `<!doctype html><${'x'.repeat((256 * 1024) + 1)}`;
    const { result } = await scan(fixture);
    expect(result.insertionOffset).toBe('<!doctype html>'.length);
    expect(result.hasAuthoredBase).toBe(false);
  });
});
