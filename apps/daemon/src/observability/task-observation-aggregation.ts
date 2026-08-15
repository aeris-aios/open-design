import { createHash } from 'node:crypto';

import {
  NormalizedAgentObservationV1Schema,
  normalizeAgentObservationV1,
  type NormalizedAgentObservationKindV1,
  type NormalizedAgentObservationStatusV1,
  type NormalizedAgentObservationV1,
  type ObservationUsageValuesV1,
  type PromptBoundaryEvidenceV1,
  type StrategyInputStageV2,
} from '@open-design/contracts';
import type Database from 'better-sqlite3';

import type { TelemetryPrefs } from '../app-config.js';
import { getSnapshot } from '../plugins/snapshots.js';
import {
  getStrategyTaskExecution,
  type StrategyTaskExecutionRecord,
  type StrategyTaskOutcome,
} from '../strategies/task-store.js';
import {
  deriveRunTelemetryExportExpectation,
  type RunTelemetryExportExpectation,
} from './run-exporter.js';

const STAGE_ORDER: readonly StrategyInputStageV2[] = [
  'request',
  'clarification',
  'contract_repair',
  'production',
];
const KIND_ORDER: Readonly<Record<NormalizedAgentObservationKindV1, number>> = {
  task_run: 0,
  child_agent: 1,
  model_call: 2,
  tool: 3,
};
const TERMINAL_OBSERVATION_STATUSES = new Set<NormalizedAgentObservationStatusV1>([
  'completed',
  'failed',
  'canceled',
]);

export interface TaskObservationCoverageV1 {
  runs: {
    availability: 'complete' | 'partial';
    expected: number;
    observed: number;
    missingRunIds: string[];
  };
  children: {
    availability: 'complete' | 'partial' | 'unavailable';
    knownObservationCount: number;
  };
  prompt: ObservationAvailabilityCountsV1;
  usage: ObservationAvailabilityCountsV1;
  timing: ObservationAvailabilityCountsV1;
}

export interface ObservationAvailabilityCountsV1 {
  complete: number;
  partial: number;
  unavailable: number;
}

export interface KnownUsageSummaryV1 extends ObservationAvailabilityCountsV1 {
  observedObservationCount: number;
  values?: Partial<ObservationUsageValuesV1>;
}

export interface TaskObservationStageTotalV1 {
  stage: StrategyInputStageV2;
  runCount: number;
  runStatuses: NormalizedAgentObservationStatusV1[];
  knownMainRunUsage: KnownUsageSummaryV1;
  knownChildUsage: KnownUsageSummaryV1;
}

export interface StrategyTaskObservationRootV1 {
  observationId: string;
  taskExecutionId: string;
  status: StrategyTaskOutcome;
  route: StrategyTaskExecutionRecord['route'];
  executionMode: StrategyTaskExecutionRecord['executionMode'];
  taskType: string | null;
  strategyId: StrategyTaskExecutionRecord['strategyId'];
  strategyVersion: string;
  strategyPackageHash: string;
  snapshotId: string;
  planContractHash: string | null;
  selectedAgentId: string;
  createdAt: number;
  updatedAt: number;
}

export interface StrategyTaskObservationAggregateV1 {
  schema: 'open-design.strategy-task-observation/v1';
  root: StrategyTaskObservationRootV1;
  observations: NormalizedAgentObservationV1[];
  coverage: TaskObservationCoverageV1;
  stageTotals: TaskObservationStageTotalV1[];
  limitations: string[];
}

export interface LegacyTaskObservationExportPlan {
  expectation: RunTelemetryExportExpectation;
  batch: unknown[];
}

export interface TaskObservationExportContextV1 {
  environment: string;
  tag: string;
}

export class InvalidTaskObservationAggregateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaskObservationAggregateError';
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function strategyTaskRootObservationId(taskExecutionId: string): string {
  return `strategy-task:${taskExecutionId}`;
}

export function strategyTaskRunObservationId(
  taskExecutionId: string,
  runId: string,
): string {
  return `task-run:${taskExecutionId}:${runId}`;
}

