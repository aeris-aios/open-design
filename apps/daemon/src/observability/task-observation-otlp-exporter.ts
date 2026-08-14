import { createHash } from 'node:crypto';

import type {
  NormalizedAgentObservationStatusV1,
  NormalizedAgentObservationV1,
} from '@open-design/contracts';

import type { TelemetryPrefs } from '../app-config.js';
import {
  HARD_BATCH_MAX_BYTES,
  postLangfuseBatch,
  readRunTelemetrySinkConfig,
  type LangfuseConfig,
  type LangfuseDeliveryState,
} from '../langfuse-trace.js';
import {
  buildLegacyTaskObservationPayload,
  prepareLegacyTaskObservationExport,
  safeTaskObservationLimitationCodes,
  safeTaskObservationUsageValueSources,
  safeTaskObservationUsageValues,
  strategyTaskRootObservationId,
  type StrategyTaskObservationAggregateV1,
} from './task-observation-aggregation.js';

export const LANGFUSE_OTLP_TRACES_PATH = '/api/public/otel/v1/traces';
export const LANGFUSE_OTLP_INGESTION_VERSION = '4';

export type TaskObservationExporterMode = 'legacy' | 'dual' | 'otlp';

export interface TaskObservationExporterConfig extends LangfuseConfig {
  mode: TaskObservationExporterMode;
}

export interface TaskObservationExportOptions {
  prefs: TelemetryPrefs;
  config: TaskObservationExporterConfig | null;
  fetchImpl?: typeof fetch;
  deliveryIdempotencyKey?: string;
  onDeliveryAttempt?: () => void;
  /** Test-only retry delay override. Production callers should omit it. */
  retryDelayMs?: number;
}

export interface TaskObservationDeliveryState extends LangfuseDeliveryState {
  exporter_mode: TaskObservationExporterMode;
  primary_protocol: 'legacy-v1' | 'otlp-v4' | 'none';
  /** Dual is a local mapping shadow, never a second production write. */
  shadow_protocol?: 'otlp-v4';
  shadow_status?: 'matched' | 'mismatch';
}

export interface EffectiveTaskObservationExporterDiagnostic {
  mode: TaskObservationExporterMode;
  primaryProtocol: 'legacy-v1' | 'otlp-v4';
  shadowProtocol: 'otlp-v4' | null;
  shadowNetworkEnabled: false;
}

interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string;
  doubleValue?: number;
  arrayValue?: { values: OtlpAnyValue[] };
}

interface OtlpAttribute {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpSpanV1 {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number; message?: string };
}

export interface OtlpTraceExportRequestV1 {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OtlpSpanV1[];
    }>;
  }>;
}

interface ObservationTimingMapping {
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  mapping: 'unix_epoch_ms' | 'single_boundary_zero_duration' | 'aggregate_updated_at_zero_duration';
}

function parseMode(value: string | undefined): TaskObservationExporterMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'otlp' || normalized === 'dual' ? normalized : 'legacy';
}

export function readTaskObservationExporterConfig(
  env: NodeJS.ProcessEnv = process.env,
  configuredEnv: Record<string, string> = {},
): TaskObservationExporterConfig | null {
  const config = readRunTelemetrySinkConfig(env, configuredEnv);
  // Relay and Vela own their existing legacy wire contracts. This direct
  // self-host migration must never bypass the effective-sink priority merely
  // because Langfuse keys are also present in the environment.
  if (!config || config.kind !== 'langfuse') return null;
  return {
    authHeader: config.authHeader,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    mode: parseMode(env.LANGFUSE_EXPORTER_MODE),
  };
}

export function describeTaskObservationExporter(
  mode: TaskObservationExporterMode,
): EffectiveTaskObservationExporterDiagnostic {
  return mode === 'otlp'
    ? {
        mode,
        primaryProtocol: 'otlp-v4',
        shadowProtocol: null,
        shadowNetworkEnabled: false,
      }
    : {
        mode,
        primaryProtocol: 'legacy-v1',
        shadowProtocol: mode === 'dual' ? 'otlp-v4' : null,
        shadowNetworkEnabled: false,
      };
}

function stableHexId(namespace: string, value: string, length: 16 | 32): string {
  return createHash('sha256')
    .update(`${namespace}\n${value}`, 'utf8')
    .digest('hex')
    .slice(0, length);
}

export function otlpTaskTraceId(taskExecutionId: string): string {
  return stableHexId('open-design/task-observation-otlp-trace/v1', taskExecutionId, 32);
}

export function otlpTaskSpanId(observationId: string): string {
  return stableHexId('open-design/task-observation-otlp-span/v1', observationId, 16);
}

