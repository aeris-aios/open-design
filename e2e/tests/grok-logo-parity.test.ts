import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// The landing-page copies of this mark are certain-exempt surface owned by
// landing-page CI; apps/landing-page/tests/grok-logo-parity.test.ts anchors
// them against the product copy checked here.
const logoPaths = [
  'apps/web/public/agent-icons/grok-build.png',
  'design-templates/open-design-landing/assets/agents/grok-build.png',
] as const;

const sourcePaths = [
  'apps/web/src/components/AgentIcon.tsx',
  'apps/web/src/components/modelProviderIcon.ts',
  'apps/web/src/components/HomeHero.tsx',
  'design-templates/open-design-landing/example.html',
] as const;

describe('Grok Build logo parity', () => {
  it('ships one byte-identical supplied mark across product and template surfaces', async () => {
    const logos = await Promise.all(
      logoPaths.map((relativePath) => readFile(path.join(repoRoot, relativePath))),
    );

    expect(logos[0]?.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    for (const logo of logos.slice(1)) expect(logo).toEqual(logos[0]);
  });

  it('does not route live Grok or xAI surfaces back to the superseded X artwork', async () => {
    const sources = (
      await Promise.all(
        sourcePaths.map((relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8')),
      )
    ).join('\n');

    expect(sources).toContain('grok-build.png');
    expect(sources).not.toMatch(/grok-build\.svg|model-icons\/x\.svg|agents\/xai\.svg/);
  });
});
