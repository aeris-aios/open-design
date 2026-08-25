import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startAmrTerminalReportDeliveryAfterBind, startServer } from '../src/server.js';

describe('/api/version', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('starts terminal delivery only after a valid listener bind', () => {
    const start = vi.fn();
    expect(startAmrTerminalReportDeliveryAfterBind({ start }, null)).toBe(false);
    expect(start).not.toHaveBeenCalled();

    expect(startAmrTerminalReportDeliveryAfterBind({ start }, 7456)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });

  it('returns current app version info', async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    const json = await res.json() as unknown;

    expect(res.ok).toBe(true);
    expect(json).toEqual({
      version: {
        version: expect.any(String),
        channel: expect.any(String),
        packaged: expect.any(Boolean),
        platform: expect.any(String),
        arch: expect.any(String),
        capabilities: { slideRenderer: expect.any(Boolean) },
      },
    });
  });

  // The export routes 501 on exactly `typeof desktopSlideRenderer !== 'function'`.
  // Advertising anything else would let the UI offer an export the daemon then
  // refuses, which is the bug this flag exists to prevent — so the two specs
  // below pin the flag to that binding from both sides.
  it('forbids caching now that the payload carries a runtime capability', async () => {
    // Same URL, different answer depending on which daemon is behind it. A
    // cached response outlives the daemon that produced it, and a stale
    // `slideRenderer: true` would be consumed as authoritative — reopening the
    // export the gate exists to hide.
    const res = await fetch(`${baseUrl}/api/version`);

    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('reports no slide renderer when the daemon runs without one', async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    const json = await res.json() as { version?: { capabilities?: { slideRenderer?: boolean } } };

    expect(json.version?.capabilities?.slideRenderer).toBe(false);
  });

  it('reports a slide renderer when one is injected', async () => {
    const started = await startServer({
      port: 0,
      returnServer: true,
      desktopSlideRenderer: async () => ({ ok: true, slides: [], width: 0, height: 0, mode: 'deck' }),
    }) as { url: string; server: http.Server };
    try {
      const res = await fetch(`${started.url}/api/version`);
      const json = await res.json() as { version?: { capabilities?: { slideRenderer?: boolean } } };

      expect(json.version?.capabilities?.slideRenderer).toBe(true);
    } finally {
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  });

  it('keeps health version aligned with version endpoint', async () => {
    const [healthRes, versionRes] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/version`),
    ]);
    const health = await healthRes.json() as { ok?: unknown; version?: unknown };
    const version = await versionRes.json() as { version?: { version?: unknown } };

    expect(healthRes.ok).toBe(true);
    expect(versionRes.ok).toBe(true);
    expect(health).toEqual({
      ok: true,
      version: version.version?.version,
      amrTerminalReporter: { status: 'active' },
    });
  });

  it('keeps detailed terminal-report counts on local-authorized diagnostics', async () => {
    const allowed = await fetch(`${baseUrl}/api/diagnostics/amr-terminal-reports`);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({
      pending: 0,
      delivered: 0,
      unsupported: 0,
      terminalFailed: 0,
      oldestPendingAgeMs: null,
    });

    const denied = await fetch(`${baseUrl}/api/diagnostics/amr-terminal-reports`, {
      headers: { origin: 'https://example.com' },
    });
    expect(denied.status).toBe(403);
  });
});
