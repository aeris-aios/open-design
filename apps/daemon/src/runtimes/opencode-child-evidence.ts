import { createHash } from 'node:crypto';

import {
  NORMALIZED_AGENT_OBSERVATION_V1_SCHEMA,
  NormalizedAgentObservationV1Schema,
  type NormalizedAgentObservationV1,
  type StrategyInputStageV2,
} from '@open-design/contracts';

export const OPENCODE_CHILD_EVIDENCE_ADAPTER_VERSION =
  'od-opencode-child-evidence/v1' as const;

export const OPENCODE_CHILD_EVIDENCE_CLI_VERSION = '1.18.4' as const;

type RecordValue = Record<string, unknown>;

export interface OpenCodeTaskTerminalCandidate {
  adapterVersion: typeof OPENCODE_CHILD_EVIDENCE_ADAPTER_VERSION;
  cliVersion: string;
  rootSessionId: string;
  childSessionId: string;
  toolCallId: string;
  state: 'completed' | 'failed' | 'canceled';
  observedAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  promptHash?: string;
  promptBytes?: number;
  model?: {
    providerId: string;
    modelId: string;
  };
}

export interface OpenCodeChildRuntimeFact extends Omit<OpenCodeTaskTerminalCandidate, 'state'> {
  state: 'started' | 'completed' | 'failed' | 'canceled';
  source: 'opencode_root_task_tool_and_sanitized_export';
  sourceEventType: 'root_task_tool_terminal' | 'sanitized_child_export';
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    thoughtTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  limitations: string[];
}

