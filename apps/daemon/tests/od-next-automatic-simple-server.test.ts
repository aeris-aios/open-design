import type { Server } from 'node:http';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AppliedStrategyBindingV2,
  OdNextRuntimeCapabilitySnapshotV1,
  OpenDesignPlanContractV2,
} from '@open-design/contracts';
import {
  normalizeAgentObservationV1,
  OD_NEXT_PROMPT_STAGE_CONTRACT_V2,
} from '@open-design/contracts';

const uuidControl = vi.hoisted(() => ({ forced: [] as string[] }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: () => uuidControl.forced.shift() ?? actual.randomUUID(),
  };
});

import { closeDatabase, openDatabase } from '../src/db.js';
import { createSnapshot, linkSnapshotToProject } from '../src/plugins/snapshots.js';
import { resolvePluginFolder, upsertInstalledPlugin } from '../src/plugins/registry.js';
import { createBundledStrategyBindingV2 } from '../src/plugins/strategy-package.js';
import { startServer, type StartServerOptions } from '../src/server.js';
import {
  createStrategyTaskExecution,
  getStrategyTaskExecution,
} from '../src/strategies/task-store.js';
import { prepareStrategyRequest } from '../src/strategies/od-next/coordinator.js';
import {
  clearOdNextRolloutStop,
  latchOdNextRolloutStop,
} from '../src/strategies/od-next/rollout.js';
import { hashOdNextRuntimeCapabilitySnapshotV1 } from '../src/runtimes/od-next-capability-gate.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  status: string;
  updatedAt: number;
  error?: string | null;
  errorCode?: string | null;
  strategyTask?: {
    taskExecutionId: string;
    inputStage: string;
    outcome: string;
    terminal: boolean;
  };
};

type Invocation = {
  argv: string[];
  stdin: string;
  cwd: string;
  startedAt: number;
};

const THREAD_ID = '019fffaa-0000-7000-8000-000000000010';
const execFileP = promisify(execFile);
const DAEMON_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(DAEMON_ROOT, '../..');
const CLI_SRC = path.resolve(DAEMON_ROOT, 'src/cli.ts');
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const EXECUTION_PREFLIGHT = {
  productionRoutes: [{ id: 'html', available: true }],
  dependencies: [],
  inputs: [{ id: 'request', available: true }],
  renderers: [],
  exporters: [],
  templates: [],
  outputKinds: [{ id: 'prototype', supported: true }],
};
const DIRECT_ELIGIBLE = {
  editableBaselineExists: true,
  localAndUnambiguous: true,
  canonicalDeliverableStable: true,
  deliverableSetStable: true,
  dependenciesBounded: true,
};
const INTAKE_PASSED = {
  inputRefs: [{ id: 'request', accessible: true }],
  selectedAgentAvailable: true,
  nativeContinuation: 'verified' as const,
  taskProfileAvailable: true,
  dependencies: [],
};

function complexCapabilitySnapshot(): OdNextRuntimeCapabilitySnapshotV1 {
  const withoutHash: Omit<OdNextRuntimeCapabilitySnapshotV1, 'snapshotHash'> = {
    schema: 'open-design.od-next-runtime-capability-snapshot/v1',
    runtimePath: 'codex',
    agentId: 'codex',
    agentCliVersion: 'synthetic-cli-simulating-fixture/1',
    runtimeAdapterVersion: 'synthetic-adapter/1',
    fixtureVersion: 'synthetic-gate/v1',
    fixtureHash: `sha256:${'d'.repeat(64)}`,
    nativeSessionContinuation: {
      support: 'verified', evidenceLevel: 'L0', source: 'sanitized_fixture_replay',
    },
    nativeSubagents: {
      support: 'verified', evidenceLevel: 'L2', source: 'sanitized_fixture_replay',
    },
    capturedAt: 100,
  };
  return {
    ...withoutHash,
    snapshotHash: hashOdNextRuntimeCapabilitySnapshotV1(withoutHash),
  };
}

