import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { strategyPackageHashFromDigests } from '@open-design/plugin-runtime';
import type { OpenDesignPlanContractV2 } from '@open-design/contracts';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, openDatabase } from '../../src/db.js';
import { createSnapshot } from '../../src/plugins/snapshots.js';
import {
  createTaskObservationRolloutService,
  readTaskObservationRolloutConfig,
} from '../../src/observability/task-observation-rollout.js';
import { runTelemetryDeliveryIdempotencyKey } from '../../src/observability/delivery-state.js';
import { reconcileDurableRunTerminals } from '../../src/runtimes/run-terminal-reconciliation.js';
import {
  compareAndTransitionStrategyTaskExecution,
  createStrategyTaskExecution,
  getStrategyTaskExecution,
  migrateStrategyTaskStore,
} from '../../src/strategies/task-store.js';

const BASE_ENV = {
  OPEN_DESIGN_VELA_TELEMETRY: 'off',
  OD_NEXT_TASK_OBSERVABILITY_ENVIRONMENT: 'synthetic-test',
  OD_NEXT_TASK_OBSERVABILITY_TAG: 'task22-canary',
  LANGFUSE_PUBLIC_KEY: 'pk_fixture',
  LANGFUSE_SECRET_KEY: 'sk_fixture',
  LANGFUSE_BASE_URL: 'https://langfuse.example.test',
};

function strategyBinding() {
  const assetDigests = [
    { path: './SKILL.md', sha256: 'a'.repeat(64) },
    { path: './assets/task-profiles/prototype.md', sha256: 'b'.repeat(64) },
  ];
  return {
    schema: 'open-design.applied-strategy/v2' as const,
    id: 'od-next-strategy' as const,
    version: '2.0.0',
    packageHash: strategyPackageHashFromDigests(assetDigests),
    assetDigests,
    selectedTaskProfile: {
      taskType: 'prototype' as const,
      version: '2.0.0',
      path: './assets/task-profiles/prototype.md',
      sha256: 'b'.repeat(64),
    },
    taskProfileVersions: ['2.0.0'],
    promptRecipe: 'od-next-plan-build-v2' as const,
  };
}

function planContractFixture(snapshotId: string): OpenDesignPlanContractV2 {
  const strategy = strategyBinding();
  return {
    schema: 'open-design.plan-contract/v2',
    strategy: {
      id: strategy.id,
      version: strategy.version,
      packageHash: strategy.packageHash,
      snapshotId,
    },
    taskProfile: {
      schemaVersion: '2',
      taskType: 'prototype',
      taskProfileVersion: strategy.selectedTaskProfile.version,
      goal: 'Build a synthetic prototype',
      contextAndAudience: 'Synthetic test',
      inputsAndReferences: [],
      constraints: [],
      canonicalDeliverable: { id: 'prototype', kind: 'prototype', format: 'html' },
      requiredDeliverables: [{ id: 'prototype', kind: 'prototype' }],
      designSpec: {
        source: 'resolved-baseline',
        version: '1',
        decisions: { palette: 'neutral' },
      },
      buildRequirements: [{ id: 'build-1', text: 'Build the synthetic prototype.' }],
      assumptions: [],
      risks: [],
      taskSpecific: {},
    },
    fullPlan: {
      executionMode: 'simple',
      steps: [{ id: 'step-1', objective: 'Build', outputs: ['prototype'] }],
      readinessArtifacts: [],
      buildPackages: [],
    },
    runManifest: {
      selectedAgentId: 'codex',
      capabilitySnapshotHash: 'c'.repeat(64),
      inputRefs: [],
      productionRoutes: ['html'],
      preflight: { intake: 'passed', execution: 'passed' },
    },
    decisionSummary: {
      goal: 'Build a synthetic prototype',
      deliverables: ['prototype'],
      keyConstraints: [],
      assumptions: [],
      risks: [],
      openDecisions: [],
    },
  };
}

