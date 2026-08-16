import { describe, expect, it } from 'vitest';

import { buildStructuredMainRunObservationV1 } from '../../src/observability/main-run-observation.js';
import { buildPromptStackTelemetry } from '../../src/prompt-telemetry.js';
import { scanRunEventsForUsageAnalytics } from '../../src/run-analytics-observability.js';

describe('buildStructuredMainRunObservationV1', () => {
  it('adapts existing Prompt, usage, and host timing facts without changing their source semantics', () => {
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt: 'system\nuser request',
      sections: [
        { kind: 'daemonSystemPrompt', content: 'system' },
        { kind: 'userRequest', content: 'user request' },
      ],
    });

    const observation = buildStructuredMainRunObservationV1({
      taskExecutionId: 'task-1',
      runId: 'run-1',
      taskRunIndex: 0,
      runtimeSessionId: 'session-1',
      stage: 'request',
      status: 'succeeded',
      promptTelemetry,
      usage: {
        input_tokens: 100,
        input_tokens_provider: 100,
        input_tokens_effective: 120,
        output_tokens: 25,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_token_source: 'anthropic',
        input_accounting_mode: 'additive',
        token_count_source: 'provider_usage',
        agent_reported_model: 'anthropic/claude-sonnet-4',
      },
      timing: {
        tool_call_count: 1,
        total_duration_ms: 500,
        time_to_first_token_ms: 120,
        phase_timing_status: 'partial',
      },
      startedAtMs: 1_000,
      endedAtMs: 1_500,
      agentCliVersion: 'codex-cli 0.147.0',
      runtimeCompanionName: 'vela',
      runtimeCompanionVersion: '0.0.1-od-next-local',
      runtimeAdapterVersion: 'od-codex-json-events/v1',
    });

    expect(observation.identity).toMatchObject({
      observationId: 'task-run:task-1:run-1',
      runtimeSessionId: 'session-1',
    });
    expect(observation.prompt.hostComposed).toMatchObject({
      availability: 'exact',
      source: 'daemon',
      hash: promptTelemetry.promptFingerprint,
      bytes: promptTelemetry.rawBytes,
    });
    expect(observation.prompt.hostComposed.safePayload).toMatchObject({
      type: 'open-design.prompt-stack',
      promptFingerprint: promptTelemetry.promptFingerprint,
    });
    expect(observation.prompt.childInjected.availability).toBe('unavailable');
    expect(observation.prompt.agentEffectiveContext.availability).toBe('unobservable');
    expect(observation.usage).toMatchObject({
      availability: 'complete',
      source: 'provider_stream',
      accountingMode: 'additive',
      values: {
        inputTokens: 100,
        effectiveInputTokens: 120,
        outputTokens: 25,
      },
      valueSources: {
        inputTokens: 'provider_stream',
        effectiveInputTokens: 'derived',
        outputTokens: 'provider_stream',
        cacheReadTokens: 'provider_stream',
        cacheWriteTokens: 'provider_stream',
      },
    });
    expect(observation.usage.values).not.toHaveProperty('totalTokens');
    expect(observation.timing).toMatchObject({
      availability: 'partial',
      evidence: [{
        source: 'host_wall_clock',
        clockDomain: 'unix_epoch_ms',
        startedAtMs: 1_000,
        endedAtMs: 1_500,
        durationMs: 500,
      }],
    });
    expect(observation.attributes).toMatchObject({
      agentCliVersion: 'codex-cli 0.147.0',
      runtimeCompanionName: 'vela',
      runtimeCompanionVersion: '0.0.1-od-next-local',
      runtimeAdapterVersion: 'od-codex-json-events/v1',
    });
  });

  it('keeps unavailable Prompt and usage absent instead of fabricating zero values', () => {
    const observation = buildStructuredMainRunObservationV1({
      runId: 'run-2',
      taskRunIndex: 1,
      stage: 'production',
      status: 'cancelled',
    });

    expect(observation.status).toBe('canceled');
    expect(observation.identity.taskExecutionId).toBe('compat-run:run-2');
    expect(observation.limitations).toContain('compatibility_task_identity_from_run_id');
    expect(observation.prompt.hostComposed.availability).toBe('unavailable');
    expect(observation.usage).toEqual({
      availability: 'unavailable',
      source: 'unknown',
      accountingMode: 'unknown',
      limitations: ['usage_not_observed'],
    });
    expect(observation.timing.availability).toBe('unavailable');
    expect(observation.usage).not.toHaveProperty('values');
    expect(observation.timing).not.toHaveProperty('evidence.0.durationMs');
  });

  it('does not relabel totals synthesized by the existing usage scanner as provider facts', () => {
    const usage = scanRunEventsForUsageAnalytics(
      [{
        event: 'agent',
        data: {
          type: 'usage',
          usage: {
            input_tokens: 1_000,
            output_tokens: 50,
            cache_read_input_tokens: 250,
            cache_creation_input_tokens: 100,
          },
        },
      }],
      'claude-opus-4',
      40,
    );
    expect(usage.total_tokens).toBe(1_400);

    const observation = buildStructuredMainRunObservationV1({
      taskExecutionId: 'task-3',
      runId: 'run-3',
      taskRunIndex: 0,
      stage: 'request',
      status: 'succeeded',
      usage,
    });

    expect(observation.usage.values).toMatchObject({
      inputTokens: 1_000,
      effectiveInputTokens: 1_350,
      outputTokens: 50,
      uncachedInputTokens: 1_000,
      estimatedContextTokens: 1_310,
    });
    expect(observation.usage.values).not.toHaveProperty('totalTokens');
    expect(observation.usage.valueSources).toMatchObject({
      inputTokens: 'provider_stream',
      outputTokens: 'provider_stream',
      effectiveInputTokens: 'derived',
      uncachedInputTokens: 'derived',
      estimatedContextTokens: 'derived',
    });
    expect(observation.usage.limitations).toEqual(expect.arrayContaining([
      'effective_input_tokens_are_derived',
      'uncached_input_tokens_are_derived',
      'estimated_context_tokens_are_derived',
      'total_tokens_omitted_without_raw_provenance',
    ]));
  });
});
