import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

export type OdNextRolloutMode = 'off' | 'observe' | 'active';
export type OdNextRolloutTaskType = 'prototype' | 'ppt' | 'marketing' | 'hyperframes';

export interface OdNextRolloutPolicy {
  requestedMode: OdNextRolloutMode;
  assignmentPercent: number;
  assignmentSalt: string;
  contentEnabled: boolean;
  behaviorEnabled: boolean;
  eligibleTaskTypes: readonly OdNextRolloutTaskType[];
  eligibleAgents: readonly string[];
  productionActiveApproved: boolean;
  localSyntheticCanary: boolean;
}

export interface OdNextRolloutDecision {
  requestedMode: OdNextRolloutMode;
  effectiveMode: OdNextRolloutMode;
  taskType: OdNextRolloutTaskType | null;
  assignmentBucket: number;
  eligible: boolean;
  syntheticCanary: boolean;
  reasonCodes: string[];
}

const DEFAULT_TASK_TYPES: readonly OdNextRolloutTaskType[] = ['prototype', 'hyperframes'];
const DEFAULT_AGENTS = ['codex', 'claude', 'opencode', 'amr'] as const;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function mode(value: string | undefined): OdNextRolloutMode {
  return value === 'observe' || value === 'active' ? value : 'off';
}

export function readOdNextRolloutPolicy(
  env: NodeJS.ProcessEnv = process.env,
): OdNextRolloutPolicy {
  const taskTypes = list(env.OD_NEXT_STRATEGY_TASK_TYPES).filter(
    (value): value is OdNextRolloutTaskType => (
      value === 'prototype' || value === 'ppt' || value === 'marketing' || value === 'hyperframes'
    ),
  );
  const percent = Number(env.OD_NEXT_STRATEGY_ASSIGNMENT_PERCENT ?? '100');
  return {
    requestedMode: mode(env.OD_NEXT_STRATEGY_ROLLOUT),
    assignmentPercent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    assignmentSalt: env.OD_NEXT_STRATEGY_ASSIGNMENT_SALT?.trim() || 'od-next-v2-rollout',
    contentEnabled: bool(env.OD_NEXT_STRATEGY_CONTENT_ENABLED, true),
    behaviorEnabled: bool(env.OD_NEXT_STRATEGY_BEHAVIOR_ENABLED, true),
    eligibleTaskTypes: taskTypes.length > 0 ? taskTypes : DEFAULT_TASK_TYPES,
    eligibleAgents: list(env.OD_NEXT_STRATEGY_AGENTS).length > 0
      ? list(env.OD_NEXT_STRATEGY_AGENTS)
      : DEFAULT_AGENTS,
    productionActiveApproved: bool(env.OD_NEXT_STRATEGY_PRODUCTION_ACTIVE_APPROVED, false),
    localSyntheticCanary: bool(env.OD_NEXT_STRATEGY_LOCAL_SYNTHETIC_CANARY, false),
  };
}

export function odNextTaskTypeForProjectMetadata(
  metadata: { kind?: unknown; videoModel?: unknown } | null | undefined,
): OdNextRolloutTaskType | null {
  if (metadata?.kind === 'prototype') return 'prototype';
  if (metadata?.kind === 'deck') return 'ppt';
  if (metadata?.kind === 'image') return 'marketing';
  if (metadata?.kind === 'video' && metadata.videoModel === 'hyperframes-html') {
    return 'hyperframes';
  }
  return null;
}

