import { createHash } from 'node:crypto';

import {
  AppliedStrategyBindingV2Schema,
  OD_NEXT_STRATEGY_ID,
  OpenDesignPlanContractV2Schema,
  StrategyRuntimeStateV2Schema,
  StrategyRuntimeTransitionV2Schema,
  type OpenDesignPlanContractV2,
  type StrategyExecutionModeV2,
  type StrategyInputStageV2,
  type StrategyOutcomeV2,
  type StrategyRouteV2,
} from '@open-design/contracts';
import type Database from 'better-sqlite3';

import { getSnapshot } from '../plugins/snapshots.js';

type SqliteDb = Database.Database;
type DbRow = Record<string, unknown>;

const TASK_STORE_SCHEMA_VERSION = 1 as const;
const TERMINAL_OUTCOMES = new Set<StrategyTaskOutcome>([
  'completed',
  'blocked',
  'canceled',
]);

export type StrategyTaskOutcome = 'running' | StrategyOutcomeV2;

export interface StrategyTaskRunMapping {
  runId: string;
  inputStage: StrategyInputStageV2;
  taskRunIndex: number;
  sourceRunId?: string;
}

export interface StrategyTaskExecutionRecord {
  schemaVersion: typeof TASK_STORE_SCHEMA_VERSION;
  revision: number;
  taskExecutionId: string;
  projectId: string;
  conversationId: string;
  snapshotId: string;
  strategyId: typeof OD_NEXT_STRATEGY_ID;
  strategyVersion: string;
  strategyPackageHash: string;
  selectedAgentId: string;
  route: StrategyRouteV2 | null;
  inputStage: StrategyInputStageV2;
  outcome: StrategyTaskOutcome;
  executionMode: StrategyExecutionModeV2 | null;
  planContract?: OpenDesignPlanContractV2;
  planContractHash?: string;
  clarificationCount: 0 | 1;
  planContractRepairAttempts: 0 | 1;
  initialRunId: string;
  latestRunId: string;
  activeRunId: string | null;
  terminalRunId: string | null;
  runs: StrategyTaskRunMapping[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateStrategyTaskExecutionInput {
  taskExecutionId: string;
  projectId: string;
  conversationId: string;
  snapshotId: string;
  selectedAgentId: string;
  initialRunId: string;
  createdAt?: number;
}

export interface StrategyTaskTransitionState {
  route: StrategyRouteV2;
  inputStage: StrategyInputStageV2;
  outcome: StrategyTaskOutcome;
  executionMode: StrategyExecutionModeV2 | null;
}

export interface CompareAndTransitionStrategyTaskInput {
  taskExecutionId: string;
  expectedRevision: number;
  to: StrategyTaskTransitionState;
  nextRun?: {
    runId: string;
    sourceRunId: string;
  };
  planContract?: OpenDesignPlanContractV2;
  updatedAt?: number;
}

export class InvalidStrategyTaskRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStrategyTaskRecordError';
  }
}

export class InvalidStrategyTaskTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStrategyTaskTransitionError';
  }
}

export class StrategyTaskTransitionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyTaskTransitionConflictError';
  }
}

