import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  clearOdNextRolloutStop,
  evaluateOdNextRollout,
  latchOdNextRolloutStop,
  migrateOdNextRolloutStore,
  odNextRolloutSignalForRun,
  odNextTaskTypeForProjectMetadata,
  readOdNextRolloutPolicy,
  readOdNextRolloutStop,
  stableOdNextAssignmentBucket,
  stopModeForOdNextSignal,
} from '../../../src/strategies/od-next/rollout.js';

function syntheticPolicy() {
  return readOdNextRolloutPolicy({
    OD_NEXT_STRATEGY_ROLLOUT: 'active',
    OD_NEXT_STRATEGY_LOCAL_SYNTHETIC_CANARY: '1',
  });
}

describe('OD Next controlled rollout', () => {
  it('keeps off and observe behavior-inert and never calls an active bucket eligible', () => {
    for (const requestedMode of ['off', 'observe'] as const) {
      const decision = evaluateOdNextRollout({
        policy: { ...syntheticPolicy(), requestedMode },
        assignmentIdentity: 'project:conversation',
        taskType: 'prototype',
        agentId: 'codex',
        agentVersion: 'codex-e2e 0.0.0',
        sourceKind: 'bundled',
      });
      expect(decision).toMatchObject({ requestedMode, effectiveMode: requestedMode, eligible: false });
    }
  });

  it('allows only explicit local synthetic active while X1/X2 remain unresolved', () => {
    const base = {
      assignmentIdentity: 'project:conversation',
      taskType: 'prototype' as const,
      agentId: 'codex',
      sourceKind: 'bundled',
    };
    expect(evaluateOdNextRollout({
      ...base,
      policy: readOdNextRolloutPolicy({ OD_NEXT_STRATEGY_ROLLOUT: 'active' }),
      agentVersion: 'codex 9.9.9',
    })).toMatchObject({
      effectiveMode: 'observe',
      eligible: false,
      reasonCodes: expect.arrayContaining([
        'od_next_rollout_x1_capability_fixture_unverified',
        'od_next_rollout_x2_active_unapproved',
      ]),
    });
    expect(evaluateOdNextRollout({
      ...base,
      policy: syntheticPolicy(),
      agentVersion: null,
    })).toMatchObject({ effectiveMode: 'active', eligible: true, syntheticCanary: true });
  });

  it('gates task bucket, agent, version, bundled provenance, content, behavior, and assignment', () => {
    const decision = evaluateOdNextRollout({
      policy: {
        ...syntheticPolicy(),
        contentEnabled: false,
        behaviorEnabled: false,
        assignmentPercent: 0,
      },
      assignmentIdentity: 'same-id',
      taskType: 'ppt',
      agentId: 'cursor',
      agentVersion: 'cursor-e2e 0.0.0',
      sourceKind: 'community',
    });
    expect(decision.effectiveMode).toBe('off');
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      'od_next_rollout_content_disabled',
      'od_next_rollout_behavior_disabled',
      'od_next_rollout_task_bucket_ineligible',
      'od_next_rollout_agent_ineligible',
      'od_next_rollout_bundled_identity_required',
      'od_next_rollout_assignment_excluded',
    ]));
  });

  it('reconstructs stable assignment across evaluations', () => {
    const bucket = stableOdNextAssignmentBucket('project:conversation', 'salt');
    expect(stableOdNextAssignmentBucket('project:conversation', 'salt')).toBe(bucket);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(10_000);
  });

  it('persists automatic stop and manual rollback without touching task rows', () => {
    const db = new Database(':memory:');
    migrateOdNextRolloutStore(db);
    latchOdNextRolloutStop(db, { mode: 'observe', reasonCode: 'native_resume_failed', updatedAt: 1 });
    expect(readOdNextRolloutStop(db)).toEqual({ mode: 'observe', reasonCode: 'native_resume_failed' });
    latchOdNextRolloutStop(db, { mode: 'off', reasonCode: 'machine_contract_leak', updatedAt: 2 });
    expect(readOdNextRolloutStop(db)).toEqual({ mode: 'off', reasonCode: 'machine_contract_leak' });
    latchOdNextRolloutStop(db, { mode: 'observe', reasonCode: 'quality_regression', updatedAt: 3 });
    expect(readOdNextRolloutStop(db)).toEqual({
      mode: 'off',
      reasonCode: 'machine_contract_leak',
    });
    clearOdNextRolloutStop(db);
    expect(readOdNextRolloutStop(db)).toBeNull();
    db.close();
  });

  it('maps execution-local stop signals without any observability dependency', () => {
    expect(stopModeForOdNextSignal('native_resume_failed')).toBe('observe');
    expect(stopModeForOdNextSignal('machine_contract_leak')).toBe('off');
    expect(stopModeForOdNextSignal('unknown')).toBeNull();
    expect(odNextRolloutSignalForRun({ durationMs: 101, maxDurationMs: 100 }))
      .toBe('threshold_exceeded');
    expect(odNextRolloutSignalForRun({ durationMs: 100, maxDurationMs: 100 }))
      .toBeNull();
  });

  it('requires exact HyperFrames metadata and lets hard off dominate an observe latch', () => {
    expect(odNextTaskTypeForProjectMetadata({ kind: 'video' })).toBeNull();
    expect(odNextTaskTypeForProjectMetadata({ kind: 'video', videoModel: 'veo-3' })).toBeNull();
    expect(odNextTaskTypeForProjectMetadata({
      kind: 'video',
      videoModel: 'hyperframes-html',
    })).toBe('hyperframes');
    expect(evaluateOdNextRollout({
      policy: { ...syntheticPolicy(), requestedMode: 'off' },
      assignmentIdentity: 'project:conversation',
      taskType: 'prototype',
      agentId: 'codex',
      agentVersion: 'codex-e2e 0.0.0',
      sourceKind: 'bundled',
      stoppedMode: 'observe',
    }).effectiveMode).toBe('off');
  });
});
