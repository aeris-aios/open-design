import { describe, expect, it } from 'vitest';
import { entryStrategyRoutingFields } from '../../src/components/entry-strategy-routing';

describe('EntryShell automatic strategy routing', () => {
  it.each([
    ['prototype', { kind: 'prototype' as const }],
    ['ppt', { kind: 'deck' as const }],
    ['marketing', { kind: 'prototype' as const, intent: 'marketing' as const }],
    ['hyperframes', { kind: 'video' as const, intent: 'hyperframes' as const }],
  ] as const)('lets OD Next own the %s route without implicit Skill or plugin inputs', (taskProfile, metadata) => {
    expect(entryStrategyRoutingFields({
      automaticStrategyTaskProfile: taskProfile,
      skillId: 'implicit-default-skill',
      pluginInputs: { legacy: true },
    }, metadata)).toEqual({
      skillId: null,
      automaticStrategyTaskProfile: taskProfile,
    });
  });

  it.each([
    { kind: 'prototype' as const, fidelity: 'wireframe' as const },
    { kind: 'prototype' as const, platformTargets: ['mobile-ios' as const] },
  ])('rejects a prototype claim for non-OD-Next metadata and preserves ordinary defaults', (metadata) => {
    expect(entryStrategyRoutingFields({
      automaticStrategyTaskProfile: 'prototype',
      skillId: 'ordinary-default-skill',
      pluginInputs: { legacy: true },
    }, metadata)).toEqual({
      skillId: 'ordinary-default-skill',
      pluginInputs: { legacy: true },
    });
  });
});