export function migrateStrategyTaskStore(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_task_executions (
      task_execution_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 0,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      strategy_package_hash TEXT NOT NULL,
      selected_agent_id TEXT NOT NULL,
      route TEXT CHECK (route IN ('direct_edit', 'full_plan')),
      input_stage TEXT NOT NULL CHECK (
        input_stage IN ('request', 'clarification', 'contract_repair', 'production')
      ),
      outcome TEXT NOT NULL CHECK (
        outcome IN (
          'running', 'clarification_required', 'plan_ready',
          'completed', 'blocked', 'canceled'
        )
      ),
      execution_mode TEXT CHECK (execution_mode IN ('simple', 'complex')),
      plan_contract_json TEXT,
      plan_contract_hash TEXT,
      clarification_count INTEGER NOT NULL DEFAULT 0 CHECK (clarification_count BETWEEN 0 AND 1),
      plan_contract_repair_attempts INTEGER NOT NULL DEFAULT 0 CHECK (
        plan_contract_repair_attempts BETWEEN 0 AND 1
      ),
      initial_run_id TEXT NOT NULL,
      latest_run_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(snapshot_id) REFERENCES applied_plugin_snapshots(id)
    );

    CREATE INDEX IF NOT EXISTS idx_strategy_task_executions_project_conversation
      ON strategy_task_executions(project_id, conversation_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS strategy_task_runs (
      task_execution_id TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE,
      input_stage TEXT NOT NULL CHECK (
        input_stage IN ('request', 'clarification', 'contract_repair', 'production')
      ),
      task_run_index INTEGER NOT NULL CHECK (task_run_index >= 0),
      source_run_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(task_execution_id, task_run_index),
      FOREIGN KEY(task_execution_id) REFERENCES strategy_task_executions(task_execution_id)
        ON DELETE CASCADE
    );
  `);
}

export function createStrategyTaskExecution(
  db: SqliteDb,
  input: CreateStrategyTaskExecutionInput,
): StrategyTaskExecutionRecord {
  const taskExecutionId = requireNonEmpty(input.taskExecutionId, 'taskExecutionId');
  const projectId = requireNonEmpty(input.projectId, 'projectId');
  const conversationId = requireNonEmpty(input.conversationId, 'conversationId');
  const snapshotId = requireNonEmpty(input.snapshotId, 'snapshotId');
  const selectedAgentId = requireNonEmpty(input.selectedAgentId, 'selectedAgentId');
  const initialRunId = requireNonEmpty(input.initialRunId, 'initialRunId');
  const now = normalizeTimestamp(input.createdAt ?? Date.now(), 'createdAt');

  const create = db.transaction(() => {
    const conversation = db.prepare(
      `SELECT id FROM conversations WHERE id = ? AND project_id = ?`,
    ).get(conversationId, projectId);
    if (!conversation) {
      throw new InvalidStrategyTaskRecordError(
        'Strategy task conversation must belong to the selected project.',
      );
    }
    assertSnapshotOwnership(db, snapshotId, projectId, conversationId);

    const snapshot = getSnapshot(db, snapshotId);
    const binding = AppliedStrategyBindingV2Schema.safeParse(snapshot?.strategy);
    if (!snapshot || !binding.success || snapshot.pluginId !== OD_NEXT_STRATEGY_ID) {
      throw new InvalidStrategyTaskRecordError(
        'Strategy task creation requires a verified OD Next strategy binding.',
      );
    }
    if (
      snapshot.pluginVersion !== binding.data.version
      || snapshot.snapshotId !== snapshotId
    ) {
      throw new InvalidStrategyTaskRecordError(
        'Strategy task Snapshot identity does not match its verified strategy binding.',
      );
    }

    try {
      db.prepare(`
        INSERT INTO strategy_task_executions (
          task_execution_id, schema_version, revision,
          project_id, conversation_id, snapshot_id,
          strategy_id, strategy_version, strategy_package_hash, selected_agent_id,
          route, input_stage, outcome, execution_mode,
          plan_contract_json, plan_contract_hash,
          clarification_count, plan_contract_repair_attempts,
          initial_run_id, latest_run_id, created_at, updated_at
        ) VALUES (?, 1, 0, ?, ?, ?, ?, ?, ?, ?, NULL, 'request', 'running', NULL,
                  NULL, NULL, 0, 0, ?, ?, ?, ?)
      `).run(
        taskExecutionId,
        projectId,
        conversationId,
        snapshotId,
        binding.data.id,
        binding.data.version,
        binding.data.packageHash,
        selectedAgentId,
        initialRunId,
        initialRunId,
        now,
        now,
      );
      db.prepare(`
        INSERT INTO strategy_task_runs (
          task_execution_id, run_id, input_stage, task_run_index, source_run_id, created_at
        ) VALUES (?, ?, 'request', 0, NULL, ?)
      `).run(taskExecutionId, initialRunId, now);
      // A StrategyTaskExecution is itself a durable Snapshot reference. Keep
      // run_id untouched because one task owns a chain of physical Runs, but
      // clear the unreferenced-row TTL in the same transaction that installs
      // the foreign-key reference.
      db.prepare(`
        UPDATE applied_plugin_snapshots SET expires_at = NULL WHERE id = ?
      `).run(snapshotId);
    } catch (error) {
      throw new InvalidStrategyTaskRecordError(
        `Strategy task identity or initial Run is already bound: ${errorMessage(error)}`,
      );
    }
  });
  create.immediate();
  return requireTask(db, taskExecutionId);
}

export function getStrategyTaskExecution(
  db: SqliteDb,
  taskExecutionId: string,
): StrategyTaskExecutionRecord | null {
  const row = db.prepare(`
    SELECT * FROM strategy_task_executions WHERE task_execution_id = ?
  `).get(taskExecutionId) as DbRow | undefined;
  return row ? rowToTask(db, row) : null;
}

export function getStrategyTaskExecutionByRunId(
  db: SqliteDb,
  runId: string,
): StrategyTaskExecutionRecord | null {
  const row = db.prepare(`
    SELECT execution.*
      FROM strategy_task_runs AS mapping
      JOIN strategy_task_executions AS execution
        ON execution.task_execution_id = mapping.task_execution_id
     WHERE mapping.run_id = ?
  `).get(runId) as DbRow | undefined;
  return row ? rowToTask(db, row) : null;
}

export function getAwaitingClarificationStrategyTaskExecution(
  db: SqliteDb,
  input: { projectId: string; conversationId: string },
): StrategyTaskExecutionRecord | null {
  try {
    const rows = db.prepare(`
      SELECT * FROM strategy_task_executions
       WHERE project_id = ? AND conversation_id = ?
         AND route = 'full_plan'
         AND input_stage = 'request'
         AND outcome = 'clarification_required'
       ORDER BY updated_at DESC, task_execution_id ASC
       LIMIT 2
    `).all(input.projectId, input.conversationId) as DbRow[];
    // Ambiguous active ownership is fail-closed. A continuation must never be
    // guessed onto one of two logical tasks sharing a conversation.
    if (rows.length > 1) {
      throw new InvalidStrategyTaskRecordError(
        'Conversation has multiple strategy tasks awaiting clarification.',
      );
    }
    return rows.length === 1 ? rowToTask(db, rows[0]!) : null;
  } catch (error) {
    if (isMissingTaskStoreError(error)) return null;
    throw error;
  }
}

export function compareAndTransitionStrategyTaskExecution(
  db: SqliteDb,
  input: CompareAndTransitionStrategyTaskInput,
): StrategyTaskExecutionRecord {
  const updatedAt = normalizeTimestamp(input.updatedAt ?? Date.now(), 'updatedAt');
  const transition = db.transaction(() => {
    const current = requireTask(db, input.taskExecutionId);
    if (current.revision !== input.expectedRevision) {
      throw new StrategyTaskTransitionConflictError(
        `Strategy task revision changed from ${input.expectedRevision} to ${current.revision}.`,
      );
    }
    if (TERMINAL_OUTCOMES.has(current.outcome)) {
      throw new InvalidStrategyTaskTransitionError(
        `Strategy task terminal outcome ${current.outcome} is sticky.`,
      );
    }
    if (updatedAt < current.updatedAt) {
      throw new InvalidStrategyTaskTransitionError(
        'Strategy task updatedAt cannot move backward.',
      );
    }

    const next = validateTransition(current, input);
    const plan = resolvePlanContract(current, input.planContract, next);
    const nextRunId = input.nextRun?.runId ?? current.latestRunId;
    const nextRunIndex = current.runs.length;
    const clarificationCount = current.clarificationCount
      + (next.inputStage === 'clarification' && current.inputStage !== 'clarification' ? 1 : 0);
    const repairAttempts = current.planContractRepairAttempts
      + (next.inputStage === 'contract_repair' && current.inputStage !== 'contract_repair' ? 1 : 0);
    if (clarificationCount > 1) {
      throw new InvalidStrategyTaskTransitionError(
        'Strategy tasks allow exactly one clarification stage at most.',
      );
    }
    if (repairAttempts > 1) {
      throw new InvalidStrategyTaskTransitionError(
        'Strategy tasks allow exactly one Plan Contract repair stage at most.',
      );
    }

    const result = db.prepare(`
      UPDATE strategy_task_executions
         SET revision = revision + 1,
             route = ?, input_stage = ?, outcome = ?, execution_mode = ?,
             plan_contract_json = ?, plan_contract_hash = ?,
             clarification_count = ?, plan_contract_repair_attempts = ?,
             latest_run_id = ?, updated_at = ?
       WHERE task_execution_id = ? AND revision = ?
    `).run(
      next.route,
      next.inputStage,
      next.outcome,
      next.executionMode,
      plan.json,
      plan.hash,
      clarificationCount,
      repairAttempts,
      nextRunId,
      updatedAt,
      current.taskExecutionId,
      input.expectedRevision,
    );
    if (result.changes !== 1) {
      throw new StrategyTaskTransitionConflictError(
        'Strategy task revision changed while applying the transition.',
      );
    }

    if (input.nextRun) {
      try {
        db.prepare(`
          INSERT INTO strategy_task_runs (
            task_execution_id, run_id, input_stage, task_run_index, source_run_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          current.taskExecutionId,
          requireNonEmpty(input.nextRun.runId, 'nextRun.runId'),
          next.inputStage,
          nextRunIndex,
          requireNonEmpty(input.nextRun.sourceRunId, 'nextRun.sourceRunId'),
          updatedAt,
        );
      } catch (error) {
        throw new StrategyTaskTransitionConflictError(
          `Strategy next Run is already claimed: ${errorMessage(error)}`,
        );
      }
    }
  });
  transition.immediate();
  return requireTask(db, input.taskExecutionId);
}

