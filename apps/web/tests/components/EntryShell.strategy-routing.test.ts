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

  it('carries the official example reference on the surviving automatic branch', () => {
    expect(entryStrategyRoutingFields({
      automaticStrategyTaskProfile: 'prototype',
      exampleReference: { pluginId: 'example-web-prototype', source: '/plugins/web-prototype' },
      skillId: 'implicit-default-skill',
    }, { kind: 'prototype' })).toEqual({
      skillId: null,
      automaticStrategyTaskProfile: 'prototype',
      exampleReference: { pluginId: 'example-web-prototype', source: '/plugins/web-prototype' },
    });
  });

  it('drops the example reference when the claimed automatic route fails re-validation', () => {
    // Fail-closed: the reference only means anything alongside the route it was
    // claimed for. Collapsing to the ordinary plugin branch must not smuggle it
    // through — the daemon would otherwise resolve example material for a
    // project that is no longer on an OD Next route.
    expect(entryStrategyRoutingFields({
      automaticStrategyTaskProfile: 'prototype',
      exampleReference: { pluginId: 'example-web-prototype', source: '/plugins/web-prototype' },
      skillId: 'ordinary-default-skill',
      pluginInputs: { legacy: true },
    }, { kind: 'prototype', fidelity: 'wireframe' })).toEqual({
      skillId: 'ordinary-default-skill',
      pluginInputs: { legacy: true },
    });
  });
});
