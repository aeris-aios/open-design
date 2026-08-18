import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOpenDesignRuntimeProjection,
  OPEN_DESIGN_RUNTIME_MODES,
  OPEN_DESIGN_RUNTIME_SOURCES,
} from '@open-design/contracts/runtime/sidecars';
import { bootstrapControlPlane } from '@open-design/sidecar/control';

const stopRuntime = vi.fn(async () => undefined);
const startDaemonRuntime = vi.fn(async () => ({
  stop: stopRuntime,
  url: 'http://127.0.0.1:48123',
}));

function runtime(root: string, namespace: string, mode: "dev" | "runtime", source: "tools-dev" | "packaged") {
  return {
    ...createOpenDesignRuntimeProjection(mode, source),
    channel: mode === OPEN_DESIGN_RUNTIME_MODES.DEV ? "dev" : "beta",
    dataRoot: root,
    generation: 0,
    logsRoot: join(root, "logs"),
    namespace,
    resourceRoot: root,
    runtimeRoot: root,
  };
}

function control(root: string, namespace: string, mode: "dev" | "runtime", source: "tools-dev" | "packaged") {
  return bootstrapControlPlane({
    projection: createOpenDesignRuntimeProjection(mode, source),
    roots: { dataRoot: root, logsRoot: join(root, "logs"), resourceRoot: root, runtimeRoot: root },
    scope: { channel: mode === OPEN_DESIGN_RUNTIME_MODES.DEV ? "dev" : "beta", generation: 0, namespace },
  });
}

vi.mock('../src/daemon-startup.js', () => ({
  startDaemonRuntime,
}));

describe('daemon sidecar startup', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.OD_WEB_PORT;
    const { resetDesktopAuthForTests } = await import('../src/desktop-auth.js');
    resetDesktopAuthForTests();
  });

  afterEach(async () => {
    const { resetDesktopAuthForTests } = await import('../src/desktop-auth.js');
    resetDesktopAuthForTests();
    delete process.env.OD_WEB_PORT;
  });

  it('starts through the shared daemon startup path and reports live auth state', async () => {
    const { setDesktopAuthSecret } = await import('../src/desktop-auth.js');
    const { startDaemonSidecar } = await import('../src/sidecar/server.js');
    const root = await mkdtemp(join(tmpdir(), 'od-daemon-sidecar-'));
    const handle = await startDaemonSidecar(
      runtime(root, 'test', OPEN_DESIGN_RUNTIME_MODES.DEV, OPEN_DESIGN_RUNTIME_SOURCES.TOOLS_DEV),
      control(root, 'test', OPEN_DESIGN_RUNTIME_MODES.DEV, OPEN_DESIGN_RUNTIME_SOURCES.TOOLS_DEV),
    );

    try {
      expect(startDaemonRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ port: 0 }),
      );
      const initial = await handle.status();
      expect(initial.state).toBe('running');
      expect(initial.url).toBe('http://127.0.0.1:48123');
      expect(initial.desktopAuthGateActive).toBe(false);

      setDesktopAuthSecret(randomBytes(32));
      const afterAuth = await handle.status();
      expect(afterAuth.desktopAuthGateActive).toBe(true);
    } finally {
      await handle.stop();
      await handle.waitUntilStopped();
      await rm(root, { recursive: true, force: true });
    }

    expect(stopRuntime).toHaveBeenCalled();
  });

  it('registers the live packaged web URL after daemon startup and replaces it on restart', async () => {
    const { startDaemonSidecar } = await import('../src/sidecar/server.js');
    const root = await mkdtemp(join(tmpdir(), 'od-daemon-sidecar-web-url-'));
    const namespace = 'packaged-web-url';
    const handle = await startDaemonSidecar(
      runtime(root, namespace, OPEN_DESIGN_RUNTIME_MODES.RUNTIME, OPEN_DESIGN_RUNTIME_SOURCES.PACKAGED),
      control(root, namespace, OPEN_DESIGN_RUNTIME_MODES.RUNTIME, OPEN_DESIGN_RUNTIME_SOURCES.PACKAGED),
    );

    try {
      expect((await handle.status()).trustedWebOriginPort).toBeNull();

      handle.registerWebUrl({ url: 'http://127.0.0.1:64248' });
      expect(process.env.OD_WEB_PORT).toBe('64248');
      expect((await handle.status()).trustedWebOriginPort).toBe(64248);

      handle.registerWebUrl({ url: 'http://127.0.0.1:53421' });
      expect(process.env.OD_WEB_PORT).toBe('53421');
      expect((await handle.status()).trustedWebOriginPort).toBe(53421);
    } finally {
      await handle.stop();
      await handle.waitUntilStopped();
      await rm(root, { recursive: true, force: true });
    }
  });
});