describe('OD Next automatic production through the real server', () => {
  let started: StartedServer | null = null;
  let binDir: string | null = null;
  let sequence = 0;

  afterEach(async () => {
    delete process.env.OD_NEXT_STRATEGY_ROLLOUT;
    delete process.env.OD_NEXT_STRATEGY_LOCAL_SYNTHETIC_CANARY;
    delete process.env.OD_NEXT_STRATEGY_MAX_RUN_DURATION_MS;
    uuidControl.forced.length = 0;
    await stopServer(started);
    started = null;
    closeDatabase();
    if (binDir) await rm(binDir, { recursive: true, force: true });
    binDir = null;
  });

  it('keeps off/observe public POST behavior ordinary and idempotent with zero strategy tasks', async () => {
    const fixture = await createPublicRolloutFixture('inert');
    started = fixture.started;
    binDir = fixture.binDir;
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'off';
    const body = publicRunRequest(fixture, 'Run the ordinary public fixture.', 'inert-request');
    const created = await postRun(started!.url, body);
    expect(created.strategyTask).toBeUndefined();
    expect(created.pluginId).toBe('example-web-prototype');
    await waitForRunTerminal(started!.url, created.runId as string);

    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'observe';
    const replayed = await postRun(started!.url, body);
    expect(replayed).toMatchObject({ runId: created.runId, reused: true });
    expect(replayed.strategyTask).toBeUndefined();
    expect((database().prepare('SELECT COUNT(*) AS count FROM strategy_task_executions').get() as { count: number }).count)
      .toBe(0);
    const invocations = await readProjectInvocations(fixture.logPath, fixture.projectId);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.stdin).not.toContain('OD Next Strategy V2');
    expect(invocations[0]?.stdin).not.toContain('open-design.strategy-state/v2');
  });

  it('keeps active retry/task pinned while rollback sends a new public request through the ordinary path', async () => {
    const fixture = await createPublicRolloutFixture('rollback', 'design');
    started = fixture.started;
    binDir = fixture.binDir;
    expect(fixture.projectMetadata?.automaticDefaultScenario).toEqual({
      pluginId: 'example-web-prototype',
      snapshotId: fixture.appliedPluginSnapshotId,
    });
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'active';
    process.env.OD_NEXT_STRATEGY_LOCAL_SYNTHETIC_CANARY = '1';
    const activeBody = publicRunRequest(
      fixture,
      'Hold the public rollout run open until canceled.',
      'active-request',
    );
    const active = await postRun(started!.url, activeBody);
    expect(active.strategyTask).toMatchObject({ inputStage: 'request', terminal: false });
    expect((database().prepare(
      'SELECT applied_plugin_snapshot_id AS snapshotId FROM projects WHERE id = ?',
    ).get(fixture.projectId) as { snapshotId: string | null }).snapshotId)
      .toBe(fixture.appliedPluginSnapshotId);

    latchOdNextRolloutStop(database(), {
      mode: 'observe',
      reasonCode: 'threshold_exceeded',
    });
    const replayed = await postRun(started!.url, activeBody);
    expect(replayed).toMatchObject({
      runId: active.runId,
      taskExecutionId: active.taskExecutionId,
      reused: true,
    });

    const ordinary = await postRun(
      started!.url,
      publicRunRequest(fixture, 'Run after rollback.', 'ordinary-after-rollback'),
    );
    expect(ordinary.strategyTask).toBeUndefined();
    expect(ordinary.pluginId).toBe('example-web-prototype');
    await waitForRunTerminal(started!.url, ordinary.runId as string);

    const canceledResponse = await fetch(
      `${started!.url}/api/runs/${encodeURIComponent(active.runId as string)}/cancel`,
      { method: 'POST' },
    );
    expect(canceledResponse.status).toBe(200);
    expect(await waitForRunTerminal(started!.url, active.runId as string)).toMatchObject({
      status: 'canceled',
      strategyTask: {
        taskExecutionId: active.taskExecutionId,
        outcome: 'canceled',
        terminal: true,
      },
    });
    expect((database().prepare('SELECT COUNT(*) AS count FROM strategy_task_executions').get() as { count: number }).count)
      .toBe(1);
  });

  it('binds an active headless request and its strategy Snapshot to the project conversation', async () => {
    const fixture = await createPublicRolloutFixture('headless-conversation', 'design');
    started = fixture.started;
    binDir = fixture.binDir;
    clearOdNextRolloutStop(database());
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'active';
    process.env.OD_NEXT_STRATEGY_LOCAL_SYNTHETIC_CANARY = '1';

    const request = publicRunRequest(
      fixture,
      'Hold the public rollout run open until canceled.',
      'headless-conversation-request',
    );
    delete (request as { conversationId?: string }).conversationId;
    const created = await postRun(started.url, request);
    expect(created.strategyTask).toMatchObject({ inputStage: 'request', terminal: false });

    const task = getStrategyTaskExecution(database(), created.taskExecutionId as string);
    expect(task?.conversationId).toBe(fixture.conversationId);
    expect(database().prepare(
      'SELECT conversation_id AS conversationId FROM applied_plugin_snapshots WHERE id = ?',
    ).get(task?.snapshotId) as { conversationId: string | null }).toEqual({
      conversationId: fixture.conversationId,
    });

    await fetch(
      `${started.url}/api/runs/${encodeURIComponent(created.runId as string)}/cancel`,
      { method: 'POST' },
    );
  });

  it('never overrides explicit plugin, snapshot, or existing project-pin authority', async () => {
    const fixture = await createPublicRolloutFixture(
      'authority',
      'design',
      'example-web-prototype',
    );
    started = fixture.started;
    binDir = fixture.binDir;
    expect(fixture.projectMetadata?.automaticDefaultScenario).toBeUndefined();
    const strategyTaskCountAtStart = (
      database().prepare('SELECT COUNT(*) AS count FROM strategy_task_executions').get() as { count: number }
    ).count;
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'active';
    process.env.OD_NEXT_STRATEGY_LOCAL_SYNTHETIC_CANARY = '1';

    const pinned = await postRun(
      started.url,
      publicRunRequest(fixture, 'Use the pinned default.', 'pinned-authority'),
    );
    expect(pinned.strategyTask).toBeUndefined();
    expect(pinned.pluginId).toBe('example-web-prototype');

    const explicitDefault = await postRun(started.url, {
      ...publicRunRequest(fixture, 'Use the explicit default.', 'explicit-default'),
      pluginId: 'example-web-prototype',
    });
    expect(explicitDefault.strategyTask).toBeUndefined();
    expect(explicitDefault.pluginId).toBe('example-web-prototype');

    const invalidSnapshot = await fetch(`${started.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...publicRunRequest(fixture, 'Use a missing snapshot.', 'missing-snapshot'),
        appliedPluginSnapshotId: 'missing-snapshot',
      }),
    });
    expect(invalidSnapshot.status).toBe(404);
    expect(await invalidSnapshot.json()).toMatchObject({
      error: { code: 'snapshot-not-found' },
    });

    const officialSource = path.resolve(
      import.meta.dirname,
      '../../../plugins/_official/scenarios/od-next-strategy',
    );
    const resolvedCollision = await resolvePluginFolder({
      folder: officialSource,
      folderId: 'od-next-strategy',
      sourceKind: 'bundled',
      source: officialSource,
      trust: 'bundled',
    });
    if (!resolvedCollision.ok) throw new Error(resolvedCollision.errors.join('; '));
    upsertInstalledPlugin(database(), {
      ...resolvedCollision.record,
      sourceKind: 'user',
      source: 'community-collision-fixture',
      trust: 'restricted',
    });
    const collidingId = await fetch(`${started.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...publicRunRequest(fixture, 'Use an explicit colliding id.', 'colliding-id'),
        pluginId: 'od-next-strategy',
      }),
    });
    expect(collidingId.status).toBe(409);
    expect(await collidingId.json()).toMatchObject({
      error: { code: 'capabilities-required' },
    });
    expect((database().prepare('SELECT COUNT(*) AS count FROM strategy_task_executions').get() as { count: number }).count)
      .toBe(strategyTaskCountAtStart);
  });

  it('runs parsed plan -> serialization repair -> production after each source end and remains exactly-once across restart', async () => {
    const fixture = await createFixture('repair');
    const body = createRunRequest(fixture, 'Build the operator prototype.');

    uuidControl.forced.push(fixture.initialRunId);
    const created = await postRun(started!.url, body);
    expect(created).toMatchObject({
      runId: fixture.initialRunId,
      taskExecutionId: fixture.taskExecutionId,
      strategyTask: {
        taskExecutionId: fixture.taskExecutionId,
        inputStage: 'request',
        outcome: 'running',
        terminal: false,
      },
    });
    expect(uuidControl.forced).toEqual([]);

    const initialTerminal = await waitForRunTerminal(started!.url, fixture.initialRunId);
    expect(initialTerminal.status, JSON.stringify(initialTerminal)).toBe('succeeded');
    const terminal = await waitForTask(fixture.taskExecutionId, 'completed');
    expect(terminal.runs.map((run) => run.inputStage)).toEqual([
      'request',
      'contract_repair',
      'production',
    ]);
    expect(terminal.runs.map((run) => run.sourceRunId ?? null)).toEqual([
      null,
      fixture.initialRunId,
      terminal.runs[1]?.runId,
    ]);
    expect(terminal.planContractRepairAttempts).toBe(1);
    expect(terminal.terminalRunId).toBe(terminal.runs[2]?.runId);

    const statuses = await Promise.all(
      terminal.runs.map((mapping) => getRun(started!.url, mapping.runId)),
    );
    expect(statuses.map((run) => run.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(statuses.at(-1)?.strategyTask).toMatchObject({
      taskExecutionId: fixture.taskExecutionId,
      inputStage: 'production',
      outcome: 'completed',
      terminal: true,
    });
    const resultPackageResponse = await fetch(
      `${started!.url}/api/runs/${fixture.initialRunId}/result-package`,
    );
    expect(resultPackageResponse.status).toBe(200);
    const resultPackage = await resultPackageResponse.json() as {
      run: { id: string };
      strategyTask?: RunStatus['strategyTask'];
    };
    expect(resultPackage.run.id).toBe(terminal.terminalRunId);
    expect(resultPackage.strategyTask).toMatchObject({
      taskExecutionId: fixture.taskExecutionId,
      inputStage: 'production',
      outcome: 'completed',
      terminal: true,
    });
    const watched = await runOdCli([
      'run',
      'watch',
      fixture.initialRunId,
      '--daemon-url',
      started!.url,
    ]);
    const watchedEnds = watched.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; data: RunStatus })
      .filter((event) => event.event === 'end');
    expect(watched.stdout).toContain('Prepared a simple plan.');
    expect(watched.stdout).not.toContain('<open-design-plan-contract>');
    expect(watched.stdout).not.toContain('<open-design-runtime-state>');
    expect(watchedEnds.map((event) => event.data.strategyTask?.inputStage)).toEqual([
      'contract_repair',
      'production',
      'production',
    ]);
    expect(watchedEnds.at(-1)?.data.strategyTask).toMatchObject({
      outcome: 'completed',
      terminal: true,
    });

    const invocations = await readProjectInvocations(fixture.logPath, fixture.projectId);
    expect(invocations).toHaveLength(3);
    expect(invocations[0]?.argv).not.toContain('resume');
    expect(invocations[0]?.stdin).toMatch(/^<open_design_prompt_bundle/);
    expect(invocations[0]?.stdin).toContain('<system_prompt>');
    expect(invocations[0]?.stdin).toContain('<user_prompt>');
    expect(invocations[0]?.stdin).toContain('<task_config>');
    expect(invocations[0]?.stdin).toContain('<context>');
    expect(invocations[0]?.stdin).not.toContain('# User request');
    expect(invocations[1]?.argv.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(invocations[2]?.argv.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(invocations[1]?.stdin).toContain('native continuation — contract_repair');
    expect(invocations[2]?.stdin).toContain('native continuation — production');
    expect(invocations[1]?.stdin).toMatch(/^<open_design_request_turn/);
    expect(invocations[2]?.stdin).toMatch(/^<open_design_request_turn/);
    expect(invocations[1]?.stdin).toContain('stage="contract_repair" task_run_index="1"');
    expect(invocations[2]?.stdin).toContain('stage="production" task_run_index="2"');
    expect(invocations[1]?.stdin).not.toContain('# User request');
    expect(invocations[2]?.stdin).not.toContain('# User request');
    expect(invocations[1]?.stdin).not.toContain('open-design.strategy-state/v2');
    expect(invocations[2]?.stdin).not.toContain('open-design.strategy-state/v2');
    expect(statuses[0]!.updatedAt).toBeLessThanOrEqual(invocations[1]!.startedAt);
    expect(statuses[1]!.updatedAt).toBeLessThanOrEqual(invocations[2]!.startedAt);

    for (const mapping of terminal.runs) {
      await getRun(started!.url, mapping.runId);
      await getRun(started!.url, mapping.runId);
    }
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(3);
    expect(getStrategyTaskExecution(database(), fixture.taskExecutionId)?.runs).toHaveLength(3);

    await stopServer(started);
    started = await startDaemon();
    for (const mapping of terminal.runs) {
      expect((await getRun(started.url, mapping.runId)).status).toBe('succeeded');
    }
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(3);
    expect(getStrategyTaskExecution(database(), fixture.taskExecutionId)).toMatchObject({
      outcome: 'completed',
      terminalRunId: terminal.runs[2]?.runId,
    });
  });

  it('completes direct edit in its request Run and an exact retry or restart cannot allocate another Run', async () => {
    const fixture = await createFixture('direct');
    const body = createRunRequest(fixture, 'Update the existing operator header.');

    uuidControl.forced.push(fixture.initialRunId);
    const created = await postRun(started!.url, body);
    expect(created).toMatchObject({
      runId: fixture.initialRunId,
      taskExecutionId: fixture.taskExecutionId,
    });
    const terminal = await waitForTask(fixture.taskExecutionId, 'completed');
    expect(terminal.runs).toEqual([
      expect.objectContaining({
        runId: fixture.initialRunId,
        inputStage: 'request',
        taskRunIndex: 0,
      }),
    ]);
    expect(terminal.route).toBe('direct_edit');
    expect(terminal.terminalRunId).toBe(fixture.initialRunId);
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(1);

    const retried = await postRun(started!.url, body);
    expect(retried).toMatchObject({
      runId: fixture.initialRunId,
      reused: true,
      taskExecutionId: fixture.taskExecutionId,
      strategyTask: {
        taskExecutionId: fixture.taskExecutionId,
        inputStage: 'request',
        outcome: 'completed',
        terminal: true,
      },
    });
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(1);
    expect(getStrategyTaskExecution(database(), fixture.taskExecutionId)?.runs).toHaveLength(1);

    await stopServer(started);
    started = await startDaemon();
    expect((await getRun(started.url, fixture.initialRunId)).status).toBe('succeeded');
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(1);
    expect(getStrategyTaskExecution(database(), fixture.taskExecutionId)).toMatchObject({
      outcome: 'completed',
      latestRunId: fixture.initialRunId,
      terminalRunId: fixture.initialRunId,
    });
  });

  it('blocks the durable task before an early agent startup failure publishes its end event', async () => {
    const fixture = await createFixture('direct', { selectedAgentId: 'missing-agent' });

    uuidControl.forced.push(fixture.initialRunId);
    const created = await postRun(
      started!.url,
      createRunRequest(fixture, 'Update the existing operator header.'),
    );
    const terminal = await waitForRunTerminal(started!.url, created.runId as string);

    expect(terminal).toMatchObject({
      status: 'failed',
      errorCode: 'AGENT_UNAVAILABLE',
      strategyTask: {
        taskExecutionId: fixture.taskExecutionId,
        outcome: 'blocked',
        terminal: true,
      },
    });
    expect(getStrategyTaskExecution(database(), fixture.taskExecutionId)).toMatchObject({
      outcome: 'blocked',
      latestRunId: fixture.initialRunId,
    });
  });

  it('fails closed when daemon-owned execution preflight rejects', async () => {
    const fixture = await createFixture('repair');
    await stopServer(started);
    started = await startDaemon(async () => {
      throw new Error('fixture preflight unavailable');
    });

    uuidControl.forced.push(fixture.initialRunId);
    await postRun(started.url, createRunRequest(fixture, 'Build the operator prototype.'));
    const task = await waitForTask(fixture.taskExecutionId, 'blocked');
    const terminal = await waitForRunTerminal(started.url, task.latestRunId);

    expect(task.runs.map((run) => run.inputStage)).toEqual(['request']);
    expect(terminal).toMatchObject({
      status: 'failed',
      errorCode: 'OD_NEXT_EXECUTION_PREFLIGHT_FAILED',
      strategyTask: {
        taskExecutionId: fixture.taskExecutionId,
        outcome: 'blocked',
        terminal: true,
      },
    });
  });

  it('does not allocate a stale continuation when cancel wins during execution preflight', async () => {
    const fixture = await createFixture('repair');
    await stopServer(started);
    let enterResolver!: () => void;
    let releaseResolver!: () => void;
    const resolverEntered = new Promise<void>((resolve) => { enterResolver = resolve; });
    const resolverGate = new Promise<void>((resolve) => { releaseResolver = resolve; });
    started = await startDaemon(async () => {
      enterResolver();
      await resolverGate;
      return EXECUTION_PREFLIGHT;
    });

    uuidControl.forced.push(fixture.initialRunId);
    await postRun(started.url, createRunRequest(fixture, 'Build the operator prototype.'));
    await resolverEntered;
    const awaiting = getStrategyTaskExecution(database(), fixture.taskExecutionId);
    expect(awaiting?.runs.map((run) => run.inputStage)).toEqual(['request']);
    const activeRunId = awaiting?.activeRunId;
    expect(activeRunId).toBeTruthy();

    const cancelResponse = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(activeRunId!)}/cancel`,
      { method: 'POST' },
    );
    expect(cancelResponse.status).toBe(200);
    releaseResolver();

    const task = await waitForTask(fixture.taskExecutionId, 'canceled');
    const terminal = await waitForRunTerminal(started.url, activeRunId!);
    expect(task.runs.map((run) => run.inputStage)).toEqual(['request']);
    expect(terminal).toMatchObject({
      status: 'canceled',
      strategyTask: { outcome: 'canceled', terminal: true },
    });
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(1);
  });

  it('runs a synthetic verified complex package chain and requires normalized Child evidence', async () => {
    const capability = complexCapabilitySnapshot();
    const fixture = await createFixture('complex', { capability });
    await stopServer(started);
    started = await startDaemon(
      () => EXECUTION_PREFLIGHT,
      ({ phase, taskExecutionId, runId }) => {
        if (phase === 'eligibility') return { capabilitySnapshot: capability };
        const rootId = `task-run:${runId}`;
        const fact = (
          id: string,
          kind: 'task_run' | 'child_agent',
          status: 'running' | 'completed',
          packageId?: string,
        ) => normalizeAgentObservationV1({
          identity: {
            observationId: id,
            taskExecutionId,
            runId,
            taskRunIndex: 1,
            ...(kind === 'child_agent' ? { parentObservationId: rootId } : {}),
          },
          kind,
          stage: 'production',
          status,
          ...(packageId ? { attributes: { buildPackageId: packageId } } : {}),
        });
        return {
          capabilitySnapshot: capability,
          taskRunObservationId: rootId,
          observations: [
            fact(rootId, 'task_run', 'running'),
            fact('child-shell', 'child_agent', 'running', 'shell'),
            fact('child-shell', 'child_agent', 'completed', 'shell'),
            fact('child-flow', 'child_agent', 'running', 'flow'),
            fact('child-flow', 'child_agent', 'completed', 'flow'),
            fact(rootId, 'task_run', 'completed'),
          ],
        };
      },
    );

    uuidControl.forced.push(fixture.initialRunId);
    await postRun(started.url, createRunRequest(fixture, 'Build the complex prototype.'));
    const terminal = await waitForTask(fixture.taskExecutionId, 'completed');
    expect(terminal).toMatchObject({
      executionMode: 'complex',
      terminalRunId: terminal.runs[1]?.runId,
    });
    expect(terminal.runs.map((run) => run.inputStage)).toEqual(['request', 'production']);
    expect(await readProjectInvocations(fixture.logPath, fixture.projectId)).toHaveLength(2);
  });

  async function createFixture(
    mode: 'repair' | 'direct' | 'complex',
    {
      selectedAgentId = 'codex',
      capability,
    }: {
      selectedAgentId?: string;
      capability?: OdNextRuntimeCapabilitySnapshotV1;
    } = {},
  ) {
    const suffix = `${mode}-${Date.now()}-${++sequence}`;
    binDir = await mkdtemp(path.join(os.tmpdir(), `od-next-server-${mode}-`));
    started = await startDaemon();
    const projectId = `od-next-server-${suffix}`;
    const projectResponse = await fetch(`${started.url}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: `OD Next ${mode} server test`,
        metadata: { kind: 'prototype' },
        skipDiscoveryBrief: true,
      }),
    });
    expect(projectResponse.status).toBe(200);
    const projectBody = await projectResponse.json() as { conversationId: string };
    const project = { id: projectId, conversationId: projectBody.conversationId };

    const snapshot = await createStrategySnapshot(project.id, project.conversationId);
    const initialRunId = `019fffab-0000-7000-8000-${sequence
      .toString(16)
      .padStart(12, '0')}`;
    const taskExecutionId = `task-${suffix}`;
    createStrategyTaskExecution(database(), {
      taskExecutionId,
      projectId: project.id,
      conversationId: project.conversationId,
      snapshotId: snapshot.snapshotId,
      selectedAgentId,
      initialRunId,
    });
    prepareStrategyRequest(database(), {
      taskExecutionId,
      preference: mode === 'direct' ? 'auto' : 'full_plan',
      directEdit: mode === 'direct'
        ? DIRECT_ELIGIBLE
        : {
            editableBaselineExists: false,
            localAndUnambiguous: false,
            canonicalDeliverableStable: false,
            deliverableSetStable: false,
            dependenciesBounded: false,
          },
      intake: INTAKE_PASSED,
      ...(mode === 'direct' ? { execution: EXECUTION_PREFLIGHT } : {}),
    });

    const { bin, logPath } = await writeStrategyCodex(
      binDir,
      mode,
      planContract(snapshot.snapshotId, snapshot.strategy!, mode, capability),
    );
    const configResponse = await fetch(`${started.url}/api/app-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'codex',
        agentCliEnv: { codex: { CODEX_BIN: bin, CODEX_HOME: binDir } },
        telemetry: { metrics: false, content: false, artifactManifest: false },
        privacyDecisionAt: Date.now(),
      }),
    });
    expect(configResponse.status).toBe(200);
    return {
      projectId: project.id,
      conversationId: project.conversationId,
      snapshotId: snapshot.snapshotId,
      initialRunId,
      taskExecutionId,
      logPath,
      agentId: selectedAgentId,
    };
  }
});

async function createPublicRolloutFixture(
  label: string,
  conversationMode: 'design' | 'chat' | 'plan' = 'chat',
  pluginId?: string,
) {
  const suffix = `${label}-${Date.now()}`;
  const binDir = await mkdtemp(path.join(os.tmpdir(), `od-next-public-${label}-`));
  const { bin, logPath } = await writePublicRolloutCodex(binDir, label);
  const started = await startDaemon();
  const projectId = `od-next-public-${suffix}`;
  const projectResponse = await fetch(`${started.url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: `OD Next public ${label}`,
      metadata: { kind: 'prototype' },
      conversationMode,
      ...(pluginId ? { pluginId } : {}),
      skipDiscoveryBrief: true,
    }),
  });
  expect(projectResponse.status).toBe(200);
  const { conversationId, appliedPluginSnapshotId, project } = await projectResponse.json() as {
    conversationId: string;
    appliedPluginSnapshotId?: string;
    project?: { metadata?: { automaticDefaultScenario?: { pluginId: string; snapshotId: string } } };
  };
  const configResponse = await fetch(`${started.url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: 'codex',
      agentCliEnv: { codex: { CODEX_BIN: bin, CODEX_HOME: binDir } },
      telemetry: { metrics: false, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    }),
  });
  expect(configResponse.status).toBe(200);
  const agentsResponse = await fetch(`${started.url}/api/agents`);
  expect(agentsResponse.status).toBe(200);
  return {
    started,
    binDir,
    projectId,
    conversationId,
    appliedPluginSnapshotId,
    projectMetadata: project?.metadata,
    logPath,
  };
}

function publicRunRequest(
  fixture: { projectId: string; conversationId: string },
  message: string,
  id: string,
) {
  return {
    projectId: fixture.projectId,
    conversationId: fixture.conversationId,
    agentId: 'codex',
    userMessageId: `user-${id}`,
    assistantMessageId: `assistant-${id}`,
    clientRequestId: id,
    message,
    currentPrompt: message,
  };
}

async function writePublicRolloutCodex(
  dir: string,
  label: string,
): Promise<{ bin: string; logPath: string }> {
  const bin = path.join(dir, `codex-public-${label}`);
  const logPath = path.join(dir, `codex-public-${label}.jsonl`);
  await writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
if (argv.includes('--version')) { console.log('codex-cli 0.147.0'); process.exit(0); }
if (argv.includes('--help')) { console.log('Usage: codex exec'); process.exit(0); }
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  fs.appendFileSync(logPath, JSON.stringify({ argv, stdin, cwd: process.cwd(), startedAt: Date.now() }) + '\\n');
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'public-rollout-session' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  if (stdin.includes('Hold the public rollout run open until canceled.')) {
    setInterval(() => {}, 1 << 30);
    return;
  }
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { id: 'answer', type: 'agent_message', text: 'Ordinary public run completed.' },
  }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
  setTimeout(() => process.exit(0), 5);
});
`, 'utf8');
  await chmod(bin, 0o755);
  return { bin, logPath };
}

