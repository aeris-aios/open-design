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

  /*
   * Claude Code streams `thinking_delta` frames whose `thinking` is the empty
   * string and whose only payload is `estimated_tokens` — measured directly off
   * the CLI: 20 of 20 frames on a 26.5s extended-thinking turn carried zero
   * characters (`{"type":"thinking_delta","thinking":"","estimated_tokens":50}`).
   * Those frames render nothing, so stamping `first_visible_output` on one
   * reports a first pixel that the user never saw. Run
   * 1cc48454-e9a7-411a-981e-4325fcca95dd logged
   * `time_to_first_visible_output_ms: 9926` for a turn whose first on-screen
   * character landed at 46,729ms.
   */
  it('does not count a character-less thinking delta as visible output', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'thinking_delta', delta: '' }),
    ).toEqual({
      firstModelEventType: 'thinking_delta',
      firstVisibleOutput: false,
      firstArtifactWrite: false,
    });
  });

  it('counts a thinking delta that carries characters as visible output', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'thinking_delta', delta: 'weighing' }),
    ).toEqual({
      firstModelEventType: 'thinking_delta',
      firstVisibleOutput: true,
      firstArtifactWrite: false,
    });
  });

  it('does not count a character-less text delta as visible output', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'text_delta', delta: '' }),
    ).toEqual({
      firstModelEventType: 'text_delta',
      firstVisibleOutput: false,
      firstArtifactWrite: false,
    });
  });

  it('counts a text delta that carries characters as visible output', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'text_delta', delta: 'ok' }),
    ).toEqual({
      firstModelEventType: 'text_delta',
      firstVisibleOutput: true,
      firstArtifactWrite: false,
    });
  });

  it('treats an artifact as visible output regardless of delta shape', () => {
    expect(
      runLifecycleMarkersForStreamEvent('agent', { type: 'artifact' }),
    ).toEqual({
      firstModelEventType: 'artifact',
      firstVisibleOutput: true,
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

describe('first visible output over a recorded empty-thinking turn', () => {
  /*
   * Replays the frame shape of run 1cc48454-e9a7-411a-981e-4325fcca95dd: 26
   * empty `thinking_delta` frames spanning 9.9s -> 46.1s, then the first
   * `text_delta` that actually put characters on screen at 46.8s.
   */
  it('stamps the first pixel at the first character-bearing delta', () => {
    const run = {};
    const lifecycle = createRunLifecycleTracer(run);
    const frames = [
      ...Array.from({ length: 26 }, (_, i) => ({
        data: { type: 'thinking_delta', delta: '' },
        at: 9_939 + i * 1_400,
      })),
      { data: { type: 'text_delta', delta: '\n\n在动手排' }, at: 46_831 },
      { data: { type: 'text_delta', delta: '版之前' }, at: 47_522 },
    ];

    for (const frame of frames) {
      const markers = runLifecycleMarkersForStreamEvent('agent', frame.data);
      if (markers.firstModelEventType) {
        lifecycle.markFirstModelEvent(markers.firstModelEventType, frame.at);
      }
      if (markers.firstVisibleOutput) lifecycle.mark('first_visible_output', frame.at);
    }

    // A frame really did arrive at 9.9s -- that boundary is unchanged.
    expect(run.analyticsTelemetry?.firstModelEventAt).toBe(9_939);
    expect(run.analyticsTelemetry?.firstModelEventType).toBe('thinking_delta');
    // ...but nothing was on screen until 46.8s.
    expect(run.analyticsTelemetry?.firstVisibleOutputAt).toBe(46_831);
  });
});