export function cancelStrategyTaskExecution(
  db: SqliteDb,
  input: {
    taskExecutionId: string;
    expectedRevision: number;
    updatedAt?: number;
  },
): StrategyTaskExecutionRecord {
  const updatedAt = normalizeTimestamp(input.updatedAt ?? Date.now(), 'updatedAt');
  const cancel = db.transaction(() => {
    const current = requireTask(db, input.taskExecutionId);
    if (current.revision !== input.expectedRevision) {
      throw new StrategyTaskTransitionConflictError(
        `Strategy task revision changed from ${input.expectedRevision} to ${current.revision}.`,
      );
    }
    if (TERMINAL_OUTCOMES.has(current.outcome)) {
      throw new InvalidStrategyTaskTransitionError(
        `Strategy task terminal outcome ${current.outcome} is sticky.`,
      );
    }
    if (updatedAt < current.updatedAt) {
      throw new InvalidStrategyTaskTransitionError(
        'Strategy task updatedAt cannot move backward.',
      );
    }
    const result = db.prepare(`
      UPDATE strategy_task_executions
         SET revision = revision + 1, outcome = 'canceled', updated_at = ?
       WHERE task_execution_id = ? AND revision = ?
         AND outcome NOT IN ('completed', 'blocked', 'canceled')
    `).run(updatedAt, current.taskExecutionId, input.expectedRevision);
    if (result.changes !== 1) {
      throw new StrategyTaskTransitionConflictError(
        'Strategy task changed while applying cancellation.',
      );
    }
  });
  cancel.immediate();
  return requireTask(db, input.taskExecutionId);
}