function stableLegacyEventId(type: string, bodyId: string): string {
  return `od-${createHash('sha256')
    .update(`open-design/task-observation-legacy/v1\n${type}\n${bodyId}`, 'utf8')
    .digest('hex')}`;
}

function ensureTaskMapping(task: StrategyTaskExecutionRecord): void {
  for (const [index, mapping] of task.runs.entries()) {
    if (mapping.taskRunIndex !== index) {
      throw new InvalidTaskObservationAggregateError(
        `Task Run mapping ${mapping.runId} has non-contiguous taskRunIndex.`,
      );
    }
  }
}

function sameIdentity(
  left: NormalizedAgentObservationV1,
  right: NormalizedAgentObservationV1,
): boolean {
  return left.kind === right.kind &&
    left.stage === right.stage &&
    left.identity.taskExecutionId === right.identity.taskExecutionId &&
    left.identity.runId === right.identity.runId &&
    left.identity.taskRunIndex === right.identity.taskRunIndex &&
    left.identity.parentObservationId === right.identity.parentObservationId &&
    left.identity.runtimeSessionId === right.identity.runtimeSessionId;
}

function mergeObservationLifecycle(
  facts: readonly NormalizedAgentObservationV1[],
): NormalizedAgentObservationV1[] {
  const byId = new Map<string, NormalizedAgentObservationV1>();
  for (const fact of facts) {
    const current = byId.get(fact.identity.observationId);
    if (!current) {
      byId.set(fact.identity.observationId, fact);
      continue;
    }
    if (!sameIdentity(current, fact)) {
      throw new InvalidTaskObservationAggregateError(
        `Observation ${fact.identity.observationId} changed immutable identity.`,
      );
    }
    if (
      TERMINAL_OBSERVATION_STATUSES.has(current.status) &&
      current.status !== fact.status
    ) {
      throw new InvalidTaskObservationAggregateError(
        `Observation ${fact.identity.observationId} changed terminal status.`,
      );
    }
    byId.set(fact.identity.observationId, fact);
  }
  return [...byId.values()];
}

function validateFactAgainstTask(
  task: StrategyTaskExecutionRecord,
  fact: NormalizedAgentObservationV1,
): void {
  const mapping = task.runs.find((run) => run.runId === fact.identity.runId);
  if (!mapping) {
    throw new InvalidTaskObservationAggregateError(
      `Observation ${fact.identity.observationId} references an unmapped Run.`,
    );
  }
  if (
    fact.identity.taskExecutionId !== task.taskExecutionId ||
    fact.identity.taskRunIndex !== mapping.taskRunIndex ||
    fact.stage !== mapping.inputStage
  ) {
    throw new InvalidTaskObservationAggregateError(
      `Observation ${fact.identity.observationId} conflicts with the durable task mapping.`,
    );
  }
  if (
    fact.kind === 'task_run' &&
    fact.identity.observationId !== strategyTaskRunObservationId(
      task.taskExecutionId,
      mapping.runId,
    )
  ) {
    throw new InvalidTaskObservationAggregateError(
      `Run ${mapping.runId} does not use its stable task observation identity.`,
    );
  }
}

