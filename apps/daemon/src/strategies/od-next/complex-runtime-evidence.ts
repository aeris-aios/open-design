import type { OpenDesignPlanContractV2, StrategyInputStageV2 } from '@open-design/contracts';

import { buildStructuredMainRunObservationV1 } from '../../observability/main-run-observation.js';
import { adaptRuntimeChildObservationsV1 } from '../../observability/runtime-child-observations.js';
import { strategyTaskRunObservationId } from '../../observability/task-observation-aggregation.js';
import {
  OD_NEXT_RUNTIME_PATH_DESCRIPTORS,
  resolveBundledOdNextRuntimeCapability,
} from '../../runtimes/od-next-capability-gate.js';
import type { OdNextComplexRuntimeEvidence } from './complex-production.js';

interface ComplexRunEvidenceInput {
  phase: 'eligibility' | 'completion';
  taskExecutionId: string;
  runId: string;
  taskRunIndex: number;
  stage: StrategyInputStageV2;
  agentId: string;
  agentCliVersion?: string;
  runtimeCompanionName?: string;
  runtimeCompanionVersion?: string;
  plan: OpenDesignPlanContractV2;
  run: {
    status: string;
    createdAt: number;
    updatedAt: number;
    events: Array<{ event: string; data: unknown; timestamp?: number }>;
  };
}

/** Build complex evidence only from exact capability provenance and durable facts. */
export function resolveDaemonOwnedOdNextComplexRuntimeEvidence(
  input: ComplexRunEvidenceInput,
): OdNextComplexRuntimeEvidence | undefined {
  const capability = resolveBundledOdNextRuntimeCapability({
    agentId: input.agentId,
    ...(input.agentCliVersion ? { agentCliVersion: input.agentCliVersion } : {}),
    ...(input.runtimeCompanionName
      ? { runtimeCompanionName: input.runtimeCompanionName }
      : {}),
    ...(input.runtimeCompanionVersion
      ? { runtimeCompanionVersion: input.runtimeCompanionVersion }
      : {}),
  });
  if (!capability.snapshot) return undefined;
  if (input.phase === 'eligibility') {
    return { capabilitySnapshot: capability.snapshot };
  }
  const taskRunObservationId = strategyTaskRunObservationId(
    input.taskExecutionId,
    input.runId,
  );
  const runtimeAdapterVersion = OD_NEXT_RUNTIME_PATH_DESCRIPTORS.find((item) => (
    item.agentId === input.agentId
  ))?.runtimeAdapterVersion;
  const rootInput = {
    taskExecutionId: input.taskExecutionId,
    runId: input.runId,
    taskRunIndex: input.taskRunIndex,
    stage: input.stage,
    startedAtMs: input.run.createdAt,
    ...(input.agentCliVersion ? { agentCliVersion: input.agentCliVersion } : {}),
    ...(input.runtimeCompanionName
      ? { runtimeCompanionName: input.runtimeCompanionName }
      : {}),
    ...(input.runtimeCompanionVersion
      ? { runtimeCompanionVersion: input.runtimeCompanionVersion }
      : {}),
    ...(runtimeAdapterVersion ? { runtimeAdapterVersion } : {}),
  };
  const running = buildStructuredMainRunObservationV1({
    ...rootInput,
    status: 'running',
  });
  const children = adaptRuntimeChildObservationsV1({
    events: input.run.events,
    taskExecutionId: input.taskExecutionId,
    runId: input.runId,
    taskRunIndex: input.taskRunIndex,
    taskRunObservationId,
    stage: input.stage,
    ...(input.agentCliVersion ? { agentCliVersion: input.agentCliVersion } : {}),
    ...(input.runtimeCompanionVersion
      ? { runtimeCompanionVersion: input.runtimeCompanionVersion }
      : {}),
  });
  const completed = buildStructuredMainRunObservationV1({
    ...rootInput,
    status: 'completed',
    endedAtMs: input.run.updatedAt,
  });
  return {
    capabilitySnapshot: capability.snapshot,
    observations: [running, ...children, completed],
    taskRunObservationId,
  };
}