/**
 * Converge a logical task after startup reconciles its latest physical Run.
 * Successful Runs still require Coordinator-owned protocol interpretation, so
 * this narrow bridge only maps process failure -> blocked and cancellation ->
 * canceled. Databases without Task06 tables are intentionally a no-op.
 */
export function reconcileStrategyTaskRunTerminal(
  db: SqliteDb,
  input: {
    runId: string;
    status: 'failed' | 'canceled';
    updatedAt?: number;
  },
): boolean {
  try {
    const reconcile = db.transaction(() => {
      const current = getStrategyTaskExecutionByRunId(db, input.runId);
      if (
        !current
        || current.latestRunId !== input.runId
        || current.outcome !== 'running'
      ) {
        return false;
      }
      const result = db.prepare(`
        UPDATE strategy_task_executions
           SET revision = revision + 1, outcome = ?, updated_at = ?
         WHERE task_execution_id = ? AND revision = ?
           AND latest_run_id = ? AND outcome = 'running'
      `).run(
        input.status === 'canceled' ? 'canceled' : 'blocked',
        Math.max(
          current.updatedAt,
          normalizeTimestamp(input.updatedAt ?? Date.now(), 'updatedAt'),
        ),
        current.taskExecutionId,
        current.revision,
        input.runId,
      );
      return result.changes === 1;
    });
    return reconcile.immediate();
  } catch (error) {
    if (isMissingTaskStoreError(error)) return false;
    throw error;
  }
}

function requireTask(db: SqliteDb, taskExecutionId: string): StrategyTaskExecutionRecord {
  const task = getStrategyTaskExecution(db, taskExecutionId);
  if (!task) {
    throw new InvalidStrategyTaskRecordError(
      `Unknown strategy task execution ${taskExecutionId}.`,
    );
  }
  return task;
}