function jsonString(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

function anyValue(value: string | number | boolean | readonly string[]): OtlpAnyValue {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isSafeInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return {
    arrayValue: { values: value.map((item) => ({ stringValue: item })) },
  };
}

function attributes(
  entries: ReadonlyArray<readonly [string, string | number | boolean | readonly string[] | null | undefined]>,
): OtlpAttribute[] {
  return entries
    .filter((entry): entry is readonly [string, string | number | boolean | readonly string[]] => (
      entry[1] !== null && entry[1] !== undefined
    ))
    .map(([key, value]) => ({ key, value: anyValue(value) }));
}

function taskTraceAttributes(
  aggregate: StrategyTaskObservationAggregateV1,
): OtlpAttribute[] {
  const limitations = safeTaskObservationLimitationCodes(aggregate.limitations);
  return attributes([
    ['langfuse.trace.name', 'open-design-strategy-task'],
    ['langfuse.session.id', aggregate.root.taskExecutionId],
    ['langfuse.version', aggregate.root.strategyVersion],
    ['langfuse.trace.tags', [
      'od-next-strategy-v2',
      aggregate.root.route,
      aggregate.root.executionMode,
    ].filter((value): value is string => typeof value === 'string')],
    ['langfuse.trace.metadata.task_execution_id', aggregate.root.taskExecutionId],
    ['langfuse.trace.metadata.route', aggregate.root.route],
    ['langfuse.trace.metadata.execution_mode', aggregate.root.executionMode],
    ['langfuse.trace.metadata.task_type', aggregate.root.taskType],
    ['langfuse.trace.metadata.outcome', aggregate.root.status],
    ['langfuse.trace.metadata.strategy_id', aggregate.root.strategyId],
    ['langfuse.trace.metadata.strategy_package_hash', aggregate.root.strategyPackageHash],
    ['langfuse.trace.metadata.snapshot_id', aggregate.root.snapshotId],
    ['langfuse.trace.metadata.plan_contract_hash', aggregate.root.planContractHash],
    ['langfuse.trace.metadata.selected_agent_id', aggregate.root.selectedAgentId],
    ['langfuse.trace.metadata.coverage', jsonString(aggregate.coverage)],
    ['langfuse.trace.metadata.stage_totals', jsonString(aggregate.stageTotals)],
    ['langfuse.trace.metadata.limitations', jsonString(limitations)],
  ]);
}

function observationLevel(status: NormalizedAgentObservationStatusV1 | string): string {
  if (status === 'failed' || status === 'blocked') return 'ERROR';
  if (status === 'canceled') return 'WARNING';
  return 'DEFAULT';
}

function spanStatus(status: NormalizedAgentObservationStatusV1 | string): OtlpSpanV1['status'] {
  if (status === 'failed' || status === 'blocked') {
    return { code: 2, message: status };
  }
  if (status === 'completed') return { code: 1 };
  if (status === 'canceled') return { code: 0, message: status };
  return { code: 0 };
}

function epochNanoseconds(milliseconds: number): string {
  return (BigInt(Math.max(0, Math.trunc(milliseconds))) * 1_000_000n).toString();
}

function observationTiming(
  observation: NormalizedAgentObservationV1,
  aggregateUpdatedAt: number,
): ObservationTimingMapping {
  const evidence = observation.timing.evidence?.find((candidate) => (
    candidate.clockDomain === 'unix_epoch_ms' &&
    (candidate.startedAtMs !== undefined || candidate.endedAtMs !== undefined)
  ));
  if (!evidence) {
    const fallback = epochNanoseconds(aggregateUpdatedAt);
    return {
      startTimeUnixNano: fallback,
      endTimeUnixNano: fallback,
      mapping: 'aggregate_updated_at_zero_duration',
    };
  }
  const start = evidence.startedAtMs ?? evidence.endedAtMs!;
  const end = evidence.endedAtMs ?? evidence.startedAtMs!;
  return {
    startTimeUnixNano: epochNanoseconds(Math.min(start, end)),
    endTimeUnixNano: epochNanoseconds(Math.max(start, end)),
    mapping:
      evidence.startedAtMs !== undefined && evidence.endedAtMs !== undefined
        ? 'unix_epoch_ms'
        : 'single_boundary_zero_duration',
  };
}

function promptBoundary(observation: NormalizedAgentObservationV1) {
  if (observation.kind === 'task_run') return observation.prompt.hostComposed;
  if (observation.kind === 'child_agent') return observation.prompt.childInjected;
  if (observation.kind === 'model_call') return observation.prompt.agentEffectiveContext;
  return undefined;
}

function safeObservationInput(
  observation: NormalizedAgentObservationV1,
): unknown {
  const prompt = promptBoundary(observation);
  return prompt && (prompt.availability === 'exact' || prompt.availability === 'partial')
    ? prompt.safePayload
    : undefined;
}

function legacyObservationTiming(
  observation: NormalizedAgentObservationV1,
): { startTime?: string; endTime?: string } {
  const evidence = observation.timing.evidence?.find((candidate) => (
    candidate.clockDomain === 'unix_epoch_ms' &&
    (candidate.startedAtMs !== undefined || candidate.endedAtMs !== undefined)
  ));
  if (!evidence) return {};
  return {
    ...(evidence.startedAtMs === undefined
      ? {}
      : { startTime: new Date(evidence.startedAtMs).toISOString() }),
    ...(evidence.endedAtMs === undefined
      ? {}
      : { endTime: new Date(evidence.endedAtMs).toISOString() }),
  };
}

function observationUsageDetails(
  observation: NormalizedAgentObservationV1,
): string | undefined {
  if (
    observation.kind !== 'model_call' ||
    observation.turnAccounting?.disposition === 'exclude_inherited' ||
    !safeTaskObservationUsageValues(observation)
  ) {
    return undefined;
  }
  const values = safeTaskObservationUsageValues(observation)!;
  return jsonString({
    input: values.effectiveInputTokens ?? values.inputTokens,
    output: values.outputTokens,
    total: values.totalTokens,
    reasoning: values.thoughtTokens,
    cache_read_input: values.cacheReadTokens,
    cache_write_input: values.cacheWriteTokens,
  });
}

function modelName(observation: NormalizedAgentObservationV1): string | undefined {
  const value = observation.attributes?.['model'];
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
    ? value
    : undefined;
}

function buildRootSpan(
  aggregate: StrategyTaskObservationAggregateV1,
  traceId: string,
  rootSpanId: string,
  propagated: OtlpAttribute[],
): OtlpSpanV1 {
  const limitations = safeTaskObservationLimitationCodes(aggregate.limitations);
  return {
    traceId,
    spanId: rootSpanId,
    name: 'open-design-strategy-task',
    kind: 1,
    startTimeUnixNano: epochNanoseconds(aggregate.root.createdAt),
    endTimeUnixNano: epochNanoseconds(Math.max(aggregate.root.createdAt, aggregate.root.updatedAt)),
    attributes: [
      ...propagated,
      ...attributes([
        ['langfuse.observation.type', 'span'],
        ['langfuse.observation.level', observationLevel(aggregate.root.status)],
        ['langfuse.observation.input', jsonString({
          taskExecutionId: aggregate.root.taskExecutionId,
          route: aggregate.root.route,
          executionMode: aggregate.root.executionMode,
          taskType: aggregate.root.taskType,
        })],
        ['langfuse.observation.output', jsonString({
          outcome: aggregate.root.status,
          limitations,
        })],
        ['langfuse.observation.metadata.observation_id', aggregate.root.observationId],
        ['langfuse.observation.metadata.kind', 'task'],
        ['langfuse.observation.metadata.schema', aggregate.schema],
      ]),
    ],
    status: spanStatus(aggregate.root.status),
  };
}

function buildObservationSpan(
  aggregate: StrategyTaskObservationAggregateV1,
  observation: NormalizedAgentObservationV1,
  traceId: string,
  rootSpanId: string,
  propagated: OtlpAttribute[],
): OtlpSpanV1 {
  const timing = observationTiming(observation, aggregate.root.updatedAt);
  const prompt = promptBoundary(observation);
  const input = safeObservationInput(observation);
  const usageAccounted = observation.turnAccounting?.disposition !== 'exclude_inherited';
  const usageDetails = observationUsageDetails(observation);
  const usageValues = safeTaskObservationUsageValues(observation);
  const usageValueSources = safeTaskObservationUsageValueSources(observation);
  const usageLimitations = safeTaskObservationLimitationCodes(observation.usage.limitations);
  const limitations = safeTaskObservationLimitationCodes(observation.limitations);
  const parentObservationId = observation.kind === 'task_run'
    ? aggregate.root.observationId
    : observation.identity.parentObservationId!;
  return {
    traceId,
    spanId: otlpTaskSpanId(observation.identity.observationId),
    parentSpanId: parentObservationId === aggregate.root.observationId
      ? rootSpanId
      : otlpTaskSpanId(parentObservationId),
    name: observation.kind === 'task_run'
      ? `strategy-stage:${observation.stage}`
      : observation.kind,
    kind: 1,
    startTimeUnixNano: timing.startTimeUnixNano,
    endTimeUnixNano: timing.endTimeUnixNano,
    attributes: [
      ...propagated,
      ...attributes([
        ['langfuse.observation.type', observation.kind === 'model_call' ? 'generation' : 'span'],
        ['langfuse.observation.level', observationLevel(observation.status)],
        ['langfuse.observation.input', input === undefined ? undefined : jsonString(input)],
        ['langfuse.observation.model.name', observation.kind === 'model_call'
          ? modelName(observation)
          : undefined],
        ['langfuse.observation.usage_details', usageDetails],
        ['langfuse.observation.metadata.observation_id', observation.identity.observationId],
        ['langfuse.observation.metadata.kind', observation.kind],
        ['langfuse.observation.metadata.run_id', observation.identity.runId],
        ['langfuse.observation.metadata.task_run_index', String(observation.identity.taskRunIndex)],
        ['langfuse.observation.metadata.stage', observation.stage],
        ['langfuse.observation.metadata.status', observation.status],
        ['langfuse.observation.metadata.prompt_availability', prompt?.availability],
        ['langfuse.observation.metadata.usage_availability', observation.usage.availability],
        ['langfuse.observation.metadata.usage_source', observation.usage.source],
        ['langfuse.observation.metadata.usage_accounting_mode', observation.usage.accountingMode],
        ['langfuse.observation.metadata.usage_accounted', String(usageAccounted)],
        ['langfuse.observation.metadata.turn_accounting_disposition',
          observation.turnAccounting?.disposition],
        ['langfuse.observation.metadata.turn_accounting_owner_observation_id',
          observation.turnAccounting?.ownerObservationId],
        ['langfuse.observation.metadata.usage_values', usageValues
          ? jsonString(usageValues)
          : undefined],
        ['langfuse.observation.metadata.usage_value_sources', usageValueSources
          ? jsonString(usageValueSources)
          : undefined],
        ['langfuse.observation.metadata.usage_limitations', jsonString(usageLimitations)],
        ['langfuse.observation.metadata.timing_availability', observation.timing.availability],
        ['langfuse.observation.metadata.timing_mapping', timing.mapping],
        ['langfuse.observation.metadata.limitations', jsonString(limitations)],
      ]),
    ],
    status: spanStatus(observation.status),
  };
}

/**
 * Map the protocol-neutral task aggregate to one complete immutable OTLP span
 * per operation. No transport, consent, or delivery state is consulted here.
 */
export function buildOtlpTaskObservationPayload(
  aggregate: StrategyTaskObservationAggregateV1,
): OtlpTraceExportRequestV1 {
  const traceId = otlpTaskTraceId(aggregate.root.taskExecutionId);
  const rootObservationId = strategyTaskRootObservationId(aggregate.root.taskExecutionId);
  if (aggregate.root.observationId !== rootObservationId) {
    throw new Error('Task aggregate root does not use its stable observation identity.');
  }
  const rootSpanId = otlpTaskSpanId(aggregate.root.observationId);
  const propagated = taskTraceAttributes(aggregate);
  const spans = [
    buildRootSpan(aggregate, traceId, rootSpanId, propagated),
    ...aggregate.observations.map((observation) => (
      buildObservationSpan(aggregate, observation, traceId, rootSpanId, propagated)
    )),
  ];
  const spanIds = new Set(spans.map((span) => span.spanId));
  if (spanIds.size !== spans.length) throw new Error('OTLP span identity collision.');
  for (const span of spans.slice(1)) {
    if (!span.parentSpanId || !spanIds.has(span.parentSpanId)) {
      throw new Error(`OTLP span ${span.spanId} has an unavailable parent.`);
    }
  }
  return {
    resourceSpans: [{
      resource: {
        attributes: attributes([
          ['service.name', 'open-design-daemon'],
          ['telemetry.sdk.name', 'open-design-task-observation-exporter'],
        ]),
      },
      scopeSpans: [{
        scope: {
          name: 'open-design.task-observability',
          version: '1',
        },
        spans,
      }],
    }],
  };
}

function otlpSpans(payload: OtlpTraceExportRequestV1): OtlpSpanV1[] {
  return payload.resourceSpans.flatMap((resource) => (
    resource.scopeSpans.flatMap((scope) => scope.spans)
  ));
}

function attributeValue(span: OtlpSpanV1, key: string): string | undefined {
  return span.attributes.find((attribute) => attribute.key === key)?.value.stringValue;
}

function attributeMatches(span: OtlpSpanV1, expected: OtlpAttribute): boolean {
  const actual = span.attributes.find((attribute) => attribute.key === expected.key);
  return actual !== undefined && jsonString(actual.value) === jsonString(expected.value);
}

const TASK_TRACE_ATTRIBUTE_KEYS = [
  'langfuse.trace.name',
  'langfuse.session.id',
  'langfuse.version',
  'langfuse.trace.tags',
  'langfuse.trace.metadata.task_execution_id',
  'langfuse.trace.metadata.route',
  'langfuse.trace.metadata.execution_mode',
  'langfuse.trace.metadata.task_type',
  'langfuse.trace.metadata.outcome',
  'langfuse.trace.metadata.strategy_id',
  'langfuse.trace.metadata.strategy_package_hash',
  'langfuse.trace.metadata.snapshot_id',
  'langfuse.trace.metadata.plan_contract_hash',
  'langfuse.trace.metadata.selected_agent_id',
  'langfuse.trace.metadata.coverage',
  'langfuse.trace.metadata.stage_totals',
  'langfuse.trace.metadata.limitations',
] as const;

function traceAttributesMatch(
  span: OtlpSpanV1,
  expectedAttributes: readonly OtlpAttribute[],
): boolean {
  const expected = new Map(expectedAttributes.map((attribute) => [attribute.key, attribute]));
  return TASK_TRACE_ATTRIBUTE_KEYS.every((key) => {
    const expectedAttribute = expected.get(key);
    const actualAttribute = span.attributes.find((attribute) => attribute.key === key);
    return expectedAttribute
      ? attributeMatches(span, expectedAttribute)
      : actualAttribute === undefined;
  });
}

function recordMatches(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
): boolean {
  return actual !== undefined && Object.entries(expected).every(([key, value]) => (
    jsonString(actual[key]) === jsonString(value)
  ));
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

/**
 * Dual mode is an offline shadow only. This guard proves the two mappings use
 * the same trace semantics, observation identities/types, parent graph,
 * status, complete usage evidence, and limits;
 * it intentionally makes no second network request to the same project.
 */
export function legacyAndOtlpTaskMappingsMatch(
  aggregate: StrategyTaskObservationAggregateV1,
  legacyBatch: readonly unknown[],
  otlpPayload: OtlpTraceExportRequestV1,
): boolean {
  const legacyEvents = legacyBatch.filter((event): event is {
    type: string;
    body: Record<string, unknown>;
  } => !!event && typeof event === 'object' && !Array.isArray(event) &&
    typeof (event as { type?: unknown }).type === 'string' &&
    !!(event as { body?: unknown }).body &&
    typeof (event as { body?: unknown }).body === 'object');
  const trace = legacyEvents.find((event) => event.type === 'trace-create');
  if (!trace || trace.body.id !== aggregate.root.observationId) return false;
  const rootLimitations = safeTaskObservationLimitationCodes(aggregate.limitations);
  const legacyTraceMetadata = trace.body.metadata as Record<string, unknown> | undefined;
  if (
    trace.body.name !== 'open-design-strategy-task' ||
    !recordMatches(legacyTraceMetadata, {
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
      coverage: aggregate.coverage,
      stageTotals: aggregate.stageTotals,
      limitations: rootLimitations,
    })
  ) {
    return false;
  }
  const spans = otlpSpans(otlpPayload);
  const root = spans.find((span) => (
    attributeValue(span, 'langfuse.observation.metadata.observation_id') === aggregate.root.observationId
  ));
  const propagatedTraceAttributes = taskTraceAttributes(aggregate);
  const expectedTraceId = otlpTaskTraceId(aggregate.root.taskExecutionId);
  const expectedRootInput = jsonString({
    taskExecutionId: aggregate.root.taskExecutionId,
    route: aggregate.root.route,
    executionMode: aggregate.root.executionMode,
    taskType: aggregate.root.taskType,
  });
  if (
    !root ||
    root.parentSpanId !== undefined ||
    root.traceId !== expectedTraceId ||
    root.spanId !== otlpTaskSpanId(aggregate.root.observationId) ||
    root.name !== 'open-design-strategy-task' ||
    root.status.code !== spanStatus(aggregate.root.status).code ||
    root.status.message !== spanStatus(aggregate.root.status).message ||
    attributeValue(root, 'langfuse.observation.type') !== 'span' ||
    attributeValue(root, 'langfuse.observation.level') !== observationLevel(aggregate.root.status) ||
    attributeValue(root, 'langfuse.observation.metadata.kind') !== 'task' ||
    attributeValue(root, 'langfuse.observation.metadata.schema') !== aggregate.schema ||
    attributeValue(root, 'langfuse.observation.input') !== expectedRootInput ||
    attributeValue(root, 'langfuse.observation.output') !== jsonString({
      outcome: aggregate.root.status,
      limitations: rootLimitations,
    }) ||
    !traceAttributesMatch(root, propagatedTraceAttributes)
  ) {
    return false;
  }
  const legacyById = new Map(legacyEvents.map((event) => [String(event.body.id), event]));
  const otlpById = new Map(spans.map((span) => [
    attributeValue(span, 'langfuse.observation.metadata.observation_id'),
    span,
  ]));
  for (const observation of aggregate.observations) {
    const legacy = legacyById.get(observation.identity.observationId);
    const otlp = otlpById.get(observation.identity.observationId);
    if (!legacy || !otlp) return false;
    const legacyParent = observation.kind === 'task_run'
      ? aggregate.root.observationId
      : legacy.body.parentObservationId;
    const expectedParentSpan = legacyParent === aggregate.root.observationId
      ? root.spanId
      : otlpTaskSpanId(String(legacyParent));
    const legacyMetadata = legacy.body.metadata as Record<string, unknown> | undefined;
    const limitations = safeTaskObservationLimitationCodes(observation.limitations);
    const usageValues = safeTaskObservationUsageValues(observation);
    const usageValueSources = safeTaskObservationUsageValueSources(observation);
    const usageLimitations = safeTaskObservationLimitationCodes(observation.usage.limitations);
    const prompt = promptBoundary(observation);
    const input = safeObservationInput(observation);
    const expectedInput = input === undefined ? undefined : jsonString(input);
    const expectedModel = observation.kind === 'model_call'
      ? modelName(observation)
      : undefined;
    const legacyTiming = legacyObservationTiming(observation);
    const otlpTiming = observationTiming(observation, aggregate.root.updatedAt);
    const usageAccounted = observation.turnAccounting?.disposition !== 'exclude_inherited';
    const expectedEventType = observation.kind === 'model_call'
      ? 'generation-create'
      : 'span-create';
    const expectedObservationType = observation.kind === 'model_call' ? 'generation' : 'span';
    const expectedName = observation.kind === 'task_run'
      ? `strategy-stage:${observation.stage}`
      : observation.kind;
    if (
      legacy.type !== expectedEventType ||
      legacy.body.traceId !== aggregate.root.observationId ||
      legacy.body.name !== expectedName ||
      (legacy.body.input === undefined) !== (input === undefined) ||
      (input !== undefined && jsonString(legacy.body.input) !== jsonString(input)) ||
      legacy.body.model !== expectedModel ||
      legacy.body.startTime !== legacyTiming.startTime ||
      legacy.body.endTime !== legacyTiming.endTime ||
      legacy.body.level !== observationLevel(observation.status) ||
      otlp.name !== expectedName ||
      otlp.traceId !== expectedTraceId ||
      otlp.spanId !== otlpTaskSpanId(observation.identity.observationId) ||
      otlp.parentSpanId !== expectedParentSpan ||
      otlp.startTimeUnixNano !== otlpTiming.startTimeUnixNano ||
      otlp.endTimeUnixNano !== otlpTiming.endTimeUnixNano ||
      !traceAttributesMatch(otlp, propagatedTraceAttributes) ||
      !recordMatches(legacyMetadata, {
        schema: observation.schema,
        taskExecutionId: observation.identity.taskExecutionId,
        runId: observation.identity.runId,
        taskRunIndex: observation.identity.taskRunIndex,
        stage: observation.stage,
        status: observation.status,
        promptAvailability: prompt?.availability,
        usageAvailability: observation.usage.availability,
        usageSource: observation.usage.source,
        usageAccountingMode: observation.usage.accountingMode,
        usageValues,
        usageValueSources,
        usageLimitations,
        usageAccounted,
        turnAccountingDisposition: observation.turnAccounting?.disposition,
        turnAccountingOwnerObservationId: observation.turnAccounting?.ownerObservationId,
        timingAvailability: observation.timing.availability,
        limitations,
      }) ||
      attributeValue(otlp, 'langfuse.observation.type') !== expectedObservationType ||
      attributeValue(otlp, 'langfuse.observation.level') !== observationLevel(observation.status) ||
      attributeValue(otlp, 'langfuse.observation.metadata.kind') !== observation.kind ||
      attributeValue(otlp, 'langfuse.observation.metadata.run_id') !== observation.identity.runId ||
      attributeValue(otlp, 'langfuse.observation.metadata.task_run_index') !==
        String(observation.identity.taskRunIndex) ||
      attributeValue(otlp, 'langfuse.observation.metadata.stage') !== observation.stage ||
      attributeValue(otlp, 'langfuse.observation.metadata.status') !== observation.status ||
      attributeValue(otlp, 'langfuse.observation.metadata.prompt_availability') !==
        prompt?.availability ||
      attributeValue(otlp, 'langfuse.observation.input') !== expectedInput ||
      attributeValue(otlp, 'langfuse.observation.model.name') !== expectedModel ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_availability') !==
        observation.usage.availability ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_source') !==
        observation.usage.source ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_accounting_mode') !==
        observation.usage.accountingMode ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_accounted') !==
        String(usageAccounted) ||
      attributeValue(otlp, 'langfuse.observation.metadata.turn_accounting_disposition') !==
        observation.turnAccounting?.disposition ||
      attributeValue(otlp, 'langfuse.observation.metadata.turn_accounting_owner_observation_id') !==
        observation.turnAccounting?.ownerObservationId ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_values') !==
        (usageValues ? jsonString(usageValues) : undefined) ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_value_sources') !==
        (usageValueSources ? jsonString(usageValueSources) : undefined) ||
      attributeValue(otlp, 'langfuse.observation.metadata.usage_limitations') !==
        jsonString(usageLimitations) ||
      attributeValue(otlp, 'langfuse.observation.usage_details') !==
        observationUsageDetails(observation) ||
      jsonString(legacy.body.usage) !== jsonString(
        observation.kind === 'model_call' && usageAccounted
          ? legacyUsage(observation)
          : undefined,
      ) ||
      attributeValue(otlp, 'langfuse.observation.metadata.timing_availability') !==
        observation.timing.availability ||
      attributeValue(otlp, 'langfuse.observation.metadata.timing_mapping') !==
        otlpTiming.mapping ||
      attributeValue(otlp, 'langfuse.observation.metadata.limitations') !==
        jsonString(limitations) ||
      jsonString(otlp.status) !== jsonString(spanStatus(observation.status))
    ) {
      return false;
    }
  }
  return legacyEvents.length === aggregate.observations.length + 1 &&
    spans.length === aggregate.observations.length + 1;
}

function withDiagnostics(
  state: LangfuseDeliveryState,
  mode: TaskObservationExporterMode,
  primary: TaskObservationDeliveryState['primary_protocol'],
  idempotencyKey: string | undefined,
  extras: Pick<TaskObservationDeliveryState, 'shadow_protocol' | 'shadow_status'> = {},
): TaskObservationDeliveryState {
  return {
    ...state,
    ...(idempotencyKey ? { langfuse_idempotency_key: idempotencyKey } : {}),
    exporter_mode: mode,
    primary_protocol: primary,
    ...extras,
  };
}

function payloadTooLarge(
  mode: TaskObservationExporterMode,
  primary: TaskObservationDeliveryState['primary_protocol'],
  idempotencyKey: string | undefined,
): TaskObservationDeliveryState {
  return withDiagnostics({
    langfuse_expected: true,
    langfuse_delivery_status: 'failed',
    langfuse_drop_reason: 'payload_too_large',
    langfuse_attempt_count: 0,
  }, mode, primary, idempotencyKey);
}

function otlpPartialSuccess(body: string): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as { partialSuccess?: { rejectedSpans?: unknown } };
    const value = parsed.partialSuccess?.rejectedSpans;
    return (typeof value === 'number' && value > 0) ||
      (typeof value === 'string' && Number.parseInt(value, 10) > 0);
  } catch {
    return false;
  }
}