export interface OpenCodeRootTaskEvidenceCollector {
  observe(value: unknown): void;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function promptIdentity(value: unknown): { hash: string; bytes: number } | undefined {
  if (typeof value !== 'string') return undefined;
  return {
    hash: createHash('sha256').update(value, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(value, 'utf8'),
  };
}

function terminalStateFromTaskTool(state: RecordValue): OpenCodeTaskTerminalCandidate['state'] | undefined {
  if (state.status === 'completed') return 'completed';
  if (state.status !== 'error') return undefined;
  const error = typeof state.error === 'string' ? state.error.trim().toLowerCase() : '';
  if (error === 'cancelled' || error === 'canceled' || error === 'task cancelled' || error === 'task canceled') {
    return 'canceled';
  }
  // OpenCode 1.18.4 has no stable native Task timeout terminal shape. Do not
  // relabel a timeout-looking error as either cancellation or failure.
  if (error.includes('timeout') || error.includes('timed out')) return undefined;
  return error ? 'failed' : undefined;
}

/**
 * Observe only terminal native Task parts from the root OpenCode JSON stream.
 *
 * OpenCode 1.18.4 filters child-session events out of `run --format json`.
 * The terminal root Task part nevertheless carries a child `sessionId`, a
 * `parentSessionId`, and the root tool call id. The raw Prompt is reduced to a
 * hash and byte count synchronously and is never retained in a fact.
 */
export function createOpenCodeRootTaskEvidenceCollector(input: {
  rootSessionId?: string;
  cliVersion: string;
  onCandidate: (candidate: OpenCodeTaskTerminalCandidate) => void;
  now?: () => number;
}): OpenCodeRootTaskEvidenceCollector {
  const now = input.now ?? Date.now;
  const emitted = new Set<string>();
  let rootSessionId = input.rootSessionId;

  function observe(value: unknown): void {
    if (!isRecord(value)) return;
    if (
      value.type === 'step_start' &&
      !rootSessionId &&
      typeof value.sessionID === 'string' &&
      value.sessionID.trim()
    ) {
      rootSessionId = value.sessionID;
      return;
    }
    if (input.cliVersion !== OPENCODE_CHILD_EVIDENCE_CLI_VERSION) return;
    if (value.type !== 'tool_use' || !rootSessionId) return;
    if (value.sessionID !== rootSessionId || !isRecord(value.part)) return;
    const part = value.part;
    if (part.type !== 'tool' || part.tool !== 'task') return;
    const toolCallId = nonEmptyString(part.callID);
    const state = isRecord(part.state) ? part.state : undefined;
    if (!toolCallId || !state) return;
    const terminal = terminalStateFromTaskTool(state);
    if (!terminal || emitted.has(toolCallId)) return;
    const metadata = isRecord(state.metadata) ? state.metadata : undefined;
    // A foreground Task promoted to background and an explicitly background
    // Task both return a completed root tool part while the Child is still
    // running. The native metadata is the only reliable discriminator here.
    if (metadata?.background === true) return;
    const metadataParentSessionId = nonEmptyString(metadata?.parentSessionId);
    const childSessionId = nonEmptyString(metadata?.sessionId);
    if (metadataParentSessionId !== rootSessionId || !childSessionId) return;

    const time = isRecord(state.time) ? state.time : undefined;
    const model = isRecord(metadata?.model) ? metadata.model : undefined;
    const providerId = nonEmptyString(model?.providerID);
    const modelId = nonEmptyString(model?.modelID);
    const taskInput = isRecord(state.input) ? state.input : undefined;
    const prompt = promptIdentity(taskInput?.prompt);
    const startedAtMs = nonNegativeNumber(time?.start);
    const reportedEndedAtMs = nonNegativeNumber(time?.end);
    const endedAtMs = reportedEndedAtMs !== undefined &&
      (startedAtMs === undefined || reportedEndedAtMs >= startedAtMs)
      ? reportedEndedAtMs
      : undefined;

    emitted.add(toolCallId);
    try {
      input.onCandidate({
        adapterVersion: OPENCODE_CHILD_EVIDENCE_ADAPTER_VERSION,
        cliVersion: input.cliVersion,
        rootSessionId,
        childSessionId,
        toolCallId,
        state: terminal,
        observedAtMs: now(),
        ...(startedAtMs === undefined ? {} : { startedAtMs }),
        ...(endedAtMs === undefined ? {} : { endedAtMs }),
        ...(prompt ? { promptHash: prompt.hash, promptBytes: prompt.bytes } : {}),
        ...(providerId && modelId ? { model: { providerId, modelId } } : {}),
      });
    } catch {
      // Evidence is a side channel. Observer failures must not affect the
      // existing main OpenCode parser or Run outcome.
    }
  }

  return { observe };
}

function addUsageValue(
  values: NonNullable<OpenCodeChildRuntimeFact['usage']>,
  key: keyof NonNullable<OpenCodeChildRuntimeFact['usage']>,
  value: unknown,
): void {
  const parsed = nonNegativeNumber(value);
  if (parsed !== undefined) values[key] = (values[key] ?? 0) + parsed;
}

function childUsageFromSanitizedExport(
  value: RecordValue,
  candidate: OpenCodeTaskTerminalCandidate,
): OpenCodeChildRuntimeFact['usage'] {
  if (candidate.startedAtMs === undefined || candidate.endedAtMs === undefined) return undefined;
  if (!Array.isArray(value.messages)) return undefined;
  const usage: NonNullable<OpenCodeChildRuntimeFact['usage']> = {};
  for (const message of value.messages) {
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== 'assistant') continue;
    if (message.info.sessionID !== candidate.childSessionId) continue;
    const time = isRecord(message.info.time) ? message.info.time : undefined;
    const createdAtMs = nonNegativeNumber(time?.created);
    if (
      createdAtMs === undefined ||
      createdAtMs < candidate.startedAtMs ||
      createdAtMs > candidate.endedAtMs
    ) {
      continue;
    }
    const tokens = isRecord(message.info.tokens) ? message.info.tokens : undefined;
    if (!tokens) continue;
    addUsageValue(usage, 'inputTokens', tokens.input);
    addUsageValue(usage, 'outputTokens', tokens.output);
    addUsageValue(usage, 'thoughtTokens', tokens.reasoning);
    if (isRecord(tokens.cache)) {
      addUsageValue(usage, 'cacheReadTokens', tokens.cache.read);
      addUsageValue(usage, 'cacheWriteTokens', tokens.cache.write);
    }
  }
  return Object.keys(usage).length ? usage : undefined;
}

/**
 * Bind one root Task candidate to one explicitly requested sanitized child
 * export. The caller chooses the child id from the candidate; this function
 * never lists or scans unrelated OpenCode sessions.
 */
export function verifyOpenCodeChildExport(input: {
  candidate: OpenCodeTaskTerminalCandidate;
  sanitizedExport: unknown;
}): OpenCodeChildRuntimeFact[] {
  if (input.candidate.cliVersion !== OPENCODE_CHILD_EVIDENCE_CLI_VERSION) return [];
  if (!isRecord(input.sanitizedExport) || !isRecord(input.sanitizedExport.info)) return [];
  const info = input.sanitizedExport.info;
  if (
    info.id !== input.candidate.childSessionId ||
    info.parentID !== input.candidate.rootSessionId
  ) {
    return [];
  }

  const common = {
    ...input.candidate,
    source: 'opencode_root_task_tool_and_sanitized_export' as const,
    limitations: [
      'Child identity requires both root Task metadata and sanitized export parentID.',
      'OpenCode root JSON does not stream child-session events in real time.',
    ],
  };
  const facts: OpenCodeChildRuntimeFact[] = [];
  if (input.candidate.startedAtMs !== undefined) {
    facts.push({
      ...common,
      state: 'started',
      sourceEventType: 'root_task_tool_terminal',
    });
  }
  const usage = childUsageFromSanitizedExport(input.sanitizedExport, input.candidate);
  facts.push({
    ...common,
    state: input.candidate.state,
    sourceEventType: 'sanitized_child_export',
    ...(usage ? { usage } : {}),
  });
  return facts;
}

/**
 * Run the post-run lookup through an injected, exact-id loader. Query failures
 * deliberately degrade to no facts and never escape into the parent Run.
 */
export async function collectOpenCodeChildRuntimeFacts(input: {
  candidate: OpenCodeTaskTerminalCandidate;
  loadSanitizedExport: (childSessionId: string) => Promise<unknown>;
}): Promise<OpenCodeChildRuntimeFact[]> {
  if (input.candidate.cliVersion !== OPENCODE_CHILD_EVIDENCE_CLI_VERSION) return [];
  try {
    const sanitizedExport = await input.loadSanitizedExport(input.candidate.childSessionId);
    return verifyOpenCodeChildExport({
      candidate: input.candidate,
      sanitizedExport,
    });
  } catch {
    return [];
  }
}

export interface AdaptOpenCodeChildFactInput {
  fact: OpenCodeChildRuntimeFact;
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  taskRunObservationId: string;
  stage: StrategyInputStageV2;
}

function observationId(runId: string, childSessionId: string): string {
  return `opencode-child:${runId}:${childSessionId}`;
}

function normalizedUsage(
  usage: OpenCodeChildRuntimeFact['usage'],
): NormalizedAgentObservationV1['usage'] {
  if (!usage) {
    return {
      availability: 'unavailable',
      source: 'unknown',
      accountingMode: 'unknown',
      limitations: ['Sanitized child export did not report independent usage.'],
    };
  }
  const values = {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.thoughtTokens === undefined ? {} : { thoughtTokens: usage.thoughtTokens }),
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
  };
  const valueSources = Object.fromEntries(
    Object.keys(values).map((key) => [key, 'runtime' as const]),
  );
  const complete = usage.inputTokens !== undefined && usage.outputTokens !== undefined;
  return {
    availability: complete ? 'complete' : 'partial',
    source: 'runtime',
    accountingMode: 'additive',
    values,
    valueSources,
    limitations: complete
      ? []
      : ['Sanitized child export reported only a subset of usage fields.'],
  };
}

