import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  evaluateRuntimeEvidenceGraphV1,
  evaluateRuntimeFixtureCaseV1,
  normalizeAgentObservationV1,
  type NormalizedAgentObservationV1,
} from '@open-design/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { collectCodexChildEvidence } from '../../src/runtimes/codex-child-evidence.js';

const PARENT = '10000000-0000-4000-8000-000000000001';
const CHILD = '20000000-0000-4000-8000-000000000002';
const GRANDCHILD = '30000000-0000-4000-8000-000000000003';
const SIBLING = '40000000-0000-4000-8000-000000000004';
const BASE_TIME = Date.parse('2026-08-14T00:00:00.000Z');

const temporaryRoots: string[] = [];

function timestamp(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}

function metadata(
  sessionId: string,
  parentSessionId?: string,
  nestedParentSessionId = parentSessionId,
): Record<string, unknown> {
  return {
    timestamp: timestamp(0),
    type: 'session_meta',
    payload: {
      id: sessionId,
      ...(parentSessionId ? { parent_thread_id: parentSessionId } : {}),
      ...(nestedParentSessionId
        ? {
            source: {
              subagent: {
                thread_spawn: { parent_thread_id: nestedParentSessionId },
              },
            },
          }
        : {}),
    },
  };
}

function event(offsetMs: number, payload: Record<string, unknown>): Record<string, unknown> {
  return { timestamp: timestamp(offsetMs), type: 'event_msg', payload };
}

function turn(input: {
  id: string;
  startedAtMs: number;
  prompt?: string;
  usage?: Record<string, number>;
  childActivities?: Array<{ sessionId: string; kind: string; atMs: number }>;
  terminal?: 'complete' | 'abort-canceled' | 'abort-failed' | 'none';
}): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [
    event(input.startedAtMs, { type: 'task_started', turn_id: input.id }),
  ];
  if (input.prompt !== undefined) {
    records.push(event(input.startedAtMs + 10, { type: 'user_message', message: input.prompt }));
  }
  if (input.usage) {
    records.push(event(input.startedAtMs + 20, {
      type: 'token_count',
      info: {
        last_token_usage: input.usage,
        total_token_usage: input.usage,
      },
    }));
  }
  for (const activity of input.childActivities ?? []) {
    records.push(event(activity.atMs, {
      type: 'sub_agent_activity',
      agent_thread_id: activity.sessionId,
      kind: activity.kind,
      occurred_at_ms: BASE_TIME + activity.atMs,
    }));
  }
  if (input.terminal === 'abort-canceled' || input.terminal === 'abort-failed') {
    records.push(event(input.startedAtMs + 900, {
      type: 'turn_aborted',
      reason: input.terminal === 'abort-canceled' ? 'cancelled' : 'runtime_error',
    }));
  } else if (input.terminal !== 'none') {
    records.push(event(input.startedAtMs + 900, { type: 'task_complete', turn_id: input.id }));
  }
  return records;
}

async function codexHome(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'od-codex-child-evidence-'));
  temporaryRoots.push(root);
  return root;
}

async function writeRollout(
  home: string,
  sessionId: string,
  records: readonly Record<string, unknown>[],
  date = '2026/08/14',
): Promise<string> {
  const directory = path.join(home, 'sessions', ...date.split('/'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, `rollout-${date.replaceAll('/', '-')}-${sessionId}.jsonl`);
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o600,
  });
  return filePath;
}

function collectInput(home: string, overrides: Record<string, unknown> = {}) {
  return {
    codexHome: home,
    parentSessionId: PARENT,
    parentTurnId: 'parent-turn',
    taskExecutionId: 'task-1',
    runId: 'run-1',
    taskRunIndex: 0,
    stage: 'production' as const,
    parentObservationId: 'root',
    runStartedAtMs: BASE_TIME,
    runEndedAtMs: BASE_TIME + 10_000,
    ...overrides,
  };
}

function root(status: NormalizedAgentObservationV1['status']): NormalizedAgentObservationV1 {
  return normalizeAgentObservationV1({
    identity: {
      observationId: 'root',
      taskExecutionId: 'task-1',
      runId: 'run-1',
      taskRunIndex: 0,
      runtimeSessionId: PARENT,
    },
    kind: 'task_run',
    stage: 'production',
    status,
    limitations: [],
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootPath) => (
    rm(rootPath, { recursive: true, force: true })
  )));
});