function rowToTask(db: SqliteDb, row: DbRow): StrategyTaskExecutionRecord {
  if (row['schema_version'] !== TASK_STORE_SCHEMA_VERSION) {
    throw new InvalidStrategyTaskRecordError('Unsupported strategy task schema version.');
  }
  const taskExecutionId = requireStoredString(row['task_execution_id'], 'task_execution_id');
  const projectId = requireStoredString(row['project_id'], 'project_id');
  const conversationId = requireStoredString(row['conversation_id'], 'conversation_id');
  const snapshotId = requireStoredString(row['snapshot_id'], 'snapshot_id');
  const strategyId = requireStoredString(row['strategy_id'], 'strategy_id');
  const strategyVersion = requireStoredString(row['strategy_version'], 'strategy_version');
  const strategyPackageHash = requireStoredString(
    row['strategy_package_hash'],
    'strategy_package_hash',
  );
  const conversation = db.prepare(
    `SELECT id FROM conversations WHERE id = ? AND project_id = ?`,
  ).get(conversationId, projectId);
  if (!conversation) {
    throw new InvalidStrategyTaskRecordError(
      'Persisted strategy task conversation no longer belongs to its project.',
    );
  }
  assertSnapshotOwnership(db, snapshotId, projectId, conversationId);
  const snapshot = getSnapshot(db, snapshotId);
  const binding = AppliedStrategyBindingV2Schema.safeParse(snapshot?.strategy);
  if (
    !snapshot
    || !binding.success
    || snapshot.pluginId !== OD_NEXT_STRATEGY_ID
    || snapshot.pluginVersion !== binding.data.version
    || snapshot.snapshotId !== snapshotId
    || strategyId !== binding.data.id
    || strategyVersion !== binding.data.version
    || strategyPackageHash !== binding.data.packageHash
  ) {
    throw new InvalidStrategyTaskRecordError(
      'Persisted strategy task identity no longer matches its verified Snapshot binding.',
    );
  }

  const route = parseNullableRoute(row['route']);
  const inputStage = parseStage(row['input_stage']);
  const outcome = parseOutcome(row['outcome']);
  const executionMode = parseNullableExecutionMode(row['execution_mode']);
  validateStoredState({ route, inputStage, outcome, executionMode });
  const plan = parseStoredPlanContract(row['plan_contract_json'], row['plan_contract_hash']);
  if (
    (inputStage === 'production' || outcome === 'plan_ready')
    && (!plan.contract || !plan.hash)
  ) {
    throw new InvalidStrategyTaskRecordError(
      'Production and plan-ready records require a versioned, hash-bound Plan Contract.',
    );
  }
  if (plan.contract) {
    validatePlanIdentity(
      plan.contract,
      {
        snapshotId,
        strategyVersion,
        strategyPackageHash,
        selectedAgentId: requireStoredString(row['selected_agent_id'], 'selected_agent_id'),
      },
      executionMode,
    );
  }

  const runs = db.prepare(`
    SELECT run_id AS runId, input_stage AS inputStage,
           task_run_index AS taskRunIndex, source_run_id AS sourceRunId,
           created_at AS createdAt
      FROM strategy_task_runs
     WHERE task_execution_id = ?
     ORDER BY task_run_index ASC
  `).all(taskExecutionId) as Array<{
    runId: unknown;
    inputStage: unknown;
    taskRunIndex: unknown;
    sourceRunId: unknown;
    createdAt: unknown;
  }>;
  const createdAt = requireNonNegativeInteger(row['created_at'], 'created_at');
  const updatedAt = requireNonNegativeInteger(row['updated_at'], 'updated_at');
  if (updatedAt < createdAt) {
    throw new InvalidStrategyTaskRecordError(
      'Strategy task updated_at cannot precede created_at.',
    );
  }
  let previousMappingCreatedAt = createdAt;
  const mappings = runs.map((mapping, index): StrategyTaskRunMapping => {
    const taskRunIndex = requireNonNegativeInteger(mapping.taskRunIndex, 'task_run_index');
    if (taskRunIndex !== index) {
      throw new InvalidStrategyTaskRecordError(
        'Strategy task Run indices must be contiguous from zero.',
      );
    }
    const mappingCreatedAt = requireNonNegativeInteger(mapping.createdAt, 'run.created_at');
    if (mappingCreatedAt < previousMappingCreatedAt || mappingCreatedAt > updatedAt) {
      throw new InvalidStrategyTaskRecordError(
        'Strategy task Run mapping timestamps must be monotonic within the task lifetime.',
      );
    }
    previousMappingCreatedAt = mappingCreatedAt;
    return {
      runId: requireStoredString(mapping.runId, 'run_id'),
      inputStage: parseStage(mapping.inputStage),
      taskRunIndex,
      ...(mapping.sourceRunId == null
        ? {}
        : { sourceRunId: requireStoredString(mapping.sourceRunId, 'source_run_id') }),
    };
  });
  const initialRunId = requireStoredString(row['initial_run_id'], 'initial_run_id');
  const latestRunId = requireStoredString(row['latest_run_id'], 'latest_run_id');
  if (
    mappings.length === 0
    || mappings[0]?.runId !== initialRunId
    || mappings.at(-1)?.runId !== latestRunId
    || mappings.at(-1)?.inputStage !== inputStage
  ) {
    throw new InvalidStrategyTaskRecordError(
      'Strategy task Run mapping does not match its initial/latest identity.',
    );
  }

  const clarificationCount = requireBoundedCount(
    row['clarification_count'],
    'clarification_count',
  );
  const planContractRepairAttempts = requireBoundedCount(
    row['plan_contract_repair_attempts'],
    'plan_contract_repair_attempts',
  );
  validateRunChain(
    mappings,
    route,
    inputStage,
    clarificationCount,
    planContractRepairAttempts,
  );
  return {
    schemaVersion: TASK_STORE_SCHEMA_VERSION,
    revision: requireNonNegativeInteger(row['revision'], 'revision'),
    taskExecutionId,
    projectId,
    conversationId,
    snapshotId,
    strategyId: OD_NEXT_STRATEGY_ID,
    strategyVersion,
    strategyPackageHash,
    selectedAgentId: requireStoredString(row['selected_agent_id'], 'selected_agent_id'),
    route,
    inputStage,
    outcome,
    executionMode,
    ...(plan.contract ? { planContract: plan.contract } : {}),
    ...(plan.hash ? { planContractHash: plan.hash } : {}),
    clarificationCount,
    planContractRepairAttempts,
    initialRunId,
    latestRunId,
    activeRunId: outcome === 'running' ? latestRunId : null,
    terminalRunId: TERMINAL_OUTCOMES.has(outcome) ? latestRunId : null,
    runs: mappings,
    createdAt,
    updatedAt,
  };
}

