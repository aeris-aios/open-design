import type {
  OpenDesignPlanContractV2,
  StrategyRuntimeStateV2,
} from '@open-design/contracts';
import {
  AppliedStrategyBindingV2Schema,
  OD_NEXT_RUNTIME_STATE_SCHEMA,
  composeOdNextStrategyContinuationV2,
} from '@open-design/contracts';
import type Database from 'better-sqlite3';

import { getSnapshot } from '../../plugins/snapshots.js';
import { countRenderableQuestionForms } from '../../question-form-detect.js';
import {
  compareAndTransitionStrategyTaskExecution,
  getStrategyTaskExecution,
  strategyPlanContractHash,
  type StrategyTaskExecutionRecord,
} from '../task-store.js';
import type { OdNextMachineProtocolStream } from './protocol.js';
import {
  decideStrategyRequestRoute,
  runExecutionPreflight,
  runIntakePreflight,
  type OdNextDirectEditEligibility,
  type OdNextExecutionPreflightInput,
  type OdNextIntakePreflightInput,
} from './resolver.js';

type SqliteDb = Database.Database;

export type OdNextCoordinatorReasonCode =
  | 'od_next_route_already_locked'
  | 'od_next_route_not_locked'
  | 'od_next_task_not_found'
  | 'od_next_task_not_running'
  | 'od_next_task_run_mismatch'
  | 'od_next_protocol_route_mismatch'
  | 'od_next_protocol_stage_mismatch'
  | 'od_next_protocol_execution_mode_mismatch'
  | 'od_next_protocol_plan_contract_missing'
  | 'od_next_protocol_plan_contract_unexpected'
  | 'od_next_clarification_form_missing'
  | 'od_next_clarification_form_ambiguous'
  | 'od_next_clarification_form_unexpected'
  | 'od_next_clarification_answer_missing'
  | 'od_next_clarification_repeated'
  | 'od_next_contract_repair_semantic_drift'
  | 'od_next_contract_repair_tool_use_forbidden'
  | 'od_next_plan_task_profile_mismatch'
  | 'od_next_plan_snapshot_mismatch'
  | 'od_next_plan_strategy_version_mismatch'
  | 'od_next_plan_strategy_package_hash_mismatch'
  | 'od_next_plan_selected_agent_mismatch'
  | 'od_next_preflight_execution_facts_missing'
  | 'od_next_physical_run_not_succeeded'
  | 'od_next_canonical_deliverable_invalid';

export class OdNextCoordinatorError extends Error {
  constructor(
    message: string,
    readonly reasonCodes: string[],
  ) {
    super(message);
    this.name = 'OdNextCoordinatorError';
  }
}

export interface OdNextCoordinatorResult {
  action:
    | 'running'
    | 'awaiting_clarification'
    | 'contract_repair'
    | 'plan_ready'
    | 'completed'
    | 'blocked'
    | 'canceled';
  task: StrategyTaskExecutionRecord;
  visibleText: string;
  reasonCodes: string[];
  decisionSummary?: OpenDesignPlanContractV2['decisionSummary'];
  instruction?:
    | {
        stage: 'clarification';
        nativeSessionResume: true;
        answer: string;
      }
    | {
        stage: 'contract_repair';
        nativeSessionResume: true;
        serializationIssue: string;
      };
}

function requireTask(db: SqliteDb, taskExecutionId: string): StrategyTaskExecutionRecord {
  const task = getStrategyTaskExecution(db, taskExecutionId);
  if (!task) {
    throw new OdNextCoordinatorError(
      `Unknown OD Next task execution ${taskExecutionId}.`,
      ['od_next_task_not_found'],
    );
  }
  return task;
}

