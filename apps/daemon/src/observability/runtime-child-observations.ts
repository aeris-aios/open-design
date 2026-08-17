import { createHash } from 'node:crypto';

import {
  NormalizedAgentObservationV1Schema,
  normalizeAgentObservationV1,
  type NormalizedAgentObservationV1,
  type StrategyInputStageV2,
} from '@open-design/contracts';

import {
  adaptClaudeChildToolRuntimeFactV1,
  adaptClaudeChildRuntimeFactV1,
  type ClaudeChildRuntimeFact,
  type ClaudeChildToolRuntimeFact,
} from '../runtimes/claude-child-evidence.js';
import {
  adaptOpenCodeTaskCandidateV1,
  type OpenCodeTaskTerminalCandidate,
} from '../runtimes/opencode-child-evidence.js';
import {
  adaptVelaChildRuntimeFactV1,
  type VelaChildRuntimeFact,
} from '../runtimes/vela-child-evidence.js';

const MAX_MAIN_TOOL_OBSERVATIONS_PER_RUN = 256;
const SAFE_TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeToolName(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOOL_NAME_RE.test(value) ? value : undefined;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function mainRunToolObservationId(runId: string, rawToolCallId: string): string {
  return `agent-tool:${runId}:${sha256(rawToolCallId)}`;
}

/**
 * Build safe parent-Agent tool spans from the already-normalized Run event
 * stream shared by every runtime. Tool arguments, results, and raw provider
 * call ids never cross this adapter.
 */
export function adaptMainRunToolObservationsV1(input: {
  events: ReadonlyArray<{ event: string; data: unknown; timestamp?: number }>;
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  taskRunObservationId: string;
  stage: StrategyInputStageV2;
  agentCliVersion?: string;
  runtimeCompanionVersion?: string;
  runtimeAdapterVersion?: string;
}): NormalizedAgentObservationV1[] {
  const calls = new Map<string, {
    toolCallHash: string;
    toolName: string;
    startedAtMs?: number;
    endedAtMs?: number;
    status: 'running' | 'completed' | 'failed' | 'unknown';
    conflicted: boolean;
  }>();

  for (const record of input.events) {
    if (record.event !== 'agent' || !isRecord(record.data)) continue;
    const data = record.data;
    if (data.type === 'tool_use') {
      const rawId = typeof data.id === 'string' && data.id.trim() ? data.id : undefined;
      const toolName = safeToolName(data.name);
      if (!rawId || !toolName) continue;
      const existing = calls.get(rawId);
      if (existing) {
        if (existing.toolName !== toolName) {
          existing.conflicted = true;
          existing.status = 'unknown';
        }
        continue;
      }
      if (calls.size >= MAX_MAIN_TOOL_OBSERVATIONS_PER_RUN) continue;
      calls.set(rawId, {
        toolCallHash: sha256(rawId),
        toolName,
        ...(typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
          ? { startedAtMs: record.timestamp }
          : {}),
        status: 'running',
        conflicted: false,
      });
      continue;
    }
    if (data.type === 'tool_result') {
      const rawId = typeof data.toolUseId === 'string' && data.toolUseId.trim()
        ? data.toolUseId
        : undefined;
      if (!rawId) continue;
      const call = calls.get(rawId);
      if (!call || call.conflicted) continue;
      const nextStatus = data.isError === true ? 'failed' : 'completed';
      if (call.status !== 'running' && call.status !== nextStatus) {
        call.conflicted = true;
        call.status = 'unknown';
        continue;
      }
      call.status = nextStatus;
      if (typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)) {
        if (call.startedAtMs !== undefined && record.timestamp < call.startedAtMs) {
          call.conflicted = true;
          call.status = 'unknown';
        } else {
          call.endedAtMs = record.timestamp;
        }
      }
    }
  }

  return [...calls.values()].map((call) => normalizeAgentObservationV1({
    identity: {
      observationId: `agent-tool:${input.runId}:${call.toolCallHash}`,
      taskExecutionId: input.taskExecutionId,
      runId: input.runId,
      taskRunIndex: input.taskRunIndex,
      parentObservationId: input.taskRunObservationId,
    },
    kind: 'tool',
    stage: input.stage,
    status: call.status,
    prompt: {
      hostComposed: {
        availability: 'unobservable',
        limitations: ['tool_prompt_boundary_not_applicable'],
      },
      childInjected: {
        availability: 'unobservable',
        limitations: ['tool_prompt_boundary_not_applicable'],
      },
      agentEffectiveContext: {
        availability: 'unobservable',
        limitations: ['tool_effective_context_not_exposed'],
      },
    },
    usage: {
      availability: 'unavailable',
      source: 'unknown',
      accountingMode: 'unknown',
      limitations: ['tool_usage_not_independently_reported'],
    },
    timing: call.startedAtMs === undefined && call.endedAtMs === undefined
      ? {
          availability: 'unavailable',
          limitations: ['tool_timing_not_observed'],
        }
      : {
          availability: 'partial',
          evidence: [{
            source: 'host_wall_clock',
            clockDomain: 'unix_epoch_ms',
            ...(call.startedAtMs === undefined ? {} : { startedAtMs: call.startedAtMs }),
            ...(call.endedAtMs === undefined ? {} : { endedAtMs: call.endedAtMs }),
            ...(call.startedAtMs !== undefined && call.endedAtMs !== undefined
              ? { durationMs: Math.max(0, call.endedAtMs - call.startedAtMs) }
              : {}),
          }],
          limitations: ['tool_timing_is_host_event_window'],
        },
    limitations: [
      'tool_input_and_output_redacted',
      ...(call.conflicted ? ['tool_lifecycle_conflicted'] : []),
    ],
    attributes: {
      toolName: call.toolName,
      toolCallHash: call.toolCallHash,
      source: 'normalized_agent_event',
      ...(input.agentCliVersion ? { agentCliVersion: input.agentCliVersion } : {}),
      ...(input.runtimeCompanionVersion
        ? { runtimeCompanionVersion: input.runtimeCompanionVersion }
        : {}),
      ...(input.runtimeAdapterVersion
        ? { runtimeAdapterVersion: input.runtimeAdapterVersion }
        : {}),
    },
  }));
}

