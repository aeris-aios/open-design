import {
  NormalizedAgentObservationV1Schema,
  OdNextRuntimeCapabilitySnapshotV1Schema,
  evaluateRuntimeEvidenceGraphV1,
  type NormalizedAgentObservationV1,
  type OdNextRuntimeCapabilitySnapshotV1,
  type OpenDesignPlanContractV2,
} from '@open-design/contracts';

import {
  evaluateOdNextExecutionEligibility,
  hashOdNextRuntimeCapabilitySnapshotV1,
} from '../../runtimes/od-next-capability-gate.js';

export type OdNextComplexProductionReasonCode =
  | 'od_next_complex_capability_snapshot_missing'
  | 'od_next_complex_capability_snapshot_invalid'
  | 'od_next_complex_capability_agent_mismatch'
  | 'od_next_complex_capability_version_drift'
  | 'od_next_complex_native_continuation_unverified'
  | 'od_next_complex_native_subagents_unsupported'
  | 'od_next_complex_native_subagents_unverified'
  | 'od_next_complex_child_lifecycle_unverified'
  | 'od_next_complex_child_evidence_missing'
  | 'od_next_complex_child_evidence_invalid'
  | 'od_next_complex_child_parent_mismatch'
  | 'od_next_complex_child_package_missing'
  | 'od_next_complex_child_package_unknown'
  | 'od_next_complex_child_package_mismatch'
  | 'od_next_complex_child_package_duplicate'
  | 'od_next_complex_child_started_missing'
  | 'od_next_complex_child_terminal_missing'
  | 'od_next_complex_child_failed'
  | 'od_next_complex_package_dependency_order_invalid'
  | 'od_next_complex_parent_summary_missing'
  | 'od_next_complex_parent_summary_incomplete';

export interface OdNextComplexRuntimeEvidence {
  capabilitySnapshot?: unknown;
  /**
   * Provider-neutral observations emitted by a verified runtime adapter. The
   * package association is a structured `attributes.buildPackageId` field;
   * this boundary never inspects Prompt text, assistant prose, or raw stdout.
   */
  observations?: readonly unknown[];
  taskRunObservationId?: string;
}

export interface OdNextComplexGateResult {
  eligible: boolean;
  reasonCodes: OdNextComplexProductionReasonCode[];
}

function uniqueReasonCodes(
  values: readonly OdNextComplexProductionReasonCode[],
): OdNextComplexProductionReasonCode[] {
  return [...new Set(values)];
}

function capabilitySnapshotHashIsValid(
  snapshot: OdNextRuntimeCapabilitySnapshotV1,
): boolean {
  const { snapshotHash: _snapshotHash, ...withoutHash } = snapshot;
  return hashOdNextRuntimeCapabilitySnapshotV1(withoutHash) === snapshot.snapshotHash;
}

/**
 * Gate a locked complex Plan against the exact fixture-backed capability
 * snapshot recorded in its RunManifest. Synthetic tests may supply a snapshot
 * that simulates this registry output; production support still comes only
 * from the Task14 registry and sanitized fixture replay.
 */