/** Convert one verified, provider-shaped fact without consulting any store. */
export function adaptOpenCodeChildRuntimeFactV1(
  input: AdaptOpenCodeChildFactInput,
): NormalizedAgentObservationV1 {
  const fact = input.fact;
  if (fact.cliVersion !== OPENCODE_CHILD_EVIDENCE_CLI_VERSION) {
    throw new TypeError(`Unsupported OpenCode child evidence version: ${fact.cliVersion}`);
  }
  const promptObserved = fact.promptHash !== undefined && fact.promptBytes !== undefined;
  const timingEvidence = fact.startedAtMs === undefined
    ? undefined
    : [{
        source: 'runtime' as const,
        clockDomain: 'opencode_unix_epoch_ms',
        startedAtMs: fact.startedAtMs,
        ...(fact.state === 'started' || fact.endedAtMs === undefined
          ? {}
          : {
              endedAtMs: fact.endedAtMs,
              durationMs: fact.endedAtMs - fact.startedAtMs,
            }),
      }];
  const observation = {
    schema: NORMALIZED_AGENT_OBSERVATION_V1_SCHEMA,
    identity: {
      observationId: observationId(input.runId, fact.childSessionId),
      taskExecutionId: input.taskExecutionId,
      runId: input.runId,
      taskRunIndex: input.taskRunIndex,
      parentObservationId: input.taskRunObservationId,
      runtimeSessionId: fact.childSessionId,
    },
    kind: 'child_agent' as const,
    stage: input.stage,
    status: fact.state === 'started' ? 'running' : fact.state,
    prompt: {
      hostComposed: {
        availability: 'unobservable' as const,
        limitations: ['The daemon does not compose OpenCode native Child Prompts.'],
      },
      childInjected: promptObserved
        ? {
            availability: 'partial' as const,
            source: 'runtime' as const,
            hash: fact.promptHash,
            bytes: fact.promptBytes,
            limitations: ['Only hash and byte length are retained from native Task input.'],
          }
        : {
            availability: 'unavailable' as const,
            source: 'unknown' as const,
            limitations: ['Native Task Prompt was not present in the root terminal part.'],
          },
      agentEffectiveContext: {
        availability: 'unobservable' as const,
        limitations: ['OpenCode does not expose effective Child context in this boundary.'],
      },
    },
    usage: normalizedUsage(fact.state === 'started' ? undefined : fact.usage),
    timing: timingEvidence
      ? {
          availability: 'partial' as const,
          evidence: timingEvidence,
          limitations: ['Timestamps are read post-run from the root terminal Task part.'],
        }
      : {
          availability: 'unavailable' as const,
          limitations: ['Root terminal Task part did not report native timing.'],
        },
    limitations: fact.limitations,
    attributes: {
      runtimeAdapterVersion: fact.adapterVersion,
      runtimeCliVersion: fact.cliVersion,
      nativeTaskToolCallId: fact.toolCallId,
      rootSessionId: fact.rootSessionId,
      source: fact.source,
      sourceEventType: fact.sourceEventType,
      ...(fact.model ? { model: fact.model } : {}),
    },
  };
  return NormalizedAgentObservationV1Schema.parse(observation);
}
