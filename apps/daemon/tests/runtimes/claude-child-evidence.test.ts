import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateRuntimeEvidenceGraphV1 } from '@open-design/contracts';
import { describe, expect, it } from 'vitest';

import { buildStructuredMainRunObservationV1 } from '../../src/observability/main-run-observation.js';
import { safeTaskObservationRuntimeVersions } from '../../src/observability/task-observation-aggregation.js';
import {
  CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION,
  adaptClaudeChildRuntimeFactV1,
  createClaudeChildEvidenceCollector,
  type ClaudeChildRuntimeFact,
} from '../../src/runtimes/claude-child-evidence.js';
import { createClaudeStreamHandler } from '../../src/runtimes/claude-stream.js';

type Fixture = {
  provenance: 'test_synthetic';
  containsSensitiveContent: false;
  cases: Record<string, unknown[]>;
};

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'od-next-runtime-capabilities',
  'claude-code.synthetic.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

function replay(caseId: string, opts?: { finish?: 'canceled' | 'timeout' | 'stream_incomplete' }) {
  const mainEvents: Array<Record<string, unknown>> = [];
  const facts: ClaudeChildRuntimeFact[] = [];
  let now = 1000;
  const handler = createClaudeStreamHandler(
    (event) => mainEvents.push(event),
    {
      onChildRuntimeFact: (fact) => facts.push(fact),
      childEvidenceNow: () => {
        now += 10;
        return now;
      },
    },
  );
  for (const frame of fixture.cases[caseId] ?? []) {
    handler.feed(`${JSON.stringify(frame)}\n`);
  }
  handler.flush();
  if (opts?.finish) handler.finishOpenChildEvidence(opts.finish);
  return { mainEvents, facts };
}

function root(status: 'running' | 'completed') {
  return buildStructuredMainRunObservationV1({
    taskExecutionId: 'task-execution-1',
    runId: 'run-1',
    taskRunIndex: 1,
    runtimeSessionId: 'session-synthetic',
    stage: 'production',
    status,
    startedAtMs: 900,
    ...(status === 'completed' ? { endedAtMs: 1100 } : {}),
  });
}

function adapt(fact: ClaudeChildRuntimeFact) {
  return adaptClaudeChildRuntimeFactV1({
    fact,
    agentCliVersion: '2.1.219 (Claude Code)',
    taskExecutionId: 'task-execution-1',
    runId: 'run-1',
    taskRunIndex: 1,
    taskRunObservationId: 'task-run:task-execution-1:run-1',
    stage: 'production',
  });
}

function collect(
  frames: unknown[],
  finish?: 'canceled' | 'timeout' | 'stream_incomplete',
): ClaudeChildRuntimeFact[] {
  const facts: ClaudeChildRuntimeFact[] = [];
  let now = 2000;
  const collector = createClaudeChildEvidenceCollector({
    onFact: (fact) => facts.push(fact),
    now: () => {
      now += 10;
      return now;
    },
  });
  for (const frame of frames) collector.observe(frame);
  if (finish) collector.finishOpenChildren(finish);
  return facts;
}

function evaluate(facts: ClaudeChildRuntimeFact[]) {
  return evaluateRuntimeEvidenceGraphV1([
    root('running'),
    ...facts.map(adapt),
    root('completed'),
  ]);
}

