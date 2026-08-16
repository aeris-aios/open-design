import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import { NormalizedAgentObservationV1Schema } from '@open-design/contracts';
import type { TelemetryPrefs } from '../app-config.js';
import {
  HARD_BATCH_MAX_BYTES,
  describeRunTelemetrySink,
  postLegacyTelemetryBatch,
  readTelemetrySinkConfig,
  readRunTelemetrySinkConfig,
  type LangfuseDeliveryState,
  type RunTelemetrySinkConfig,
  type TelemetrySinkConfig,
} from '../langfuse-trace.js';
import {
  scanRunEventsForUsageAnalytics,
  summarizeRunTimingAnalytics,
} from '../run-analytics-observability.js';
import {
  getStrategyTaskExecution,
  getStrategyTaskExecutionByRunId,
  type StrategyTaskExecutionRecord,
} from '../strategies/task-store.js';
import {
  runTelemetryDeliveryIdempotencyKey,
  type RunTelemetryDeliveryStateV1,
  type RunTelemetryDeliveryResult,
} from './delivery-state.js';
import { buildStructuredMainRunObservationV1 } from './main-run-observation.js';
import { getDetectedRuntimeVersions } from '../runtimes/detection.js';
import { OD_NEXT_RUNTIME_PATH_DESCRIPTORS } from '../runtimes/od-next-capability-gate.js';
import {
  adaptOpenCodeTaskCandidateV1,
  type OpenCodeTaskTerminalCandidate,
} from '../runtimes/opencode-child-evidence.js';
import {
  adaptVelaChildRuntimeFactV1,
  type VelaChildRuntimeFact,
} from '../runtimes/vela-child-evidence.js';
import {
  adaptClaudeChildRuntimeFactV1,
  type ClaudeChildRuntimeFact,
} from '../runtimes/claude-child-evidence.js';
import {
  aggregateStrategyTaskObservations,
  buildLegacyTaskObservationPayload,
  prepareLegacyTaskObservationExport,
  strategyTaskRootObservationId,
  type StrategyTaskObservationAggregateV1,
  type TaskObservationExportContextV1,
} from './task-observation-aggregation.js';
import {
  exportTaskObservationAggregate,
  readTaskObservationExporterConfig,
  type TaskObservationDeliveryState,
} from './task-observation-otlp-exporter.js';

export type TaskObservationRolloutMode = 'off' | 'observe' | 'send';

export interface TaskObservationRolloutConfig {
  mode: TaskObservationRolloutMode;
  context: TaskObservationExportContextV1 | null;
}

export interface TaskObservationRolloutDiagnostic {
  mode: TaskObservationRolloutMode;
  environment: string | null;
  tag: string | null;
  effectiveSink: ReturnType<typeof describeRunTelemetrySink>;
  taskProtocol: 'none' | 'legacy-v1' | 'otlp-v4';
  readyToSend: boolean;
  blockedReason: 'mode_not_send' | 'missing_environment_or_tag' | 'missing_sink' | null;
}

interface TaskRunLike {
  id: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  events: Array<{ event: string; data: unknown; timestamp?: number }>;
  promptTelemetry?: Parameters<typeof buildStructuredMainRunObservationV1>[0]['promptTelemetry'];
  analyticsTelemetry?: Parameters<typeof summarizeRunTimingAnalytics>[0]['telemetry'];
  model?: string | null;
  resolvedModelId?: string | null;
  agentId?: string | null;
  preflightAgentCliVersion?: string | null;
}

type PersistedDeliveryStatus =
  | 'observed'
  | 'in_flight'
  | 'accepted'
  | 'not_expected'
  | 'failed';

interface TaskObservationDeliveryRow {
  taskExecutionId: string;
  mode: 'observe' | 'send';
  environment: string;
  tag: string;
  aggregateDigest: string | null;
  observationCount: number;
  coverageJson: string | null;
  status: PersistedDeliveryStatus;
  idempotencyKey: string | null;
  attemptCount: number;
  crashWindow: number;
  startedAt: number;
  dropReason: string | null;
  finalizedAt: number | null;
  updatedAt: number;
}