function validateParentGraph(
  task: StrategyTaskExecutionRecord,
  facts: readonly NormalizedAgentObservationV1[],
): void {
  const byId = new Map(facts.map((fact) => [fact.identity.observationId, fact]));
  const turnOwners = new Map<string, string>();
  for (const fact of facts) {
    const accounting = fact.turnAccounting;
    if (!accounting) continue;
    const turnKey = `${fact.identity.runId}\n${accounting.turnId}`;
    if (accounting.disposition === 'owner') {
      const existing = turnOwners.get(turnKey);
      if (existing && existing !== fact.identity.observationId) {
        throw new InvalidTaskObservationAggregateError(
          `Turn ${accounting.turnId} has multiple accounting owners in one Run.`,
        );
      }
      turnOwners.set(turnKey, fact.identity.observationId);
    }
  }
  for (const fact of facts) {
    const accounting = fact.turnAccounting;
    if (accounting?.disposition !== 'exclude_inherited') continue;
    const owner = byId.get(accounting.ownerObservationId);
    if (
      !owner ||
      owner.identity.runId !== fact.identity.runId ||
      owner.turnAccounting?.disposition !== 'owner' ||
      owner.turnAccounting.turnId !== accounting.turnId
    ) {
      throw new InvalidTaskObservationAggregateError(
        `Inherited Turn ${accounting.turnId} does not resolve to its declared owner.`,
      );
    }
  }
  for (const fact of facts) {
    if (fact.kind === 'task_run') continue;
    const seen = new Set([fact.identity.observationId]);
    let cursor: NormalizedAgentObservationV1 | undefined = fact;
    while (cursor && cursor.kind !== 'task_run') {
      const parentObservationId = cursor.identity.parentObservationId;
      if (!parentObservationId) break;
      const parent = byId.get(parentObservationId);
      if (!parent) {
        throw new InvalidTaskObservationAggregateError(
          `Observation ${fact.identity.observationId} has an unavailable parent.`,
        );
      }
      if (
        parent.identity.runId !== fact.identity.runId ||
        parent.identity.taskRunIndex !== fact.identity.taskRunIndex
      ) {
        throw new InvalidTaskObservationAggregateError(
          `Observation ${fact.identity.observationId} crosses a physical Run boundary.`,
        );
      }
      if (seen.has(parent.identity.observationId)) {
        throw new InvalidTaskObservationAggregateError(
          `Observation ${fact.identity.observationId} forms a parent cycle.`,
        );
      }
      seen.add(parent.identity.observationId);
      cursor = parent;
    }
    if (cursor?.kind !== 'task_run') {
      throw new InvalidTaskObservationAggregateError(
        `Observation ${fact.identity.observationId} does not resolve to its task Run root.`,
      );
    }
  }

  const taskRunIds = new Set(
    task.runs.map((run) => strategyTaskRunObservationId(task.taskExecutionId, run.runId)),
  );
  for (const fact of facts) {
    if (fact.kind === 'task_run' && !taskRunIds.has(fact.identity.observationId)) {
      throw new InvalidTaskObservationAggregateError('Unexpected task Run observation.');
    }
  }
}

function missingRunObservation(
  task: StrategyTaskExecutionRecord,
  mapping: StrategyTaskExecutionRecord['runs'][number],
): NormalizedAgentObservationV1 {
  return normalizeAgentObservationV1({
    identity: {
      observationId: strategyTaskRunObservationId(task.taskExecutionId, mapping.runId),
      taskExecutionId: task.taskExecutionId,
      runId: mapping.runId,
      taskRunIndex: mapping.taskRunIndex,
      parentObservationId: strategyTaskRootObservationId(task.taskExecutionId),
    },
    kind: 'task_run',
    stage: mapping.inputStage,
    status: 'unknown',
    limitations: ['run_observation_not_observed'],
  });
}

function observationDepth(
  fact: NormalizedAgentObservationV1,
  byId: ReadonlyMap<string, NormalizedAgentObservationV1>,
): number {
  let depth = 0;
  let cursor: NormalizedAgentObservationV1 | undefined = fact;
  const seen = new Set<string>();
  while (cursor?.identity.parentObservationId) {
    if (seen.has(cursor.identity.observationId)) return Number.MAX_SAFE_INTEGER;
    seen.add(cursor.identity.observationId);
    cursor = byId.get(cursor.identity.parentObservationId);
    depth += 1;
  }
  return depth;
}

function sortObservations(
  observations: readonly NormalizedAgentObservationV1[],
): NormalizedAgentObservationV1[] {
  const byId = new Map(observations.map((fact) => [fact.identity.observationId, fact]));
  return [...observations].sort((left, right) => (
    left.identity.taskRunIndex - right.identity.taskRunIndex ||
    observationDepth(left, byId) - observationDepth(right, byId) ||
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    compareCodeUnits(left.identity.observationId, right.identity.observationId)
  ));
}