function assertSnapshotOwnership(
  db: SqliteDb,
  snapshotId: string,
  projectId: string,
  conversationId: string,
): void {
  const owner = db.prepare(`
    SELECT project_id AS projectId, conversation_id AS conversationId
      FROM applied_plugin_snapshots WHERE id = ?
  `).get(snapshotId) as { projectId?: unknown; conversationId?: unknown } | undefined;
  if (
    owner?.projectId !== projectId
    || owner.conversationId !== conversationId
  ) {
    throw new InvalidStrategyTaskRecordError(
      'Strategy task project/conversation must exactly match the locked Snapshot owner.',
    );
  }
}

function validateRunChain(
  mappings: StrategyTaskRunMapping[],
  route: StrategyRouteV2 | null,
  currentStage: StrategyInputStageV2,
  clarificationCount: 0 | 1,
  repairCount: 0 | 1,
): void {
  if (mappings.length === 0 || mappings[0]?.inputStage !== 'request') {
    throw new InvalidStrategyTaskRecordError(
      'A strategy task Run chain must start with the request stage.',
    );
  }
  if (mappings[0]?.sourceRunId !== undefined) {
    throw new InvalidStrategyTaskRecordError(
      'The initial strategy task Run cannot have a source Run.',
    );
  }
  const allowed = new Set([
    'request:clarification',
    'request:contract_repair',
    'request:production',
    'clarification:contract_repair',
    'clarification:production',
    'contract_repair:production',
  ]);
  for (let index = 1; index < mappings.length; index += 1) {
    const previous = mappings[index - 1];
    const current = mappings[index];
    if (!previous || !current) {
      throw new InvalidStrategyTaskRecordError('Strategy task Run mapping is incomplete.');
    }
    if (current.sourceRunId !== previous.runId) {
      throw new InvalidStrategyTaskRecordError(
        'Each strategy task Run must source the immediately preceding Run.',
      );
    }
    if (!allowed.has(`${previous.inputStage}:${current.inputStage}`)) {
      throw new InvalidStrategyTaskRecordError(
        'Strategy task Run stages must be ordered and cannot repeat or move backward.',
      );
    }
  }
  const clarificationMappings = mappings.filter(
    (mapping) => mapping.inputStage === 'clarification',
  ).length;
  const repairMappings = mappings.filter(
    (mapping) => mapping.inputStage === 'contract_repair',
  ).length;
  if (
    clarificationMappings !== clarificationCount
    || repairMappings !== repairCount
  ) {
    throw new InvalidStrategyTaskRecordError(
      'Strategy task clarification/repair counts must match the physical Run chain.',
    );
  }
  if (mappings.at(-1)?.inputStage !== currentStage) {
    throw new InvalidStrategyTaskRecordError(
      'Strategy task current stage must match its latest Run mapping.',
    );
  }
  if (route === 'direct_edit' && (
    mappings.length !== 1
    || mappings[0]?.inputStage !== 'request'
  )) {
    throw new InvalidStrategyTaskRecordError(
      'Direct Edit can only own its single request Run.',
    );
  }
  if (route === null && mappings.length !== 1) {
    throw new InvalidStrategyTaskRecordError(
      'An unrouted strategy task cannot own a next Run.',
    );
  }
}

