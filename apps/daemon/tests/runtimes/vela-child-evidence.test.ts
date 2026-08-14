import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  VELA_CHILD_EVIDENCE_ADAPTER_VERSION,
  VELA_CHILD_EVIDENCE_CANDIDATE,
  VELA_CHILD_EVIDENCE_EXTENSION,
  VELA_CHILD_EVIDENCE_SCHEMA_VERSION,
  adaptVelaChildRuntimeFactV1,
  createVelaChildEvidenceConsumer,
  negotiateVelaChildEvidence,
  type VelaChildRuntimeFact,
} from '../../src/runtimes/vela-child-evidence.js';

type RecordValue = Record<string, unknown>;

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'vela-opencode-child-evidence-wire-v1.golden.json',
);

function fixture(): RecordValue[] {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as RecordValue[];
}

function resultOf(message: RecordValue): RecordValue {
  return message.result as RecordValue;
}

function updateOf(message: RecordValue): RecordValue {
  return ((message.params as RecordValue).update) as RecordValue;
}

function newConsumer(facts: VelaChildRuntimeFact[] = []) {
  const consumer = createVelaChildEvidenceConsumer({
    onFact: (fact) => facts.push(fact),
    now: () => 9_999,
  });
  consumer.negotiate(resultOf(fixture()[0]!));
  return consumer;
}

function observe(
  consumer: ReturnType<typeof createVelaChildEvidenceConsumer>,
  update: unknown,
  envelopeAcpSessionId: unknown = 'acp-session',
) {
  return consumer.observe({
    expectedAcpSessionId: 'acp-session',
    envelopeAcpSessionId,
    update,
  });
}

function coherentTerminal(
  overrides: Record<string, unknown> = {},
): RecordValue {
  return {
    ...updateOf(fixture()[2]!),
    evidenceId: 'evidence-terminal',
    ...overrides,
  };
}