function availabilityCounts(
  observations: readonly NormalizedAgentObservationV1[],
  selector: (observation: NormalizedAgentObservationV1) => 'complete' | 'partial' | 'unavailable',
): ObservationAvailabilityCountsV1 {
  const counts: ObservationAvailabilityCountsV1 = {
    complete: 0,
    partial: 0,
    unavailable: 0,
  };
  for (const observation of observations) counts[selector(observation)] += 1;
  return counts;
}

function promptBoundaryForObservation(
  observation: NormalizedAgentObservationV1,
): PromptBoundaryEvidenceV1 | undefined {
  switch (observation.kind) {
    case 'task_run':
      return observation.prompt.hostComposed;
    case 'child_agent':
      return observation.prompt.childInjected;
    case 'model_call':
      return observation.prompt.agentEffectiveContext;
    case 'tool':
      return undefined;
  }
}

function promptCoverageAvailability(
  evidence: PromptBoundaryEvidenceV1,
): 'complete' | 'partial' | 'unavailable' {
  return evidence.availability === 'exact'
    ? 'complete'
    : evidence.availability === 'partial'
      ? 'partial'
      : 'unavailable';
}

function usageSummary(
  observations: readonly NormalizedAgentObservationV1[],
): KnownUsageSummaryV1 {
  const included = observations.filter(
    (observation) => observation.turnAccounting?.disposition !== 'exclude_inherited',
  );
  const counts = availabilityCounts(included, (observation) => observation.usage.availability);
  const values: Record<string, number> = {};
  let observedObservationCount = 0;
  for (const observation of included) {
    if (!observation.usage.values) continue;
    observedObservationCount += 1;
    for (const [key, value] of Object.entries(observation.usage.values)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      values[key] = (values[key] ?? 0) + value;
    }
  }
  return {
    ...counts,
    observedObservationCount,
    ...(Object.keys(values).length > 0
      ? { values: values as Partial<ObservationUsageValuesV1> }
      : {}),
  };
}

function childCoverage(
  children: readonly NormalizedAgentObservationV1[],
): TaskObservationCoverageV1['children'] {
  if (children.length === 0) {
    return { availability: 'unavailable', knownObservationCount: 0 };
  }
  return {
    availability: children.every((child) => TERMINAL_OBSERVATION_STATUSES.has(child.status))
      ? 'complete'
      : 'partial',
    knownObservationCount: children.length,
  };
}

function aggregateLimitations(args: {
  missingRunIds: readonly string[];
  children: TaskObservationCoverageV1['children'];
  observations: readonly NormalizedAgentObservationV1[];
  taskType: string | null;
}): string[] {
  return [...new Set([
    ...(args.missingRunIds.length > 0 ? ['physical_run_observation_partial'] : []),
    ...(args.children.availability === 'unavailable'
      ? ['child_lifecycle_unavailable_not_zero']
      : args.children.availability === 'partial'
        ? ['child_lifecycle_partial']
        : []),
    ...(args.taskType === null ? ['task_type_unavailable'] : []),
    ...(args.observations.some(
      (observation) => observation.turnAccounting?.disposition === 'exclude_inherited',
    ) ? ['inherited_turn_copies_excluded_from_usage'] : []),
    ...(args.observations.flatMap((observation) => observation.limitations)),
  ])].sort(compareCodeUnits);
}

