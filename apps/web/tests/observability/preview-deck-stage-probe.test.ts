// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PREVIEW_OBSERVABILITY_HOST_STATE_MESSAGE_TYPE,
  PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
  buildPreviewObservabilityBridge,
} from '@open-design/contracts/runtime/preview-observability';

/**
 * Behavioural cover for the OPEND-2147 deck-stage probe.
 *
 * Asserting that the bridge *source* contains a string proves nothing about
 * whether the probe can ever run. The gate it sits behind starts closed
 * (`hostActive = false`) and only opens when FileViewer posts the host-state
 * message, so a probe wired to the wrong lifecycle would be dead code that
 * every string-level test still passes. These cases execute the real bridge in
 * a document and assert what it posts.
 *
 * `getComputedStyle` is stubbed deliberately. jsdom has no layout engine, so it
 * cannot resolve a transform to a matrix or expose custom properties the way a
 * browser does; feeding the probe controlled computed values tests the decision
 * we own — which measurements mean "collapsed", and what gets reported — and
 * makes no claim about the CSS engine underneath.
 */

interface StubStyle {
  transform: string;
  props: Record<string, string>;
}

function installBridge(): void {
  const bridge = buildPreviewObservabilityBridge();
  const body = bridge.replace(/^<script[^>]*>/, '').replace(/<\/script>\s*$/, '');
  new Function(body)();
}

function stubComputedStyle(root: StubStyle, stage: StubStyle): void {
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const source = element === document.documentElement ? root : stage;
    return {
      transform: source.transform,
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgb(10, 10, 10)',
      backgroundImage: 'none',
      getPropertyValue: (name: string) => source.props[name] ?? '',
    } as unknown as CSSStyleDeclaration;
  });
}

function activateHost(): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: PREVIEW_OBSERVABILITY_HOST_STATE_MESSAGE_TYPE, active: true },
  }));
}

function deckMessages(post: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return post.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((data) => data
      && data.type === PREVIEW_OBSERVABILITY_MESSAGE_TYPE
      && data.event === 'deck_stage_unscaled');
}

let post: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  post = vi.fn();
  // jsdom makes `window.parent` the window itself, which is what the bridge
  // posts to.
  vi.stubGlobal('postMessage', post);
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  document.body.innerHTML = '<div class="stage"></div>';
  delete (window as unknown as Record<string, unknown>).__odPreviewObservability;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('deck stage probe (OPEND-2147)', () => {
  it('reports the measurement once the host says the preview is active', () => {
    stubComputedStyle(
      { transform: 'none', props: { '--canvas-w': '1920px', '--canvas-h': '1080px' } },
      { transform: 'matrix(0, 0, 0, 0, 0, 0)', props: {} },
    );
    installBridge();

    // The gate is closed until FileViewer announces an active preview: a probe
    // that fired here would also fire for every backgrounded frame.
    vi.advanceTimersByTime(60_000);
    expect(deckMessages(post)).toHaveLength(0);

    activateHost();
    vi.advanceTimersByTime(60_000);

    const [measurement, ...rest] = deckMessages(post);
    expect(rest).toHaveLength(0);
    expect(measurement).toMatchObject({
      event: 'deck_stage_unscaled',
      stage_transform: 'matrix',
      stage_scale_permille: 0,
      canvas_width: 1920,
      canvas_height: 1080,
      ready_state: 'complete',
      visibility_state: 'visible',
    });
    expect(measurement?.viewport_width).toBeGreaterThan(1);
  });

  it('stays quiet for a deck that fitted correctly', () => {
    stubComputedStyle(
      { transform: 'none', props: { '--canvas-w': '1920px', '--canvas-h': '1080px' } },
      { transform: 'matrix(0.4907, 0, 0, 0.4907, 0, 0)', props: {} },
    );
    installBridge();
    activateHost();
    vi.advanceTimersByTime(60_000);

    expect(deckMessages(post)).toHaveLength(0);
  });

  it('stays quiet for a preview that declares no fixed canvas', () => {
    // Only fixed-canvas decks have a fit contract to violate. Without this the
    // probe would fire for any preview whose root element happens to carry no
    // transform.
    stubComputedStyle(
      { transform: 'none', props: {} },
      { transform: 'none', props: {} },
    );
    installBridge();
    activateHost();
    vi.advanceTimersByTime(60_000);

    expect(deckMessages(post)).toHaveLength(0);
  });

  it('separates a stage that was never fitted from one fitted to nothing', () => {
    stubComputedStyle(
      { transform: 'none', props: { '--canvas-w': '1920px', '--canvas-h': '1080px' } },
      { transform: 'none', props: {} },
    );
    installBridge();
    activateHost();
    vi.advanceTimersByTime(60_000);

    expect(deckMessages(post)[0]).toMatchObject({
      stage_transform: 'none',
      stage_scale_permille: 0,
    });
  });
});
