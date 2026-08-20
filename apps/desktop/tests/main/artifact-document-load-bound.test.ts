// Regression boundary for the packaged export hang, at the step that actually
// hung.
//
// `renderDeckSlides` used to `await window.loadURL(...)` directly. Electron
// resolves that promise on `did-finish-load`, which Chromium only fires once
// EVERY subresource has settled — so one image or font URL that answers
// neither `load` nor `error` (the `od://` failure mode) left it pending
// forever. The export never even reached `waitForPrintableContent`, whose own
// (separate) missing timeout was the more obvious suspect.
//
// Verified against a real Electron main process before and after the fix: an
// artifact whose <img> and CSS url() both point at a socket that accepts and
// never answers went from hanging past the daemon's 600s IPC ceiling to
// returning a real PNG, with the document-load step dropping to 89ms. That
// matches production, where 122 of 142 `DESKTOP_RENDERER_UNAVAILABLE` export
// failures sat at ~10 minutes.
//
// `dom-ready` is the correct signal here: the capture pipeline only needs a
// parsed, scriptable document — waiting on subresources belongs to
// `waitForPrintableContent`, which bounds itself.

import { describe, expect, test, vi } from 'vitest';

import {
  ARTIFACT_DOCUMENT_LOAD_TIMEOUT_MS,
  loadArtifactDocument,
} from '../../src/main/deck-capture.js';

type DomReadyListener = () => void;

function createWindowStub(options: {
  /** Resolve `loadURL` (i.e. did-finish-load fired). Default: never resolves. */
  finishLoad?: boolean;
  /** Reject `loadURL` (i.e. did-fail-load). */
  failLoad?: boolean;
}) {
  const listeners: DomReadyListener[] = [];
  let loadRejected: Promise<unknown> | null = null;
  const window = {
    webContents: {
      once(event: string, listener: DomReadyListener) {
        if (event === 'dom-ready') listeners.push(listener);
      },
    },
    loadURL(_url: string) {
      if (options.failLoad) {
        loadRejected = Promise.reject(new Error('did-fail-load'));
        return loadRejected;
      }
      if (options.finishLoad) return Promise.resolve();
      return new Promise<void>(() => {});
    },
  };
  return {
    window: window as unknown as Parameters<typeof loadArtifactDocument>[0],
    fireDomReady: () => listeners.forEach((listener) => listener()),
    domReadyListenerCount: () => listeners.length,
    get loadRejected() {
      return loadRejected;
    },
  };
}

describe('loadArtifactDocument', () => {
  test('[P0] proceeds on dom-ready instead of waiting for every subresource', async () => {
    const stub = createWindowStub({}); // loadURL never resolves — a stalled subresource

    // The listener must already be attached: a `data:` URL can reach
    // dom-ready before we get a chance to subscribe otherwise.
    const pending = loadArtifactDocument(stub.window, 'data:text/html,<p>hi');
    expect(stub.domReadyListenerCount()).toBe(1);

    stub.fireDomReady();

    await expect(pending).resolves.toBeUndefined();
  });

  test('[P0] gives up after the timeout when dom-ready never fires either', async () => {
    vi.useFakeTimers();
    try {
      const stub = createWindowStub({}); // neither loadURL nor dom-ready ever settles
      let settled = false;
      const pending = loadArtifactDocument(stub.window, 'data:text/html,<p>hi').then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(ARTIFACT_DOCUMENT_LOAD_TIMEOUT_MS + 1_000);
      await pending;

      expect(
        settled,
        'an unbounded document load is what turned a stalled resource into a 10-minute export hang',
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('resolves normally when the document finishes loading', async () => {
    const stub = createWindowStub({ finishLoad: true });
    await expect(
      loadArtifactDocument(stub.window, 'data:text/html,<p>hi'),
    ).resolves.toBeUndefined();
  });

  test('a did-fail-load rejection does not escape as an unhandled rejection', async () => {
    const stub = createWindowStub({ failLoad: true });
    // The race settles on the handled rejection rather than propagating it;
    // the caller continues and captures whatever rendered.
    await expect(
      loadArtifactDocument(stub.window, 'data:text/html,<p>hi'),
    ).resolves.toBeUndefined();
    await expect(stub.loadRejected).rejects.toThrow('did-fail-load');
  });
});