export function aggregateStrategyTaskObservations(input: {
  task: StrategyTaskExecutionRecord;
  observations: readonly unknown[];
  taskType?: string;
}): StrategyTaskObservationAggregateV1 {
  ensureTaskMapping(input.task);
  const parsed = input.observations.map((observation) => (
    NormalizedAgentObservationV1Schema.parse(observation)
  ));
  const merged = mergeObservationLifecycle(parsed);
  for (const fact of merged) validateFactAgainstTask(input.task, fact);

  const rootObservationId = strategyTaskRootObservationId(input.task.taskExecutionId);
  const taskRunByRunId = new Map(
    merged
      .filter((fact) => fact.kind === 'task_run')
      .map((fact) => [fact.identity.runId, fact]),
  );
  const missingRunIds: string[] = [];
  const taskRuns = input.task.runs.map((mapping) => {
    const observed = taskRunByRunId.get(mapping.runId);
    if (!observed) {
      missingRunIds.push(mapping.runId);
      return missingRunObservation(input.task, mapping);
    }
    return NormalizedAgentObservationV1Schema.parse({
      ...observed,
      identity: {
        ...observed.identity,
        parentObservationId: rootObservationId,
      },
    });
  });
  const nested = merged.filter((fact) => fact.kind !== 'task_run');
  const observations = [...taskRuns, ...nested];
  validateParentGraph(input.task, observations);
  const sorted = sortObservations(observations);
  const childObservations = sorted.filter((observation) => observation.kind === 'child_agent');
  const children = childCoverage(childObservations);
  const coverage: TaskObservationCoverageV1 = {
    runs: {
      availability: missingRunIds.length === 0 ? 'complete' : 'partial',
      expected: input.task.runs.length,
      observed: input.task.runs.length - missingRunIds.length,
      missingRunIds,
    },
    children,
    prompt: availabilityCounts(
      sorted.filter((observation) => promptBoundaryForObservation(observation) !== undefined),
      (observation) => promptCoverageAvailability(
        promptBoundaryForObservation(observation)!,
      ),
    ),
    usage: availabilityCounts(sorted, (observation) => observation.usage.availability),
    timing: availabilityCounts(sorted, (observation) => observation.timing.availability),
  };
  const stageTotals = STAGE_ORDER
    .filter((stage) => input.task.runs.some((run) => run.inputStage === stage))
    .map((stage): TaskObservationStageTotalV1 => {
      const stageObservations = sorted.filter((observation) => observation.stage === stage);
      const stageRuns = stageObservations.filter((observation) => observation.kind === 'task_run');
      const stageChildren = stageObservations.filter(
        (observation) => observation.kind === 'child_agent',
      );
      return {
        stage,
        runCount: stageRuns.length,
        runStatuses: stageRuns.map((run) => run.status),
        knownMainRunUsage: usageSummary(stageRuns),
        knownChildUsage: usageSummary(stageChildren),
      };
    });
  const taskType = input.taskType ?? input.task.planContract?.taskProfile.taskType ?? null;
  const limitations = aggregateLimitations({
    missingRunIds,
    children,
    observations: sorted,
    taskType,
  });

  return {
    schema: 'open-design.strategy-task-observation/v1',
    root: {
      observationId: rootObservationId,
      taskExecutionId: input.task.taskExecutionId,
      status: input.task.outcome,
      route: input.task.route,
      executionMode: input.task.executionMode,
      taskType,
      strategyId: input.task.strategyId,
      strategyVersion: input.task.strategyVersion,
      strategyPackageHash: input.task.strategyPackageHash,
      snapshotId: input.task.snapshotId,
      planContractHash: input.task.planContractHash ?? null,
      selectedAgentId: input.task.selectedAgentId,
      createdAt: input.task.createdAt,
      updatedAt: input.task.updatedAt,
    },
    observations: sorted,
    coverage,
    stageTotals,
    limitations,
  };
}

export function aggregateStoredStrategyTaskObservations(input: {
  db: Database.Database;
  taskExecutionId: string;
  observations: readonly unknown[];
}): StrategyTaskObservationAggregateV1 {
  const task = getStrategyTaskExecution(input.db, input.taskExecutionId);
  if (!task) {
    throw new InvalidTaskObservationAggregateError(
      `Unknown strategy task execution ${input.taskExecutionId}.`,
    );
  }
  const snapshot = getSnapshot(input.db, task.snapshotId);
  const taskType = snapshot?.strategy?.selectedTaskProfile.taskType;
  return aggregateStrategyTaskObservations({
    task,
    observations: input.observations,
    ...(taskType ? { taskType } : {}),
  });
}