async function postOtlpTaskPayload(
  config: TaskObservationExporterConfig,
  payload: OtlpTraceExportRequestV1,
  opts: TaskObservationExportOptions,
): Promise<LangfuseDeliveryState> {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > HARD_BATCH_MAX_BYTES) {
    return {
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'payload_too_large',
      langfuse_attempt_count: 0,
    };
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const attempts = config.retries + 1;
  let attemptCount = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      attemptCount += 1;
      opts.onDeliveryAttempt?.();
      const response = await fetchImpl(`${config.baseUrl}${LANGFUSE_OTLP_TRACES_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: config.authHeader,
          'Content-Type': 'application/json',
          'x-langfuse-ingestion-version': LANGFUSE_OTLP_INGESTION_VERSION,
          ...(opts.deliveryIdempotencyKey
            ? { 'Idempotency-Key': opts.deliveryIdempotencyKey }
            : {}),
        },
        signal: AbortSignal.timeout(config.timeoutMs),
        body: serialized,
      });
      if (!response.ok) {
        if (attempt < attempts && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(
            resolve,
            opts.retryDelayMs ?? Math.min(1_000, 250 * 2 ** (attempt - 1)),
          ));
          continue;
        }
        return {
          langfuse_expected: true,
          langfuse_delivery_status: 'failed',
          langfuse_drop_reason: response.status === 413
            ? 'payload_too_large'
            : response.status >= 500
              ? 'langfuse_5xx'
              : 'langfuse_4xx',
          langfuse_attempt_count: attemptCount,
        };
      }
      const body = await response.text().catch(() => '');
      if (otlpPartialSuccess(body)) {
        return {
          langfuse_expected: true,
          langfuse_delivery_status: 'failed',
          langfuse_drop_reason: 'langfuse_4xx',
          langfuse_attempt_count: attemptCount,
        };
      }
      return {
        langfuse_expected: true,
        langfuse_delivery_status: 'accepted',
        langfuse_attempt_count: attemptCount,
      };
    } catch {
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(
          resolve,
          opts.retryDelayMs ?? Math.min(1_000, 250 * 2 ** (attempt - 1)),
        ));
        continue;
      }
      return {
        langfuse_expected: true,
        langfuse_delivery_status: 'failed',
        langfuse_drop_reason: 'network_error',
        langfuse_attempt_count: attemptCount,
      };
    }
  }
  return {
    langfuse_expected: true,
    langfuse_delivery_status: 'failed',
    langfuse_drop_reason: 'network_error',
    langfuse_attempt_count: attemptCount,
  };
}

/**
 * Deliver one final task aggregate. Consent is checked before either payload is
 * built. `dual` deliberately sends legacy only and compares OTLP locally, so a
 * production project never receives duplicate logical observations.
 */
export async function exportTaskObservationAggregate(
  aggregate: StrategyTaskObservationAggregateV1,
  opts: TaskObservationExportOptions,
): Promise<TaskObservationDeliveryState> {
  const mode = opts.config?.mode ?? 'legacy';
  const plan = prepareLegacyTaskObservationExport({
    aggregate,
    prefs: opts.prefs,
    hasEffectiveSink: opts.config !== null,
  });
  if (!plan.expectation.expected) {
    return withDiagnostics({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: plan.expectation.reason,
      langfuse_attempt_count: 0,
    }, mode, 'none', opts.deliveryIdempotencyKey);
  }
  const config = opts.config!;
  try {
    const legacyBatch = plan.batch;
    if (mode === 'otlp') {
      const otlpPayload = buildOtlpTaskObservationPayload(aggregate);
      if (!legacyAndOtlpTaskMappingsMatch(aggregate, legacyBatch, otlpPayload)) {
        return withDiagnostics({
          langfuse_expected: true,
          langfuse_delivery_status: 'failed',
          langfuse_drop_reason: 'export_mapping_mismatch',
          langfuse_attempt_count: 0,
        }, mode, 'otlp-v4', opts.deliveryIdempotencyKey);
      }
      const state = await postOtlpTaskPayload(config, otlpPayload, opts);
      return withDiagnostics(state, mode, 'otlp-v4', opts.deliveryIdempotencyKey);
    }

    const legacySerialized = JSON.stringify({ batch: legacyBatch });
    if (Buffer.byteLength(legacySerialized, 'utf8') > HARD_BATCH_MAX_BYTES) {
      return payloadTooLarge(mode, 'legacy-v1', opts.deliveryIdempotencyKey);
    }
    const matched = mode === 'dual'
      ? legacyAndOtlpTaskMappingsMatch(
          aggregate,
          legacyBatch,
          buildOtlpTaskObservationPayload(aggregate),
        )
      : true;
    let attemptCount = 0;
    const state = await postLangfuseBatch(
      config,
      legacyBatch,
      opts.fetchImpl ?? globalThis.fetch,
      () => {
        attemptCount += 1;
        opts.onDeliveryAttempt?.();
      },
    );
    return withDiagnostics({
      ...state,
      langfuse_attempt_count: attemptCount,
    }, mode, 'legacy-v1', opts.deliveryIdempotencyKey, mode === 'dual'
      ? { shadow_protocol: 'otlp-v4', shadow_status: matched ? 'matched' : 'mismatch' }
      : {});
  } catch {
    return withDiagnostics({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'payload_build_error',
      langfuse_attempt_count: 0,
    }, mode, mode === 'otlp' ? 'otlp-v4' : 'legacy-v1', opts.deliveryIdempotencyKey);
  }
}