function uniqueReasonCodes(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

/**
 * Run the request-stage Intake Preflight WITHOUT locking a route.
 *
 * Product spec 3.1 makes the main Agent the party that decides Direct Edit vs
 * Full Plan, and it can only decide once it has read the request. The daemon
 * therefore leaves `route` null through the request turn — a state both the
 * task store and the projection contract model explicitly — and adopts the
 * Agent's declaration when the turn comes back. Callers that already know the
 * route keep using `prepareStrategyRequest`.
 */
export function prepareStrategyIntake(db: SqliteDb, input: {
  taskExecutionId: string;
  intake: OdNextIntakePreflightInput;
  execution?: OdNextExecutionPreflightInput;
}): { ok: boolean; reasonCodes: string[] } {
  const current = requireTask(db, input.taskExecutionId);
  if (
    current.route !== null
    || current.inputStage !== 'request'
    || current.runs.length !== 1
  ) {
    throw new OdNextCoordinatorError(
      'OD Next routes each new logical task exactly once.',
      ['od_next_route_already_locked'],
    );
  }
  if (current.outcome !== 'running') {
    throw new OdNextCoordinatorError(
      'Only a running request can be routed.',
      ['od_next_task_not_running'],
    );
  }
  // The Agent may still choose Direct Edit, the one route that Builds on the
  // request stage, so execution facts are validated up front when available.
  const reasonCodes = uniqueReasonCodes([
    ...runIntakePreflight(input.intake).reasonCodes,
    ...(input.execution ? runExecutionPreflight(input.execution).reasonCodes : []),
  ]);
  return { ok: reasonCodes.length === 0, reasonCodes };
}

export function prepareStrategyRequest(db: SqliteDb, input: {
  taskExecutionId: string;
  preference: 'auto' | 'direct_edit' | 'full_plan';
  directEdit: OdNextDirectEditEligibility;
  intake: OdNextIntakePreflightInput;
  execution?: OdNextExecutionPreflightInput;
  updatedAt?: number;
}): OdNextCoordinatorResult {
  const current = requireTask(db, input.taskExecutionId);
  if (
    current.route !== null
    || current.inputStage !== 'request'
    || current.runs.length !== 1
  ) {
    throw new OdNextCoordinatorError(
      'OD Next routes each new logical task exactly once.',
      ['od_next_route_already_locked'],
    );
  }
  if (current.outcome !== 'running') {
    throw new OdNextCoordinatorError(
      'Only a running request can be routed.',
      ['od_next_task_not_running'],
    );
  }
  const route = decideStrategyRequestRoute({
    preference: input.preference,
    routeLocked: false,
    buildStarted: false,
    directEdit: input.directEdit,
  });
  const preflight = runIntakePreflight(input.intake);
  const preflightCodes = route.route === 'direct_edit'
    ? preflight.reasonCodes.filter(
      (code) => code !== 'od_next_preflight_native_continuation_unverified',
    )
    : preflight.reasonCodes;
  const executionCodes = route.route === 'direct_edit'
    ? input.execution
      ? runExecutionPreflight(input.execution).reasonCodes
      : ['od_next_preflight_execution_facts_missing']
    : [];
  const blockingCodes = [...preflightCodes, ...executionCodes];
  const reasonCodes = uniqueReasonCodes([...route.reasonCodes, ...blockingCodes]);
  const task = compareAndTransitionStrategyTaskExecution(db, {
    taskExecutionId: current.taskExecutionId,
    expectedRevision: current.revision,
    to: {
      route: route.route,
      inputStage: 'request',
      outcome: blockingCodes.length > 0 ? 'blocked' : 'running',
      executionMode: route.executionMode,
    },
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });
  return {
    action: task.outcome === 'blocked' ? 'blocked' : 'running',
    task,
    visibleText: '',
    reasonCodes,
  };
}

export function beginStrategyClarification(db: SqliteDb, input: {
  taskExecutionId: string;
  sourceRunId: string;
  nextRunId: string;
  answer: string;
  updatedAt?: number;
}): OdNextCoordinatorResult {
  const current = requireTask(db, input.taskExecutionId);
  if (
    current.route !== 'full_plan'
    || current.inputStage !== 'request'
    || current.outcome !== 'clarification_required'
    || current.clarificationCount !== 0
  ) {
    throw new OdNextCoordinatorError(
      'The task is not awaiting its one allowed clarification answer.',
      ['od_next_clarification_repeated'],
    );
  }
  if (input.sourceRunId !== current.latestRunId) {
    throw new OdNextCoordinatorError(
      'The clarification must continue from the latest task Run.',
      ['od_next_task_run_mismatch'],
    );
  }
  const answer = input.answer.trim();
  if (!answer) {
    throw new OdNextCoordinatorError(
      'A clarification continuation requires the user answer.',
      ['od_next_clarification_answer_missing'],
    );
  }
  const finalText = composeOdNextStrategyContinuationV2({
    stage: 'clarification',
    nativeSessionResume: true,
    taskExecutionId: current.taskExecutionId,
    taskRunIndex: current.runs.length,
    answer,
  });
  const task = compareAndTransitionStrategyTaskExecution(db, {
    taskExecutionId: current.taskExecutionId,
    expectedRevision: current.revision,
    to: {
      route: 'full_plan',
      inputStage: 'clarification',
      outcome: 'running',
      executionMode: null,
    },
    nextRun: {
      runId: input.nextRunId,
      sourceRunId: input.sourceRunId,
      finalText,
    },
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });
  return {
    action: 'running',
    task,
    visibleText: '',
    reasonCodes: [],
    instruction: { stage: 'clarification', nativeSessionResume: true, answer },
  };
}

export function finalizeStrategyPlanningTurn(db: SqliteDb, input: {
  taskExecutionId: string;
  runId: string;
  protocol: OdNextMachineProtocolStream;
  repairRun?: { runId: string; sourceRunId: string; finalText: string };
  toolUseCount?: number;
  executionPreflight?: OdNextExecutionPreflightInput;
  completionEvidence?: {
    physicalStatus: 'succeeded' | 'failed' | 'canceled';
    deliverableValid: boolean;
  };
  productionEnforcementReasonCodes?: readonly string[];
  updatedAt?: number;
}): OdNextCoordinatorResult {
  return finalizeStrategyPlanningResult(db, {
    ...input,
    parsed: input.protocol.finish(),
  });
}

export function finalizeStrategyPlanningResult(db: SqliteDb, input: {
  taskExecutionId: string;
  runId: string;
  parsed: ReturnType<OdNextMachineProtocolStream['finish']>;
  repairRun?: { runId: string; sourceRunId: string; finalText: string };
  toolUseCount?: number;
  executionPreflight?: OdNextExecutionPreflightInput;
  completionEvidence?: {
    physicalStatus: 'succeeded' | 'failed' | 'canceled';
    deliverableValid: boolean;
  };
  productionEnforcementReasonCodes?: readonly string[];
  updatedAt?: number;
}): OdNextCoordinatorResult {
  const current = requireTask(db, input.taskExecutionId);
  if (current.outcome !== 'running') {
    throw new OdNextCoordinatorError(
      'Only the active running task stage can accept agent output.',
      ['od_next_task_not_running'],
    );
  }
  if (current.latestRunId !== input.runId) {
    throw new OdNextCoordinatorError(
      'Agent output must belong to the latest physical Run.',
      ['od_next_task_run_mismatch'],
    );
  }

  const parsed = input.parsed;
  if (parsed.normalizations.length > 0) {
    console.info('[od-next-task] protocol normalized', {
      taskExecutionId: input.taskExecutionId,
      runId: input.runId,
      normalizations: parsed.normalizations,
    });
  }
  const protocolCodes = uniqueReasonCodes(parsed.issues.map((issue) => issue.code));
  let state = parsed.runtimeState;
  if (protocolCodes.length > 0) {
    const inferred = inferClarificationRuntimeState(current, parsed);
    if (inferred) {
      console.info('[od-next-task] runtime state inferred', {
        taskExecutionId: current.taskExecutionId,
        runId: input.runId,
        outcome: inferred.outcome,
      });
      state = inferred;
    } else {
      const plan = parsed.planContract ?? parsed.repairPlanContract;
      const bindingCodes = plan ? validatePlanBinding(db, current, plan) : [];
      const repair = tryBeginSerializationRepair(db, current, input, parsed, protocolCodes);
      if (repair) return repair;
      return blockTask(
        db,
        current,
        parsed.visibleText,
        [...protocolCodes, ...bindingCodes],
        input.updatedAt,
      );
    }
  }
  if (!state) {
    return blockTask(
      db,
      current,
      parsed.visibleText,
      ['od_next_protocol_runtime_state_missing'],
      input.updatedAt,
    );
  }
  const reasonCodes = validateAcceptedTurn(db, current, state, parsed.planContract, parsed.visibleText, {
    toolUseCount: input.toolUseCount ?? 0,
    ...(input.executionPreflight ? { executionPreflight: input.executionPreflight } : {}),
    ...(input.completionEvidence ? { completionEvidence: input.completionEvidence } : {}),
    ...(input.productionEnforcementReasonCodes
      ? { productionEnforcementReasonCodes: input.productionEnforcementReasonCodes }
      : {}),
  });
  if (reasonCodes.length > 0) {
    return blockTask(db, current, parsed.visibleText, reasonCodes, input.updatedAt);
  }

  if (current.route === null) {
    console.info('[od-next-task] route adopted from agent', {
      taskExecutionId: current.taskExecutionId,
      runId: input.runId,
      route: state.route,
      executionMode: state.executionMode,
    });
  }
  const task = compareAndTransitionStrategyTaskExecution(db, {
    taskExecutionId: current.taskExecutionId,
    expectedRevision: current.revision,
    to: {
      route: state.route,
      inputStage: state.inputStage,
      outcome: state.outcome,
      executionMode: state.executionMode,
    },
    ...(parsed.planContract ? { planContract: parsed.planContract } : {}),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });
  return {
    action: state.outcome === 'clarification_required'
      ? 'awaiting_clarification'
      : state.outcome,
    task,
    visibleText: parsed.visibleText,
    reasonCodes: state.reasonCodes,
    ...(parsed.planContract
      ? { decisionSummary: parsed.planContract.decisionSummary }
      : {}),
  };
}

/**
 * Deterministically recover the one runtime state a compliant clarification
 * turn could have declared. A first Full-Plan request turn that renders
 * exactly one question form and no machine block has exactly one valid
 * protocol meaning — outcome clarification_required with an unlocked
 * execution mode — so the daemon accepts it instead of dead-ending the task,
 * and stamps the inference into the state's reasonCodes for attribution.
 * Anything ambiguous (a recovered plan block, extra or missing forms, a later
 * stage, a spent clarification budget) stays fail-closed.
 */
function inferClarificationRuntimeState(
  current: StrategyTaskExecutionRecord,
  parsed: ReturnType<OdNextMachineProtocolStream['finish']>,
): StrategyRuntimeStateV2 | null {
  const issueCodes = [...new Set(parsed.issues.map((issue) => issue.code))];
  if (
    issueCodes.length !== 1
    || issueCodes[0] !== 'od_next_protocol_runtime_state_missing'
  ) return null;
  if (
    (current.route !== null && current.route !== 'full_plan')
    || current.inputStage !== 'request'
    || current.clarificationCount > 0
    || parsed.planContract
    || parsed.repairPlanContract
    || parsed.runtimeState
    || parsed.repairRuntimeState
  ) return null;
  if (countRenderableQuestionForms(parsed.visibleText) !== 1) return null;
  return {
    schema: OD_NEXT_RUNTIME_STATE_SCHEMA,
    route: 'full_plan',
    inputStage: 'request',
    outcome: 'clarification_required',
    executionMode: null,
    reasonCodes: ['od_next_protocol_runtime_state_inferred'],
  };
}

function validateAcceptedTurn(
  db: SqliteDb,
  task: StrategyTaskExecutionRecord,
  state: StrategyRuntimeStateV2,
  plan: OpenDesignPlanContractV2 | undefined,
  visibleText: string,
  input: {
    toolUseCount: number;
    executionPreflight?: OdNextExecutionPreflightInput;
    completionEvidence?: {
      physicalStatus: 'succeeded' | 'failed' | 'canceled';
      deliverableValid: boolean;
    };
    productionEnforcementReasonCodes?: readonly string[];
  },
): string[] {
  const reasonCodes: string[] = [];
  // An unrouted request turn is the one place the Agent owns the route
  // (spec 3.1). Once the chain has a route, it is locked for every later turn.
  if (task.route !== null && state.route !== task.route) {
    reasonCodes.push('od_next_protocol_route_mismatch');
  }
  if (state.inputStage !== task.inputStage) reasonCodes.push('od_next_protocol_stage_mismatch');
  if (task.executionMode && state.executionMode !== task.executionMode) {
    reasonCodes.push('od_next_protocol_execution_mode_mismatch');
  }
  if (state.route === 'direct_edit' && state.executionMode !== 'simple') {
    reasonCodes.push('od_next_protocol_execution_mode_mismatch');
  }

  const forms = countRenderableQuestionForms(visibleText);
  if (state.outcome === 'clarification_required') {
    if (forms === 0) reasonCodes.push('od_next_clarification_form_missing');
    if (forms > 1) reasonCodes.push('od_next_clarification_form_ambiguous');
    if (task.clarificationCount > 0 || task.inputStage !== 'request') {
      reasonCodes.push('od_next_clarification_repeated');
    }
  } else if (forms > 0) {
    reasonCodes.push(
      task.clarificationCount > 0 || task.inputStage === 'clarification'
        ? 'od_next_clarification_repeated'
        : 'od_next_clarification_form_unexpected',
    );
  }

  if (state.outcome === 'plan_ready') {
    if (!plan) reasonCodes.push('od_next_protocol_plan_contract_missing');
    if (!input.executionPreflight) {
      reasonCodes.push('od_next_preflight_execution_facts_missing');
    } else {
      reasonCodes.push(...runExecutionPreflight(input.executionPreflight).reasonCodes);
    }
    reasonCodes.push(...(input.productionEnforcementReasonCodes ?? []));
  } else if (plan) {
    reasonCodes.push('od_next_protocol_plan_contract_unexpected');
  }
  if (plan && state.executionMode !== plan.fullPlan.executionMode) {
    reasonCodes.push('od_next_protocol_execution_mode_mismatch');
  }
  if (plan) reasonCodes.push(...validatePlanBinding(db, task, plan));
  if (
    task.inputStage === 'contract_repair'
    && input.toolUseCount > 0
  ) {
    reasonCodes.push('od_next_contract_repair_tool_use_forbidden');
  }
  if (
    task.inputStage === 'contract_repair'
    && task.planContractHash
    && plan
    && strategyPlanContractHash(plan) !== task.planContractHash
  ) {
    reasonCodes.push('od_next_contract_repair_semantic_drift');
  }
  if (state.outcome === 'completed') {
    if (input.completionEvidence?.physicalStatus !== 'succeeded') {
      reasonCodes.push('od_next_physical_run_not_succeeded');
    }
    if (input.completionEvidence?.deliverableValid !== true) {
      reasonCodes.push('od_next_canonical_deliverable_invalid');
    }
    reasonCodes.push(...(input.productionEnforcementReasonCodes ?? []));
  }
  return uniqueReasonCodes(reasonCodes);
}

function tryBeginSerializationRepair(
  db: SqliteDb,
  current: StrategyTaskExecutionRecord,
  input: {
    repairRun?: { runId: string; sourceRunId: string; finalText: string };
    toolUseCount?: number;
    executionPreflight?: OdNextExecutionPreflightInput;
    updatedAt?: number;
  },
  parsed: ReturnType<OdNextMachineProtocolStream['finish']>,
  protocolCodes: string[],
): OdNextCoordinatorResult | null {
  const nonRepairable = new Set([
    'od_next_protocol_machine_block_too_large',
    'od_next_protocol_plan_contract_duplicate',
    'od_next_protocol_plan_contract_invalid_schema',
    'od_next_protocol_runtime_state_duplicate',
    'od_next_protocol_runtime_state_invalid_schema',
  ]);
  // A recovered Plan Contract is itself a Full Plan declaration, so an
  // as-yet-unrouted first turn qualifies; the repair transition locks
  // `full_plan` below.
  if (
    (current.route !== null && current.route !== 'full_plan')
    || !['request', 'clarification'].includes(current.inputStage)
    || protocolCodes.some((code) => nonRepairable.has(code))
  ) return null;
  if (current.planContractRepairAttempts > 0) return null;
  const plan = parsed.planContract ?? parsed.repairPlanContract;
  if (!plan) return null;
  if (validatePlanBinding(db, current, plan).length > 0) return null;
  if (
    !input.executionPreflight
    || runExecutionPreflight(input.executionPreflight).status !== 'passed'
  ) return null;
  const recoveredState = parsed.runtimeState ?? parsed.repairRuntimeState;
  if (recoveredState) {
    const stateCodes = validateRepairAnchorState(current, recoveredState, plan);
    if (stateCodes.length > 0) return null;
  }
  const repairRun = input.repairRun;
  if (!repairRun) return null;
  if (repairRun.sourceRunId !== current.latestRunId) return null;

  // Lock the recovered semantic plan/mode before entering repair, then claim
  // the repair Run. The outer immediate transaction makes the two existing
  // Task06 CAS writes one atomic coordinator decision; the transition schema
  // can therefore truthfully require repair to preserve an already-locked
  // execution mode.
  const persistRepair = db.transaction(() => {
    const locked = compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: current.taskExecutionId,
      expectedRevision: current.revision,
      to: {
        route: 'full_plan',
        inputStage: current.inputStage,
        outcome: 'running',
        executionMode: plan.fullPlan.executionMode,
      },
      planContract: plan,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    });
    return compareAndTransitionStrategyTaskExecution(db, {
      taskExecutionId: locked.taskExecutionId,
      expectedRevision: locked.revision,
      to: {
        route: 'full_plan',
        inputStage: 'contract_repair',
        outcome: 'running',
        executionMode: plan.fullPlan.executionMode,
      },
      nextRun: repairRun,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    });
  });
  const task = persistRepair.immediate();
  return {
    action: 'contract_repair',
    task,
    visibleText: parsed.visibleText,
    reasonCodes: protocolCodes,
    decisionSummary: plan.decisionSummary,
    instruction: {
      stage: 'contract_repair',
      nativeSessionResume: true,
      serializationIssue: protocolCodes.join(', '),
    },
  };
}

