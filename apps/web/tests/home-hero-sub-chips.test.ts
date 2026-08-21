import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { automaticStrategyTaskProfileForRouteId } from '@open-design/contracts';
import {
  filterPluginsBySubChip,
  isSubChipParent,
  subChipsForChip,
  taskTypeChipIdForChipId,
} from '../src/components/home-hero/sub-chips';
import { HOME_HERO_CHIPS } from '../src/components/home-hero/chips';

// Minimal record whose facet derivation lands in a known prototype scene.
// `byMode('prototype')` keys off manifest.od.mode; subcategory tests key off
// tags (slugified). See plugins-home/facets.ts.
function prototypePlugin(id: string, tags: string[]): InstalledPluginRecord {
  return {
    id,
    title: id,
    manifest: { name: id, od: { mode: 'prototype' }, tags },
  } as unknown as InstalledPluginRecord;
}

describe('subChipsForChip', () => {
  it('returns no sub-chips for chips without a second-level rail', () => {
    const records = [prototypePlugin('p-dash', ['dashboard'])];
    expect(subChipsForChip('image', records)).toEqual([]);
    expect(subChipsForChip('video', records)).toEqual([]);
    expect(subChipsForChip('audio', records)).toEqual([]);
    expect(subChipsForChip('live-artifact', records)).toEqual([]);
    // Neighbour witness: HyperFrames owns no second-level rail at all, so it
    // has no nested scene that could ever swap its route.
    expect(subChipsForChip('hyperframes', records)).toEqual([]);
    expect(subChipsForChip(null, records)).toEqual([]);
  });

  it('always exposes the fixed eight prototype scenes in product order', () => {
    const records = [
      prototypePlugin('p-dash', ['dashboard']),
      prototypePlugin('p-land', ['landing-page']),
    ];
    const result = subChipsForChip('prototype', records);
    expect(result.map((s) => s.slug)).toEqual([
      'landing-marketing',
      'business-dashboards',
      'mobile',
      'wireframe',
      'app-prototypes',
      'developer-tools',
      'brand-design',
      'docs-reports',
    ]);
    const dash = result.find((s) => s.slug === 'business-dashboards');
    expect(dash?.label).toBe('Dashboards');
    expect(result.find((s) => s.slug === 'mobile')?.actionChipId).toBe('mobile');
    expect(result.find((s) => s.slug === 'wireframe')?.actionChipId).toBe('wireframe');
  });

  it('keeps the fixed prototype hierarchy visible without installed plugins', () => {
    expect(subChipsForChip('prototype', [])).toHaveLength(8);
  });

  it('keeps the Home prototype hierarchy independent from the dynamic plugin catalog', () => {
    const displayed = [prototypePlugin('p-land', ['landing-page'])];
    const slugs = subChipsForChip('prototype', displayed).map((s) => s.slug);
    expect(slugs).toContain('business-dashboards');
    expect(slugs).toContain('developer-tools');
    expect(slugs).toContain('mobile');
  });
});

describe('filterPluginsBySubChip', () => {
  it('narrows a plugin list to the chosen sub-category', () => {
    const dash = prototypePlugin('p-dash', ['dashboard']);
    const land = prototypePlugin('p-land', ['landing-page']);
    const result = filterPluginsBySubChip([dash, land], 'prototype', 'business-dashboards');
    expect(result.map((p) => p.id)).toEqual(['p-dash']);
  });
});

describe('isSubChipParent', () => {
  it('matches only prototype and deck', () => {
    expect(isSubChipParent('prototype')).toBe(true);
    expect(isSubChipParent('deck')).toBe(true);
    expect(isSubChipParent('image')).toBe(false);
    expect(isSubChipParent(null)).toBe(false);
  });
});

describe('taskTypeChipIdForChipId', () => {
  it('folds the Mobile and Wireframe catalog actions back onto their Prototype parent', () => {
    // A second-level scene refines WHAT to build; it never decides WHETHER the
    // parent task type's product route applies.
    expect(taskTypeChipIdForChipId('mobile')).toBe('prototype');
    expect(taskTypeChipIdForChipId('wireframe')).toBe('prototype');
    expect(taskTypeChipIdForChipId('prototype')).toBe('prototype');
  });

  it('leaves every other chip id — and no id at all — untouched', () => {
    for (const chipId of [
      'deck',
      'hyperframes',
      'web-clone',
      'webgl',
      'live-artifact',
      'document',
      'image',
      'video',
      'audio',
      'figma',
      'template',
      'create-plugin',
      'create-brand-kit',
    ]) {
      expect(taskTypeChipIdForChipId(chipId)).toBe(chipId);
    }
    expect(taskTypeChipIdForChipId(null)).toBeNull();
  });

  it('routes exactly the product-owned OD Next task types and nothing else', () => {
    // Full catalog sweep: the automatic route set must not silently grow when a
    // chip is added or a nested scene is introduced.
    const routed = HOME_HERO_CHIPS
      .filter((chip) => automaticStrategyTaskProfileForRouteId(
        taskTypeChipIdForChipId(chip.id),
      ) !== null)
      .map((chip) => chip.id)
      .sort();
    expect(routed).toEqual(['deck', 'hyperframes', 'mobile', 'prototype', 'wireframe']);
    expect(
      HOME_HERO_CHIPS
        .filter((chip) => automaticStrategyTaskProfileForRouteId(
          taskTypeChipIdForChipId(chip.id),
        ) === 'prototype')
        .map((chip) => chip.id)
        .sort(),
    ).toEqual(['mobile', 'prototype', 'wireframe']);
  });
});