export function adaptRuntimeChildObservationsV1(input: {
  events: ReadonlyArray<{ event: string; data: unknown }>;
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  taskRunObservationId: string;
  stage: StrategyInputStageV2;
  agentCliVersion?: string;
  runtimeCompanionVersion?: string;
  /** Tool spans are exporter detail and must not widen complex-production gates. */
  includeChildTools?: boolean;
  /** Exporter-only hierarchy: task Run -> native Agent tool -> Child Agent. */
  mainToolObservationIds?: ReadonlySet<string>;
}) {
  return input.events.flatMap((record) => {
    if (record.event !== 'agent' || !record.data || typeof record.data !== 'object') {
      return [];
    }
    const diagnostic = record.data as Record<string, unknown>;
    if (diagnostic.type !== 'diagnostic') return [];
    try {
      if (diagnostic.name === 'normalized_agent_observation_v1') {
        const parsed = NormalizedAgentObservationV1Schema.safeParse(diagnostic.observation);
        return parsed.success ? [parsed.data] : [];
      }
      if (diagnostic.name === 'opencode_child_task_candidate') {
        return [adaptOpenCodeTaskCandidateV1({
          candidate: diagnostic as unknown as OpenCodeTaskTerminalCandidate,
          ...input,
        })];
      }
      if (diagnostic.name === 'vela_opencode_child_agent_lifecycle') {
        return [adaptVelaChildRuntimeFactV1({
          fact: diagnostic as unknown as VelaChildRuntimeFact,
          ...input,
        })];
      }
      if (diagnostic.name === 'claude_child_runtime_fact') {
        const fact = diagnostic as unknown as ClaudeChildRuntimeFact;
        return [adaptClaudeChildRuntimeFactV1({
          fact,
          ...(() => {
            const candidate = mainRunToolObservationId(input.runId, fact.childId);
            return !fact.parentChildId && input.mainToolObservationIds?.has(candidate)
              ? { rootParentToolObservationId: candidate }
              : {};
          })(),
          ...input,
        })];
      }
      if (diagnostic.name === 'claude_child_tool_runtime_fact') {
        if (input.includeChildTools !== true) return [];
        return [adaptClaudeChildToolRuntimeFactV1({
          fact: diagnostic as unknown as ClaudeChildToolRuntimeFact,
          ...input,
        })];
      }
    } catch {
      // Native evidence is optional. Invalid/stale facts remain absent so the
      // caller's graph or production gate fails closed on missing coverage.
    }
    return [];
  });
}
