import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  browserWindow: vi.fn(),
  loadArtifactDocument: vi.fn(async () => {}),
  waitForPrintableContent: vi.fn(async () => {}),
}));

vi.mock('electron', () => ({ BrowserWindow: mocks.browserWindow }));
vi.mock('../../src/main/deck-capture.js', () => ({
  loadArtifactDocument: mocks.loadArtifactDocument,
}));
vi.mock('../../src/main/pdf-export.js', () => ({
  waitForPrintableContent: mocks.waitForPrintableContent,
}));

import {
  frameFilePath,
  renderDeterministicFrames,
} from '../../src/main/frame-capture.js';

describe('deterministic Electron frame capture', () => {
  const scratch: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(scratch.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  test('[P0] seeks every frame before taking a fresh CDP screenshot', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'od-frame-capture-'));
    scratch.push(outputDir);
    const events: string[] = [];
    const debuggerApi = {
      attach: vi.fn(() => events.push('attach')),
      detach: vi.fn(() => events.push('detach')),
      sendCommand: vi.fn(async (command: string) => {
        if (command === 'Page.captureScreenshot') {
          events.push('capture');
          return { data: Buffer.from('png-frame').toString('base64') };
        }
        events.push(command);
        return {};
      }),
    };
    const window = {
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setContentSize: vi.fn(),
      setOpacity: vi.fn(),
      showInactive: vi.fn(),
      webContents: {
        debugger: debuggerApi,
        executeJavaScript: vi.fn(async (expression: string) => {
          if (expression.includes('bridge.ready')) return { duration: 0.1, fps: 30, hasAudio: false };
          if (expression.includes('__odFrameRenderer.seek')) {
            const match = /seek\([^,]+, (\d+)\)/.exec(expression);
            events.push(`seek:${match?.[1] ?? '?'}`);
          } else if (expression.includes('requestAnimationFrame')) {
            events.push('settle');
          }
          return undefined;
        }),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
    mocks.browserWindow.mockImplementation(function BrowserWindowMock() {
      return window;
    });

    const result = await renderDeterministicFrames({
      fps: 30,
      height: 180,
      html: '<main></main>',
      outputDir,
      width: 320,
    });

    expect(result).toMatchObject({ frameCount: 3, fps: 30, ok: true });
    expect(events.filter((event) => event.startsWith('seek:'))).toEqual(['seek:0', 'seek:1', 'seek:2']);
    expect(events.filter((event) => event === 'capture')).toHaveLength(3);
    for (let frame = 0; frame < 3; frame += 1) {
      const seek = events.indexOf(`seek:${frame}`);
      const capture = events.indexOf('capture', seek);
      expect(capture).toBeGreaterThan(seek);
      await expect(readFile(frameFilePath(outputDir, frame), 'utf8')).resolves.toBe('png-frame');
    }
    expect(debuggerApi.detach).toHaveBeenCalledOnce();
    expect(window.destroy).toHaveBeenCalledOnce();
  });

  test('uses zero-padded names that match the FFmpeg printf pattern', () => {
    expect(frameFilePath('/tmp/frames', 42)).toBe('/tmp/frames/frame-00000042.png');
  });

  test('rejects audio compositions instead of silently producing a muted video', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'od-frame-capture-audio-'));
    scratch.push(outputDir);
    const attach = vi.fn();
    const window = {
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setContentSize: vi.fn(),
      setOpacity: vi.fn(),
      showInactive: vi.fn(),
      webContents: {
        debugger: {
          attach,
          detach: vi.fn(),
          sendCommand: vi.fn(),
        },
        executeJavaScript: vi.fn(async (expression: string) => {
          if (expression.includes('bridge.ready')) {
            return { duration: 1, fps: 30, hasAudio: true };
          }
          return undefined;
        }),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
    mocks.browserWindow.mockImplementation(function BrowserWindowMock() {
      return window;
    });

    await expect(renderDeterministicFrames({
      height: 180,
      html: '<main><audio src="voice.wav"></audio></main>',
      outputDir,
      width: 320,
    })).resolves.toMatchObject({
      errorCode: 'AUDIO_UNSUPPORTED',
      ok: false,
    });
    expect(attach).not.toHaveBeenCalled();
    expect(window.destroy).toHaveBeenCalledOnce();
  });
});