function seedCompletedTask(db: Database.Database): void {
  db.prepare(
    `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run('project-1', 'Synthetic project', 1, 1);
  db.prepare(
    `INSERT INTO conversations (id, project_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('conversation-1', 'project-1', 'Synthetic conversation', 1, 1);
  const snapshot = createSnapshot(db, {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    runId: null,
    pluginId: 'od-next-strategy',
    pluginVersion: '2.0.0',
    manifestSourceDigest: 'manifest-digest',
    strategy: strategyBinding(),
    taskKind: 'new-generation',
    inputs: {},
    resolvedContext: { items: [] },
    capabilitiesGranted: ['prompt:inject'],
    capabilitiesRequired: ['prompt:inject'],
    assetsStaged: [],
    connectorsRequired: [],
    connectorsResolved: [],
    mcpServers: [],
  });
  createStrategyTaskExecution(db, {
    taskExecutionId: 'task-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    snapshotId: snapshot.snapshotId,
    selectedAgentId: 'codex',
    initialRunId: 'run-1',
    createdAt: 1_000,
  });
  db.prepare(
    `UPDATE strategy_task_executions
        SET revision = 1, route = 'direct_edit', outcome = 'completed',
            execution_mode = 'simple', updated_at = 2_000
      WHERE task_execution_id = 'task-1'`,
  ).run();
}

function syntheticRun() {
  return {
    id: 'run-1',
    status: 'succeeded',
    createdAt: 1_000,
    updatedAt: 2_000,
    model: 'fixture-model',
    events: [
      {
        event: 'agent',
        timestamp: 1_200,
        data: {
          type: 'usage',
          usage: { input_tokens: 21, output_tokens: 8 },
          model: 'fixture-model',
        },
      },
    ],
  };
}

function acceptedResponse(): Response {
  return new Response(JSON.stringify({ successes: [{ id: 'ok' }], errors: [] }), {
    status: 207,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface DeliveryFixtureRow {
  mode: string;
  status: string;
  aggregateDigest: string | null;
  observationCount: number;
  coverageJson: string | null;
  idempotencyKey: string | null;
  attemptCount: number;
  crashWindow: number;
  dropReason: string | null;
  finalizedAt: number | null;
}

describe('task observation rollout', () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-task-observability-'));
    db = openDatabase(tempDir, { dataDir: tempDir });
    migrateStrategyTaskStore(db);
    seedCompletedTask(db);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function service(input: {
    mode: 'off' | 'observe' | 'send';
    prefs?: { metrics: boolean; content: boolean; artifactManifest: boolean };
    env?: Record<string, string>;
    fetchImpl?: typeof fetch;
    configuredEnv?: Record<string, string>;
    getRun?: (runId: string) => ReturnType<typeof syntheticRun> | null;
  }) {
    return createTaskObservationRolloutService({
      db,
      getRun: input.getRun ?? ((runId) => runId === 'run-1' ? syntheticRun() : null),
      readTelemetry: async () => ({
        prefs: input.prefs ?? { metrics: true, content: true, artifactManifest: false },
        installationId: 'installation-fixture',
      }),
      env: {
        ...BASE_ENV,
        OD_NEXT_TASK_OBSERVABILITY_MODE: input.mode,
        ...(input.env ?? {}),
      },
      configuredEnv: () => input.configuredEnv ?? {},
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  }

  function deliveryRow(): DeliveryFixtureRow {
    return db.prepare(`
      SELECT mode,
             status,
             aggregate_digest AS aggregateDigest,
             observation_count AS observationCount,
             coverage_json AS coverageJson,
             idempotency_key AS idempotencyKey,
             attempt_count AS attemptCount,
             crash_window AS crashWindow,
             drop_reason AS dropReason,
             finalized_at AS finalizedAt
        FROM strategy_task_observation_delivery
       WHERE task_execution_id = 'task-1'
    `).get() as DeliveryFixtureRow;
  }

  it('defaults invalid rollout values to off and requires safe environment/tag values', () => {
    expect(readTaskObservationRolloutConfig({
      OD_NEXT_TASK_OBSERVABILITY_MODE: 'active',
      OD_NEXT_TASK_OBSERVABILITY_ENVIRONMENT: 'prod secret',
      OD_NEXT_TASK_OBSERVABILITY_TAG: 'canary',
    })).toEqual({ mode: 'off', context: null });
    expect(readTaskObservationRolloutConfig({
      OD_NEXT_TASK_OBSERVABILITY_MODE: 'send',
      OD_NEXT_TASK_OBSERVABILITY_ENVIRONMENT: 'staging-cn',
      OD_NEXT_TASK_OBSERVABILITY_TAG: 'bucket.01',
    })).toEqual({
      mode: 'send',
      context: { environment: 'staging-cn', tag: 'bucket.01' },
    });
  });

  it('keeps off compatible and observe local while persisting only synthetic summary facts', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await service({ mode: 'off', fetchImpl }).finalizeForRun('run-1')).toEqual({
      mode: 'off',
      action: 'compatibility',
    });

    const observe = service({ mode: 'observe', fetchImpl });
    await expect(observe.finalizeForRun('run-1')).resolves.toMatchObject({
      mode: 'observe',
      action: 'observed',
      taskExecutionId: 'task-1',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const stored = deliveryRow();
    expect(stored).toMatchObject({
      mode: 'observe',
      status: 'observed',
      observationCount: 1,
      attemptCount: 0,
      crashWindow: 0,
    });
    expect(stored.aggregateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.coverageJson).toContain('"availability":"unavailable"');
    const persisted = JSON.stringify(stored);
    expect(persisted).not.toContain('pk_fixture');
    expect(persisted).not.toContain('sk_fixture');
    expect(persisted).not.toContain('fixture-model');
  });

  it('keeps an observed row terminal when rollout later advances to send', async () => {
    await service({ mode: 'observe' }).finalizeForRun('run-1');
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const send = service({ mode: 'send', fetchImpl });
    expect(send.config.mode).toBe('send');
    expect(send.modeForRun('run-1')).toBe('observe');
    const handle = send.beginFinalizeForRun('run-1');

    expect(handle).toMatchObject({
      durableTaskTruth: true,
      suppressSingleRun: false,
    });
    await expect(handle.completion).resolves.toMatchObject({
      action: 'already_finalized',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deliveryRow()).toMatchObject({
      mode: 'observe',
      status: 'observed',
      attemptCount: 0,
      crashWindow: 0,
    });
  });

  it('sends one task root with environment tags and never resends a finalized task', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const rollout = service({ mode: 'send', fetchImpl });

    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'sent',
      delivery: { status: 'accepted', attemptCount: 1, crashWindow: false },
    });
    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'already_finalized',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0]![1]!;
    const batch = JSON.parse(String(request.body)).batch as Array<{
      type: string;
      body: Record<string, unknown>;
    }>;
    expect(batch.filter((event) => event.type === 'trace-create')).toHaveLength(1);
    expect(batch[0]!.body).toMatchObject({
      id: 'strategy-task:task-1',
      environment: 'synthetic-test',
      tags: [
        'od-next-v2',
        'environment:synthetic-test',
        'rollout:task22-canary',
      ],
    });
    expect(batch.filter((event) => event.type === 'span-create')).toHaveLength(1);
  });

  it('exports one root with the durable request/clarification/repair/production run chain', async () => {
    db.prepare(`
      UPDATE strategy_task_executions
         SET revision = 0, route = NULL, input_stage = 'request', outcome = 'running',
             execution_mode = NULL, plan_contract_json = NULL, plan_contract_hash = NULL,
             clarification_count = 0, plan_contract_repair_attempts = 0,
             latest_run_id = 'run-1', updated_at = 1000
       WHERE task_execution_id = 'task-1'
    `).run();
    let task = getStrategyTaskExecution(db, 'task-1')!;
    task = compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: task.taskExecutionId,
      expectedRevision: task.revision,
      to: {
        route: 'full_plan',
        inputStage: 'clarification',
        outcome: 'running',
        executionMode: null,
      },
      nextRun: { runId: 'run-clarification', sourceRunId: 'run-1' },
      updatedAt: 1_100,
    });
    task = compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: task.taskExecutionId,
      expectedRevision: task.revision,
      to: {
        route: 'full_plan',
        inputStage: 'clarification',
        outcome: 'running',
        executionMode: 'simple',
      },
      updatedAt: 1_150,
    });
    task = compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: task.taskExecutionId,
      expectedRevision: task.revision,
      to: {
        route: 'full_plan',
        inputStage: 'contract_repair',
        outcome: 'running',
        executionMode: 'simple',
      },
      nextRun: { runId: 'run-repair', sourceRunId: 'run-clarification' },
      updatedAt: 1_200,
    });
    task = compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: task.taskExecutionId,
      expectedRevision: task.revision,
      to: {
        route: 'full_plan',
        inputStage: 'production',
        outcome: 'running',
        executionMode: 'simple',
      },
      nextRun: { runId: 'run-production', sourceRunId: 'run-repair' },
      planContract: planContractFixture(task.snapshotId),
      updatedAt: 1_300,
    });
    compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: task.taskExecutionId,
      expectedRevision: task.revision,
      to: {
        route: 'full_plan',
        inputStage: 'production',
        outcome: 'completed',
        executionMode: 'simple',
      },
      updatedAt: 2_000,
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const rollout = service({
      mode: 'send',
      fetchImpl,
      getRun: (runId) => ({
        ...syntheticRun(),
        id: runId,
        createdAt: 1_000 + ['run-1', 'run-clarification', 'run-repair', 'run-production']
          .indexOf(runId) * 100,
      }),
    });

    await expect(rollout.finalizeForRun('run-production')).resolves.toMatchObject({
      action: 'sent',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const batch = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).batch as Array<{
      type: string;
      body: { name?: string };
    }>;
    expect(batch.filter((event) => event.type === 'trace-create')).toHaveLength(1);
    expect(batch.filter((event) => event.type === 'span-create').map((event) => event.body.name))
      .toEqual([
        'strategy-stage:request',
        'strategy-stage:clarification',
        'strategy-stage:contract_repair',
        'strategy-stage:production',
      ]);
    expect(JSON.parse(deliveryRow().coverageJson!)).toMatchObject({
      runs: { availability: 'complete', observed: 4, expected: 4, missingRunIds: [] },
      children: { availability: 'unavailable', knownObservationCount: 0 },
    });
  });

  it.each([
    { metrics: false, content: true, reason: 'metrics_consent_off' },
    { metrics: true, content: false, reason: 'content_consent_off' },
  ])('makes zero requests when consent is disabled: $reason', async (prefs) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const rollout = service({
      mode: 'send',
      fetchImpl,
      prefs: { ...prefs, artifactManifest: false },
    });
    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'not_expected',
      delivery: {
        status: 'not_expected',
        attemptCount: 0,
        dropReason: prefs.reason,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps normal failures at first attempt plus one retry and never replays finalized failed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('down', { status: 503 }));
    const rollout = service({
      mode: 'send',
      fetchImpl,
      env: { LANGFUSE_RETRIES: '9' },
    });
    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'failed',
      delivery: {
        status: 'failed',
        attemptCount: 2,
        dropReason: 'langfuse_5xx',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const restartedFetch = vi.fn<typeof fetch>();
    const restarted = service({ mode: 'send', fetchImpl: restartedFetch });
    await expect(restarted.reconcileCrashWindows()).resolves.toBe(0);
    expect(restartedFetch).not.toHaveBeenCalled();
  });

  it('atomically claims one concurrent terminal report and sends exactly once', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const rollout = service({ mode: 'send', fetchImpl });

    const results = await Promise.all([
      rollout.finalizeForRun('run-1'),
      rollout.finalizeForRun('run-1'),
    ]);

    expect(results.map((result) => result.action).sort()).toEqual([
      'already_in_flight',
      'sent',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deliveryRow()).toMatchObject({
      status: 'accepted',
      attemptCount: 1,
      crashWindow: 0,
    });
  });

  it('establishes durable task truth before an online network completion', async () => {
    let acceptRequest: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      acceptRequest = resolve;
    }));
    const rollout = service({ mode: 'send', fetchImpl });

    const handle = rollout.beginFinalizeForRun('run-1');
    expect(handle.durableTaskTruth).toBe(true);
    expect(deliveryRow()).toMatchObject({
      status: 'in_flight',
      crashWindow: 1,
      attemptCount: 0,
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(deliveryRow()).toMatchObject({
      status: 'in_flight',
      crashWindow: 1,
      attemptCount: 1,
    });
    acceptRequest!(acceptedResponse());
    await expect(handle.completion).resolves.toMatchObject({ action: 'sent' });
    expect(deliveryRow()).toMatchObject({ status: 'accepted', crashWindow: 0 });
  });

  it('terminalizes unexpected aggregate failures and never replays them after restart', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const rollout = service({
      mode: 'send',
      fetchImpl,
      getRun: () => {
        throw new Error('synthetic aggregate read failure');
      },
    });

    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'failed',
      delivery: {
        status: 'failed',
        attemptCount: 0,
        crashWindow: false,
        dropReason: 'payload_build_error',
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deliveryRow()).toMatchObject({
      status: 'failed',
      attemptCount: 0,
      crashWindow: 0,
      dropReason: 'payload_build_error',
    });

    const restartedFetch = vi.fn<typeof fetch>();
    await expect(service({ mode: 'send', fetchImpl: restartedFetch }).reconcileCrashWindows())
      .resolves.toBe(0);
    expect(restartedFetch).not.toHaveBeenCalled();
  });

  it('recovers only a persisted in-flight crash window with the same idempotency identity', async () => {
    const first = service({ mode: 'send' });
    const idempotencyKey = runTelemetryDeliveryIdempotencyKey('strategy-task:task-1');
    db.prepare(`
      INSERT INTO strategy_task_observation_delivery (
        task_execution_id, mode, environment, tag,
        aggregate_digest, observation_count, coverage_json,
        status, idempotency_key, attempt_count, crash_window,
        started_at, drop_reason, finalized_at, updated_at
      ) VALUES (
        'task-1', 'send', 'synthetic-test', 'task22-canary',
        NULL, 0, NULL, 'in_flight', ?, 0, 1, 3000, NULL, NULL, 3000
      )
    `).run(idempotencyKey);
    expect(first.diagnostic().readyToSend).toBe(true);

    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const restarted = service({
      mode: 'send',
      fetchImpl,
      env: {
        OD_NEXT_TASK_OBSERVABILITY_ENVIRONMENT: 'changed-environment',
        OD_NEXT_TASK_OBSERVABILITY_TAG: 'changed-tag',
      },
    });
    await expect(restarted.reconcileCrashWindows()).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deliveryRow()).toMatchObject({
      status: 'accepted',
      idempotencyKey,
      crashWindow: 0,
    });
    const body = String(fetchImpl.mock.calls[0]![1]!.body);
    expect(body).toContain('synthetic-test');
    expect(body).toContain('task22-canary');
    expect(body).not.toContain('changed-environment');
    expect(body).not.toContain('changed-tag');
  });

  it('claims a task trace after startup terminalizes a mapped run with no prior task row', async () => {
    db.prepare(`
      UPDATE strategy_task_executions
         SET outcome = 'running', updated_at = 2000
       WHERE task_execution_id = 'task-1'
    `).run();
    const runsLogDir = path.join(tempDir, 'runs');
    const runDir = path.join(runsLogDir, 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'run-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      assistantMessageId: null,
      agentId: 'codex',
      status: 'running',
      createdAt: 1_000,
      updatedAt: 2_000,
    }));
    const taskFetch = vi.fn<typeof fetch>(async () => acceptedResponse());
    const rollout = service({
      mode: 'send',
      fetchImpl: taskFetch,
      getRun: () => ({ ...syntheticRun(), status: 'failed' }),
    });
    const legacySingleRunReport = vi.fn();
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM strategy_task_observation_delivery`,
    ).get()).toEqual({ count: 0 });

    const durable = await reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: 'fixture',
      db,
      reportLangfuse: legacySingleRunReport,
      taskObservationModeForRun: (runId) => rollout.modeForRun(runId),
      beginTaskObservationForRun: (runId) => rollout.beginFinalizeForRun(runId),
      runsLogDir,
    });
    expect(durable).toMatchObject({
      interrupted: 1,
      strategyTasksReconciled: 1,
      langfuseReplayed: 1,
    });
    expect(legacySingleRunReport).not.toHaveBeenCalled();
    expect(taskFetch).toHaveBeenCalledTimes(1);
    expect(deliveryRow()).toMatchObject({ status: 'accepted', crashWindow: 0 });

    const second = await reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: 'fixture',
      db,
      reportLangfuse: legacySingleRunReport,
      taskObservationModeForRun: (runId) => rollout.modeForRun(runId),
      beginTaskObservationForRun: (runId) => rollout.beginFinalizeForRun(runId),
      runsLogDir,
    });
    expect(second.langfuseReplayed).toBe(0);
    await rollout.reconcileCrashWindows();
    expect(taskFetch).toHaveBeenCalledTimes(1);
    expect(legacySingleRunReport).not.toHaveBeenCalled();
  });

  it('records startup-terminalized tasks in observe mode while preserving legacy delivery', async () => {
    db.prepare(`
      UPDATE strategy_task_executions
         SET outcome = 'running', updated_at = 2000
       WHERE task_execution_id = 'task-1'
    `).run();
    const runsLogDir = path.join(tempDir, 'runs-observe');
    const runDir = path.join(runsLogDir, 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'run-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      assistantMessageId: null,
      agentId: 'codex',
      status: 'running',
      createdAt: 1_000,
      updatedAt: 2_000,
    }));
    const taskFetch = vi.fn<typeof fetch>();
    const rollout = service({
      mode: 'observe',
      fetchImpl: taskFetch,
      getRun: () => ({ ...syntheticRun(), status: 'failed' }),
    });
    const legacySingleRunReport = vi.fn(async () => ({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted' as const,
    }));

    await expect(reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: 'fixture',
      db,
      reportLangfuse: legacySingleRunReport,
      taskObservationModeForRun: (runId) => rollout.modeForRun(runId),
      beginTaskObservationForRun: (runId) => rollout.beginFinalizeForRun(runId),
      runsLogDir,
    })).resolves.toMatchObject({
      interrupted: 1,
      strategyTasksReconciled: 1,
      langfuseReplayed: 1,
    });

    expect(legacySingleRunReport).toHaveBeenCalledOnce();
    expect(taskFetch).not.toHaveBeenCalled();
    expect(deliveryRow()).toMatchObject({
      mode: 'observe',
      status: 'observed',
      attemptCount: 0,
      crashWindow: 0,
    });
  });

  it('replays legacy once when an observed task restarts in send mode with single-run in flight', async () => {
    await service({ mode: 'observe' }).finalizeForRun('run-1');
    const runsLogDir = path.join(tempDir, 'runs-observed-upgrade');
    const runDir = path.join(runsLogDir, 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'run-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      assistantMessageId: null,
      agentId: 'codex',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      telemetryDelivery: {
        version: 1,
        idempotencyKey: 'od-run-telemetry-v1-observed-upgrade',
        status: 'in_flight',
        attemptCount: 1,
        crashWindow: true,
        startedAt: 1_900,
      },
    }));
    const taskFetch = vi.fn<typeof fetch>();
    const rollout = service({ mode: 'send', fetchImpl: taskFetch });
    const legacySingleRunReport = vi.fn(async () => ({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted' as const,
    }));

    await expect(reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: 'fixture',
      db,
      reportLangfuse: legacySingleRunReport,
      taskObservationModeForRun: (runId) => rollout.modeForRun(runId),
      beginTaskObservationForRun: (runId) => rollout.beginFinalizeForRun(runId),
      runsLogDir,
    })).resolves.toMatchObject({ langfuseReplayed: 1 });

    expect(legacySingleRunReport).toHaveBeenCalledOnce();
    expect(taskFetch).not.toHaveBeenCalled();
    expect(deliveryRow()).toMatchObject({
      mode: 'observe',
      status: 'observed',
      attemptCount: 0,
      crashWindow: 0,
    });
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
      .toMatchObject({
        telemetryDelivery: {
          status: 'accepted',
          crashWindow: false,
          finalizedAt: expect.any(Number),
        },
      });

    await expect(reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: 'fixture',
      db,
      reportLangfuse: legacySingleRunReport,
      taskObservationModeForRun: (runId) => rollout.modeForRun(runId),
      beginTaskObservationForRun: (runId) => rollout.beginFinalizeForRun(runId),
      runsLogDir,
    })).resolves.toMatchObject({ langfuseReplayed: 0 });
    expect(legacySingleRunReport).toHaveBeenCalledOnce();
    expect(taskFetch).not.toHaveBeenCalled();
  });

  it.each([
    { exporterMode: 'dual', path: '/api/public/ingestion' },
    { exporterMode: 'otlp', path: '/api/public/otel/v1/traces' },
  ])('uses one network protocol in $exporterMode mode', async ({ exporterMode, path: expectedPath }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => acceptedResponse());
    const rollout = service({
      mode: 'send',
      fetchImpl,
      env: { LANGFUSE_EXPORTER_MODE: exporterMode },
    });

    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({ action: 'sent' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).pathname).toBe(expectedPath);
    const body = String(fetchImpl.mock.calls[0]![1]!.body);
    expect(body).toContain('synthetic-test');
    expect(body).toContain('task22-canary');
    if (exporterMode === 'otlp') {
      expect(body).toContain('deployment.environment.name');
      expect(body).toContain('langfuse.trace.metadata.rollout_tag');
    }
  });

  it('uses the effective Vela sink without exposing credentials in diagnostics', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 202 }));
    const rollout = service({
      mode: 'send',
      fetchImpl,
      env: {
        OPEN_DESIGN_VELA_TELEMETRY: 'on',
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://relay.example.test/private?key=secret',
      },
      configuredEnv: {
        VELA_CONTROL_KEY: 'control-secret',
        VELA_API_URL: 'https://vela.example.test',
      },
    });
    expect(rollout.diagnostic()).toMatchObject({
      effectiveSink: { kind: 'vela', host: 'vela.example.test', protocol: 'https' },
      taskProtocol: 'legacy-v1',
      readyToSend: true,
    });
    const diagnostic = JSON.stringify(rollout.diagnostic());
    expect(diagnostic).not.toContain('control-secret');
    expect(diagnostic).not.toContain('password');
    expect(diagnostic).not.toContain('/private');

    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({ action: 'sent' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'https://vela.example.test/api/v1/open-design/telemetry',
    );
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>).Authorization)
      .toBe('Bearer control-secret');
  });

  it('shares one initial plus one retry budget across Vela auth fallback', async () => {
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      const status = requestCount === 1 ? 401 : 503;
      return new Response('', { status });
    });
    const rollout = service({
      mode: 'send',
      fetchImpl,
      env: {
        OPEN_DESIGN_VELA_TELEMETRY: 'on',
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://relay.example.test/ingest',
        OPEN_DESIGN_TELEMETRY_RETRIES: '9',
      },
      configuredEnv: {
        VELA_CONTROL_KEY: 'control-secret',
        VELA_API_URL: 'https://vela.example.test',
      },
    });

    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'failed',
      delivery: {
        status: 'failed',
        attemptCount: 2,
        crashWindow: false,
        dropReason: 'relay_5xx',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('vela.example.test');
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      'https://relay.example.test/ingest',
    );

    const restarted = service({
      mode: 'send',
      fetchImpl,
      env: {
        OPEN_DESIGN_VELA_TELEMETRY: 'on',
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://relay.example.test/ingest',
      },
      configuredEnv: {
        VELA_CONTROL_KEY: 'control-secret',
        VELA_API_URL: 'https://vela.example.test',
      },
    });
    await expect(restarted.reconcileCrashWindows()).resolves.toBe(0);
    await expect(restarted.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'already_finalized',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses the effective relay sink with the same durable task idempotency key', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 202 }));
    const rollout = service({
      mode: 'send',
      fetchImpl,
      env: {
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://relay.example.test/ingest',
      },
    });

    expect(rollout.diagnostic()).toMatchObject({
      effectiveSink: { kind: 'relay', host: 'relay.example.test', protocol: 'https' },
      taskProtocol: 'legacy-v1',
      readyToSend: true,
    });
    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({ action: 'sent' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://relay.example.test/ingest');
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(
      runTelemetryDeliveryIdempotencyKey('strategy-task:task-1'),
    );
  });

  it('blocks send locally when environment/tag are missing without touching the sink', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const rollout = service({
      mode: 'send',
      fetchImpl,
      env: {
        OD_NEXT_TASK_OBSERVABILITY_ENVIRONMENT: '',
        OD_NEXT_TASK_OBSERVABILITY_TAG: '',
      },
    });
    expect(rollout.diagnostic()).toMatchObject({
      readyToSend: false,
      blockedReason: 'missing_environment_or_tag',
    });
    await expect(rollout.finalizeForRun('run-1')).resolves.toMatchObject({
      action: 'not_expected',
      delivery: { dropReason: 'task_rollout_context_missing', attemptCount: 0 },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
