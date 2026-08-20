import { describe, expect, it } from 'vitest';
import {
  createRunLifecycleTracer,
  runLifecycleMarkersForStreamEvent,
} from '../src/run-lifecycle-tracer.js';

describe('runLifecycleMarkersForStreamEvent', () => {
  it('captures live artifacts emitted through the agent stream path', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'live_artifact' }),
    ).toEqual({
      firstVisibleOutput: false,
      firstArtifactWrite: true,
    });
  });

  it('keeps tool-first events out of visible output and artifact timing', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'tool_use' }),
    ).toEqual({
      firstModelEventType: 'tool_use',
      firstVisibleOutput: false,
      firstArtifactWrite: false,
    });
  });
});

describe('createRunLifecycleTracer', () => {
  it('only records first timestamps for repeated lifecycle marks', () => {
    const run = {};
    const lifecycle = createRunLifecycleTracer(run);

    lifecycle.mark('first_artifact_write', 1_000);
    lifecycle.mark('first_artifact_write', 2_000);
    lifecycle.markFirstModelEvent('tool_use', 3_000);
    lifecycle.markFirstModelEvent('text_delta', 4_000);

    expect(run).toEqual({
      analyticsTelemetry: {
        firstArtifactWriteAt: 1_000,
        firstModelEventAt: 3_000,
        firstModelEventType: 'tool_use',
      },
    });
  });
});

describe('runLifecycleMarkersForStreamEvent artifact events', () => {
  it('does not treat a persisted artifact as the first model event', () => {
    const markers = runLifecycleMarkersForStreamEvent('agent', {
      type: 'artifact',
      source: 'plain-stream',
      name: 'index.html',
    });

    // `artifact` agent events are emitted only by the daemon's close-time
    // stdout persistence, never by a runtime relaying model output. Marking
    // one as the first model event stamps a daemon action at the end of the
    // run as the moment the model started responding.
    expect(markers.firstModelEventType).toBeUndefined();
    // It is still an artifact write, and still visible output.
    expect(markers.firstArtifactWrite).toBe(true);
    expect(markers.firstVisibleOutput).toBe(true);
  });

  it('still marks real model stream events', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'tool_use', id: 't1' })
        .firstModelEventType,
    ).toBe('tool_use');
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'text_delta', text: 'hi' })
        .firstModelEventType,
    ).toBe('text_delta');
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'thinking_delta', text: 'hm' })
        .firstModelEventType,
    ).toBe('thinking_delta');
  });
});

describe('runLifecycleMarkersForStreamEvent producer-supplied start', () => {
  it('carries a tool_use startedAt so the anchor is not stamped at completion', () => {
    // ACP accumulates tool_call frames and emits the canonical tool_use only
    // once the call reaches a terminal status, with `startedAt` set to the
    // first frame's arrival (daemon clock). Stamping the anchor when that
    // delayed event arrives puts it at tool COMPLETION, so a tool-only ACP
    // turn measures its whole tool loop as runtime init.
    const markers = runLifecycleMarkersForStreamEvent('agent', {
      type: 'tool_use',
      id: 't1',
      name: 'Bash',
      startedAt: 1_700_000_000_000,
    });

    expect(markers.firstModelEventType).toBe('tool_use');
    expect(markers.firstModelEventAt).toBe(1_700_000_000_000);
  });

  it('leaves the timestamp to the caller when the payload carries no start', () => {
    const markers = runLifecycleMarkersForStreamEvent('agent', {
      type: 'text_delta',
      text: 'hi',
    });

    expect(markers.firstModelEventType).toBe('text_delta');
    expect(markers.firstModelEventAt).toBeUndefined();
  });

  it('ignores a start that is not a finite number', () => {
    for (const startedAt of [Number.NaN, Number.POSITIVE_INFINITY, '123', null]) {
      const markers = runLifecycleMarkersForStreamEvent('agent', {
        type: 'tool_use',
        id: 't1',
        startedAt,
      });
      expect(markers.firstModelEventAt).toBeUndefined();
    }
  });
});