async function runOdCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return execFileP(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
    cwd: DAEMON_ROOT,
    env,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function database() {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required');
  return openDatabase(process.cwd(), { dataDir });
}

async function startDaemon(
  resolver: NonNullable<StartServerOptions['odNextExecutionPreflightResolver']> =
    () => EXECUTION_PREFLIGHT,
  complexResolver: StartServerOptions['odNextComplexProductionResolver'] = null,
): Promise<StartedServer> {
  return await startServer({
    port: 0,
    returnServer: true,
    odNextExecutionPreflightResolver: resolver,
    odNextComplexProductionResolver: complexResolver,
  }) as StartedServer;
}

async function stopServer(server: StartedServer | null): Promise<void> {
  if (!server) return;
  await Promise.resolve(server.shutdown?.());
  if (server.server.listening) {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
}

async function createStrategySnapshot(projectId: string, conversationId: string) {
  const source = path.resolve(
    import.meta.dirname,
    '../../../plugins/_official/scenarios/od-next-strategy',
  );
  const resolved = await resolvePluginFolder({
    folder: source,
    folderId: 'od-next-strategy',
    sourceKind: 'bundled',
    source,
    trust: 'bundled',
  });
  if (!resolved.ok) throw new Error(resolved.errors.join('; '));
  const plugin = resolved.record;
  const strategy = createBundledStrategyBindingV2({ plugin, taskType: 'prototype' });
  const snapshot = createSnapshot(database(), {
    projectId,
    conversationId,
    runId: null,
    pluginId: 'od-next-strategy',
    pluginVersion: '2.0.0',
    manifestSourceDigest: 'od-next-server-test-manifest',
    strategy,
    taskKind: 'new-generation',
    inputs: {},
    resolvedContext: { items: [] },
    pipeline: {
      stages: OD_NEXT_PROMPT_STAGE_CONTRACT_V2.map((stage) => ({
        id: stage.id,
        atoms: [...stage.atoms],
      })),
    },
    capabilitiesGranted: ['prompt:inject'],
    capabilitiesRequired: ['prompt:inject'],
    assetsStaged: [],
    connectorsRequired: [],
    connectorsResolved: [],
    mcpServers: [],
  });
  linkSnapshotToProject(database(), snapshot.snapshotId, projectId);
  return snapshot;
}

function planContract(
  snapshotId: string,
  strategy: AppliedStrategyBindingV2,
  mode: 'repair' | 'direct' | 'complex' = 'repair',
  capability = complexCapabilitySnapshot(),
): OpenDesignPlanContractV2 {
  return {
    schema: 'open-design.plan-contract/v2',
    strategy: {
      id: 'od-next-strategy',
      version: strategy.version,
      packageHash: strategy.packageHash,
      snapshotId,
    },
    taskProfile: {
      schemaVersion: '2',
      taskType: 'prototype',
      taskProfileVersion: strategy.selectedTaskProfile.version,
      goal: 'Build an operator prototype',
      contextAndAudience: 'Product operators',
      inputsAndReferences: ['request'],
      constraints: [],
      canonicalDeliverable: { id: 'prototype', kind: 'prototype', format: 'html' },
      requiredDeliverables: [{ id: 'prototype', kind: 'prototype' }],
      designSpec: {
        source: 'resolved-baseline',
        version: '1',
        decisions: { palette: 'neutral' },
      },
      buildRequirements: [{ id: 'build', text: 'Build the prototype.' }],
      assumptions: [],
      risks: [],
      taskSpecific: {},
    },
    fullPlan: {
      executionMode: mode === 'complex' ? 'complex' : 'simple',
      steps: mode === 'complex'
        ? [
            { id: 'shell', objective: 'Build shell', outputs: ['shell'] },
            { id: 'flow', objective: 'Build flow', outputs: ['flow'], dependsOn: ['shell'] },
          ]
        : [{ id: 'build', objective: 'Build', outputs: ['prototype'] }],
      readinessArtifacts: [],
      buildPackages: mode === 'complex'
        ? [
            {
              id: 'shell', objective: 'Build shell', inputs: ['design-spec'], outputs: ['shell'],
              sharedConstraints: ['Use the frozen design spec.'], dependsOn: [],
              allowedResources: ['project-source'],
            },
            {
              id: 'flow', objective: 'Build flow', inputs: ['shell'], outputs: ['flow'],
              sharedConstraints: ['Use the frozen design spec.'], dependsOn: ['shell'],
              allowedResources: ['project-source'],
            },
          ]
        : [],
    },
    runManifest: {
      selectedAgentId: 'codex',
      capabilitySnapshotHash: mode === 'complex'
        ? capability.snapshotHash.slice('sha256:'.length)
        : 'c'.repeat(64),
      inputRefs: ['request'],
      productionRoutes: ['html'],
      preflight: { intake: 'passed', execution: 'passed' },
    },
    decisionSummary: {
      goal: 'Build an operator prototype',
      deliverables: ['prototype'],
      keyConstraints: [],
      assumptions: [],
      risks: [],
      openDecisions: [],
    },
  };
}

function runtimeState(input: {
  route?: 'direct_edit' | 'full_plan';
  inputStage?: 'request' | 'contract_repair' | 'production';
  outcome: 'plan_ready' | 'completed';
  executionMode?: 'simple' | 'complex';
}) {
  return {
    schema: 'open-design.strategy-state/v2',
    route: input.route ?? 'full_plan',
    inputStage: input.inputStage ?? 'request',
    outcome: input.outcome,
    executionMode: input.executionMode ?? 'simple',
    reasonCodes: [],
  };
}

function machineBlock(tag: string, value: unknown, fenced = false): string {
  const json = JSON.stringify(value);
  return `<${tag}>\n${fenced ? `\`\`\`json\n${json}\n\`\`\`` : json}\n</${tag}>`;
}

async function writeStrategyCodex(
  dir: string,
  mode: 'repair' | 'direct' | 'complex',
  plan: OpenDesignPlanContractV2,
): Promise<{ bin: string; logPath: string }> {
  const bin = path.join(dir, `codex-${mode}`);
  const logPath = path.join(dir, `codex-${mode}.jsonl`);
  const initialRepair = [
    'Prepared a simple plan.',
    machineBlock('open-design-plan-contract', plan, true),
    machineBlock('open-design-runtime-state', runtimeState({ outcome: 'plan_ready' })),
  ].join('\n');
  const repaired = [
    machineBlock('open-design-plan-contract', plan),
    machineBlock('open-design-runtime-state', runtimeState({
      inputStage: 'contract_repair',
      outcome: 'plan_ready',
    })),
  ].join('\n');
  const production = machineBlock('open-design-runtime-state', runtimeState({
    inputStage: 'production',
    outcome: 'completed',
  }));
  const direct = machineBlock('open-design-runtime-state', runtimeState({
    route: 'direct_edit',
    outcome: 'completed',
  }));
  const complexPlan = [
    'Prepared a complex plan.',
    machineBlock('open-design-plan-contract', plan),
    machineBlock('open-design-runtime-state', runtimeState({
      outcome: 'plan_ready', executionMode: 'complex',
    })),
  ].join('\n');
  const complexProduction = machineBlock('open-design-runtime-state', runtimeState({
    inputStage: 'production', outcome: 'completed', executionMode: 'complex',
  }));

  await writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
const mode = ${JSON.stringify(mode)};
if (argv.includes('--version')) { console.log('codex-cli 0.147.0'); process.exit(0); }
if (argv.includes('--help')) { console.log('Usage: codex exec [--sandbox MODE]'); process.exit(0); }
let stdin = '';
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const startedAt = Date.now();
  fs.appendFileSync(logPath, JSON.stringify({ argv, stdin, cwd: process.cwd(), startedAt }) + '\\n');
  if (argv.includes('resume') && (argv.includes('-C') || argv.includes('--add-dir'))) {
    process.stderr.write("error: unexpected argument '-C' found\\n");
    process.exit(2);
  }
  let text;
  if (mode === 'direct') {
    fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><title>Direct</title>');
    text = ${JSON.stringify(direct)};
  } else if (mode === 'complex' && stdin.includes('native continuation — production')) {
    fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><title>Complex</title>');
    text = ${JSON.stringify(complexProduction)};
  } else if (mode === 'complex') {
    text = ${JSON.stringify(complexPlan)};
  } else if (stdin.includes('native continuation — contract_repair')) {
    text = ${JSON.stringify(repaired)};
  } else if (stdin.includes('native continuation — production')) {
    fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><title>Production</title>');
    text = ${JSON.stringify(production)};
  } else {
    text = ${JSON.stringify(initialRepair)};
  }
  console.log(JSON.stringify({ type: 'thread.started', thread_id: ${JSON.stringify(THREAD_ID)} }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }));
  setTimeout(() => process.exit(0), 5);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', finish);
process.stdin.on('error', finish);
setTimeout(finish, 1500);
`, 'utf8');
  await chmod(bin, 0o755);
  return { bin, logPath };
}

