import { describe, expect, it } from 'vitest';

import {
  isInternalStrategySnapshot,
  shouldShowSessionModeChip,
} from '../../src/runtime/strategy-turn-chrome';

const strategyBinding = {
  schema: 'open-design.applied-strategy/v2',
  id: 'od-next-strategy',
  version: '2.0.0',
  packageHash: 'b'.repeat(64),
  assetDigests: [{ path: './assets/task-profiles/prototype.md', sha256: 'b'.repeat(64) }],
  selectedTaskProfile: {
    taskType: 'prototype',
    path: './assets/task-profiles/prototype.md',
    sha256: 'b'.repeat(64),
    version: '2',
  },
  taskProfileVersions: ['2'],
  promptRecipe: 'od-next-plan-build-v2',
} as never;

describe('isInternalStrategySnapshot', () => {
  it('recognizes a daemon-applied strategy snapshot', () => {
    expect(isInternalStrategySnapshot({ strategy: strategyBinding })).toBe(true);
  });

  it('leaves ordinary plugin snapshots alone', () => {
    expect(isInternalStrategySnapshot({})).toBe(false);
    expect(isInternalStrategySnapshot({ strategy: null })).toBe(false);
    expect(isInternalStrategySnapshot(null)).toBe(false);
    expect(isInternalStrategySnapshot(undefined)).toBe(false);
  });
});

describe('shouldShowSessionModeChip', () => {
  it('drops the default Design label once a strategy owns the turn', () => {
    expect(
      shouldShowSessionModeChip({
        sessionMode: 'design',
        snapshot: { strategy: strategyBinding },
      }),
    ).toBe(false);
  });

  it('keeps the Design label when the user picked the plugin themselves', () => {
    expect(shouldShowSessionModeChip({ sessionMode: 'design', snapshot: {} })).toBe(true);
    expect(shouldShowSessionModeChip({ sessionMode: 'design', snapshot: null })).toBe(true);
  });

  it('keeps Ask and Plan labelled even on a strategy-owned turn', () => {
    for (const sessionMode of ['chat', 'plan'] as const) {
      expect(
        shouldShowSessionModeChip({ sessionMode, snapshot: { strategy: strategyBinding } }),
      ).toBe(true);
    }
  });

  it('renders nothing when the message carries no session mode', () => {
    expect(shouldShowSessionModeChip({ sessionMode: undefined, snapshot: null })).toBe(false);
  });
});
