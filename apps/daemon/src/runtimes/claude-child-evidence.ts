import {
  NORMALIZED_AGENT_OBSERVATION_V1_SCHEMA,
  NormalizedAgentObservationV1Schema,
  type NormalizedAgentObservationV1,
  type StrategyInputStageV2,
} from '@open-design/contracts';

export const CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION =
  'od-claude-child-evidence/v1' as const;

export type ClaudeChildRuntimeFactState =
  | 'started'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'conflicted';

export type ClaudeChildEvidenceConflictReason =
  | 'runtime_session_changed'
  | 'task_parent_rebound'
  | 'terminal_state_conflict';

/**
 * Provider-shaped fact emitted beside the existing Claude UI stream.
 *
 * The fact deliberately carries no Task prompt, token estimate, strategy
 * decision, or exporter field. A non-null `parent_tool_use_id` only proves a
 * child lifecycle after the matching native Task tool_use was observed.
 */
export interface ClaudeChildRuntimeFact {
  adapterVersion: typeof CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION;
  childId: string;
  parentChildId?: string;
  state: ClaudeChildRuntimeFactState;
  source: 'claude_stream_json';
  sourceEventType:
    | 'assistant.parent_tool_use_id'
    | 'system.init'
    | 'host_process_close';
  observedAtMs: number;
  startedAtMs: number;
  endedAtMs?: number;
  runtimeSessionId?: string;
  terminationReason?: 'assistant_error' | 'canceled' | 'timeout' | 'stream_incomplete';
  conflictReasons?: ClaudeChildEvidenceConflictReason[];
}

export type ClaudeOpenChildTerminationReason =
  | 'canceled'
  | 'timeout'
  | 'stream_incomplete';

export interface ClaudeChildEvidenceCollector {
  observe(value: unknown): void;
  finishOpenChildren(reason: ClaudeOpenChildTerminationReason): void;
}

interface NativeTaskRegistration {
  // This tuple is immutable for the collector lifetime. Provider evidence that
  // attempts to rebind any member poisons the Child instead of selecting the
  // newest frame.
  parentChildId?: string;
  runtimeSessionId?: string;
  poisoned: boolean;
  conflictReasons: Set<ClaudeChildEvidenceConflictReason>;
}