describe('collectCodexChildEvidence', () => {
  it('collects declared child and grandchild lifecycles without exposing prompt text', async () => {
    const home = await codexHome();
    const secretPrompt = 'never-upload-this-prompt';
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: CHILD, kind: 'completed', atMs: 6_000 },
        ],
      }),
    ]);
    await writeRollout(home, CHILD, [
      metadata(CHILD, PARENT),
      ...turn({ id: 'parent-turn', startedAtMs: 100, terminal: 'complete' }),
      ...turn({
        id: 'child-turn',
        startedAtMs: 2_000,
        prompt: secretPrompt,
        usage: { input_tokens: 11, output_tokens: 7, cached_input_tokens: 3 },
        childActivities: [
          { sessionId: GRANDCHILD, kind: 'started', atMs: 3_000 },
          { sessionId: GRANDCHILD, kind: 'completed', atMs: 5_000 },
        ],
      }),
    ]);
    await writeRollout(home, GRANDCHILD, [
      metadata(GRANDCHILD, CHILD),
      ...turn({
        id: 'grandchild-turn',
        startedAtMs: 3_500,
        prompt: 'grandchild prompt',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    ]);

    const result = await collectCodexChildEvidence(collectInput(home));
    const serialized = JSON.stringify(result);
    const graph = evaluateRuntimeEvidenceGraphV1([
      root('running'),
      ...result.observations,
      root('completed'),
    ]);

    expect(result.observations.filter((observation) => (
      observation.kind === 'child_agent' && observation.status === 'completed'
    ))).toHaveLength(2);
    expect(graph).toMatchObject({ valid: true, evidenceLevel: 'L3' });
    expect(evaluateRuntimeFixtureCaseV1('child_success', [
      root('running'),
      ...result.observations,
      root('completed'),
    ])).toMatchObject({ outcome: 'passed' });
    expect(serialized).not.toContain(secretPrompt);
    expect(serialized).not.toContain(home);
    expect(serialized).toContain('contentRedacted');
    expect(result.limitations).toContain('codex_inherited_turn_excluded');

    const depthLimited = await collectCodexChildEvidence(collectInput(home, {
      maxRecursionDepth: 1,
    }));
    expect(depthLimited.diagnostics).toContainEqual({
      code: 'child_recursion_depth_exceeded',
      count: 1,
    });
    expect(depthLimited.observations.some((observation) => (
      observation.identity.runtimeSessionId === GRANDCHILD
    ))).toBe(false);
  });

  it('uses parent lifecycle status for failure recovery and cancel evidence', async () => {
    const home = await codexHome();
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: CHILD, kind: 'failed', atMs: 6_000 },
          { sessionId: SIBLING, kind: 'started', atMs: 1_500 },
          { sessionId: SIBLING, kind: 'cancelled', atMs: 6_500 },
        ],
      }),
    ]);
    for (const [sessionId, prompt] of [[CHILD, 'failed child'], [SIBLING, 'canceled child']] as const) {
      await writeRollout(home, sessionId, [
        metadata(sessionId, PARENT),
        ...turn({
          id: `${sessionId}-turn`,
          startedAtMs: sessionId === CHILD ? 2_000 : 2_500,
          prompt,
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      ]);
    }

    const result = await collectCodexChildEvidence(collectInput(home));
    const childStatuses = result.observations
      .filter((observation) => observation.kind === 'child_agent')
      .map((observation) => observation.status);
    const fixture = evaluateRuntimeFixtureCaseV1('child_failure_parent_recovers', [
      root('running'),
      ...result.observations,
      root('completed'),
    ]);

    expect(childStatuses).toContain('failed');
    expect(childStatuses).toContain('canceled');
    expect(fixture).toMatchObject({ outcome: 'passed' });

    const sessionLimited = await collectCodexChildEvidence(collectInput(home, {
      maxChildSessions: 1,
    }));
    expect(sessionLimited.diagnostics).toContainEqual({
      code: 'child_session_limit_exceeded',
      count: 1,
    });
    expect(new Set(sessionLimited.observations.map((observation) => (
      observation.identity.runtimeSessionId
    )))).toEqual(new Set([CHILD]));
  });

  it('rejects missing, mismatched, and cyclic parent declarations', async () => {
    const home = await codexHome();
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: SIBLING, kind: 'started', atMs: 1_100 },
        ],
      }),
    ]);
    await writeRollout(home, CHILD, [
      metadata(CHILD, PARENT),
      ...turn({
        id: 'child-turn',
        startedAtMs: 2_000,
        prompt: 'valid',
        usage: { input_tokens: 1, output_tokens: 1 },
        childActivities: [{ sessionId: PARENT, kind: 'started', atMs: 2_500 }],
      }),
    ]);
    await writeRollout(home, SIBLING, [
      metadata(SIBLING, GRANDCHILD),
      ...turn({ id: 'sibling-turn', startedAtMs: 2_000 }),
    ]);

    const result = await collectCodexChildEvidence(collectInput(home));

    expect(result.observations.some((observation) => (
      observation.identity.runtimeSessionId === SIBLING
    ))).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      { code: 'child_cycle_rejected', count: 1 },
      { code: 'child_parent_mismatch', count: 1 },
    ]));
    expect(result.limitations).toEqual(expect.arrayContaining([
      'codex_child_cycle_rejected',
      'codex_child_parent_unverified',
    ]));
  });

  it('keeps one incomplete child partial even when another child terminates', async () => {
    const home = await codexHome();
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: CHILD, kind: 'completed', atMs: 6_000 },
          { sessionId: SIBLING, kind: 'started', atMs: 1_500 },
          { sessionId: SIBLING, kind: 'future_unknown_kind', atMs: 6_500 },
        ],
      }),
    ]);
    await writeRollout(home, CHILD, [
      metadata(CHILD, PARENT),
      ...turn({ id: 'child-turn', startedAtMs: 2_000 }),
    ]);
    await writeRollout(home, SIBLING, [
      metadata(SIBLING, PARENT),
      ...turn({ id: 'sibling-turn', startedAtMs: 2_500, terminal: 'none' }),
    ]);

    const result = await collectCodexChildEvidence(collectInput(home));

    expect(result.availability).toBe('partial');
    expect(result.limitations).toContain('codex_child_terminal_not_observed');
    const siblingLifecycle = result.observations.filter((observation) => (
      observation.identity.runtimeSessionId === SIBLING && observation.kind === 'child_agent'
    ));
    expect(siblingLifecycle.map((observation) => observation.status)).toEqual(['running']);
  });

  it('rejects ambiguous multi-turn child sessions instead of double-terminating them', async () => {
    const home = await codexHome();
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: CHILD, kind: 'completed', atMs: 6_000 },
        ],
      }),
    ]);
    await writeRollout(home, CHILD, [
      metadata(CHILD, PARENT),
      ...turn({ id: 'child-turn-1', startedAtMs: 2_000 }),
      ...turn({ id: 'child-turn-2', startedAtMs: 4_000 }),
    ]);

    const result = await collectCodexChildEvidence(collectInput(home));

    expect(result.observations).toEqual([]);
    expect(result.limitations).toContain('codex_child_turn_ambiguous');
    expect(result.diagnostics).toContainEqual({ code: 'child_turn_ambiguous', count: 1 });
  });

  it('fails closed on undeclared roots, unsafe files, ambiguous rotation, and scan bounds', async () => {
    const home = await codexHome();
    const parentRecords = [
      metadata(PARENT),
      ...turn({ id: 'parent-turn', startedAtMs: 100 }),
    ];
    const parentPath = await writeRollout(home, PARENT, parentRecords);

    await expect(collectCodexChildEvidence(collectInput(home, { codexHome: undefined })))
      .resolves.toMatchObject({
        availability: 'unavailable',
        diagnostics: [{ code: 'codex_home_not_declared', count: 1 }],
      });

    await chmod(parentPath, 0o666);
    await expect(collectCodexChildEvidence(collectInput(home))).resolves.toMatchObject({
      availability: 'unavailable',
      diagnostics: [{ code: 'unsafe_rollout_file', count: 1 }],
    });
    await chmod(parentPath, 0o600);

    await writeRollout(home, PARENT, parentRecords, '2026/08/13');
    await expect(collectCodexChildEvidence(collectInput(home))).resolves.toMatchObject({
      availability: 'unavailable',
      diagnostics: [{ code: 'rollout_ambiguous', count: 1 }],
    });

    const boundedHome = await codexHome();
    await mkdir(path.join(boundedHome, 'sessions', '2026', '08', '14'), {
      recursive: true,
      mode: 0o700,
    });
    await writeRollout(boundedHome, PARENT, parentRecords, '2026/08/13');
    await expect(collectCodexChildEvidence(collectInput(boundedHome, {
      maxDayDirectories: 1,
    }))).resolves.toMatchObject({
      availability: 'unavailable',
      diagnostics: [{ code: 'rollout_rotation_window_exhausted', count: 1 }],
    });
  });

  it('does not follow rollout symlinks or accept conflicting parent metadata', async () => {
    const home = await codexHome();
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [{ sessionId: CHILD, kind: 'started', atMs: 1_000 }],
      }),
    ]);
    const outside = path.join(home, 'outside.jsonl');
    await writeFile(outside, `${JSON.stringify(metadata(CHILD, PARENT))}\n`, { mode: 0o600 });
    const day = path.join(home, 'sessions', '2026', '08', '14');
    await symlink(outside, path.join(day, `rollout-symlink-${CHILD}.jsonl`));

    const symlinkResult = await collectCodexChildEvidence(collectInput(home));
    expect(symlinkResult.observations).toEqual([]);
    expect(symlinkResult.diagnostics).toContainEqual({ code: 'rollout_not_found', count: 1 });

    await rm(path.join(day, `rollout-symlink-${CHILD}.jsonl`));
    await writeRollout(home, CHILD, [
      metadata(CHILD, PARENT),
      metadata(CHILD, GRANDCHILD),
      ...turn({ id: 'child-turn', startedAtMs: 2_000 }),
    ]);
    const conflictResult = await collectCodexChildEvidence(collectInput(home));
    expect(conflictResult.observations).toEqual([]);
    expect(conflictResult.diagnostics).toContainEqual({
      code: 'parent_declaration_conflict',
      count: 1,
    });
  });

  it('fails closed on conflicting parent terminal states while deduplicating one state', async () => {
    const home = await codexHome();
    const childRecords = [
      metadata(CHILD, PARENT),
      ...turn({
        id: 'child-turn',
        startedAtMs: 2_000,
        prompt: 'terminal conflict child',
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    ];
    await writeRollout(home, CHILD, childRecords);
    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: CHILD, kind: 'completed', atMs: 5_000 },
          { sessionId: CHILD, kind: 'completed', atMs: 5_500 },
        ],
      }),
    ]);

    const duplicateResult = await collectCodexChildEvidence(collectInput(home));
    const completed = duplicateResult.observations.find((observation) => (
      observation.kind === 'child_agent' && observation.status === 'completed'
    ));
    expect(completed?.timing.evidence?.[0]?.endedAtMs).toBe(BASE_TIME + 5_500);
    expect(duplicateResult.diagnostics).not.toContainEqual({
      code: 'child_terminal_status_conflict',
      count: 1,
    });

    await writeRollout(home, PARENT, [
      metadata(PARENT),
      ...turn({
        id: 'parent-turn',
        startedAtMs: 100,
        terminal: 'none',
        childActivities: [
          { sessionId: CHILD, kind: 'started', atMs: 1_000 },
          { sessionId: CHILD, kind: 'completed', atMs: 5_000 },
          { sessionId: CHILD, kind: 'failed', atMs: 6_000 },
        ],
      }),
    ]);

    const conflictResult = await collectCodexChildEvidence(collectInput(home));
    expect(conflictResult.availability).toBe('partial');
    expect(conflictResult.limitations).toContain('codex_child_terminal_status_conflict');
    expect(conflictResult.diagnostics).toContainEqual({
      code: 'child_terminal_status_conflict',
      count: 1,
    });
    expect(conflictResult.observations.some((observation) => (
      observation.kind === 'child_agent' &&
      ['completed', 'failed', 'canceled'].includes(observation.status)
    ))).toBe(false);
    expect(conflictResult.observations).toContainEqual(expect.objectContaining({
      kind: 'model_call',
      status: 'unknown',
    }));
  });
});