function validateRepairAnchorState(
  task: StrategyTaskExecutionRecord,
  state: StrategyRuntimeStateV2,
  plan: OpenDesignPlanContractV2,
): string[] {
  const reasonCodes: string[] = [];
  // The repair anchor may arrive on a still-unrouted first turn; the repair
  // transition locks `full_plan` right after this check.
  if (task.route !== null && state.route !== task.route) {
    reasonCodes.push('od_next_protocol_route_mismatch');
  }
  if (state.inputStage !== task.inputStage) reasonCodes.push('od_next_protocol_stage_mismatch');
  if (state.outcome !== 'plan_ready') reasonCodes.push('od_next_protocol_plan_contract_unexpected');
  if (state.executionMode !== plan.fullPlan.executionMode) {
    reasonCodes.push('od_next_protocol_execution_mode_mismatch');
  }
  return reasonCodes;
}

function validateTaskProfileBinding(
  db: SqliteDb,
  task: StrategyTaskExecutionRecord,
  plan: OpenDesignPlanContractV2,
): string[] {
  const snapshot = getSnapshot(db, task.snapshotId);
  const binding = AppliedStrategyBindingV2Schema.safeParse(snapshot?.strategy);
  if (
    !binding.success
    || plan.taskProfile.taskType !== binding.data.selectedTaskProfile.taskType
    || plan.taskProfile.taskProfileVersion !== binding.data.selectedTaskProfile.version
  ) {
    return ['od_next_plan_task_profile_mismatch'];
  }
  return [];
}

