import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

describe('web-prototype real-first imagery contract', () => {
  it('[P0] keeps filesystem and live-artifact resources aligned', async () => {
    const [
      filesystemSkill,
      artifactSkill,
      filesystemChecklist,
      artifactChecklist,
      filesystemLayouts,
      artifactLayouts,
    ] = await Promise.all([
      readRepoFile('design-templates/web-prototype/SKILL.md'),
      readRepoFile('plugins/_official/examples/web-prototype/SKILL.md'),
      readRepoFile('design-templates/web-prototype/references/checklist.md'),
      readRepoFile('plugins/_official/examples/web-prototype/references/checklist.md'),
      readRepoFile('design-templates/web-prototype/references/layouts.md'),
      readRepoFile('plugins/_official/examples/web-prototype/references/layouts.md'),
    ]);

    for (const skill of [filesystemSkill, artifactSkill]) {
      expect(skill).toContain('`.ph-img` is temporary layout scaffolding');
      expect(skill).toContain('search/fetch the correct real image');
      expect(skill).toContain('never generate, draw, or invent a substitute');
      expect(skill).not.toContain('Image placeholders, not external URLs');
    }
    expect(filesystemSkill).toContain('copy it into the project, and reference it relatively');
    expect(artifactSkill).toContain('embed it as a data URI in the artifact HTML');

    for (const checklist of [filesystemChecklist, artifactChecklist]) {
      expect(checklist).toContain('Named real-world referents use the correct real images');
      expect(checklist).toContain('No remote image dependencies');
    }
    expect(filesystemLayouts).toContain('replace the scaffold with the acquired project-local image');
    expect(artifactLayouts).toContain('replace the scaffold with an acquired image embedded as a data URI');
  });
});