function validateTransition(
  current: StrategyTaskExecutionRecord,
  input: CompareAndTransitionStrategyTaskInput,
): StrategyTaskTransitionState {
  const next = input.to;
  if (current.route && current.route !== next.route) {
    throw new InvalidStrategyTaskTransitionError('Strategy route is locked for the task chain.');
  }
  if (
    current.executionMode
    && current.executionMode !== next.executionMode
  ) {
    throw new InvalidStrategyTaskTransitionError(
      'Strategy execution mode is locked once selected.',
    );
  }
  if (next.route === 'direct_edit') {
    if (
      next.inputStage !== 'request'
      || next.executionMode !== 'simple'
      || input.nextRun
    ) {
      throw new InvalidStrategyTaskTransitionError(
        'Direct Edit is request-only, simple, and cannot create a next Run.',
      );
    }
  }
  if (
    next.inputStage === 'clarification'
    && current.inputStage !== 'clarification'
    && next.executionMode !== null
  ) {
    throw new InvalidStrategyTaskTransitionError(
      'Clarification must be entered before execution mode is locked.',
    );
  }
  if (
    (next.inputStage === 'contract_repair' || next.inputStage === 'production')
    && next.executionMode === null
  ) {
    throw new InvalidStrategyTaskTransitionError(
      `${next.inputStage} requires a locked execution mode.`,
    );
  }

  const changesStage = next.inputStage !== current.inputStage;
  if (changesStage) {
    if (!input.nextRun || next.outcome !== 'running') {
      throw new InvalidStrategyTaskTransitionError(
        'A physical-stage change must atomically claim one running next Run.',
      );
    }
    if (input.nextRun.sourceRunId !== current.latestRunId) {
      throw new InvalidStrategyTaskTransitionError(
        'The next Run source must be the task chain latest Run.',
      );
    }
    const transition = StrategyRuntimeTransitionV2Schema.safeParse({
      from: {
        route: current.route ?? next.route,
        inputStage: current.inputStage,
        executionMode: current.executionMode,
      },
      to: {
        route: next.route,
        inputStage: next.inputStage,
        executionMode: next.executionMode,
      },
    });
    if (!transition.success) {
      throw new InvalidStrategyTaskTransitionError(
        transition.error.issues[0]?.message ?? 'Illegal strategy physical-stage transition.',
      );
    }
  } else if (input.nextRun) {
    throw new InvalidStrategyTaskTransitionError(
      'A next Run must advance to a different physical stage.',
    );
  }

  if (next.outcome !== 'running') {
    const state = StrategyRuntimeStateV2Schema.safeParse({
      schema: 'open-design.strategy-state/v2',
      route: next.route,
      inputStage: next.inputStage,
      outcome: next.outcome,
      executionMode: next.executionMode,
      reasonCodes: [],
    });
    if (!state.success) {
      throw new InvalidStrategyTaskTransitionError(
        state.error.issues[0]?.message ?? 'Illegal strategy task outcome.',
      );
    }
  }
  return next;
}

function resolvePlanContract(
  current: StrategyTaskExecutionRecord,
  candidate: OpenDesignPlanContractV2 | undefined,
  next: StrategyTaskTransitionState,
): { json: string | null; hash: string | null } {
  let contract = current.planContract;
  let hash = current.planContractHash;
  if (candidate) {
    const parsed = OpenDesignPlanContractV2Schema.safeParse(candidate);
    if (!parsed.success) {
      throw new InvalidStrategyTaskTransitionError(
        parsed.error.issues[0]?.message ?? 'Plan Contract is invalid.',
      );
    }
    validatePlanIdentity(parsed.data, current, next.executionMode);
    const candidateHash = strategyPlanContractHash(parsed.data);
    if (hash && hash !== candidateHash) {
      throw new InvalidStrategyTaskTransitionError(
        'The locked Plan Contract hash cannot change.',
      );
    }
    contract = parsed.data;
    hash = candidateHash;
  }
  if (next.inputStage === 'production' && (!contract || !hash)) {
    throw new InvalidStrategyTaskTransitionError(
      'Production requires a versioned, hash-bound Plan Contract.',
    );
  }
  if (next.outcome === 'plan_ready' && (!contract || !hash)) {
    throw new InvalidStrategyTaskTransitionError(
      'A plan-ready task requires a versioned, hash-bound Plan Contract.',
    );
  }
  return {
    json: contract ? JSON.stringify(contract) : null,
    hash: hash ?? null,
  };
}

function validatePlanIdentity(
  plan: OpenDesignPlanContractV2,
  identity: {
    snapshotId: string;
    strategyVersion: string;
    strategyPackageHash: string;
    selectedAgentId: string;
  },
  executionMode: StrategyExecutionModeV2 | null,
): void {
  if (
    plan.strategy.snapshotId !== identity.snapshotId
    || plan.strategy.version !== identity.strategyVersion
    || plan.strategy.packageHash !== identity.strategyPackageHash
  ) {
    throw new InvalidStrategyTaskTransitionError(
      'Plan Contract strategy identity must match the locked Snapshot.',
    );
  }
  if (plan.runManifest.selectedAgentId !== identity.selectedAgentId) {
    throw new InvalidStrategyTaskTransitionError(
      'Plan Contract selected agent must match the locked task agent.',
    );
  }
  if (executionMode === null || plan.fullPlan.executionMode !== executionMode) {
    throw new InvalidStrategyTaskTransitionError(
      'Plan Contract execution mode must match the locked task mode.',
    );
  }
}

