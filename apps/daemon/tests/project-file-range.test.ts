import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseByteRange, resolveProjectFilePath } from '../src/projects.js';
import { startServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// parseByteRange — RFC 7233 unit tests
// ---------------------------------------------------------------------------

describe('parseByteRange', () => {
  it('returns null when header is undefined', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
  });

  it('returns null when header is an empty string', () => {
    expect(parseByteRange('', 1000)).toBeNull();
  });

  it('returns null for non-bytes unit', () => {
    expect(parseByteRange('none=0-100', 1000)).toBeNull();
  });

  it('returns null for multi-range (caller falls back to full 200)', () => {
    expect(parseByteRange('bytes=0-100, 200-300', 1000)).toBeNull();
  });

  it('parses a standard start-end range', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });

  it('clamps an over-long end to fileSize - 1', () => {
    expect(parseByteRange('bytes=0-9999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('parses an open-ended range (bytes=N-)', () => {
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('parses a suffix range (bytes=-N)', () => {
    expect(parseByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });

  it('clamps suffix larger than fileSize to the whole file', () => {
    expect(parseByteRange('bytes=-9999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('returns unsatisfiable when start equals fileSize', () => {
    expect(parseByteRange('bytes=1000-1999', 1000)).toBe('unsatisfiable');
  });

  it('returns unsatisfiable when start exceeds fileSize', () => {
    expect(parseByteRange('bytes=5000-5999', 1000)).toBe('unsatisfiable');
  });

  it('returns unsatisfiable for a zero-length suffix range (bytes=-0)', () => {
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });

  it('returns unsatisfiable for a negative suffix', () => {
    expect(parseByteRange('bytes=--1', 1000)).toBe('unsatisfiable');
  });

  it('returns null for non-integer start', () => {
    expect(parseByteRange('bytes=1.5-499', 1000)).toBeNull();
  });

  it('returns null for non-integer end', () => {
    expect(parseByteRange('bytes=0-499.9', 1000)).toBeNull();
  });

  it('returns null when end < start', () => {
    expect(parseByteRange('bytes=500-100', 1000)).toBeNull();
  });

  it('returns null for alphabetic range values', () => {
    expect(parseByteRange('bytes=abc-xyz', 1000)).toBeNull();
  });

  it('handles a single-byte range (bytes=0-0)', () => {
    expect(parseByteRange('bytes=0-0', 1000)).toEqual({ start: 0, end: 0 });
  });

  it('handles a range that exactly covers the last byte', () => {
    expect(parseByteRange('bytes=999-999', 1000)).toEqual({ start: 999, end: 999 });
  });
});

// ---------------------------------------------------------------------------
// resolveProjectFilePath — integration test (real temp files)
// ---------------------------------------------------------------------------

describe('resolveProjectFilePath', () => {
  let projectsRoot = '';
  const projectId = 'proj-range-test';

  beforeEach(async () => {
    projectsRoot = mkdtempSync(path.join(tmpdir(), 'od-range-'));
    const dir = path.join(projectsRoot, projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'clip.mp4'), Buffer.alloc(2048));
    await writeFile(path.join(dir, 'index.html'), '<html/>');
  });

  afterEach(() => {
    if (projectsRoot) rmSync(projectsRoot, { recursive: true, force: true });
  });

  it('returns the correct size and mime for a video file', async () => {
    const result = await resolveProjectFilePath(projectsRoot, projectId, 'clip.mp4');
    expect(result.size).toBe(2048);
    expect(result.mime).toBe('video/mp4');
    expect(result.kind).toBe('video');
    expect(path.isAbsolute(result.filePath)).toBe(true);
  });

  it('returns the correct mime for an html file', async () => {
    const result = await resolveProjectFilePath(projectsRoot, projectId, 'index.html');
    expect(result.mime).toBe('text/html; charset=utf-8');
  });

  it('throws ENOENT for a missing file', async () => {
    await expect(
      resolveProjectFilePath(projectsRoot, projectId, 'missing.mp4'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects path traversal attempts', async () => {
    await expect(
      resolveProjectFilePath(projectsRoot, projectId, '../other-project/secret.mp4'),
    ).rejects.toThrow();
  });

  it('rejects symlink escapes inside managed projects', async () => {
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'od-range-outside-'));
    try {
      await writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
      await symlink(
        path.join(outsideRoot, 'secret.txt'),
        path.join(projectsRoot, projectId, 'linked-secret.txt'),
      );

      await expect(
        resolveProjectFilePath(projectsRoot, projectId, 'linked-secret.txt'),
      ).rejects.toMatchObject({ code: 'EPATHESCAPE' });
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/raw/* — HTTP route-level tests
// Exercises the actual endpoint the VideoViewer and AudioViewer components
// call, confirming 206 / Accept-Ranges / Content-Range behaviour end-to-end.
// ---------------------------------------------------------------------------

describe('GET /api/projects/:id/raw/* range request route', () => {
  let server: http.Server;
  let baseUrl: string;
  let projectsRoot: string;
  const projectId = 'proj-raw-range-test';
  const FILE_SIZE = 512;

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;

    const createResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Raw range fixture' }),
    });
    expect(createResponse.status).toBe(200);

    // Write a test video file into the daemon's projects root.
    // OD_DATA_DIR is set by tests/setup.ts so we can derive the path.
    projectsRoot = path.join(process.env.OD_DATA_DIR!, 'projects');
    const dir = path.join(projectsRoot, projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'clip.mp4'), Buffer.alloc(FILE_SIZE, 0x42));
    await writeFile(path.join(dir, 'audio.mp3'), Buffer.alloc(FILE_SIZE, 0x43));
    await writeFile(path.join(dir, 'page.html'), Buffer.from('<html/>'));
    await writeFile(
      path.join(dir, 'large.html'),
      Buffer.from(`<!doctype html><html><body><main>Large Preview</main>${'x'.repeat((2 * 1024 * 1024) + 256)}</body></html>`),
    );
    await writeFile(
      path.join(dir, 'large-powered.html'),
      Buffer.from(`<!doctype html><html><body>${'x'.repeat((2 * 1024 * 1024) + 256)}<script>new Worker("worker.js")</script></body></html>`),
    );
    await writeFile(
      path.join(dir, 'large-external.html'),
      Buffer.from([
        '<!doctype html><html><head>',
        '<link rel="stylesheet" href="./styles.css">',
        '<script src="./support.js"></script>',
        ...Array.from({ length: 43 }, (_, index) => (
          `<script type="text/babel" src="./screen-${index + 1}.jsx"></script>`
        )),
        '</head><body><main id="root">External Preview</main>',
        '<!-- ',
        'x'.repeat((2 * 1024 * 1024) + 256),
        ' --></body></html>',
      ].join('')),
    );
    await writeFile(
      path.join(dir, 'large-body-redirect.html'),
      Buffer.from([
        '<!doctype html><html><head><title>Body redirect</title></head>',
        '<body><main>Redirect Preview</main>',
        '<!-- ',
        'x'.repeat((2 * 1024 * 1024) + 256),
        ' -->',
        '<script>location.replace("./next.html")</script>',
        '</body></html>',
      ].join('')),
    );
    await writeFile(
      path.join(dir, 'large-late-guards.html'),
      Buffer.from([
        '<!doctype html><html><head><title>Late guards</title></head><body>',
        'x'.repeat((96 * 1024) + 1),
        '<input autofocus>',
        '<script type="text/babel" src="./screen-1.jsx"></script>',
        '<script>location.replace("./next.html")</script>',
        'x'.repeat((2 * 1024 * 1024) + 256),
        '</body></html>',
      ].join('')),
    );
    const deckSource = [
      '<!doctype html><html><head><style>.slide{display:none}.slide.active{display:block}</style></head>',
      '<body><main id="deck-stage"><deck-stage>',
      '<section class="slide active">One</section><section class="slide">Two</section>',
      '</deck-stage></main>',
      '<script>window.addEventListener("message",function(event){if(event.data.type==="od:slide"){};});',
      'window.addEventListener("keydown",function(event){if(event.key==="ArrowRight"){};});',
      'window.addEventListener("hashchange",function(){return location.hash||"#/";});</script>',
      '</body></html>',
    ].join('');
    await writeFile(path.join(dir, 'deck.html'), deckSource);
    await writeFile(
      path.join(dir, 'large-deck.html'),
      deckSource.replace('</body>', `<!-- ${'x'.repeat((2 * 1024 * 1024) + 256)} --></body>`),
    );
    await writeFile(path.join(dir, 'styles.css'), 'body { color: rgb(1, 2, 3); }');
    await writeFile(path.join(dir, 'support.js'), 'window.__supportLoaded = true;');
    for (let index = 1; index <= 43; index += 1) {
      await writeFile(path.join(dir, `screen-${index}.jsx`), `window.__screen${index} = true;`);
    }
    await writeFile(path.join(dir, 'body.html'), Buffer.from('<html><body><main>Preview</main></body></html>'));
    await writeFile(
      path.join(dir, 'guarded.html'),
      Buffer.from('<!doctype html><html><head><script src="./boot.js"></script></head><body><input autofocus></body></html>'),
    );
    const complexPreviewDir = path.join(dir, 'prototypes', 'booking');
    await mkdir(path.join(complexPreviewDir, 'styles'), { recursive: true });
    await mkdir(path.join(complexPreviewDir, 'scripts'), { recursive: true });
    await mkdir(path.join(complexPreviewDir, 'components'), { recursive: true });
    await mkdir(path.join(complexPreviewDir, 'assets'), { recursive: true });
    const babelScripts = Array.from(
      { length: 43 },
      (_, index) => `<script type="text/babel" src="./components/screen-${index + 1}.jsx"></script>`,
    ).join('');
    await writeFile(
      path.join(complexPreviewDir, 'index.html'),
      Buffer.from([
        '<!doctype html><html><head>',
        '<link rel="stylesheet" href="./styles/app.css">',
        '<script src="./scripts/support.js"></script>',
        babelScripts,
        '<script type="module" src="./scripts/module.js"></script>',
        '</head><body>',
        '<img src="./assets/card.svg" srcset="./assets/card.svg 1x, ./assets/card@2x.svg 2x">',
        '<main id="root"></main>',
        '</body></html>',
      ].join('')),
    );
    await writeFile(
      path.join(complexPreviewDir, 'styles', 'app.css'),
      '@import "./theme.css"; .card { background-image: url("../assets/card.svg"); }',
    );
    await writeFile(path.join(complexPreviewDir, 'styles', 'theme.css'), ':root { --accent: #0a7; }');
    await writeFile(
      path.join(complexPreviewDir, 'scripts', 'support.js'),
      'window.__supportLoaded = true; fetch("./data.json").then((response) => response.json());',
    );
    await writeFile(path.join(complexPreviewDir, 'scripts', 'module.js'), 'export const ready = true;');
    for (let index = 1; index <= 43; index += 1) {
      await writeFile(
        path.join(complexPreviewDir, 'components', `screen-${index}.jsx`),
        `window.__screen${index} = () => <section>Screen ${index}</section>;`,
      );
    }
    await writeFile(path.join(complexPreviewDir, 'data.json'), '{"ready":true}');
    await writeFile(path.join(complexPreviewDir, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(path.join(complexPreviewDir, 'assets', 'card@2x.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>');
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'assets', 'root.css'), ':root { --scope-root: true; }');
    await writeFile(
      path.join(dir, 'bridged.html'),
      Buffer.from('<html><body><script data-od-url-scroll-bridge></script><main>Preview</main></body></html>'),
    );
    await writeFile(
      path.join(dir, 'selection-bridged.html'),
      Buffer.from('<html><body><script data-od-url-selection-bridge></script><main>Preview</main></body></html>'),
    );
    await writeFile(
      path.join(dir, 'snapshot-bridged.html'),
      Buffer.from('<html><body><script data-od-url-snapshot-bridge></script><main>Preview</main></body></html>'),
    );
    await writeFile(
      path.join(dir, 'observability-bridged.html'),
      Buffer.from('<html><head><script data-od-preview-observability></script></head><body><main>Preview</main></body></html>'),
    );
    await mkdir(path.join(dir, 'dist', 'assets'), { recursive: true });
    await writeFile(
      path.join(dir, 'vite-entry.html'),
      Buffer.from('<!doctype html><html><head><script type="module" src="/src/main.tsx"></script></head><body><div id="root"></div></body></html>'),
    );
    await writeFile(
      path.join(dir, 'dist', 'index.html'),
      Buffer.from(
        '<!doctype html><html><head>' +
          '<script type="module" crossorigin src="/assets/app.js"></script>' +
          '<link rel="stylesheet" crossorigin href="/assets/app.css">' +
          '</head><body><div id="root"></div></body></html>',
      ),
    );
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const rawUrl = (name: string) => `${baseUrl}/api/projects/${projectId}/raw/${name}`;
  const poweredUrl = (name: string) => `${baseUrl}/api/projects/${projectId}/powered/${name}`;
  const poweredOrigin = () => {
    const url = new URL(baseUrl);
    url.hostname = url.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
    return url.origin;
  };
  const scopedRequest = (
    requestPath: string,
    hostHeader: string,
  ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> => {
    const target = new URL(baseUrl);
    return new Promise((resolve, reject) => {
      const request = http.request({
        hostname: target.hostname,
        port: target.port,
        path: requestPath,
        method: 'GET',
        headers: { Host: hostHeader },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
        }));
      });
      request.on('error', reject);
      request.end();
    });
  };

  it('advertises Accept-Ranges: bytes for a video file with no Range header', async () => {
    const res = await fetch(rawUrl('clip.mp4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toContain('video/mp4');
    expect(Number(res.headers.get('content-length'))).toBe(FILE_SIZE);
  });

  it('returns 206 with correct Content-Range for a partial video request', async () => {
    const res = await fetch(rawUrl('clip.mp4'), {
      headers: { Range: 'bytes=0-99' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${FILE_SIZE}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(100);
    expect(buf[0]).toBe(0x42);
  });

  it('returns 206 for an open-ended range on an audio file', async () => {
    const res = await fetch(rawUrl('audio.mp3'), {
      headers: { Range: 'bytes=256-' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 256-${FILE_SIZE - 1}/${FILE_SIZE}`);
    expect(res.headers.get('content-length')).toBe(String(FILE_SIZE - 256));
  });

  it('returns 206 for a suffix range', async () => {
    const res = await fetch(rawUrl('clip.mp4'), {
      headers: { Range: 'bytes=-128' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${FILE_SIZE - 128}-${FILE_SIZE - 1}/${FILE_SIZE}`);
    expect(res.headers.get('content-length')).toBe('128');
  });

  it('returns 416 for an out-of-bounds range', async () => {
    const res = await fetch(rawUrl('clip.mp4'), {
      headers: { Range: 'bytes=9999-99999' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${FILE_SIZE}`);
  });

  it('does not stream small transformed HTML files (HTML returns full 200 without Accept-Ranges)', async () => {
    const res = await fetch(rawUrl('page.html'));
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBeNull();
    const text = await res.text();
    expect(text).toBe('<html/>');
  });

  it('returns a truncated text preview for large HTML without reading the full file', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/text-preview/large.html?limit=64`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      text: string;
      truncated: boolean;
      size: number;
      limit: number;
      mime: string;
      poweredPreview: {
        required: boolean;
        scannedBytes: number;
        complete: boolean;
      };
    };
    expect(body.text).toContain('<!doctype html>');
    expect(body.text.length).toBeLessThanOrEqual(1024);
    expect(body.truncated).toBe(true);
    expect(body.size).toBeGreaterThan(2 * 1024 * 1024);
    expect(body.limit).toBe(1024);
    expect(body.mime).toContain('text/html');
    expect(body.poweredPreview.required).toBe(false);
    expect(body.poweredPreview.complete).toBe(true);
  });

  it('returns powered-preview hints even when the Worker/WASM signal is late in a large HTML file', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/text-preview/large-powered.html?limit=64`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      text: string;
      poweredPreview: {
        required: boolean;
        scannedBytes: number;
        complete: boolean;
      };
    };
    expect(body.text.length).toBeLessThanOrEqual(1024);
    expect(body.text).not.toContain('new Worker');
    expect(body.poweredPreview.required).toBe(true);
    expect(body.poweredPreview.scannedBytes).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('returns passive-guard hints when every signal is after the text-preview prefix', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/text-preview/large-late-guards.html?limit=${96 * 1024}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      text: string;
      passiveGuards: {
        sandbox: boolean;
        focus: boolean;
        redirect: boolean;
        scannedBytes: number;
        complete: boolean;
      };
    };
    expect(body.text).not.toContain('autofocus');
    expect(body.text).not.toContain('text/babel');
    expect(body.text).not.toContain('location.replace');
    expect(body.passiveGuards).toMatchObject({
      sandbox: true,
      focus: true,
      redirect: true,
    });
    expect(body.passiveGuards.scannedBytes).toBeGreaterThan(96 * 1024);
  });

  it('streams URL preview bridges into large HTML while preserving range semantics', async () => {
    const url = `${rawUrl('large.html')}?odPreviewBridge=scroll&odPreviewBridge=selection&odPreviewBridge=snapshot&odPreviewBridge=observability`;
    const full = await fetch(url);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const body = Buffer.from(await full.arrayBuffer());
    const html = body.toString('utf8');
    expect(Number(full.headers.get('content-length'))).toBe(body.byteLength);
    expect(html).toContain('Large Preview');
    expect(html).toContain('data-od-url-scroll-bridge');
    expect(html).toContain('data-od-url-selection-bridge');
    expect(html).toContain('data-od-url-snapshot-bridge');
    expect(html).toContain('data-od-preview-observability');
    expect(html).toContain('data-od-project-preview-base');

    const rangeStart = html.indexOf('data-od-url-selection-bridge') - 32;
    const rangeEnd = rangeStart + 255;
    const partial = await fetch(url, {
      headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(
      `bytes ${rangeStart}-${rangeEnd}/${body.byteLength}`,
    );
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(body.subarray(rangeStart, rangeEnd + 1));

    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(2 * 1024 * 1024);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it('keeps large support.js, CSS, and Babel-script previews on a scoped real URL', async () => {
    const source = await fetch(rawUrl('large-external.html'));
    const sourceBody = Buffer.from(await source.arrayBuffer());
    expect(sourceBody.toString()).not.toContain('data-od-project-preview-base');

    const preview = await fetch(
      `${rawUrl('large-external.html')}?odPreviewBridge=sandbox&odPreviewBridge=focus&odPreviewBridge=selection`,
    );
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain('data-od-project-preview-base');
    expect(html).toContain('data-od-sandbox-shim');
    expect(html).toContain('data-od-preview-focus-guard');
    expect(html).toContain('data-od-url-selection-bridge');
    expect(html.indexOf('data-od-project-preview-base')).toBeLessThan(html.indexOf('src="./support.js"'));
    expect(html).toContain('src="./screen-43.jsx"');
    expect(html).toContain('href="./styles.css"');

    const baseHref = html.match(/<base href="([^"]+)" data-od-project-preview-base>/)?.[1];
    expect(baseHref).toBeTruthy();
    const previewBase = new URL(baseHref!, baseUrl);
    const [script, css, jsx] = await Promise.all([
      fetch(new URL('support.js', previewBase)),
      fetch(new URL('styles.css', previewBase)),
      fetch(new URL('screen-43.jsx', previewBase)),
    ]);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('__supportLoaded');
    expect(css.status).toBe(200);
    expect(await css.text()).toContain('rgb(1, 2, 3)');
    expect(jsx.status).toBe(200);
    expect(await jsx.text()).toContain('__screen43');
  });

  it('enables load-time redirect blocking for a large body script', async () => {
    const preview = await fetch(
      `${rawUrl('large-body-redirect.html')}?odPreviewBridge=redirect`,
      { headers: { Connection: 'close' } },
    );
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain('data-od-preview-redirect-guard');
    expect(html).toContain('var BLOCK_LOAD_TIME_SCRIPT_REDIRECT = true;');
    expect(html).toContain('location.replace("./next.html")');
  });

  it('streams every requested passive guard for signals after the routing prefix', async () => {
    const preview = await fetch(
      `${rawUrl('large-late-guards.html')}?odPreviewBridge=sandbox&odPreviewBridge=focus&odPreviewBridge=redirect`,
      { headers: { Connection: 'close' } },
    );
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain('data-od-sandbox-shim');
    expect(html).toContain('data-od-preview-focus-guard');
    expect(html).toContain('data-od-preview-redirect-guard');
    expect(html).toContain('var BLOCK_LOAD_TIME_SCRIPT_REDIRECT = true;');
  });

  it('streams requested bridges into large powered HTML previews', async () => {
    const preview = await fetch(
      `${poweredUrl('large-powered.html')}?odPreviewBridge=observability&odPreviewBridge=snapshot`,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('document-isolation-policy')).toBe('isolate-and-credentialless');
    const html = await preview.text();
    expect(html).toContain('data-od-preview-observability');
    expect(html).toContain('data-od-url-snapshot-bridge');
    expect(html).toContain('new Worker("worker.js")');
  });

  it('injects the URL preview scroll bridge only when requested', async () => {
    const plain = await fetch(rawUrl('page.html'));
    expect(await plain.text()).toBe('<html/>');

    const bridged = await fetch(`${rawUrl('page.html')}?odPreviewBridge=scroll`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html).toContain('data-od-url-scroll-bridge');
    expect(html).toContain("type: 'od:preview-scroll'");
    expect(html).toContain("type: 'od:preview-content-size'");
    expect(html).toContain('od:preview-content-size-request');
    expect(html).toContain('lastContentSizeRequest.measurementId');
    expect(html).toContain('lastContentSizeRequest.generation');
    expect(html).toContain('documentEpoch: contentSizeDocumentEpoch');
    expect(html).toContain("get('odPreviewEpoch')");
    expect(html).toContain('scrollWidth: size && size.scrollWidth');
    expect(html).toContain('clientWidth: size && size.clientWidth');
  });

  it('injects the URL preview scroll bridge before the closing body tag', async () => {
    const bridged = await fetch(`${rawUrl('body.html')}?odPreviewBridge=scroll`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html.indexOf('data-od-url-scroll-bridge')).toBeGreaterThan(-1);
    expect(html.indexOf('data-od-url-scroll-bridge')).toBeLessThan(html.indexOf('</body>'));
  });

  it('injects the URL preview selection bridge only when requested', async () => {
    const plain = await fetch(rawUrl('page.html'));
    expect(await plain.text()).toBe('<html/>');

    const bridged = await fetch(`${rawUrl('page.html')}?odPreviewBridge=selection`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html).toContain('data-od-url-selection-bridge');
    expect(html).toContain("type: 'od:comment-target'");
    expect(html).toContain("type: 'od:preview-runtime-state-captured'");
    expect(html).toContain('roots: roots');
    expect(html).toContain('function postReady(');
    expect(html).toContain('href: window.location.href');
    expect(html).not.toContain('data-od-url-scroll-bridge');
  });

  it('injects the URL preview snapshot bridge only when requested', async () => {
    const plain = await fetch(rawUrl('page.html'));
    expect(await plain.text()).toBe('<html/>');

    const bridged = await fetch(`${rawUrl('page.html')}?odPreviewBridge=snapshot`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html).toContain('data-od-url-snapshot-bridge');
    expect(html).toContain("type: 'od:snapshot:result'");
    expect(html).not.toContain('data-od-url-scroll-bridge');
    expect(html).not.toContain('data-od-url-selection-bridge');
  });

  it('injects URL preview observability before author scripts when requested', async () => {
    const bridged = await fetch(`${rawUrl('body.html')}?odPreviewBridge=observability`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html).toContain('data-od-preview-observability');
    expect(html).toContain("send('runtime_error'");
    expect(html).toContain("send('white_screen'");
    expect(html.indexOf('data-od-preview-observability')).toBeLessThan(html.indexOf('<body>'));
  });

  it('injects passive URL guards before authored scripts', async () => {
    const bridged = await fetch(
      `${rawUrl('guarded.html')}?odPreviewBridge=sandbox&odPreviewBridge=focus&odPreviewBridge=redirect`,
    );
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    const authorScriptIndex = html.indexOf('<script src="./boot.js">');
    expect(authorScriptIndex).toBeGreaterThan(-1);
    expect(html).toContain('data-od-sandbox-shim');
    expect(html).toContain('data-od-preview-focus-guard');
    expect(html).toContain('data-od-preview-redirect-guard');
    expect(html.indexOf('data-od-sandbox-shim')).toBeLessThan(authorScriptIndex);
    expect(html.indexOf('data-od-preview-focus-guard')).toBeLessThan(authorScriptIndex);
    expect(html.indexOf('data-od-preview-redirect-guard')).toBeLessThan(authorScriptIndex);
  });

  it('preserves and serves complex nested external resources through a guarded URL preview', async () => {
    const response = await fetch(
      `${rawUrl('prototypes/booking/index.html')}?odPreviewBridge=scroll&odPreviewBridge=selection&odPreviewBridge=snapshot&odPreviewBridge=observability&odPreviewBridge=sandbox&odPreviewBridge=focus`,
    );
    expect(response.status).toBe(200);
    const html = await response.text();

    const firstAuthorScript = html.indexOf('<script src="./scripts/support.js">');
    expect(firstAuthorScript).toBeGreaterThan(-1);
    expect(html.indexOf('data-od-sandbox-shim')).toBeLessThan(firstAuthorScript);
    expect(html.indexOf('data-od-preview-focus-guard')).toBeLessThan(firstAuthorScript);
    expect(html.match(/type="text\/babel"/g)).toHaveLength(43);
    expect(html).toContain('<script type="module" src="./scripts/module.js"></script>');
    expect(html).toContain('srcset="./assets/card.svg 1x, ./assets/card@2x.svg 2x"');

    const baseHref = html.match(/<base href="([^"]+)" data-od-project-preview-base>/)?.[1];
    expect(baseHref).toBeTruthy();
    const previewBase = new URL(baseHref!, baseUrl);
    const expectedResources = new Map([
      ['./styles/app.css', '@import "./theme.css"; .card { background-image: url("../assets/card.svg"); }'],
      ['./styles/theme.css', ':root { --accent: #0a7; }'],
      ['./scripts/support.js', 'window.__supportLoaded = true; fetch("./data.json").then((response) => response.json());'],
      ['./scripts/module.js', 'export const ready = true;'],
      ['./components/screen-43.jsx', 'window.__screen43 = () => <section>Screen 43</section>;'],
      ['./data.json', '{"ready":true}'],
      ['./assets/card.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
      ['./assets/card@2x.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>'],
    ]);
    for (const [relativePath, expectedBody] of expectedResources) {
      const assetResponse = await fetch(new URL(relativePath, previewBase));
      expect(assetResponse.status, relativePath).toBe(200);
      expect(await assetResponse.text(), relativePath).toBe(expectedBody);
    }
  });

  it('binds a scoped preview origin to one project root and blocks daemon APIs', async () => {
    const minted = await fetch(
      `${baseUrl}/api/projects/${projectId}/preview-url?file=prototypes%2Fbooking%2Findex.html`,
    );
    expect(minted.status).toBe(200);
    const preview = await minted.json() as {
      url: string;
      scopedOrigin?: {
        normalUrl: string;
        poweredUrl: string;
        documentVersion: string;
      };
    };
    const scope = preview.url.match(/\/preview\/([^/]+)\//u)?.[1];
    expect(scope).toBeTruthy();

    const port = new URL(baseUrl).port;
    expect(preview.scopedOrigin).toEqual({
      normalUrl: `http://n-${scope}.localhost:${port}/prototypes/booking/index.html`,
      poweredUrl: `http://p-${scope}.localhost:${port}/prototypes/booking/index.html`,
      documentVersion: expect.stringMatching(/^\d+:\d+(?:\.\d+)?$/u),
    });
    const normalHost = `n-${scope}.localhost:${port}`;
    const html = await scopedRequest(
      '/prototypes/booking/index.html?odPreviewBridge=scroll',
      normalHost,
    );
    expect(html.status).toBe(200);
    expect(html.body).toContain('<script src="./scripts/support.js">');
    expect(html.body).toContain('data-od-preview-runtime');
    expect(html.body).toContain("register('scroll'");
    expect(html.body).toContain('data-od-url-selection-bridge');
    expect(html.body).toContain("register(\"selection\"");
    expect(html.body).toContain("register(\"comment\"");
    expect(html.body).toContain("register(\"inspect\"");
    expect(html.body).toContain("register(\"draw\"");
    expect(html.body).toContain('data-od-url-snapshot-bridge');
    expect(html.body).toContain("register(\"snapshot\"");
    expect(html.body).toContain('data-od-preview-observability');
    expect(html.body).toContain("register(\"observability\"");
    expect(html.body).toContain('data-od-preview-runtime');
    expect(html.body).toContain('"content_measurement","scroll","snapshot","observability","selection","comment","inspect","draw","tweaks","palette"');
    expect(html.body).toContain("register('tweaks'");
    expect(html.body).toContain("register('palette'");
    expect(html.body.indexOf('data-od-preview-runtime')).toBeLessThan(
      html.body.indexOf('<script src="./scripts/support.js">'),
    );

    const nestedScript = await scopedRequest(
      '/prototypes/booking/scripts/support.js',
      normalHost,
    );
    expect(nestedScript.status).toBe(200);
    expect(nestedScript.body).toContain('window.__supportLoaded = true');

    const rootAsset = await scopedRequest('/assets/root.css', normalHost);
    expect(rootAsset.status).toBe(200);
    expect(rootAsset.body).toBe(':root { --scope-root: true; }');

    const large = await scopedRequest(
      '/large-external.html?odPreviewBridge=scroll&odPreviewBridge=selection',
      normalHost,
    );
    expect(large.status).toBe(200);
    expect(large.body).toContain('data-od-preview-runtime');
    expect(large.body).toContain('data-od-preview-runtime');
    expect(large.body).toContain("register('scroll'");
    expect(large.body).toContain('data-od-url-selection-bridge');
    expect(large.body.match(/type="text\/babel"/gu)).toHaveLength(43);
    expect(large.body.indexOf('data-od-preview-runtime')).toBeLessThan(
      large.body.indexOf('<script src="./support.js">'),
    );

    const smallDeck = await scopedRequest(
      '/deck.html?odPreviewRuntime=deck',
      normalHost,
    );
    expect(smallDeck.status).toBe(200);
    expect(smallDeck.body).toContain('"palette","deck"');
    expect(smallDeck.body).toContain("register('deck'");
    expect(smallDeck.body).toContain('__odDeckStageFallbackInstalled');
    expect(smallDeck.body).toContain('var odHasArtifactKeydownListener = true;');
    expect(smallDeck.body).toContain('var odHasExternalSlideMessageListener = true;');
    expect(smallDeck.body.indexOf('__odDeckStageFallbackInstalled')).toBeLessThan(
      smallDeck.body.indexOf('<main id="deck-stage">'),
    );

    const largeDeck = await scopedRequest(
      '/large-deck.html?odPreviewRuntime=deck',
      normalHost,
    );
    expect(largeDeck.status).toBe(200);
    expect(largeDeck.body).toContain('"palette","deck"');
    expect(largeDeck.body).toContain("register('deck'");
    expect(largeDeck.body).toContain('__odDeckStageFallbackInstalled');
    expect(largeDeck.body).toContain('var odHasArtifactKeydownListener = true;');
    expect(largeDeck.body).toContain('var odHasExternalSlideMessageListener = true;');
    expect(largeDeck.body.indexOf('__odDeckStageFallbackInstalled')).toBeLessThan(
      largeDeck.body.indexOf('<main id="deck-stage">'),
    );

    const api = await scopedRequest('/api/projects', normalHost);
    expect(api.status).toBe(403);
    expect(JSON.parse(api.body)).toEqual({
      error: 'Project preview origin cannot access daemon API routes',
    });

    const powered = await scopedRequest(
      '/prototypes/booking/index.html',
      `p-${scope}.localhost:${port}`,
    );
    expect(powered.status).toBe(200);
    expect(powered.headers['document-isolation-policy']).toBe('isolate-and-credentialless');

    const unknownScope = await scopedRequest(
      '/prototypes/booking/index.html',
      `n-00000000-0000-0000-0000-000000000000.localhost:${port}`,
    );
    expect(unknownScope.status).toBe(404);
    expect(JSON.parse(unknownScope.body).error.code).toBe('PREVIEW_SCOPE_NOT_FOUND');
  });

  it('serves built dist HTML for Vite dev entries so previews do not load /src from daemon root', async () => {
    const res = await fetch(rawUrl('vite-entry.html'));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).not.toContain('/src/main.tsx');
    expect(html).not.toContain('src="/assets/app.js"');
    expect(html).not.toContain('href="/assets/app.css"');
    expect(html).toContain('src="dist/assets/app.js"');
    expect(html).toContain('href="dist/assets/app.css"');
  });

  it('does not expose powered preview project files to foreign browser origins through CORS', async () => {
    const browserOrigin = new URL(baseUrl);
    browserOrigin.hostname = browserOrigin.hostname === '127.0.0.1'
      ? 'localhost'
      : '127.0.0.1';

    const res = await fetch(poweredUrl('page.html'), {
      headers: { Origin: browserOrigin.origin },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('document-isolation-policy')).toBe('isolate-and-credentialless');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await res.text()).toBe('<html/>');

    const foreign = await fetch(poweredUrl('page.html'), {
      headers: { Origin: 'https://foreign.example' },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await fetch(poweredUrl('page.html'), {
      method: 'OPTIONS',
      headers: {
        Origin: browserOrigin.origin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('injects the URL preview scroll bridge for powered previews when requested', async () => {
    const bridged = await fetch(`${poweredUrl('page.html')}?odPreviewBridge=scroll`);
    expect(bridged.status).toBe(200);
    expect(bridged.headers.get('document-isolation-policy')).toBe('isolate-and-credentialless');
    const html = await bridged.text();
    expect(html).toContain('data-od-url-scroll-bridge');
    expect(html).toContain("type: 'od:preview-content-size'");
    expect(html).toContain('od:preview-content-size-request');
    expect(html).toContain('lastContentSizeRequest.measurementId');
    expect(html).toContain('lastContentSizeRequest.generation');
    expect(html).toContain('documentEpoch: contentSizeDocumentEpoch');
    expect(html).toContain("get('odPreviewEpoch')");
    expect(html).toContain('scrollWidth: size && size.scrollWidth');
    expect(html).toContain('clientWidth: size && size.clientWidth');
  });

  it('injects preview observability for powered previews when requested', async () => {
    const bridged = await fetch(`${poweredUrl('page.html')}?odPreviewBridge=observability`);
    expect(bridged.status).toBe(200);
    expect(bridged.headers.get('document-isolation-policy')).toBe('isolate-and-credentialless');
    const html = await bridged.text();
    expect(html).toContain('data-od-preview-observability');
    expect(html).toContain("send('runtime_error'");
    expect(html).toContain("send('white_screen'");
  });

  it('does not let the powered preview origin call normal daemon APIs', async () => {
    const origin = poweredOrigin();
    const poweredReferer = `${origin}/api/projects/${projectId}/powered/page.html`;

    const poweredFile = await fetch(`${origin}/api/projects/${projectId}/powered/page.html`, {
      headers: {
        Referer: poweredReferer,
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    expect(poweredFile.status).toBe(200);
    expect(await poweredFile.text()).toBe('<html/>');

    const api = await fetch(`${origin}/api/projects`, {
      headers: {
        Referer: poweredReferer,
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({
      error: 'Powered preview origin cannot access this API route',
    });
  });

  it('injects all URL preview bridges together', async () => {
    const bridged = await fetch(`${rawUrl('body.html')}?odPreviewBridge=scroll&odPreviewBridge=selection&odPreviewBridge=snapshot&odPreviewBridge=observability`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html).toContain('data-od-url-scroll-bridge');
    expect(html).toContain('data-od-url-selection-bridge');
    expect(html).toContain('data-od-url-snapshot-bridge');
    expect(html).toContain('data-od-preview-observability');
    expect(html.indexOf('data-od-preview-observability')).toBeLessThan(html.indexOf('<body>'));
    expect(html.indexOf('data-od-url-scroll-bridge')).toBeLessThan(html.indexOf('</body>'));
    expect(html.indexOf('data-od-url-selection-bridge')).toBeLessThan(html.indexOf('</body>'));
    expect(html.indexOf('data-od-url-snapshot-bridge')).toBeLessThan(html.indexOf('</body>'));
  });

  it('does not inject the URL preview scroll bridge twice', async () => {
    const bridged = await fetch(`${rawUrl('bridged.html')}?odPreviewBridge=scroll`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html.match(/data-od-url-scroll-bridge/g)?.length).toBe(1);
  });

  it('does not inject the URL preview selection bridge twice', async () => {
    const bridged = await fetch(`${rawUrl('selection-bridged.html')}?odPreviewBridge=selection`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html.match(/data-od-url-selection-bridge/g)?.length).toBe(1);
  });

  it('does not inject the URL preview snapshot bridge twice', async () => {
    const bridged = await fetch(`${rawUrl('snapshot-bridged.html')}?odPreviewBridge=snapshot`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html.match(/data-od-url-snapshot-bridge/g)?.length).toBe(1);
  });

  it('does not inject the URL preview observability bridge twice', async () => {
    const bridged = await fetch(`${rawUrl('observability-bridged.html')}?odPreviewBridge=observability`);
    expect(bridged.status).toBe(200);
    const html = await bridged.text();
    expect(html.match(/data-od-preview-observability/g)?.length).toBe(1);
  });

  it('returns 404 for a missing file', async () => {
    const res = await fetch(rawUrl('missing.mp4'));
    expect(res.status).toBe(404);
  });
});
