import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BundledStrategyDeclarationV2Schema } from '@open-design/contracts';
import { parseManifest } from '../src/index.js';

const pluginRoot = fileURLToPath(
  new URL('../../../plugins/_official/scenarios/od-next-strategy/', import.meta.url),
);
const manifestSource = readFileSync(`${pluginRoot}/open-design.json`, 'utf8');
const parsed = parseManifest(manifestSource);

if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const manifest = parsed.manifest;
const declaration = BundledStrategyDeclarationV2Schema.parse(
  (manifest.od as Record<string, unknown>)['strategy'],
);

const forbiddenContent = [
  /acceptanceChecklist/i,
  /evidence[ -]plan/i,
  /quality[ -]score/i,
  /judge(?:[ -]agent)?/i,
  /artifact[ -]repair/i,
  /candidate[ -]evidence[ -]bundle/i,
  /completion[ -]gate/i,
  /final[ -]evidence[ -]bundle/i,
  /repair[ -]required/i,
  /\brepeat\b/i,
  /\bcritique\b/i,
  /revalidation/i,
  /critique(?:-theater)?/i,
  /post[- ]build[\s\S]{0,80}(?:verify|inspect|check|review)/i,
  /(?:screenshot|browser|dom)[\s\S]{0,80}(?:verify|inspect|check|review)/i,
];

describe('bundled OD Next Strategy V2 package', () => {
  it('declares the inactive versioned asset set and exact planning recipe identity', () => {
    expect(manifest).toMatchObject({
      name: 'od-next-strategy',
      version: '2.0.0',
      od: {
        kind: 'scenario',
        hidden: true,
        strategy: {
          schema: 'open-design.bundled-strategy/v2',
          id: 'od-next-strategy',
          promptRecipe: 'od-next-plan-build-v2',
        },
      },
    });
    expect(declaration.assets.taskProfiles.map((profile) => [
      profile.taskType,
      profile.rollout,
      profile.projectKinds,
    ])).toEqual([
      ['prototype', 'active', ['prototype']],
      ['ppt', 'reserved', ['deck']],
      ['marketing', 'reserved', ['image']],
      ['hyperframes', 'active', ['video']],
    ]);
  });

  it('declares discovery, plan, and generate without a repeating stage', () => {
    expect(manifest.od?.pipeline?.stages).toEqual([
      { id: 'discovery', atoms: ['discovery-question-form'] },
      { id: 'plan', atoms: ['direction-picker', 'todo-write'] },
      { id: 'generate', atoms: ['file-write', 'live-artifact'] },
    ]);
    expect(manifest.od?.pipeline?.stages.some((stage) => stage.repeat)).toBe(false);
  });

  it('ships every declared asset and keeps strategy content on the pre-Build side', () => {
    const assetPaths = [
      declaration.assets.core.path,
      declaration.assets.orchestration.path,
      ...declaration.assets.taskProfiles.map((profile) => profile.path),
      declaration.assets.taskProfileMapping.path,
    ];
    expect(new Set(assetPaths).size).toBe(assetPaths.length);

    for (const assetPath of assetPaths) {
      const content = readFileSync(`${pluginRoot}/${assetPath.slice(2)}`, 'utf8');
      expect(content.length, assetPath).toBeGreaterThan(100);
      for (const forbidden of forbiddenContent) {
        expect(content, `${assetPath} must not match ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it('maps unknown project kinds to generic or blocked instead of guessing', () => {
    const mapping = readFileSync(
      `${pluginRoot}/${declaration.assets.taskProfileMapping.path.slice(2)}`,
      'utf8',
    );
    expect(mapping).toContain('use task type `generic`');
    expect(mapping).toContain('report blocked');
    expect(mapping).toContain('Never select the nearest specialist profile by guesswork');
  });
});