function parseStoredPlanContract(
  json: unknown,
  hash: unknown,
): { contract?: OpenDesignPlanContractV2; hash?: string } {
  if (json == null && hash == null) return {};
  if (typeof json !== 'string' || typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) {
    throw new InvalidStrategyTaskRecordError(
      'Stored Plan Contract JSON and hash must be present together.',
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new InvalidStrategyTaskRecordError('Stored Plan Contract contains invalid JSON.');
  }
  const parsed = OpenDesignPlanContractV2Schema.safeParse(value);
  if (!parsed.success || strategyPlanContractHash(parsed.data) !== hash) {
    throw new InvalidStrategyTaskRecordError(
      'Stored Plan Contract failed schema or hash validation.',
    );
  }
  return { contract: parsed.data, hash };
}

export function strategyPlanContractHash(plan: OpenDesignPlanContractV2): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJsonValue(plan)), 'utf8')
    .digest('hex');
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalJsonValue(child)]),
    );
  }
  return value;
}

function validateStoredState(state: {
  route: StrategyRouteV2 | null;
  inputStage: StrategyInputStageV2;
  outcome: StrategyTaskOutcome;
  executionMode: StrategyExecutionModeV2 | null;
}): void {
  if (state.route === null) {
    if (
      state.inputStage !== 'request'
      || state.executionMode !== null
      || !['running', 'canceled', 'blocked'].includes(state.outcome)
    ) {
      throw new InvalidStrategyTaskRecordError(
        'An unlocked route is valid only for an initial request before routing.',
      );
    }
    return;
  }
  if (state.outcome === 'running') {
    if (state.route === 'direct_edit') {
      if (state.inputStage !== 'request' || state.executionMode !== 'simple') {
        throw new InvalidStrategyTaskRecordError(
          'A running Direct Edit must remain request/simple.',
        );
      }
    } else if (
      (state.inputStage === 'contract_repair' || state.inputStage === 'production')
      && state.executionMode === null
    ) {
      throw new InvalidStrategyTaskRecordError(
        'A running repair/production stage requires a locked execution mode.',
      );
    }
    return;
  }
  const parsed = StrategyRuntimeStateV2Schema.safeParse({
    schema: 'open-design.strategy-state/v2',
    route: state.route,
    inputStage: state.inputStage,
    outcome: state.outcome,
    executionMode: state.executionMode,
    reasonCodes: [],
  });
  if (!parsed.success) {
    throw new InvalidStrategyTaskRecordError(
      parsed.error.issues[0]?.message ?? 'Persisted strategy task state is invalid.',
    );
  }
}

function parseNullableRoute(value: unknown): StrategyRouteV2 | null {
  if (value == null) return null;
  if (value === 'direct_edit' || value === 'full_plan') return value;
  throw new InvalidStrategyTaskRecordError('Stored strategy route is invalid.');
}

function parseStage(value: unknown): StrategyInputStageV2 {
  if (
    value === 'request'
    || value === 'clarification'
    || value === 'contract_repair'
    || value === 'production'
  ) return value;
  throw new InvalidStrategyTaskRecordError('Stored strategy input stage is invalid.');
}

function parseOutcome(value: unknown): StrategyTaskOutcome {
  if (
    value === 'running'
    || value === 'clarification_required'
    || value === 'plan_ready'
    || value === 'completed'
    || value === 'blocked'
    || value === 'canceled'
  ) return value;
  throw new InvalidStrategyTaskRecordError('Stored strategy outcome is invalid.');
}

function parseNullableExecutionMode(value: unknown): StrategyExecutionModeV2 | null {
  if (value == null) return null;
  if (value === 'simple' || value === 'complex') return value;
  throw new InvalidStrategyTaskRecordError('Stored strategy execution mode is invalid.');
}

function requireBoundedCount(value: unknown, field: string): 0 | 1 {
  if (value === 0 || value === 1) return value;
  throw new InvalidStrategyTaskRecordError(`${field} must be zero or one.`);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new InvalidStrategyTaskRecordError(`${field} must be a non-negative integer.`);
}

function normalizeTimestamp(value: number, field: string): number {
  if (Number.isInteger(value) && value >= 0) return value;
  throw new InvalidStrategyTaskRecordError(`${field} must be a non-negative integer.`);
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InvalidStrategyTaskRecordError(`${field} must not be empty.`);
  return normalized;
}

function requireStoredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidStrategyTaskRecordError(`${field} must contain a non-empty string.`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingTaskStoreError(error: unknown): boolean {
  return error instanceof Error
    && /no such table: strategy_task_(?:executions|runs)/iu.test(error.message);
}