function validatePlanBinding(
  db: SqliteDb,
  task: StrategyTaskExecutionRecord,
  plan: OpenDesignPlanContractV2,
): string[] {
  const reasonCodes: string[] = [];
  if (plan.strategy.snapshotId !== task.snapshotId) {
    reasonCodes.push('od_next_plan_snapshot_mismatch');
  }
  if (plan.strategy.version !== task.strategyVersion) {
    reasonCodes.push('od_next_plan_strategy_version_mismatch');
  }
  if (plan.strategy.packageHash !== task.strategyPackageHash) {
    reasonCodes.push('od_next_plan_strategy_package_hash_mismatch');
  }
  if (plan.runManifest.selectedAgentId !== task.selectedAgentId) {
    reasonCodes.push('od_next_plan_selected_agent_mismatch');
  }
  reasonCodes.push(...validateTaskProfileBinding(db, task, plan));
  return uniqueReasonCodes(reasonCodes);
}

function blockTask(
  db: SqliteDb,
  current: StrategyTaskExecutionRecord,
  visibleText: string,
  reasonCodes: string[],
  updatedAt?: number,
): OdNextCoordinatorResult {
  // A turn that never produced a usable route cannot have proven Direct Edit
  // eligibility, so it settles on the spec's fallback route (3.2: "or cannot
  // be safely judged as Direct Edit") rather than failing to record at all.
  const route = current.route ?? 'full_plan';
  const blockedReasonCodes = uniqueReasonCodes(reasonCodes);
  console.warn('[od-next-task] blocked', {
    taskExecutionId: current.taskExecutionId,
    runId: current.latestRunId,
    inputStage: current.inputStage,
    reasonCodes: blockedReasonCodes,
  });
  const task = compareAndTransitionStrategyTaskExecution(db, {
    taskExecutionId: current.taskExecutionId,
    expectedRevision: current.revision,
    to: {
      route,
      inputStage: current.inputStage,
      outcome: 'blocked',
      executionMode: current.executionMode,
    },
    blockedContext: {
      reasonCodes: blockedReasonCodes,
      visibleText: visibleText.length > 0 ? visibleText : null,
    },
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });
  return {
    action: 'blocked',
    task,
    visibleText,
    reasonCodes: blockedReasonCodes,
  };
}