export interface TaskObservationRolloutResult {
  mode: TaskObservationRolloutMode;
  action:
    | 'compatibility'
    | 'waiting_for_task_terminal'
    | 'observed'
    | 'sent'
    | 'already_in_flight'
    | 'already_finalized'
    | 'not_expected'
    | 'failed';
  taskExecutionId?: string;
  delivery?: RunTelemetryDeliveryStateV1;
}

export interface TaskObservationRolloutService {
  readonly config: TaskObservationRolloutConfig;
  diagnostic(): TaskObservationRolloutDiagnostic;
  modeForRun(runId: string): TaskObservationRolloutMode;
  beginFinalizeForRun(runId: string): TaskObservationFinalizationHandle;
  finalizeForRun(runId: string): Promise<TaskObservationRolloutResult>;
  reconcileCrashWindows(): Promise<number>;
}

export interface TaskObservationFinalizationHandle {
  durableTaskTruth: boolean;
  suppressSingleRun: boolean;
  completion: Promise<TaskObservationRolloutResult>;
}

export interface CreateTaskObservationRolloutServiceOptions {
  db: Database.Database;
  getRun(runId: string): TaskRunLike | null | undefined;
  readTelemetry(): Promise<{ prefs: TelemetryPrefs; installationId?: string | null }>;
  env?: NodeJS.ProcessEnv;
  configuredEnv?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const CONTEXT_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const TERMINAL_TASK_OUTCOMES = new Set(['completed', 'blocked', 'canceled']);

function cleanContextValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return CONTEXT_VALUE_RE.test(normalized) ? normalized : null;
}

export function readTaskObservationRolloutConfig(
  env: NodeJS.ProcessEnv = process.env,
): TaskObservationRolloutConfig {
  const rawMode = env.OD_NEXT_TASK_OBSERVABILITY_MODE?.trim().toLowerCase();
  const mode: TaskObservationRolloutMode = rawMode === 'observe' || rawMode === 'send'
    ? rawMode
    : 'off';
  const environment = cleanContextValue(
    env.OD_NEXT_TASK_OBSERVABILITY_ENVIRONMENT,
  );
  const tag = cleanContextValue(env.OD_NEXT_TASK_OBSERVABILITY_TAG);
  return { mode, context: environment && tag ? { environment, tag } : null };
}

export function migrateTaskObservationRolloutStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_task_observation_delivery (
      task_execution_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('observe', 'send')),
      environment TEXT NOT NULL,
      tag TEXT NOT NULL,
      aggregate_digest TEXT,
      observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
      coverage_json TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('observed', 'in_flight', 'accepted', 'not_expected', 'failed')
      ),
      idempotency_key TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      crash_window INTEGER NOT NULL DEFAULT 0 CHECK (crash_window IN (0, 1)),
      started_at INTEGER NOT NULL,
      drop_reason TEXT,
      finalized_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(task_execution_id) REFERENCES strategy_task_executions(task_execution_id)
        ON DELETE CASCADE
    );
  `);
}

function rowFromDb(row: Record<string, unknown>): TaskObservationDeliveryRow {
  return {
    taskExecutionId: String(row['taskExecutionId']),
    mode: row['mode'] === 'observe' ? 'observe' : 'send',
    environment: String(row['environment']),
    tag: String(row['tag']),
    aggregateDigest:
      typeof row['aggregateDigest'] === 'string' ? row['aggregateDigest'] : null,
    observationCount: Number(row['observationCount']),
    coverageJson: typeof row['coverageJson'] === 'string' ? row['coverageJson'] : null,
    status: row['status'] as PersistedDeliveryStatus,
    idempotencyKey:
      typeof row['idempotencyKey'] === 'string' ? row['idempotencyKey'] : null,
    attemptCount: Number(row['attemptCount']),
    crashWindow: Number(row['crashWindow']),
    startedAt: Number(row['startedAt']),
    dropReason: typeof row['dropReason'] === 'string' ? row['dropReason'] : null,
    finalizedAt: typeof row['finalizedAt'] === 'number' ? row['finalizedAt'] : null,
    updatedAt: Number(row['updatedAt']),
  };
}

function readDeliveryRow(
  db: Database.Database,
  taskExecutionId: string,
): TaskObservationDeliveryRow | null {
  const row = db.prepare(`
    SELECT task_execution_id AS taskExecutionId,
           mode, environment, tag,
           aggregate_digest AS aggregateDigest,
           observation_count AS observationCount,
           coverage_json AS coverageJson,
           status,
           idempotency_key AS idempotencyKey,
           attempt_count AS attemptCount,
           crash_window AS crashWindow,
           started_at AS startedAt,
           drop_reason AS dropReason,
           finalized_at AS finalizedAt,
           updated_at AS updatedAt
      FROM strategy_task_observation_delivery
     WHERE task_execution_id = ?
  `).get(taskExecutionId) as Record<string, unknown> | undefined;
  return row ? rowFromDb(row) : null;
}

function deliveryState(row: TaskObservationDeliveryRow): RunTelemetryDeliveryStateV1 | undefined {
  if (row.status === 'observed' || !row.idempotencyKey) return undefined;
  return {
    version: 1,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    attemptCount: row.attemptCount,
    crashWindow: row.crashWindow === 1,
    startedAt: row.startedAt,
    ...(row.dropReason ? { dropReason: row.dropReason } : {}),
    ...(row.finalizedAt !== null ? { finalizedAt: row.finalizedAt } : {}),
  };
}

function taskDeliveryIdentity(taskExecutionId: string): string {
  return `strategy-task:${taskExecutionId}`;
}

function aggregateDigest(aggregate: StrategyTaskObservationAggregateV1): string {
  return createHash('sha256').update(JSON.stringify(aggregate), 'utf8').digest('hex');
}

function capSinkRetries<T extends RunTelemetrySinkConfig>(config: T): T {
  return { ...config, retries: Math.min(config.retries, 1) };
}

function deliveryAction(delivery: RunTelemetryDeliveryStateV1): TaskObservationRolloutResult['action'] {
  if (delivery.status === 'accepted') return 'sent';
  if (delivery.status === 'not_expected') return 'not_expected';
  return 'failed';
}

function taskAggregate(
  task: StrategyTaskExecutionRecord,
  getRun: CreateTaskObservationRolloutServiceOptions['getRun'],
): StrategyTaskObservationAggregateV1 {
  const observations = task.runs.flatMap((mapping) => {
    const run = getRun(mapping.runId);
    if (!run) return [];
    const usage = scanRunEventsForUsageAnalytics(
      run.events,
      run.resolvedModelId ?? run.model,
      0,
    );
    const timing = summarizeRunTimingAnalytics({
      runCreatedAt: run.createdAt,
      runUpdatedAt: run.updatedAt,
      analyticsCapturedAt: run.updatedAt,
      ...(run.analyticsTelemetry ? { telemetry: run.analyticsTelemetry } : {}),
      events: run.events,
    });
    const detectedVersions = getDetectedRuntimeVersions(run.agentId);
    const runtimeAdapterVersion = OD_NEXT_RUNTIME_PATH_DESCRIPTORS.find(
      (descriptor) => descriptor.agentId === run.agentId,
    )?.runtimeAdapterVersion;
    const taskRunObservation = buildStructuredMainRunObservationV1({
      taskExecutionId: task.taskExecutionId,
      runId: run.id,
      taskRunIndex: mapping.taskRunIndex,
      parentObservationId: strategyTaskRootObservationId(task.taskExecutionId),
      stage: mapping.inputStage,
      status: run.status,
      ...(run.promptTelemetry ? { promptTelemetry: run.promptTelemetry } : {}),
      usage,
      timing,
      startedAtMs: run.createdAt,
      endedAtMs: run.updatedAt,
      ...(run.preflightAgentCliVersion || detectedVersions?.agentCliVersion
        ? {
            agentCliVersion:
              run.preflightAgentCliVersion ?? detectedVersions!.agentCliVersion!,
          }
        : {}),
      ...(detectedVersions?.runtimeCompanionName
        ? { runtimeCompanionName: detectedVersions.runtimeCompanionName }
        : {}),
      ...(detectedVersions?.runtimeCompanionVersion
        ? { runtimeCompanionVersion: detectedVersions.runtimeCompanionVersion }
        : {}),
      ...(runtimeAdapterVersion ? { runtimeAdapterVersion } : {}),
    });
    const childObservations = run.events.flatMap((record) => {
      if (record.event !== 'agent' || !record.data || typeof record.data !== 'object') {
        return [];
      }
      const diagnostic = record.data as Record<string, unknown>;
      if (diagnostic.type !== 'diagnostic') return [];
      try {
        if (diagnostic.name === 'normalized_agent_observation_v1') {
          const parsed = NormalizedAgentObservationV1Schema.safeParse(
            diagnostic.observation,
          );
          return parsed.success ? [parsed.data] : [];
        }
        if (diagnostic.name === 'opencode_child_task_candidate') {
          return [adaptOpenCodeTaskCandidateV1({
            candidate: diagnostic as unknown as OpenCodeTaskTerminalCandidate,
            taskExecutionId: task.taskExecutionId,
            runId: run.id,
            taskRunIndex: mapping.taskRunIndex,
            taskRunObservationId: taskRunObservation.identity.observationId,
            stage: mapping.inputStage,
          })];
        }
        if (diagnostic.name === 'vela_opencode_child_agent_lifecycle') {
          return [adaptVelaChildRuntimeFactV1({
            fact: diagnostic as unknown as VelaChildRuntimeFact,
            taskExecutionId: task.taskExecutionId,
            runId: run.id,
            taskRunIndex: mapping.taskRunIndex,
            taskRunObservationId: taskRunObservation.identity.observationId,
            stage: mapping.inputStage,
          })];
        }
        if (diagnostic.name === 'claude_child_runtime_fact') {
          return [adaptClaudeChildRuntimeFactV1({
            fact: diagnostic as unknown as ClaudeChildRuntimeFact,
            taskExecutionId: task.taskExecutionId,
            runId: run.id,
            taskRunIndex: mapping.taskRunIndex,
            taskRunObservationId: taskRunObservation.identity.observationId,
            stage: mapping.inputStage,
          })];
        }
      } catch {
        // Runtime evidence is an optional side channel. Malformed or stale
        // facts lower task coverage; they never block terminal delivery.
      }
      return [];
    });
    return [taskRunObservation, ...childObservations];
  });
  return aggregateStrategyTaskObservations({ task, observations });
}

function nonNetworkResult(reason: string): RunTelemetryDeliveryResult {
  return {
    langfuse_expected: false,
    langfuse_delivery_status: 'not_expected',
    langfuse_drop_reason: reason,
    langfuse_attempt_count: 0,
  };
}

function resultTerminalStatus(result: RunTelemetryDeliveryResult): 'accepted' | 'not_expected' | 'failed' {
  if (result.langfuse_expected === false) return 'not_expected';
  return result.langfuse_delivery_status === 'accepted' ? 'accepted' : 'failed';
}

function resultAttempts(result: RunTelemetryDeliveryResult): number {
  return Number.isSafeInteger(result.langfuse_attempt_count)
    && result.langfuse_attempt_count! >= 0
    ? result.langfuse_attempt_count!
    : result.langfuse_expected === false
      ? 0
      : 1;
}

export function createTaskObservationRolloutService(
  options: CreateTaskObservationRolloutServiceOptions,
): TaskObservationRolloutService {
  migrateTaskObservationRolloutStore(options.db);
  const env = options.env ?? process.env;
  const config = readTaskObservationRolloutConfig(env);
  const now = options.now ?? Date.now;
  const configuredEnv = () => options.configuredEnv?.() ?? {};

  const effectiveSink = (): RunTelemetrySinkConfig | null => {
    const sink = readRunTelemetrySinkConfig(env, configuredEnv());
    return sink ? capSinkRetries(sink) : null;
  };

  const effectiveFallbackSink = (): TelemetrySinkConfig | null => {
    const sink = readTelemetrySinkConfig(env);
    return sink ? capSinkRetries(sink) : null;
  };

  const diagnostic = (): TaskObservationRolloutDiagnostic => {
    const sink = effectiveSink();
    const directExporter = sink?.kind === 'langfuse'
      ? readTaskObservationExporterConfig(env, configuredEnv())
      : null;
    const taskProtocol = sink === null
      ? 'none' as const
      : directExporter?.mode === 'otlp'
        ? 'otlp-v4' as const
        : 'legacy-v1' as const;
    const blockedReason = config.mode !== 'send'
      ? 'mode_not_send' as const
      : config.context === null
        ? 'missing_environment_or_tag' as const
        : sink === null
          ? 'missing_sink' as const
          : null;
    return {
      mode: config.mode,
      environment: config.context?.environment ?? null,
      tag: config.context?.tag ?? null,
      effectiveSink: describeRunTelemetrySink(sink),
      taskProtocol,
      readyToSend: blockedReason === null,
      blockedReason,
    };
  };

  const claimSend = (
    taskExecutionId: string,
    context: TaskObservationExportContextV1,
    recoverCrashWindow: boolean,
  ): { claimed: boolean; row: TaskObservationDeliveryRow } => {
    const claim = options.db.transaction(() => {
      const existing = readDeliveryRow(options.db, taskExecutionId);
      if (existing) {
        return {
          claimed: recoverCrashWindow
            && existing.status === 'in_flight'
            && existing.crashWindow === 1,
          row: existing,
        };
      }
      const at = now();
      options.db.prepare(`
        INSERT INTO strategy_task_observation_delivery (
          task_execution_id, mode, environment, tag,
          aggregate_digest, observation_count, coverage_json,
          status, idempotency_key, attempt_count, crash_window,
          started_at, drop_reason, finalized_at, updated_at
        ) VALUES (?, 'send', ?, ?, NULL, 0, NULL, 'in_flight', ?, 0, 1, ?, NULL, NULL, ?)
      `).run(
        taskExecutionId,
        context.environment,
        context.tag,
        runTelemetryDeliveryIdempotencyKey(taskDeliveryIdentity(taskExecutionId)),
        at,
        at,
      );
      return { claimed: true, row: readDeliveryRow(options.db, taskExecutionId)! };
    });
    return claim.immediate();
  };

  const recordAggregate = (
    taskExecutionId: string,
    aggregate: StrategyTaskObservationAggregateV1,
  ): void => {
    options.db.prepare(`
      UPDATE strategy_task_observation_delivery
         SET aggregate_digest = ?, observation_count = ?, coverage_json = ?, updated_at = ?
       WHERE task_execution_id = ? AND status = 'in_flight'
    `).run(
      aggregateDigest(aggregate),
      aggregate.observations.length,
      JSON.stringify(aggregate.coverage),
      now(),
      taskExecutionId,
    );
  };

  const recordAttempt = (taskExecutionId: string): void => {
    options.db.prepare(`
      UPDATE strategy_task_observation_delivery
         SET attempt_count = attempt_count + 1, updated_at = ?
       WHERE task_execution_id = ? AND status = 'in_flight'
    `).run(now(), taskExecutionId);
  };

  const finalizeDelivery = (
    taskExecutionId: string,
    result: RunTelemetryDeliveryResult,
  ): TaskObservationDeliveryRow => {
    const at = now();
    const status = resultTerminalStatus(result);
    const dropReason = result.langfuse_drop_reason
      ?? (status === 'failed' ? 'network_error' : null);
    options.db.prepare(`
      UPDATE strategy_task_observation_delivery
         SET status = ?,
             attempt_count = MAX(attempt_count, ?),
             crash_window = 0,
             drop_reason = ?,
             finalized_at = ?,
             updated_at = ?
       WHERE task_execution_id = ? AND status = 'in_flight'
    `).run(status, resultAttempts(result), dropReason, at, at, taskExecutionId);
    return readDeliveryRow(options.db, taskExecutionId)!;
  };

  const recordObserved = (
    taskExecutionId: string,
    context: TaskObservationExportContextV1,
    aggregate: StrategyTaskObservationAggregateV1,
  ): void => {
    const at = now();
    options.db.prepare(`
      INSERT INTO strategy_task_observation_delivery (
        task_execution_id, mode, environment, tag,
        aggregate_digest, observation_count, coverage_json,
        status, idempotency_key, attempt_count, crash_window,
        started_at, drop_reason, finalized_at, updated_at
      ) VALUES (?, 'observe', ?, ?, ?, ?, ?, 'observed', NULL, 0, 0, ?, NULL, ?, ?)
      ON CONFLICT(task_execution_id) DO NOTHING
    `).run(
      taskExecutionId,
      context.environment,
      context.tag,
      aggregateDigest(aggregate),
      aggregate.observations.length,
      JSON.stringify(aggregate.coverage),
      at,
      at,
      at,
    );
  };

  const deliver = async (
    aggregate: StrategyTaskObservationAggregateV1,
    context: TaskObservationExportContextV1,
    prefs: TelemetryPrefs,
    installationId: string | null | undefined,
    sink: RunTelemetrySinkConfig,
    idempotencyKey: string,
    onAttempt: () => void,
  ): Promise<TaskObservationDeliveryState | LangfuseDeliveryState> => {
    if (sink.kind === 'langfuse') {
      const direct = readTaskObservationExporterConfig(env, configuredEnv());
      if (direct) {
        return exportTaskObservationAggregate(aggregate, {
          prefs,
          config: { ...direct, retries: Math.min(direct.retries, 1) },
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          deliveryIdempotencyKey: idempotencyKey,
          onDeliveryAttempt: onAttempt,
          context,
        });
      }
    }
    const plan = prepareLegacyTaskObservationExport({
      aggregate,
      prefs,
      hasEffectiveSink: true,
      context,
    });
    if (!plan.expectation.expected) {
      return {
        langfuse_expected: false,
        langfuse_delivery_status: 'not_expected',
        langfuse_drop_reason: plan.expectation.reason,
        langfuse_attempt_count: 0,
      };
    }
    const batch = buildLegacyTaskObservationPayload(aggregate, context);
    if (Buffer.byteLength(JSON.stringify({ batch }), 'utf8') > HARD_BATCH_MAX_BYTES) {
      return {
        langfuse_expected: true,
        langfuse_delivery_status: 'failed',
        langfuse_drop_reason: 'payload_too_large',
        langfuse_attempt_count: 0,
      };
    }
    let attemptCount = 0;
    const result = await postLegacyTelemetryBatch(sink, batch, {
      ...(installationId !== undefined ? { installationId } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      deliveryIdempotencyKey: idempotencyKey,
      fallbackConfig: effectiveFallbackSink(),
      maxTotalAttempts: 2,
      onAttempt: () => {
        attemptCount += 1;
        onAttempt();
      },
    });
    return { ...result, langfuse_attempt_count: attemptCount };
  };

  const finalizeTask = async (
    task: StrategyTaskExecutionRecord,
    recoverCrashWindow = false,
    preparedClaim?: { claimed: boolean; row: TaskObservationDeliveryRow },
  ): Promise<TaskObservationRolloutResult> => {
    if (!TERMINAL_TASK_OUTCOMES.has(task.outcome)) {
      return {
        mode: config.mode,
        action: 'waiting_for_task_terminal',
        taskExecutionId: task.taskExecutionId,
      };
    }
    const context = config.context ?? {
      environment: 'unconfigured',
      tag: 'unconfigured',
    };
    if (config.mode === 'observe') {
      try {
        const aggregate = taskAggregate(task, options.getRun);
        recordObserved(task.taskExecutionId, context, aggregate);
        return { mode: 'observe', action: 'observed', taskExecutionId: task.taskExecutionId };
      } catch {
        return { mode: 'observe', action: 'failed', taskExecutionId: task.taskExecutionId };
      }
    }

    const claim = preparedClaim
      ?? claimSend(task.taskExecutionId, context, recoverCrashWindow);
    if (!claim.claimed) {
      const persisted = deliveryState(claim.row);
      return {
        mode: 'send',
        action: claim.row.status === 'in_flight'
          ? 'already_in_flight'
          : 'already_finalized',
        taskExecutionId: task.taskExecutionId,
        ...(persisted ? { delivery: persisted } : {}),
      };
    }

    let result: RunTelemetryDeliveryResult;
    try {
      const aggregate = taskAggregate(task, options.getRun);
      recordAggregate(task.taskExecutionId, aggregate);
      const telemetry = await options.readTelemetry();
      const sink = effectiveSink();
      const exportContext = recoverCrashWindow
        ? { environment: claim.row.environment, tag: claim.row.tag }
        : config.context;
      if (exportContext === null) {
        result = nonNetworkResult('task_rollout_context_missing');
      } else if (sink === null) {
        result = nonNetworkResult('missing_sink_config');
      } else {
        result = await deliver(
          aggregate,
          exportContext,
          telemetry.prefs,
          telemetry.installationId,
          sink,
          claim.row.idempotencyKey!,
          () => recordAttempt(task.taskExecutionId),
        );
      }
    } catch {
      // An owned claim must terminalize for every ordinary failure. Only a
      // real process death between claim and this catch leaves `in_flight`
      // eligible for startup recovery.
      result = {
        langfuse_expected: true,
        langfuse_delivery_status: 'failed',
        langfuse_drop_reason: 'payload_build_error',
        langfuse_attempt_count: 0,
      };
    }
    const finalized = finalizeDelivery(task.taskExecutionId, result);
    const persisted = deliveryState(finalized)!;
    return {
      mode: 'send',
      action: deliveryAction(persisted),
      taskExecutionId: task.taskExecutionId,
      delivery: persisted,
    };
  };

  const beginFinalizeForRun = (runId: string): TaskObservationFinalizationHandle => {
    if (config.mode === 'off') {
      return {
        durableTaskTruth: false,
        suppressSingleRun: false,
        completion: Promise.resolve({ mode: 'off', action: 'compatibility' }),
      };
    }
    const task = getStrategyTaskExecutionByRunId(options.db, runId);
    if (!task) {
      return {
        durableTaskTruth: false,
        suppressSingleRun: false,
        completion: Promise.resolve({ mode: config.mode, action: 'compatibility' }),
      };
    }
    if (config.mode !== 'send' || !TERMINAL_TASK_OUTCOMES.has(task.outcome)) {
      return {
        durableTaskTruth: false,
        suppressSingleRun: config.mode === 'send',
        completion: finalizeTask(task),
      };
    }
    const context = config.context ?? {
      environment: 'unconfigured',
      tag: 'unconfigured',
    };
    const claim = claimSend(task.taskExecutionId, context, false);
    const observedCompatibility = claim.row.status === 'observed';
    return {
      durableTaskTruth: true,
      suppressSingleRun: !observedCompatibility,
      completion: finalizeTask(task, false, claim),
    };
  };

  return {
    config,
    diagnostic,
    modeForRun(runId) {
      const task = getStrategyTaskExecutionByRunId(options.db, runId);
      if (!task) return 'off';
      // Observe is a permanent compatibility contract: once its legacy
      // single-Run trace may have crossed the network, a later global send
      // rollout cannot reinterpret the task as hierarchy-owned.
      return readDeliveryRow(options.db, task.taskExecutionId)?.status === 'observed'
        ? 'observe'
        : config.mode;
    },
    beginFinalizeForRun,
    finalizeForRun(runId) {
      return beginFinalizeForRun(runId).completion;
    },
    async reconcileCrashWindows() {
      if (config.mode !== 'send') return 0;
      const rows = options.db.prepare(`
        SELECT task_execution_id AS taskExecutionId
          FROM strategy_task_observation_delivery
         WHERE status = 'in_flight' AND crash_window = 1
         ORDER BY started_at ASC, task_execution_id ASC
      `).all() as Array<{ taskExecutionId: string }>;
      let recovered = 0;
      for (const row of rows) {
        const task = getStrategyTaskExecution(options.db, row.taskExecutionId);
        if (!task || !TERMINAL_TASK_OUTCOMES.has(task.outcome)) continue;
        await finalizeTask(task, true);
        recovered += 1;
      }
      return recovered;
    },
  };
}