export function evaluateOdNextComplexEligibility(input: {
  plan: OpenDesignPlanContractV2;
  selectedAgentId: string;
  capabilitySnapshot?: unknown;
}): OdNextComplexGateResult {
  if (input.capabilitySnapshot === undefined) {
    return {
      eligible: false,
      reasonCodes: ['od_next_complex_capability_snapshot_missing'],
    };
  }
  const parsed = OdNextRuntimeCapabilitySnapshotV1Schema.safeParse(
    input.capabilitySnapshot,
  );
  if (!parsed.success || !capabilitySnapshotHashIsValid(parsed.data)) {
    return {
      eligible: false,
      reasonCodes: ['od_next_complex_capability_snapshot_invalid'],
    };
  }
  const snapshot = parsed.data;
  const reasonCodes: OdNextComplexProductionReasonCode[] = [];
  if (
    snapshot.agentId !== input.selectedAgentId
    || snapshot.agentId !== input.plan.runManifest.selectedAgentId
  ) {
    reasonCodes.push('od_next_complex_capability_agent_mismatch');
  }
  const planSnapshotHash = snapshot.snapshotHash.startsWith('sha256:')
    ? snapshot.snapshotHash.slice('sha256:'.length)
    : snapshot.snapshotHash;
  if (planSnapshotHash !== input.plan.runManifest.capabilitySnapshotHash) {
    reasonCodes.push('od_next_complex_capability_version_drift');
  }

  const eligibility = evaluateOdNextExecutionEligibility(snapshot, 'complex');
  if (!eligibility.eligible) {
    if (eligibility.reason === 'native_continuation_not_verified') {
      reasonCodes.push('od_next_complex_native_continuation_unverified');
    } else if (snapshot.nativeSubagents.support === 'unsupported') {
      reasonCodes.push('od_next_complex_native_subagents_unsupported');
    } else if (eligibility.reason === 'native_subagents_not_verified') {
      reasonCodes.push('od_next_complex_native_subagents_unverified');
    } else {
      reasonCodes.push('od_next_complex_child_lifecycle_unverified');
    }
  }
  const unique = uniqueReasonCodes(reasonCodes);
  return { eligible: unique.length === 0, reasonCodes: unique };
}