export function stableOdNextAssignmentBucket(identity: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${identity}`).digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function evaluateOdNextRollout(input: {
  policy: OdNextRolloutPolicy;
  assignmentIdentity: string;
  taskType: OdNextRolloutTaskType | null;
  agentId: string | null;
  agentVersion: string | null;
  sourceKind: string | null;
  runtimeCapabilityVerified?: boolean;
  runtimeCapabilityReason?: string | null;
  stoppedMode?: Exclude<OdNextRolloutMode, 'active'> | null;
}): OdNextRolloutDecision {
  const { policy } = input;
  const assignmentBucket = stableOdNextAssignmentBucket(
    input.assignmentIdentity,
    policy.assignmentSalt,
  );
  const reasons: string[] = [];
  if (policy.requestedMode === 'off') reasons.push('od_next_rollout_off');
  if (!policy.contentEnabled) reasons.push('od_next_rollout_content_disabled');
  if (!policy.behaviorEnabled) reasons.push('od_next_rollout_behavior_disabled');
  if (!input.taskType || !policy.eligibleTaskTypes.includes(input.taskType)) {
    reasons.push('od_next_rollout_task_bucket_ineligible');
  }
  if (!input.agentId || !policy.eligibleAgents.includes(input.agentId)) {
    reasons.push('od_next_rollout_agent_ineligible');
  }
  if (input.sourceKind !== 'bundled') reasons.push('od_next_rollout_bundled_identity_required');
  if (assignmentBucket >= policy.assignmentPercent * 100) {
    reasons.push('od_next_rollout_assignment_excluded');
  }
  // This is an explicit, local-only escape hatch used to prove the public
  // daemon/browser chain while X1/X2 remain unresolved. It must never be
  // inferred from a runtime version (or enabled in a production process).
  const syntheticCanary = Boolean(
    policy.localSyntheticCanary && process.env.NODE_ENV !== 'production',
  );
  if (!input.agentVersion && !syntheticCanary) {
    reasons.push('od_next_rollout_runtime_version_unverified');
  }
  if (!input.runtimeCapabilityVerified && !syntheticCanary) {
    reasons.push('od_next_rollout_x1_capability_fixture_unverified');
    if (input.runtimeCapabilityReason) reasons.push(`od_next_rollout_capability_${input.runtimeCapabilityReason}`);
  }
  if (!policy.productionActiveApproved && !syntheticCanary) {
    reasons.push('od_next_rollout_x2_active_unapproved');
  }
  if (input.stoppedMode) reasons.push('od_next_rollout_stop_latched');

  const requestedActive = policy.requestedMode === 'active';
  const eligible = requestedActive && reasons.length === 0;
  const effectiveMode: OdNextRolloutMode = policy.requestedMode === 'off'
    || !policy.contentEnabled
    || !policy.behaviorEnabled
    ? 'off'
    : input.stoppedMode
      ?? (eligible
      ? 'active'
      : 'observe');
  return {
    requestedMode: policy.requestedMode,
    effectiveMode,
    taskType: input.taskType,
    assignmentBucket,
    eligible,
    syntheticCanary,
    reasonCodes: [...new Set(reasons)],
  };
}

export function migrateOdNextRolloutStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_rollout_controls (
      strategy_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('off', 'observe')),
      reason_code TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function readOdNextRolloutStop(
  db: Database.Database,
): { mode: 'off' | 'observe'; reasonCode: string } | null {
  const row = db.prepare(`
    SELECT mode, reason_code AS reasonCode
      FROM strategy_rollout_controls WHERE strategy_id = 'od-next-strategy'
  `).get() as { mode: 'off' | 'observe'; reasonCode: string } | undefined;
  return row ?? null;
}

export function latchOdNextRolloutStop(
  db: Database.Database,
  input: { mode: 'off' | 'observe'; reasonCode: string; updatedAt?: number },
): void {
  db.prepare(`
    INSERT INTO strategy_rollout_controls (strategy_id, mode, reason_code, updated_at)
    VALUES ('od-next-strategy', ?, ?, ?)
    ON CONFLICT(strategy_id) DO UPDATE SET
      mode = CASE WHEN excluded.mode = 'off' THEN 'off' ELSE strategy_rollout_controls.mode END,
      reason_code = CASE
        WHEN strategy_rollout_controls.mode = 'off' AND excluded.mode = 'observe'
          THEN strategy_rollout_controls.reason_code
        ELSE excluded.reason_code
      END,
      updated_at = excluded.updated_at
  `).run(input.mode, input.reasonCode, input.updatedAt ?? Date.now());
}

export function clearOdNextRolloutStop(db: Database.Database): void {
  db.prepare(`DELETE FROM strategy_rollout_controls WHERE strategy_id = 'od-next-strategy'`).run();
}

export function stopModeForOdNextSignal(signal: string): 'off' | 'observe' | null {
  if (signal === 'machine_contract_leak' || signal === 'default_critique_skipped') return 'off';
  if (
    signal === 'native_resume_failed'
    || signal === 'route_mode_drift'
    || signal === 'complex_child_unverified'
    || signal === 'threshold_exceeded'
    || signal === 'quality_regression'
  ) return 'observe';
  return null;
}

export function odNextRolloutSignalForRun(input: {
  durationMs: number;
  maxDurationMs?: number | null;
}): 'threshold_exceeded' | null {
  if (
    typeof input.maxDurationMs === 'number'
    && Number.isFinite(input.maxDurationMs)
    && input.maxDurationMs >= 0
    && input.durationMs > input.maxDurationMs
  ) return 'threshold_exceeded';
  return null;
}
