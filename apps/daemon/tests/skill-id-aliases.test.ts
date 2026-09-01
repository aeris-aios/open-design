import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SKILL_ID_ALIASES,
  findSkillById,
  listSkills,
  resolveSkillId,
} from '../src/skills.js';

// Regression coverage for skill-id renames (currently taste-skill →
// design-taste-frontend; the older editorial-collage → open-design-landing
// pair went away with the templates it pointed at). The daemon persists the
// chosen skill_id verbatim on a project row and resolves it later by id, so a
// folder/frontmatter rename without a compatibility shim would silently drop
// the skill prompt for projects saved against the old id. These tests pin the
// alias map and the lookup helper that every server-side resolver must go
// through.

let skillsRoot: string;

beforeAll(async () => {
  skillsRoot = await mkdtemp(path.join(tmpdir(), 'od-skills-aliases-'));
  // Mimic the on-disk shape the production registry expects: one
  // directory per skill, each with a SKILL.md whose frontmatter `name`
  // becomes the canonical id returned by listSkills().
  await mkdir(path.join(skillsRoot, 'design-taste-frontend'), { recursive: true });
  await writeFile(
    path.join(skillsRoot, 'design-taste-frontend', 'SKILL.md'),
    '---\nname: design-taste-frontend\ndescription: Front-end taste pass.\n---\n\nbody\n',
    'utf8',
  );
  // An untouched skill so we can prove the helper still resolves
  // non-aliased ids and does not match by accident.
  await mkdir(path.join(skillsRoot, 'simple-deck'), { recursive: true });
  await writeFile(
    path.join(skillsRoot, 'simple-deck', 'SKILL.md'),
    '---\nname: simple-deck\ndescription: Plain deck.\n---\n\nbody\n',
    'utf8',
  );
});

afterAll(async () => {
  if (skillsRoot) await rm(skillsRoot, { recursive: true, force: true });
});

describe('SKILL_ID_ALIASES', () => {
  it('maps every deprecated id to a non-empty canonical id', () => {
    const entries = Object.entries(SKILL_ID_ALIASES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [deprecated, canonical] of entries) {
      expect(deprecated.length).toBeGreaterThan(0);
      expect(typeof canonical).toBe('string');
      expect((canonical as string).length).toBeGreaterThan(0);
      expect(canonical).not.toBe(deprecated);
    }
  });

  it('maps the taste-skill rename to its current canonical id', () => {
    expect(SKILL_ID_ALIASES['taste-skill']).toBe('design-taste-frontend');
  });

  it('is frozen so callers cannot mutate the deprecation list at runtime', () => {
    expect(Object.isFrozen(SKILL_ID_ALIASES)).toBe(true);
  });
});

describe('resolveSkillId', () => {
  it('forwards deprecated ids to their canonical replacement', () => {
    expect(resolveSkillId('taste-skill')).toBe('design-taste-frontend');
  });

  it('passes non-aliased ids through unchanged', () => {
    expect(resolveSkillId('simple-deck')).toBe('simple-deck');
    expect(resolveSkillId('totally-unknown')).toBe('totally-unknown');
  });

  it('returns the input unchanged for empty / non-string ids', () => {
    expect(resolveSkillId('')).toBe('');
    expect(resolveSkillId(undefined)).toBeUndefined();
    expect(resolveSkillId(null)).toBeNull();
  });
});

describe('findSkillById', () => {
  it('resolves a project saved with the old taste-skill id to the renamed skill', async () => {
    const skills = await listSkills(skillsRoot);
    const skill = findSkillById(skills, 'taste-skill');
    if (!skill) throw new Error('taste-skill did not resolve through the alias map');
    expect(skill.id).toBe('design-taste-frontend');
    expect(skill.body).toContain('body');
  });

  it('still resolves current ids exactly', async () => {
    const skills = await listSkills(skillsRoot);
    expect(findSkillById(skills, 'design-taste-frontend')?.id).toBe(
      'design-taste-frontend',
    );
    expect(findSkillById(skills, 'simple-deck')?.id).toBe('simple-deck');
  });

  it('returns undefined for unknown ids and missing inputs', async () => {
    const skills = await listSkills(skillsRoot);
    expect(findSkillById(skills, 'definitely-not-a-skill')).toBeUndefined();
    expect(findSkillById(skills, '')).toBeUndefined();
    expect(findSkillById(null, 'design-taste-frontend')).toBeUndefined();
  });
});