function legacyLevel(status: NormalizedAgentObservationStatusV1 | StrategyTaskOutcome): string {
  if (status === 'failed' || status === 'blocked') return 'ERROR';
  if (status === 'canceled') return 'WARNING';
  return 'DEFAULT';
}

function legacyAbsoluteTiming(
  observation: NormalizedAgentObservationV1,
): { startTime?: string; endTime?: string } {
  const evidence = observation.timing.evidence?.find((candidate) => (
    candidate.clockDomain === 'unix_epoch_ms' &&
    (candidate.startedAtMs !== undefined || candidate.endedAtMs !== undefined)
  ));
  if (!evidence) return {};
  return {
    ...(evidence.startedAtMs !== undefined
      ? { startTime: new Date(evidence.startedAtMs).toISOString() }
      : {}),
    ...(evidence.endedAtMs !== undefined
      ? { endTime: new Date(evidence.endedAtMs).toISOString() }
      : {}),
  };
}

function legacyUsage(observation: NormalizedAgentObservationV1): Record<string, unknown> | undefined {
  const values = safeTaskObservationUsageValues(observation);
  if (!values) return undefined;
  return {
    input: values.effectiveInputTokens ?? values.inputTokens,
    output: values.outputTokens,
    total: values.totalTokens,
    unit: 'TOKENS',
  };
}

const SAFE_USAGE_VALUE_KEYS = [
  'inputTokens',
  'effectiveInputTokens',
  'outputTokens',
  'totalTokens',
  'thoughtTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'uncachedInputTokens',
  'estimatedContextTokens',
] as const;

export function safeTaskObservationUsageValues(
  observation: NormalizedAgentObservationV1,
): Record<string, number> | undefined {
  if (observation.turnAccounting?.disposition === 'exclude_inherited') {
    return undefined;
  }
  const source = observation.usage.values;
  if (!source) return undefined;
  const values: Record<string, number> = {};
  for (const key of SAFE_USAGE_VALUE_KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      values[key] = value;
    }
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

export function safeTaskObservationUsageValueSources(
  observation: NormalizedAgentObservationV1,
): Record<string, string> | undefined {
  if (observation.turnAccounting?.disposition === 'exclude_inherited') {
    return undefined;
  }
  const source = observation.usage.valueSources;
  if (!source) return undefined;
  const valueSources: Record<string, string> = {};
  for (const key of SAFE_USAGE_VALUE_KEYS) {
    const value = source[key];
    if (typeof value === 'string') valueSources[key] = value;
  }
  return Object.keys(valueSources).length > 0 ? valueSources : undefined;
}

function safePromptInput(observation: NormalizedAgentObservationV1): unknown {
  const boundary = promptBoundaryForObservation(observation);
  if (!boundary) return undefined;
  return boundary.availability === 'exact' || boundary.availability === 'partial'
    ? boundary.safePayload
    : undefined;
}

export function safeTaskObservationLimitationCodes(
  limitations: readonly string[],
): string[] {
  return limitations.filter((limitation) => (
    /^[a-z0-9][a-z0-9_:.-]{0,127}$/.test(limitation)
  ));
}

function safeModelName(observation: NormalizedAgentObservationV1): string | undefined {
  const model = observation.attributes?.['model'];
  return typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)
    ? model
    : undefined;
}

/**
 * Map one protocol-neutral task aggregate to legacy ingestion events.
 *
 * This builder performs no I/O. The caller must pass through the consent/sink
 * plan below before delivery. Inherited Turn copies stay in the exported
 * hierarchy, while their usage is omitted and marked unaccounted so the legacy
 * sink cannot count an owner/exclude pair twice.
 */