interface ChildLifecycle {
  startedAtMs: number;
  terminal?: {
    state: Exclude<ClaudeChildRuntimeFactState, 'started' | 'conflicted'>;
    terminationReason?: ClaudeChildRuntimeFact['terminationReason'];
  };
  conflictEmitted: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nativeTaskToolUses(value: unknown): Array<{ id: string }> {
  if (!isRecord(value) || !Array.isArray(value.content)) return [];
  return value.content.flatMap((block) => (
    isRecord(block) &&
    block.type === 'tool_use' &&
    block.name === 'Task' &&
    typeof block.id === 'string' &&
    block.id.trim()
      ? [{ id: block.id }]
      : []
  ));
}

/**
 * Collect native Claude Task sidechain lifecycle facts without changing the
 * order or meaning of the main stream parser. Unknown frames are ignored.
 */
export function createClaudeChildEvidenceCollector(input: {
  onFact: (fact: ClaudeChildRuntimeFact) => void;
  now?: () => number;
}): ClaudeChildEvidenceCollector {
  const now = input.now ?? Date.now;
  const nativeTasks = new Map<string, NativeTaskRegistration>();
  const lifecycles = new Map<string, ChildLifecycle>();
  let runtimeSessionId: string | undefined;
  let runtimeSessionConflicted = false;

  function emit(fact: ClaudeChildRuntimeFact): void {
    // This is a side channel. A telemetry/observer callback must never consume
    // or abort the production parser's main UI/lifecycle event stream.
    try {
      input.onFact(fact);
    } catch {}
  }

  function started(childId: string, at: number): ChildLifecycle {
    const existing = lifecycles.get(childId);
    if (existing) return existing;
    const lifecycle = { startedAtMs: at, conflictEmitted: false };
    lifecycles.set(childId, lifecycle);
    const registration = nativeTasks.get(childId);
    if (registration?.poisoned) {
      emitConflict(childId, lifecycle, registration);
      return lifecycle;
    }
    emit({
      adapterVersion: CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION,
      childId,
      ...(registration?.parentChildId
        ? { parentChildId: registration.parentChildId }
        : {}),
      state: 'started',
      source: 'claude_stream_json',
      sourceEventType: 'assistant.parent_tool_use_id',
      observedAtMs: at,
      startedAtMs: at,
      ...(registration?.runtimeSessionId
        ? { runtimeSessionId: registration.runtimeSessionId }
        : {}),
    });
    return lifecycle;
  }

  function emitConflict(
    childId: string,
    lifecycle: ChildLifecycle,
    registration: NativeTaskRegistration,
  ): void {
    // `conflicted` adapts to a non-terminal observation. If the Child had not
    // terminated, the graph reports child_terminal_missing; if a contradictory
    // frame arrived after terminal, terminal_status_changed retracts L2.
    if (lifecycle.conflictEmitted) return;
    lifecycle.conflictEmitted = true;
    const at = now();
    emit({
      adapterVersion: CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION,
      childId,
      ...(registration.parentChildId
        ? { parentChildId: registration.parentChildId }
        : {}),
      state: 'conflicted',
      source: 'claude_stream_json',
      sourceEventType: registration.conflictReasons.has('runtime_session_changed')
        ? 'system.init'
        : 'assistant.parent_tool_use_id',
      observedAtMs: at,
      startedAtMs: lifecycle.startedAtMs,
      ...(registration.runtimeSessionId
        ? { runtimeSessionId: registration.runtimeSessionId }
        : {}),
      conflictReasons: [...registration.conflictReasons].sort(),
    });
  }

  function poison(
    childId: string,
    reason: ClaudeChildEvidenceConflictReason,
  ): void {
    const registration = nativeTasks.get(childId);
    if (!registration) return;
    registration.poisoned = true;
    registration.conflictReasons.add(reason);
    const lifecycle = lifecycles.get(childId) ?? {
      startedAtMs: now(),
      conflictEmitted: false,
    };
    if (!lifecycles.has(childId)) lifecycles.set(childId, lifecycle);
    emitConflict(childId, lifecycle, registration);
  }

  function registerTask(childId: string, parentChildId?: string): void {
    const existing = nativeTasks.get(childId);
    if (existing) {
      if (
        existing.parentChildId !== parentChildId ||
        existing.runtimeSessionId !== runtimeSessionId
      ) {
        poison(childId, existing.parentChildId !== parentChildId
          ? 'task_parent_rebound'
          : 'runtime_session_changed');
      }
      return;
    }
    nativeTasks.set(childId, {
      ...(parentChildId ? { parentChildId } : {}),
      ...(runtimeSessionId ? { runtimeSessionId } : {}),
      poisoned: runtimeSessionConflicted,
      conflictReasons: new Set<ClaudeChildEvidenceConflictReason>(
        runtimeSessionConflicted ? ['runtime_session_changed'] : [],
      ),
    });
    if (runtimeSessionConflicted) poison(childId, 'runtime_session_changed');
  }

  function terminal(inputFact: {
    childId: string;
    state: Exclude<ClaudeChildRuntimeFactState, 'started' | 'conflicted'>;
    sourceEventType: ClaudeChildRuntimeFact['sourceEventType'];
    terminationReason?: ClaudeChildRuntimeFact['terminationReason'];
  }): void {
    const at = now();
    const lifecycle = started(inputFact.childId, at);
    const registration = nativeTasks.get(inputFact.childId);
    if (!registration || registration.poisoned) return;
    if (lifecycle.terminal) {
      if (
        lifecycle.terminal.state !== inputFact.state ||
        lifecycle.terminal.terminationReason !== inputFact.terminationReason
      ) {
        poison(inputFact.childId, 'terminal_state_conflict');
      }
      return;
    }
    lifecycle.terminal = {
      state: inputFact.state,
      ...(inputFact.terminationReason
        ? { terminationReason: inputFact.terminationReason }
        : {}),
    };
    emit({
      adapterVersion: CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION,
      childId: inputFact.childId,
      ...(registration?.parentChildId
        ? { parentChildId: registration.parentChildId }
        : {}),
      state: inputFact.state,
      source: 'claude_stream_json',
      sourceEventType: inputFact.sourceEventType,
      observedAtMs: at,
      startedAtMs: lifecycle.startedAtMs,
      endedAtMs: at,
      ...(registration.runtimeSessionId
        ? { runtimeSessionId: registration.runtimeSessionId }
        : {}),
      ...(inputFact.terminationReason
        ? { terminationReason: inputFact.terminationReason }
        : {}),
    });
  }

  function observe(value: unknown): void {
    if (!isRecord(value)) return;
    if (
      value.type === 'system' &&
      value.subtype === 'init' &&
      typeof value.session_id === 'string' &&
      value.session_id.trim()
    ) {
      if (runtimeSessionId === undefined) {
        runtimeSessionId = value.session_id;
        if (nativeTasks.size > 0) {
          runtimeSessionConflicted = true;
          for (const childId of nativeTasks.keys()) {
            poison(childId, 'runtime_session_changed');
          }
        }
      } else if (runtimeSessionId !== value.session_id) {
        runtimeSessionConflicted = true;
        for (const childId of nativeTasks.keys()) {
          poison(childId, 'runtime_session_changed');
        }
      }
      return;
    }
    if (value.type !== 'assistant' || !isRecord(value.message)) return;

    const wrapperParentId = typeof value.parent_tool_use_id === 'string' &&
      value.parent_tool_use_id.trim()
      ? value.parent_tool_use_id
      : undefined;
    const wrapperIsKnownChild = wrapperParentId === undefined || nativeTasks.has(wrapperParentId);
    if (wrapperIsKnownChild) {
      for (const task of nativeTaskToolUses(value.message)) {
        registerTask(task.id, wrapperParentId);
      }
    }

    if (!wrapperParentId || !nativeTasks.has(wrapperParentId)) return;
    const lifecycle = started(wrapperParentId, now());
    const registration = nativeTasks.get(wrapperParentId);
    if (!registration || registration.poisoned) return;

    if (typeof value.error === 'string' && value.error.trim()) {
      terminal({
        childId: wrapperParentId,
        state: 'failed',
        sourceEventType: 'assistant.parent_tool_use_id',
        terminationReason: 'assistant_error',
      });
      return;
    }
    const stopReason = typeof value.message.stop_reason === 'string'
      ? value.message.stop_reason
      : null;
    // Only the observed native Task end_turn shape proves success. Unknown
    // future stop reasons (for example a provider truncation) keep coverage
    // incomplete instead of being promoted to a completed Child.
    if (stopReason === 'end_turn') {
      terminal({
        childId: wrapperParentId,
        state: 'completed',
        sourceEventType: 'assistant.parent_tool_use_id',
      });
    }
  }

  function finishOpenChildren(reason: ClaudeOpenChildTerminationReason): void {
    for (const [childId, lifecycle] of lifecycles) {
      const registration = nativeTasks.get(childId);
      if (lifecycle.terminal || registration?.poisoned) continue;
      terminal({
        childId,
        state: reason === 'canceled' ? 'canceled' : 'failed',
        sourceEventType: 'host_process_close',
        terminationReason: reason,
      });
    }
  }

  return { observe, finishOpenChildren };
}

export interface AdaptClaudeChildFactInput {
  fact: ClaudeChildRuntimeFact;
  agentCliVersion?: string;
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  taskRunObservationId: string;
  stage: StrategyInputStageV2;
}

function childObservationId(runId: string, childId: string): string {
  return `claude-child:${runId}:${childId}`;
}

/**
 * Convert one Claude runtime fact to the provider-neutral V1 observation.
 * Prompt and usage stay unavailable because `parent_tool_use_id` contains no
 * independent evidence for either boundary.
 */
export function adaptClaudeChildRuntimeFactV1(
  input: AdaptClaudeChildFactInput,
): NormalizedAgentObservationV1 {
  const fact = input.fact;
  const status = fact.state === 'started' || fact.state === 'conflicted'
    ? 'running'
    : fact.state === 'completed'
      ? 'completed'
      : fact.state === 'canceled'
        ? 'canceled'
        : 'failed';
  const observation = {
    schema: NORMALIZED_AGENT_OBSERVATION_V1_SCHEMA,
    identity: {
      observationId: childObservationId(input.runId, fact.childId),
      taskExecutionId: input.taskExecutionId,
      runId: input.runId,
      taskRunIndex: input.taskRunIndex,
      parentObservationId: fact.parentChildId
        ? childObservationId(input.runId, fact.parentChildId)
        : input.taskRunObservationId,
      ...(fact.runtimeSessionId ? { runtimeSessionId: fact.runtimeSessionId } : {}),
    },
    kind: 'child_agent' as const,
    stage: input.stage,
    status,
    prompt: {
      hostComposed: {
        availability: 'unobservable' as const,
        limitations: ['Claude child host-composed Prompt is outside the stream-json boundary.'],
      },
      childInjected: {
        availability: 'unavailable' as const,
        source: 'unknown' as const,
        limitations: ['parent_tool_use_id does not prove the injected Child Prompt.'],
      },
      agentEffectiveContext: {
        availability: 'unobservable' as const,
        limitations: ['Claude does not expose the effective Child context in this stream.'],
      },
    },
    usage: {
      availability: 'unavailable' as const,
      source: 'unknown' as const,
      accountingMode: 'unknown' as const,
      limitations: ['Claude child usage is not independently reported by this stream shape.'],
    },
    timing: {
      availability: 'partial' as const,
      evidence: [{
        source: 'host_wall_clock' as const,
        clockDomain: 'unix_epoch_ms',
        startedAtMs: fact.startedAtMs,
        ...(fact.endedAtMs === undefined
          ? {}
          : {
              endedAtMs: fact.endedAtMs,
              durationMs: fact.endedAtMs - fact.startedAtMs,
            }),
      }],
      limitations: [
        fact.endedAtMs === undefined
          ? 'Child terminal time has not been observed.'
          : 'Host observation window begins at first sidechain frame, not native Child spawn.',
      ],
    },
    limitations: [
      'Lifecycle is derived only from a matched native Task tool_use and parent_tool_use_id.',
      ...(fact.state === 'conflicted'
        ? ['Claude Child association evidence conflicted; this observation must not be promoted to L2.']
        : []),
    ],
    attributes: {
      runtimeAdapterVersion: fact.adapterVersion,
      ...(input.agentCliVersion
        ? { agentCliVersion: input.agentCliVersion }
        : {}),
      nativeTaskToolUseId: fact.childId,
      source: fact.source,
      sourceEventType: fact.sourceEventType,
      associationStatus: fact.state === 'conflicted' ? 'conflicted' : 'verified',
      ...(fact.conflictReasons ? { conflictReasons: fact.conflictReasons } : {}),
      ...(fact.terminationReason ? { terminationReason: fact.terminationReason } : {}),
    },
  };
  return NormalizedAgentObservationV1Schema.parse(observation);
}