describe('Claude native Child evidence side channel', () => {
  it('normalizes a matched Task sidechain lifecycle to L2 without inventing Prompt or usage', () => {
    const { mainEvents, facts } = replay('child_success');

    expect(facts.map((fact) => [fact.childId, fact.state])).toEqual([
      ['task-success', 'started'],
      ['task-success', 'completed'],
    ]);
    const observations = [root('running'), ...facts.map(adapt), root('completed')];
    const graph = evaluateRuntimeEvidenceGraphV1(observations);
    expect(graph).toMatchObject({ valid: true, evidenceLevel: 'L2' });
    expect(observations[2]).toMatchObject({
      prompt: { childInjected: { availability: 'unavailable' } },
      usage: { availability: 'unavailable', accountingMode: 'unknown' },
      attributes: {
        agentCliVersion: '2.1.219 (Claude Code)',
        runtimeAdapterVersion: CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION,
      },
    });
    expect(safeTaskObservationRuntimeVersions(observations[2]!)).toEqual({
      agentCliVersion: '2.1.219 (Claude Code)',
      runtimeAdapterVersion: CLAUDE_CHILD_EVIDENCE_ADAPTER_VERSION,
    });
    expect(mainEvents).toContainEqual({ type: 'turn_end', stopReason: 'tool_use' });
    expect(mainEvents).toContainEqual({ type: 'turn_end', stopReason: 'end_turn' });
  });

  it('keeps child failure separate while the parent main turn recovers', () => {
    const { mainEvents, facts } = replay('child_failure_parent_recovers');

    expect(facts.map((fact) => fact.state)).toEqual(['started', 'failed']);
    expect(facts[1]).toMatchObject({ terminationReason: 'assistant_error' });
    expect(mainEvents.filter((event) => event.type === 'error')).toEqual([]);
    expect(mainEvents.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', stopReason: 'tool_use' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('tracks multiple stable native Task ids and emits exactly one terminal per child', () => {
    const { facts } = replay('multiple_children');

    expect(facts.map((fact) => `${fact.childId}:${fact.state}`)).toEqual([
      'task-a:started',
      'task-a:completed',
      'task-b:started',
      'task-b:completed',
    ]);
  });

  it('accepts an idempotent repeat of the same session, Task id, and parent tuple', () => {
    const taskFrame = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'task-repeat', name: 'Task', input: {} }],
        stop_reason: 'tool_use',
      },
    };
    const facts = collect([
      { type: 'system', subtype: 'init', session_id: 'session-repeat' },
      taskFrame,
      taskFrame,
      {
        type: 'assistant',
        parent_tool_use_id: 'task-repeat',
        message: { content: [], stop_reason: 'end_turn' },
      },
    ]);

    expect(facts.map((fact) => fact.state)).toEqual(['started', 'completed']);
    expect(evaluate(facts)).toMatchObject({ valid: true, evidenceLevel: 'L2' });
  });

  it('tracks a nested native Task with immutable parent association', () => {
    const facts = collect([
      { type: 'system', subtype: 'init', session_id: 'session-nested' },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [{ type: 'tool_use', id: 'task-parent', name: 'Task', input: {} }],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'task-parent',
        message: {
          content: [{ type: 'tool_use', id: 'task-nested', name: 'Task', input: {} }],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'task-nested',
        message: { content: [], stop_reason: 'end_turn' },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'task-parent',
        message: { content: [], stop_reason: 'end_turn' },
      },
    ]);

    expect(facts.map((fact) => [fact.childId, fact.state, fact.parentChildId])).toEqual([
      ['task-parent', 'started', undefined],
      ['task-nested', 'started', 'task-parent'],
      ['task-nested', 'completed', 'task-parent'],
      ['task-parent', 'completed', undefined],
    ]);
    expect(evaluate(facts)).toMatchObject({ valid: true, evidenceLevel: 'L2' });
  });

  it.each([
    {
      label: 'root to nested',
      frames: [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'tool_use', id: 'task-dup', name: 'Task', input: {} },
              { type: 'tool_use', id: 'task-parent', name: 'Task', input: {} },
            ],
            stop_reason: 'tool_use',
          },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-parent',
          message: {
            content: [{ type: 'tool_use', id: 'task-dup', name: 'Task', input: {} }],
            stop_reason: 'end_turn',
          },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-dup',
          message: { content: [], stop_reason: 'end_turn' },
        },
      ],
    },
    {
      label: 'nested parent A to parent B',
      frames: [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'tool_use', id: 'task-a', name: 'Task', input: {} },
              { type: 'tool_use', id: 'task-b', name: 'Task', input: {} },
            ],
            stop_reason: 'tool_use',
          },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-a',
          message: {
            content: [{ type: 'tool_use', id: 'task-dup', name: 'Task', input: {} }],
            stop_reason: 'end_turn',
          },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-b',
          message: {
            content: [{ type: 'tool_use', id: 'task-dup', name: 'Task', input: {} }],
            stop_reason: 'end_turn',
          },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-dup',
          message: { content: [], stop_reason: 'end_turn' },
        },
      ],
    },
  ])('poisons a Task id after $label rebinding instead of choosing a parent', ({ frames }) => {
    const facts = collect([
      { type: 'system', subtype: 'init', session_id: 'session-rebind' },
      ...frames,
    ], 'stream_incomplete');
    const duplicateFacts = facts.filter((fact) => fact.childId === 'task-dup');

    expect(duplicateFacts.map((fact) => fact.state)).toEqual(['conflicted']);
    expect(duplicateFacts[0]).toMatchObject({
      conflictReasons: ['task_parent_rebound'],
    });
    expect(adapt(duplicateFacts[0]!)).toMatchObject({
      status: 'running',
      limitations: expect.arrayContaining([
        expect.stringContaining('must not be promoted to L2'),
      ]),
      attributes: {
        associationStatus: 'conflicted',
        conflictReasons: ['task_parent_rebound'],
      },
    });
    expect(evaluate(facts)).toMatchObject({ valid: false, evidenceLevel: 'L0' });
  });

  it('poisons every registered Task when the runtime session changes', () => {
    const facts = collect([
      { type: 'system', subtype: 'init', session_id: 'session-a' },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [{ type: 'tool_use', id: 'task-session', name: 'Task', input: {} }],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'task-session',
        message: { content: [], stop_reason: null },
      },
      { type: 'system', subtype: 'init', session_id: 'session-b' },
      {
        type: 'assistant',
        parent_tool_use_id: 'task-session',
        message: { content: [], stop_reason: 'end_turn' },
      },
    ], 'stream_incomplete');

    expect(facts.map((fact) => [fact.state, fact.runtimeSessionId])).toEqual([
      ['started', 'session-a'],
      ['conflicted', 'session-a'],
    ]);
    expect(facts[1]).toMatchObject({ conflictReasons: ['runtime_session_changed'] });
    expect(evaluate(facts)).toMatchObject({ valid: false, evidenceLevel: 'L0' });
  });

  it.each([
    {
      label: 'completed then failed',
      terminalFrames: [
        {
          type: 'assistant',
          parent_tool_use_id: 'task-terminal',
          message: { content: [], stop_reason: 'end_turn' },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-terminal',
          error: 'provider child error',
          message: { content: [], stop_reason: null },
        },
      ],
      firstTerminal: 'completed',
    },
    {
      label: 'failed then completed',
      terminalFrames: [
        {
          type: 'assistant',
          parent_tool_use_id: 'task-terminal',
          error: 'provider child error',
          message: { content: [], stop_reason: null },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'task-terminal',
          message: { content: [], stop_reason: 'end_turn' },
        },
      ],
      firstTerminal: 'failed',
    },
  ])('poisons $label evidence instead of keeping a certifiable first terminal', ({
    terminalFrames,
    firstTerminal,
  }) => {
    const facts = collect([
      { type: 'system', subtype: 'init', session_id: 'session-terminal' },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [{ type: 'tool_use', id: 'task-terminal', name: 'Task', input: {} }],
          stop_reason: 'tool_use',
        },
      },
      ...terminalFrames,
    ], 'stream_incomplete');

    expect(facts.map((fact) => fact.state)).toEqual([
      'started',
      firstTerminal,
      'conflicted',
    ]);
    expect(facts[2]).toMatchObject({ conflictReasons: ['terminal_state_conflict'] });
    const graph = evaluate(facts);
    expect(graph).toMatchObject({ valid: false, evidenceLevel: 'L0' });
    expect(graph.issues).toContainEqual({
      code: 'terminal_status_changed',
      observationId: 'claude-child:run-1:task-terminal',
    });
  });

  it.each([
    ['canceled', 'canceled', 'canceled'],
    ['timeout', 'failed', 'timeout'],
    ['stream_incomplete', 'failed', 'stream_incomplete'],
  ] as const)('finalizes an open child for %s without guessing a completed state', (
    finish,
    state,
    terminationReason,
  ) => {
    const { facts } = replay('incomplete_child', { finish });

    expect(facts.map((fact) => fact.state)).toEqual(['started', state]);
    expect(facts[1]).toMatchObject({
      sourceEventType: 'host_process_close',
      terminationReason,
    });
  });

  it('leaves an incomplete stream non-terminal until the host supplies a close reason', () => {
    const { facts } = replay('incomplete_child');
    const graph = evaluateRuntimeEvidenceGraphV1([root('running'), ...facts.map(adapt)]);

    expect(facts.map((fact) => fact.state)).toEqual(['started']);
    expect(graph).toMatchObject({ valid: false });
    expect(graph.issues).toContainEqual({
      code: 'child_terminal_missing',
      observationId: 'claude-child:run-1:task-incomplete',
    });
  });

  it('does not promote an unknown future stop reason to completed', () => {
    const facts: ClaudeChildRuntimeFact[] = [];
    const collector = createClaudeChildEvidenceCollector({
      onFact: (fact) => facts.push(fact),
      now: () => 100,
    });
    collector.observe({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'task-future', name: 'Task', input: {} }],
        stop_reason: 'tool_use',
      },
    });
    collector.observe({
      type: 'assistant',
      parent_tool_use_id: 'task-future',
      message: { content: [], stop_reason: 'future_provider_reason' },
    });

    expect(facts.map((fact) => fact.state)).toEqual(['started']);
  });

  it('ignores an unmatched parent_tool_use_id and swallows observer failure', () => {
    const facts: ClaudeChildRuntimeFact[] = [];
    const collector = createClaudeChildEvidenceCollector({
      onFact: (fact) => {
        facts.push(fact);
        throw new Error('observer failure');
      },
      now: () => 100,
    });
    collector.observe({
      type: 'assistant',
      parent_tool_use_id: 'not-a-matched-task',
      unknown_future_field: { preservedByMainParser: true },
      message: { content: [], stop_reason: 'end_turn' },
    });

    expect(facts).toEqual([]);
    expect(() => {
      collector.observe({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [{ type: 'tool_use', id: 'task-known', name: 'Task', input: {} }],
          stop_reason: 'tool_use',
        },
      });
      collector.observe({
        type: 'assistant',
        parent_tool_use_id: 'task-known',
        message: { content: [], stop_reason: 'end_turn' },
      });
    }).not.toThrow();
    expect(facts.map((fact) => fact.state)).toEqual(['started', 'completed']);
  });
});