describe('Vela OpenCode child evidence adapter', () => {
  it('pins only the approved unpublished candidate and negotiates exact schema v1', () => {
    expect(VELA_CHILD_EVIDENCE_CANDIDATE).toEqual({
      repository: 'PowerformerAI/vela',
      commit: '1d52465dd24878ef430ebba56fb63a4327a48554',
      fixture: 'apps/cli/internal/agent/testdata/opencode_child_evidence_wire_v1.golden.json',
      published: false,
      verifiedRuntimeSupport: false,
    });
    expect(negotiateVelaChildEvidence(resultOf(fixture()[0]!))).toMatchObject({
      advertised: true,
      supported: true,
      schemaVersion: VELA_CHILD_EVIDENCE_SCHEMA_VERSION,
      producerName: 'Vela OpenCode',
      producerVersion: '0.0.0',
      reason: 'supported_candidate',
      candidatePublished: false,
      candidateCommit: VELA_CHILD_EVIDENCE_CANDIDATE.commit,
    });

    const missing = negotiateVelaChildEvidence({ protocolVersion: 1 });
    expect(missing).toMatchObject({
      advertised: false,
      supported: false,
      reason: 'extension_missing',
    });
    const unknown = negotiateVelaChildEvidence({
      agentCapabilities: {
        extensions: {
          [VELA_CHILD_EVIDENCE_EXTENSION]: { schemaVersion: 2 },
        },
      },
    });
    expect(unknown).toMatchObject({
      advertised: true,
      supported: false,
      schemaVersion: 2,
      reason: 'unsupported_schema_version',
    });
  });

  it('replays paired producer lifecycles and promotes only complete terminals to L2', () => {
    const wire = fixture();
    const facts: VelaChildRuntimeFact[] = [];
    const consumer = newConsumer(facts);

    for (const message of wire.slice(1)) {
      expect(observe(consumer, updateOf(message))).toMatchObject({
        handled: true,
        accepted: true,
      });
    }

    expect(facts).toHaveLength(8);
    expect(facts.map((fact) => fact.state)).toEqual([
      'running',
      'completed',
      'running',
      'failed',
      'running',
      'cancelled',
      'running',
      'timed_out',
    ]);
    expect(facts.every((fact) => (
      fact.adapterVersion === VELA_CHILD_EVIDENCE_ADAPTER_VERSION &&
      fact.schemaVersion === VELA_CHILD_EVIDENCE_SCHEMA_VERSION &&
      fact.l3Eligible === false
    ))).toBe(true);
    expect(facts.map((fact) => fact.evidenceLevel)).toEqual([
      'L1',
      'L2',
      'L1',
      'L2',
      'L1',
      'L2',
      'L1',
      'L1',
    ]);
    expect(facts[1]).toMatchObject({
      rootSessionId: 'root',
      childSessionId: 'child-completed',
      toolCallId: 'task-completed',
      prompt: { bytes: 14 },
      usage: {
        completeness: 'complete',
        source: 'child_step_finish',
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        thoughtTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 1,
      },
    });
    expect(facts[1]?.limitations).toContain(
      'L3 remains unavailable until one closed model-turn accounting group proves ownership and inherited-copy exclusion.',
    );
  });

  it('maps accepted facts to shared Normalized observations without inventing L3 accounting', () => {
    const facts: VelaChildRuntimeFact[] = [];
    const consumer = newConsumer(facts);
    for (const message of fixture().slice(1)) {
      observe(consumer, updateOf(message));
    }

    const normalized = facts.map((fact) => adaptVelaChildRuntimeFactV1({
      fact,
      taskExecutionId: 'task-1',
      runId: 'run-1',
      taskRunIndex: 0,
      taskRunObservationId: 'task-run:run-1:0',
      stage: 'production',
    }));
    expect(normalized[0]).toMatchObject({
      kind: 'child_agent',
      status: 'running',
      usage: { availability: 'unavailable' },
      timing: { availability: 'partial' },
      attributes: { evidenceLevel: 'L1', l3Eligible: false },
    });
    expect(normalized[1]).toMatchObject({
      status: 'completed',
      prompt: { childInjected: { availability: 'partial', source: 'acp', bytes: 14 } },
      usage: {
        availability: 'complete',
        source: 'acp',
        accountingMode: 'additive',
        values: { inputTokens: 11, outputTokens: 7, totalTokens: 18, thoughtTokens: 2 },
        valueSources: { inputTokens: 'acp', outputTokens: 'acp', totalTokens: 'acp' },
      },
      timing: { availability: 'complete' },
    });
    expect(normalized[5]).toMatchObject({
      status: 'canceled',
      usage: { availability: 'partial', source: 'acp' },
    });
    expect(normalized[7]).toMatchObject({
      status: 'failed',
      attributes: { nativeStatus: 'timed_out' },
    });
    expect(normalized.every((observation) => observation.turnAccounting === undefined)).toBe(true);
  });

  it('drops unknown and malicious fields instead of forwarding them', () => {
    const facts: VelaChildRuntimeFact[] = [];
    const consumer = newConsumer(facts);
    expect(observe(consumer, updateOf(fixture()[1]!)).accepted).toBe(true);
    const malicious = {
      ...updateOf(fixture()[2]!),
      secret: 'sk-do-not-forward',
      cwd: '/private/user/workspace',
      sourceEvidence: [
        'root_task_metadata',
        'session.created',
        'child_session_status',
        'attacker.private_log',
      ],
      prompt: {
        ...(updateOf(fixture()[2]!).prompt as RecordValue),
        text: 'private prompt body',
        safePayload: { token: 'secret' },
      },
      usage: {
        ...(updateOf(fixture()[2]!).usage as RecordValue),
        providerResponse: { authorization: 'Bearer secret' },
      },
    };
    expect(observe(consumer, malicious).accepted).toBe(true);
    const serialized = JSON.stringify(facts[1]);
    expect(serialized).not.toContain('sk-do-not-forward');
    expect(serialized).not.toContain('/private/user/workspace');
    expect(serialized).not.toContain('private prompt body');
    expect(serialized).not.toContain('Bearer secret');
    expect(facts[1]?.sourceEvidence).toEqual([
      'root_task_metadata',
      'session.created',
      'child_session_status',
    ]);
    expect(facts[1]?.limitations).toContain('Unknown source-evidence labels were discarded.');
  });

  it('fails closed for old/unknown schema, wrong ACP session, and malformed known fields', () => {
    const old = createVelaChildEvidenceConsumer();
    old.negotiate({ protocolVersion: 1 });
    expect(observe(old, updateOf(fixture()[1]!))).toMatchObject({
      handled: true,
      accepted: false,
      reason: 'capability_not_negotiated',
    });

    const unknown = createVelaChildEvidenceConsumer();
    unknown.negotiate({
      agentCapabilities: {
        extensions: {
          [VELA_CHILD_EVIDENCE_EXTENSION]: { schemaVersion: 2 },
        },
      },
    });
    expect(observe(unknown, { ...updateOf(fixture()[1]!), schemaVersion: 2 })).toMatchObject({
      handled: true,
      accepted: false,
      reason: 'unsupported_schema_version',
    });

    const consumer = newConsumer();
    expect(observe(consumer, updateOf(fixture()[1]!), 'other-acp-session')).toMatchObject({
      accepted: false,
      reason: 'acp_session_mismatch',
    });
    expect(observe(consumer, {
      ...updateOf(fixture()[1]!),
      toolCallId: 'bad\ntool-call',
    })).toMatchObject({
      accepted: false,
      reason: 'invalid_wire_shape',
    });
  });

  it('rejects unrelated roots, cycles, parent/tool conflicts, regressions, and conflicting terminals', () => {
    const unrelated = newConsumer();
    expect(observe(unrelated, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(unrelated, {
      ...updateOf(fixture()[3]!),
      parentSessionId: 'unrelated-root',
    })).toMatchObject({ accepted: false, reason: 'root_session_conflict' });

    const cycle = newConsumer();
    expect(observe(cycle, {
      ...updateOf(fixture()[1]!),
      childSessionId: 'root',
    })).toMatchObject({ accepted: false, reason: 'parent_cycle' });

    const parentConflict = newConsumer();
    expect(observe(parentConflict, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(parentConflict, coherentTerminal({ parentSessionId: 'different-root' })))
      .toMatchObject({ accepted: false, reason: 'parent_conflict' });

    const toolConflict = newConsumer();
    expect(observe(toolConflict, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(toolConflict, coherentTerminal({ toolCallId: 'different-task' })))
      .toMatchObject({ accepted: false, reason: 'tool_call_rebound' });

    const monotonic = newConsumer();
    expect(observe(monotonic, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(monotonic, coherentTerminal()).accepted).toBe(true);
    expect(observe(monotonic, {
      ...updateOf(fixture()[1]!),
      evidenceId: 'late-start',
    })).toMatchObject({ accepted: false, reason: 'status_regression' });
    expect(observe(monotonic, coherentTerminal({
      evidenceId: 'conflicting-terminal',
      status: 'failed',
      sourceEvidence: ['child_session_error', 'root_task_metadata', 'session.created'],
    }))).toMatchObject({ accepted: false, reason: 'terminal_conflict' });

    const evidenceConflict = newConsumer();
    expect(observe(evidenceConflict, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(evidenceConflict, {
      ...updateOf(fixture()[1]!),
      childSessionId: 'other-child',
    })).toMatchObject({ accepted: false, reason: 'evidence_id_conflict' });
  });

  it('rejects terminal-first and incoherent terminal-source combinations', () => {
    const terminalFirstFacts: VelaChildRuntimeFact[] = [];
    const terminalFirst = newConsumer(terminalFirstFacts);
    expect(observe(terminalFirst, updateOf(fixture()[2]!))).toMatchObject({
      accepted: false,
      reason: 'status_regression',
    });
    expect(terminalFirstFacts).toEqual([]);

    const wrongStatusSource = newConsumer();
    expect(observe(wrongStatusSource, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(wrongStatusSource, {
      ...updateOf(fixture()[2]!),
      status: 'failed',
    })).toMatchObject({ accepted: false, reason: 'invalid_wire_shape' });

    const multipleTerminalSources = newConsumer();
    expect(observe(multipleTerminalSources, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(multipleTerminalSources, {
      ...updateOf(fixture()[2]!),
      sourceEvidence: [
        'root_task_metadata',
        'session.created',
        'child_session_status',
        'child_session_error',
      ],
    })).toMatchObject({ accepted: false, reason: 'invalid_wire_shape' });

    const wrongTimeoutCompleteness = newConsumer();
    expect(observe(wrongTimeoutCompleteness, updateOf(fixture()[7]!)).accepted).toBe(true);
    expect(observe(wrongTimeoutCompleteness, {
      ...updateOf(fixture()[8]!),
      lifecycleCompleteness: 'complete',
    })).toMatchObject({ accepted: false, reason: 'invalid_wire_shape' });

    const hostIncompleteWithUsage = newConsumer();
    expect(observe(hostIncompleteWithUsage, updateOf(fixture()[7]!)).accepted).toBe(true);
    expect(observe(hostIncompleteWithUsage, {
      ...updateOf(fixture()[8]!),
      usage: updateOf(fixture()[2]!).usage,
    })).toMatchObject({ accepted: false, reason: 'invalid_wire_shape' });
  });

  it('accepts each status-coherent producer terminal source', () => {
    const cases = [
      {
        status: 'completed',
        source: 'root_task_tool',
        lifecycleCompleteness: 'complete',
        evidenceLevel: 'L2',
      },
      {
        status: 'failed',
        source: 'child_session_error',
        lifecycleCompleteness: 'complete',
        evidenceLevel: 'L2',
      },
      {
        status: 'timed_out',
        source: 'child_session_error',
        lifecycleCompleteness: 'complete',
        evidenceLevel: 'L2',
      },
      {
        status: 'cancelled',
        source: 'parent_prompt_cancelled',
        lifecycleCompleteness: 'partial',
        evidenceLevel: 'L1',
      },
    ] as const;
    for (const testCase of cases) {
      const consumer = newConsumer();
      expect(observe(consumer, updateOf(fixture()[1]!)).accepted).toBe(true);
      expect(observe(consumer, coherentTerminal({
        evidenceId: `evidence-${testCase.status}-${testCase.source}`,
        status: testCase.status,
        lifecycleCompleteness: testCase.lifecycleCompleteness,
        sourceEvidence: [
          testCase.source,
          'root_task_metadata',
          'session.created',
        ],
        ...(testCase.source === 'parent_prompt_cancelled'
          ? { usage: { availability: 'unavailable', completeness: 'unavailable' } }
          : {}),
      }))).toMatchObject({
        accepted: true,
        fact: {
          state: testCase.status,
          lifecycleCompleteness: testCase.lifecycleCompleteness,
          evidenceLevel: testCase.evidenceLevel,
        },
      });
    }

    const exportFallback = newConsumer();
    expect(observe(exportFallback, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(exportFallback, coherentTerminal({
      evidenceId: 'evidence-export-step-finish',
      sourceEvidence: [
        'child_session_status',
        'opencode_export_step_finish',
        'root_task_metadata',
        'session.created',
      ],
      usage: {
        ...(updateOf(fixture()[2]!).usage as RecordValue),
        source: 'opencode_export_step_finish',
      },
    }))).toMatchObject({
      accepted: true,
      fact: { usage: { source: 'opencode_export_step_finish' } },
    });
  });

  it.each([
    ['child_step_finish', 'partial'],
    ['opencode_export_step_finish', 'partial'],
    ['opencode_export_message_snapshot', 'complete'],
  ] as const)('rejects impossible %s usage with %s completeness', (source, completeness) => {
    const consumer = newConsumer();
    expect(observe(consumer, updateOf(fixture()[1]!)).accepted).toBe(true);
    const terminal = coherentTerminal({
      evidenceId: `usage-mismatch-${source}-${completeness}`,
      sourceEvidence: [
        'child_session_status',
        'root_task_metadata',
        'session.created',
        ...(source.startsWith('opencode_export_') ? [source] : []),
      ],
      usage: {
        ...(updateOf(fixture()[2]!).usage as RecordValue),
        source,
        completeness,
      },
    });

    expect(observe(consumer, terminal)).toMatchObject({
      accepted: false,
      reason: 'invalid_wire_shape',
    });
  });

  it.each([
    { completeness: 'complete' },
    { completeness: 'unavailable', source: 'child_step_finish' },
    { completeness: 'unavailable', totalTokens: 18 },
  ])('rejects unavailable usage that carries impossible known evidence %o', (usage) => {
    const consumer = newConsumer();
    expect(observe(consumer, updateOf(fixture()[1]!)).accepted).toBe(true);
    expect(observe(consumer, coherentTerminal({
      evidenceId: `unavailable-usage-mismatch-${JSON.stringify(usage)}`,
      usage: { availability: 'unavailable', ...usage },
    }))).toMatchObject({
      accepted: false,
      reason: 'invalid_wire_shape',
    });
  });
});
