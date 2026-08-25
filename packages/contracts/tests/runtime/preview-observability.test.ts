import { describe, expect, it } from 'vitest';
import {
  PREVIEW_OBSERVABILITY_BRIDGE_MARKER,
  PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
  PREVIEW_OBSERVABILITY_PROTOCOL_VERSION,
  buildPreviewObservabilityBridge,
  parsePreviewObservabilityMessage,
} from '../../src/runtime/preview-observability.js';

describe('preview observability contract', () => {
  it('builds one bounded bridge for runtime, resource, console, and white-screen failures', () => {
    const bridge = buildPreviewObservabilityBridge();

    expect(bridge).toContain(PREVIEW_OBSERVABILITY_BRIDGE_MARKER);
    expect(bridge).toContain(PREVIEW_OBSERVABILITY_MESSAGE_TYPE);
    expect(bridge).toContain("send('runtime_error'");
    expect(bridge).toContain("send('unhandled_rejection'");
    expect(bridge).toContain("send('console_error'");
    expect(bridge).toContain("send('resource_error'");
    expect(bridge).toContain("send('white_screen'");
    expect(bridge).toContain('stack: text(value.stack, 2000)');
    expect(bridge).toContain('detail.source_url = text(event && event.filename, 1000)');
    expect(bridge).toContain('var MAX_EVENTS = 12');
    expect(bridge).not.toContain('JSON.stringify(arguments)');
  });

  // OPEND-2147: a deck whose stage collapses to scale ~0 renders as an empty
  // frame, but every existing signal stays clean -- the artifact loaded, no
  // script threw, and `visiblePaintCount()` still sees painted chrome, so
  // `white_screen` never fires. The frame is sized and the content is simply
  // scaled out of existence. Without a dedicated probe the failure leaves no
  // trace at all, which is exactly why it took seven eliminations and still
  // could not be reproduced. The bridge must carry its own measurement.
  it('probes a sized deck frame whose stage collapsed to no scale', () => {
    const bridge = buildPreviewObservabilityBridge();
    expect(bridge).toContain('deck_stage_unscaled');
    // The measurement has to be self-describing in the exported log: without
    // the frame size, the authored canvas size, and the resolved scale we
    // cannot tell a collapsed stage from a legitimately tiny frame.
    for (const field of ['stage_scale_permille', 'stage_transform', 'stage_width', 'canvas_width', 'elapsed_ms']) {
      expect(bridge).toContain(field);
    }
  });

  it('accepts only the versioned preview observability wire shape', () => {
    expect(parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: 1,
      event: 'runtime_error',
      message: 'boom',
    })).toMatchObject({ event: 'runtime_error', message: 'boom' });

    expect(parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: 2,
      event: 'runtime_error',
    })).toBeNull();
    expect(parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: 1,
      event: 'arbitrary_event',
    })).toBeNull();
  });

  it('normalizes untrusted fields before returning a bounded payload', () => {
    const parsed = parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: 1,
      event: 'runtime_error',
      message: `  ${'x'.repeat(600)}  `,
      stack: 'line one\nline two',
      line: 12.6,
      viewport_width: 20_000_000,
      blank_observation_count: 2,
      sample_interval_ms: 1_500,
      ignored: 'not part of the protocol',
    });

    expect(parsed).toMatchObject({
      event: 'runtime_error',
      message: 'x'.repeat(500),
      stack: 'line one line two',
      line: 13,
      viewport_width: 10_000_000,
      blank_observation_count: 2,
      sample_interval_ms: 1_500,
    });
    expect(parsed).not.toHaveProperty('ignored');
  });

  it('accepts the deck stage measurement as a versioned event', () => {
    expect(parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: PREVIEW_OBSERVABILITY_PROTOCOL_VERSION,
      event: 'deck_stage_unscaled',
      stage_scale_permille: 0,
      stage_transform: 'matrix',
      stage_width: 0,
      stage_height: 0,
      canvas_width: 1920,
      canvas_height: 1080,
      viewport_width: 1075,
      viewport_height: 530,
      elapsed_ms: 5000,
    })).toMatchObject({
      event: 'deck_stage_unscaled',
      stage_transform: 'matrix',
      stage_width: 0,
      canvas_width: 1920,
      canvas_height: 1080,
      elapsed_ms: 5000,
    });
  });

  it('rejects known fields with invalid types', () => {
    expect(parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: 1,
      event: 'runtime_error',
      message: { nested: 'boom' },
    })).toBeNull();
    expect(parsePreviewObservabilityMessage({
      type: PREVIEW_OBSERVABILITY_MESSAGE_TYPE,
      version: 1,
      event: 'runtime_error',
      line: '12',
    })).toBeNull();
  });
});