function createRunRequest(
  fixture: {
    projectId: string;
    conversationId: string;
    snapshotId: string;
    agentId?: string;
  },
  message: string,
) {
  return {
    projectId: fixture.projectId,
    conversationId: fixture.conversationId,
    agentId: fixture.agentId ?? 'codex',
    appliedPluginSnapshotId: fixture.snapshotId,
    userMessageId: `user-${fixture.projectId}`,
    assistantMessageId: `assistant-${fixture.projectId}`,
    clientRequestId: `request-${fixture.projectId}`,
    message,
    currentPrompt: message,
  };
}

async function postRun(url: string, body: Record<string, unknown>) {
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json() as Record<string, any>;
  expect(response.status, JSON.stringify(responseBody)).toBe(202);
  return responseBody;
}

async function getRun(url: string, runId: string): Promise<RunStatus> {
  const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
  expect(response.status).toBe(200);
  return await response.json() as RunStatus;
}

async function waitForRunTerminal(url: string, runId: string): Promise<RunStatus> {
  const deadline = Date.now() + 10_000;
  let latest: RunStatus | null = null;
  while (Date.now() < deadline) {
    latest = await getRun(url, runId);
    if (['succeeded', 'failed', 'canceled'].includes(latest.status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} did not finish: ${JSON.stringify(latest)}`);
}

async function waitForTask(taskExecutionId: string, outcome: string) {
  const deadline = Date.now() + 10_000;
  let latest = null;
  while (Date.now() < deadline) {
    const task = getStrategyTaskExecution(database(), taskExecutionId);
    latest = task;
    if (task?.outcome === outcome) return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `task ${taskExecutionId} did not reach ${outcome}: ${JSON.stringify(latest)}`,
  );
}

async function readProjectInvocations(logPath: string, projectId: string): Promise<Invocation[]> {
  let raw = '';
  try {
    raw = await readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Invocation)
    .filter((invocation) =>
      invocation.argv[0] === 'exec'
      && invocation.cwd.includes(projectId),
    );
}