function buildPackageId(
  observation: NormalizedAgentObservationV1,
): string | undefined {
  const value = observation.attributes?.buildPackageId;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Prove that every required Build Package has one direct native Child with a
 * monotonic started -> completed lifecycle, that dependencies were observed
 * in order, and that the parent summary completed after the children. Array
 * order is the normalized adapter replay order, avoiding cross-clock math.
 */
/**
 * Does this runtime's Child evidence carry Build Package ownership?
 *
 * Ownership travels on a per-runtime transport: the daemon issues opaque
 * handles through Claude's `--agents` contract and reads them back from the
 * structured `subagent_type`, and only `claude-child-evidence.ts` stamps
 * `attributes.buildPackageId`. No other adapter has that transport, by the
 * scope decision recorded beside the binding factory in
 * `automatic-simple-production.ts` ("never teach Codex/OpenCode a Claude tool
 * shape").
 *
 * Runtimes without it must still be able to finish a complex task. Demanding
 * an attribute their adapter cannot produce refused every complex run on
 * Codex, native OpenCode and AMR at the completion turn — after a full
 * production Run had already been spent — and the blocked verdict then latched
 * OD Next off for the whole daemon. Package-ownership assertions are therefore
 * scoped to the runtimes that can answer them; every lifecycle, graph, parent
 * and ordering assertion still applies to all four.
 */
export function ownsOdNextNativeBuildPackageBindings(agentId: string): boolean {
  return agentId === 'claude';
}

export function evaluateOdNextComplexChildEvidence(input: {
  plan: OpenDesignPlanContractV2;
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  observations?: readonly unknown[];
  taskRunObservationId?: string;
  /**
   * Assert that every Child names the Build Package it owns. Only meaningful
   * for a runtime whose adapter stamps `attributes.buildPackageId`; see
   * `ownsOdNextNativeBuildPackageBindings`. Defaults to asserting so a caller
   * must opt out deliberately.
   */
  verifiesBuildPackageOwnership?: boolean;
}): OdNextComplexGateResult {
  const verifiesBuildPackageOwnership = input.verifiesBuildPackageOwnership ?? true;
  if (!input.observations || input.observations.length === 0) {
    return {
      eligible: false,
      reasonCodes: ['od_next_complex_child_evidence_missing'],
    };
  }
  const parsed = input.observations.map((value) =>
    NormalizedAgentObservationV1Schema.safeParse(value));
  if (parsed.some((result) => !result.success)) {
    return {
      eligible: false,
      reasonCodes: ['od_next_complex_child_evidence_invalid'],
    };
  }
  const observations = parsed.flatMap((result) => result.success ? [result.data] : []);
  const reasonCodes: OdNextComplexProductionReasonCode[] = [];
  if (observations.some((observation) => (
    observation.identity.taskExecutionId !== input.taskExecutionId
    || observation.identity.runId !== input.runId
    || observation.identity.taskRunIndex !== input.taskRunIndex
  ))) {
    reasonCodes.push('od_next_complex_child_evidence_invalid');
  }

  const graph = evaluateRuntimeEvidenceGraphV1(observations);
  if (!graph.valid || (graph.evidenceLevel !== 'L2' && graph.evidenceLevel !== 'L3')) {
    reasonCodes.push('od_next_complex_child_evidence_invalid');
    if (graph.issues.some((issue) => (
      issue.code === 'child_started_missing' || issue.code === 'status_regression'
    ))) {
      reasonCodes.push('od_next_complex_child_started_missing');
    }
    if (graph.issues.some((issue) => issue.code === 'child_terminal_missing')) {
      reasonCodes.push('od_next_complex_child_terminal_missing');
    }
    if (graph.issues.some((issue) => (
      issue.code === 'child_parent_missing'
      || issue.code === 'parent_missing'
      || issue.code === 'parent_identity_changed'
      || issue.code === 'cross_run_parent'
      || issue.code === 'parent_cycle'
    ))) {
      reasonCodes.push('od_next_complex_child_parent_mismatch');
    }
  }

  const rootId = input.taskRunObservationId;
  if (!rootId) {
    reasonCodes.push('od_next_complex_parent_summary_missing');
  }
  const indexed = observations.map((observation, index) => ({ observation, index }));
  const rootEvents = rootId
    ? indexed.filter(({ observation }) => (
        observation.kind === 'task_run'
        && observation.identity.observationId === rootId
        && observation.identity.parentObservationId === undefined
      ))
    : [];
  const rootCompletedAt = rootEvents.filter(({ observation }) => (
    observation.status === 'completed'
  )).at(-1)?.index ?? -1;
  if (
    rootEvents.length === 0
    || !rootEvents.some(({ observation }) => observation.status === 'running')
    || rootCompletedAt < 0
  ) {
    reasonCodes.push('od_next_complex_parent_summary_missing');
  }

  const childEvents = indexed.filter(({ observation }) => observation.kind === 'child_agent');
  const childIds = new Set(childEvents.map(({ observation }) => (
    observation.identity.observationId
  )));
  const packageIds = new Set(input.plan.fullPlan.buildPackages.map((item) => item.id));
  const packageToChildren = new Map<string, Set<string>>();
  const childStartedAt = new Map<string, number>();
  const childCompletedAt = new Map<string, number>();

  for (const childId of childIds) {
    const sequence = childEvents.filter(({ observation }) => (
      observation.identity.observationId === childId
    ));
    const parentIds = new Set(sequence.map(({ observation }) => (
      observation.identity.parentObservationId
    )));
    if (!rootId || parentIds.size !== 1 || !parentIds.has(rootId)) {
      reasonCodes.push('od_next_complex_child_parent_mismatch');
    }
    if (verifiesBuildPackageOwnership) {
      const assignedPackages = new Set(sequence.flatMap(({ observation }) => {
        const packageId = buildPackageId(observation);
        return packageId ? [packageId] : [];
      }));
      if (sequence.some(({ observation }) => buildPackageId(observation) === undefined)) {
        reasonCodes.push('od_next_complex_child_package_missing');
      }
      if (assignedPackages.size === 0) {
        reasonCodes.push('od_next_complex_child_package_missing');
        continue;
      }
      if (assignedPackages.size !== 1) {
        reasonCodes.push('od_next_complex_child_package_mismatch');
        continue;
      }
      const packageId = [...assignedPackages][0]!;
      if (!packageIds.has(packageId)) {
        reasonCodes.push('od_next_complex_child_package_unknown');
        continue;
      }
      const owners = packageToChildren.get(packageId) ?? new Set<string>();
      owners.add(childId);
      packageToChildren.set(packageId, owners);
    }

    const started = sequence.find(({ observation }) => observation.status === 'running');
    const completed = sequence.filter(({ observation }) => (
      observation.status === 'completed'
    )).at(-1);
    const terminal = sequence.find(({ observation }) => (
      observation.status === 'completed'
      || observation.status === 'failed'
      || observation.status === 'canceled'
    ));
    if (!started) reasonCodes.push('od_next_complex_child_started_missing');
    if (!terminal) reasonCodes.push('od_next_complex_child_terminal_missing');
    if (terminal && terminal.observation.status !== 'completed') {
      reasonCodes.push('od_next_complex_child_failed');
    }
    if (started) childStartedAt.set(childId, started.index);
    if (completed) childCompletedAt.set(childId, completed.index);
  }

  for (const buildPackage of verifiesBuildPackageOwnership
    ? input.plan.fullPlan.buildPackages
    : []) {
    const owners = packageToChildren.get(buildPackage.id);
    if (!owners || owners.size === 0) {
      reasonCodes.push('od_next_complex_child_package_missing');
      continue;
    }
    if (owners.size !== 1) {
      reasonCodes.push('od_next_complex_child_package_duplicate');
      continue;
    }
    const childId = [...owners][0]!;
    const startedAt = childStartedAt.get(childId);
    for (const dependencyId of buildPackage.dependsOn) {
      const dependencyChildren = packageToChildren.get(dependencyId);
      const dependencyChildId = dependencyChildren?.size === 1
        ? [...dependencyChildren][0]
        : undefined;
      const dependencyCompletedAt = dependencyChildId
        ? childCompletedAt.get(dependencyChildId)
        : undefined;
      if (
        startedAt === undefined
        || dependencyCompletedAt === undefined
        || startedAt <= dependencyCompletedAt
      ) {
        reasonCodes.push('od_next_complex_package_dependency_order_invalid');
      }
    }
  }

  const lastChildCompletedAt = childCompletedAt.size > 0
    ? Math.max(...childCompletedAt.values())
    : -1;
  if (rootCompletedAt >= 0 && rootCompletedAt <= lastChildCompletedAt) {
    reasonCodes.push('od_next_complex_parent_summary_incomplete');
  }

  const unique = uniqueReasonCodes(reasonCodes);
  return { eligible: unique.length === 0, reasonCodes: unique };
}

export function evaluateOdNextComplexProduction(input: {
  plan: OpenDesignPlanContractV2;
  selectedAgentId: string;
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  evidence?: OdNextComplexRuntimeEvidence;
}): OdNextComplexGateResult {
  const eligibility = evaluateOdNextComplexEligibility({
    plan: input.plan,
    selectedAgentId: input.selectedAgentId,
    capabilitySnapshot: input.evidence?.capabilitySnapshot,
  });
  const childEvidence = evaluateOdNextComplexChildEvidence({
    plan: input.plan,
    taskExecutionId: input.taskExecutionId,
    runId: input.runId,
    taskRunIndex: input.taskRunIndex,
    ...(input.evidence?.observations
      ? { observations: input.evidence.observations }
      : {}),
    ...(input.evidence?.taskRunObservationId
      ? { taskRunObservationId: input.evidence.taskRunObservationId }
      : {}),
    verifiesBuildPackageOwnership:
      ownsOdNextNativeBuildPackageBindings(input.selectedAgentId),
  });
  const reasonCodes = uniqueReasonCodes([
    ...eligibility.reasonCodes,
    ...childEvidence.reasonCodes,
  ]);
  return { eligible: reasonCodes.length === 0, reasonCodes };
}