export function buildLegacyTaskObservationPayload(
  aggregate: StrategyTaskObservationAggregateV1,
  context?: TaskObservationExportContextV1,
): unknown[] {
  const traceId = aggregate.root.observationId;
  const nowIso = new Date(aggregate.root.updatedAt).toISOString();
  const events: unknown[] = [];
  const pushEvent = (type: string, body: Record<string, unknown>) => {
    const bodyId = String(body.id);
    events.push({
      id: stableLegacyEventId(type, bodyId),
      type,
      timestamp: nowIso,
      body,
    });
  };
  pushEvent('trace-create', {
    id: traceId,
    name: 'open-design-strategy-task',
    timestamp: new Date(aggregate.root.createdAt).toISOString(),
    ...(context
      ? {
          environment: context.environment,
          tags: [
            'od-next-v2',
            `environment:${context.environment}`,
            `rollout:${context.tag}`,
          ],
        }
      : {}),
    metadata: {
      schema: aggregate.schema,
      taskExecutionId: aggregate.root.taskExecutionId,
      route: aggregate.root.route,
      executionMode: aggregate.root.executionMode,
      taskType: aggregate.root.taskType,
      outcome: aggregate.root.status,
      strategyId: aggregate.root.strategyId,
      strategyVersion: aggregate.root.strategyVersion,
      strategyPackageHash: aggregate.root.strategyPackageHash,
      snapshotId: aggregate.root.snapshotId,
      planContractHash: aggregate.root.planContractHash,
      selectedAgentId: aggregate.root.selectedAgentId,
      ...(context
        ? {
            environment: context.environment,
            rolloutTag: context.tag,
          }
        : {}),
      coverage: aggregate.coverage,
      stageTotals: aggregate.stageTotals,
      limitations: safeTaskObservationLimitationCodes(aggregate.limitations),
    },
  });

  for (const observation of aggregate.observations) {
    const promptBoundary = promptBoundaryForObservation(observation);
    const promptInput = safePromptInput(observation);
    const common = {
      id: observation.identity.observationId,
      traceId,
      ...(observation.kind === 'task_run'
        ? {}
        : { parentObservationId: observation.identity.parentObservationId }),
      name: observation.kind === 'task_run'
        ? `strategy-stage:${observation.stage}`
        : observation.kind,
      ...legacyAbsoluteTiming(observation),
      ...(promptInput !== undefined ? { input: promptInput } : {}),
      level: legacyLevel(observation.status),
      metadata: {
        schema: observation.schema,
        taskExecutionId: observation.identity.taskExecutionId,
        runId: observation.identity.runId,
        taskRunIndex: observation.identity.taskRunIndex,
        stage: observation.stage,
        status: observation.status,
        ...(promptBoundary
          ? { promptAvailability: promptBoundary.availability }
          : {}),
        usageAvailability: observation.usage.availability,
        usageSource: observation.usage.source,
        usageAccountingMode: observation.usage.accountingMode,
        usageValues: safeTaskObservationUsageValues(observation),
        usageValueSources: safeTaskObservationUsageValueSources(observation),
        usageLimitations: safeTaskObservationLimitationCodes(
          observation.usage.limitations,
        ),
        usageAccounted:
          observation.turnAccounting?.disposition !== 'exclude_inherited',
        turnAccountingDisposition: observation.turnAccounting?.disposition,
        turnAccountingOwnerObservationId:
          observation.turnAccounting?.ownerObservationId,
        timingAvailability: observation.timing.availability,
        limitations: safeTaskObservationLimitationCodes(observation.limitations),
      },
    };
    if (observation.kind === 'model_call') {
      const usage = observation.turnAccounting?.disposition === 'exclude_inherited'
        ? undefined
        : legacyUsage(observation);
      pushEvent('generation-create', {
        ...common,
        ...(usage ? { usage } : {}),
        model: safeModelName(observation),
      });
    } else {
      pushEvent('span-create', common);
    }
  }
  return events;
}

export function prepareLegacyTaskObservationExport(input: {
  aggregate: StrategyTaskObservationAggregateV1;
  prefs: TelemetryPrefs;
  hasEffectiveSink: boolean;
  context?: TaskObservationExportContextV1;
}): LegacyTaskObservationExportPlan {
  const expectation = deriveRunTelemetryExportExpectation(
    input.prefs,
    input.hasEffectiveSink,
  );
  return {
    expectation,
    batch: expectation.expected
      ? buildLegacyTaskObservationPayload(input.aggregate, input.context)
      : [],
  };
}
