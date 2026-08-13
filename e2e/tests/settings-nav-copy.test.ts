/**
 * Settings-destination drift gate.
 *
 * When the daemon or the agent tells a user to go fix something —
 * "no Fal API key — configure it in Settings → …" — it names a
 * Settings section. Nothing tied that name to the Settings dialog, so
 * it drifted: media errors and the od-media-generation skill kept
 * pointing at a section called "Media" after the nav item had been
 * renamed to "Media providers" (`媒体生成提供商` in zh-CN), and users
 * following the instruction found no such entry. That was V0.19.1
 * acceptance bug recvre8FrTE2Oa.
 *
 * `packages/contracts/src/settings-nav.ts` is now the single place a
 * Settings destination is spelled. This gate holds the two ends
 * together:
 *
 *   1. Each constant still equals the English label the Settings nav
 *      actually renders (`apps/web/src/i18n/locales/en.ts`), so
 *      renaming the nav item without updating the constant fails here
 *      rather than in front of a user.
 *   2. No producer re-inlines its own guess: the daemon's media
 *      provider errors and the prompt/skill guidance must route
 *      through the constants, and must not name a Settings section
 *      that the nav does not have.
 *
 * Lives in `e2e/tests/` per the root `AGENTS.md` boundary rule — it
 * reads `apps/web`, `apps/daemon`, `packages/contracts`, and
 * `plugins/` together, which no single app package is allowed to do.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type SettingsNavContracts = {
  SETTINGS_MEDIA_PROVIDERS: string;
  SETTINGS_EXTERNAL_MCP: string;
  SETTINGS_MEDIA_PROVIDERS_PATH: string;
  SETTINGS_EXTERNAL_MCP_PATH: string;
};

const navModules = import.meta.glob<SettingsNavContracts>(
  '../../packages/contracts/src/settings-nav.ts',
  { eager: true },
);
const nav = Object.values(navModules)[0];
if (!nav) {
  throw new Error(
    'settings-nav gate could not load packages/contracts/src/settings-nav.ts via import.meta.glob; '
      + 'this almost always means the file was renamed or moved.',
  );
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

/** The value of one `'key': 'value'` entry in the English locale dictionary. */
function englishLabel(key: string): string {
  const en = read('apps/web/src/i18n/locales/en.ts');
  const match = en.match(
    new RegExp(`^\\s*['"]${key.replace(/\./g, '\\.')}['"]\\s*:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`, 'm'),
  );
  if (!match) throw new Error(`i18n key ${key} is missing from apps/web/src/i18n/locales/en.ts`);
  return match[2]!.replace(/\\(['"\\])/g, '$1');
}

describe('Settings destinations quoted to users', () => {
  it.each([
    ['SETTINGS_MEDIA_PROVIDERS', 'settings.mediaProviders'],
    ['SETTINGS_EXTERNAL_MCP', 'settings.externalMcpTitle'],
  ])('%s matches the label the Settings nav renders (%s)', (constant, key) => {
    expect(nav[constant as keyof SettingsNavContracts]).toBe(englishLabel(key));
  });

  it('writes a destination as "Settings → <section>"', () => {
    expect(nav.SETTINGS_MEDIA_PROVIDERS_PATH).toBe(`Settings → ${nav.SETTINGS_MEDIA_PROVIDERS}`);
    expect(nav.SETTINGS_EXTERNAL_MCP_PATH).toBe(`Settings → ${nav.SETTINGS_EXTERNAL_MCP}`);
  });

  it('never sends a media-credential error to a bare, unnamed "Settings"', () => {
    const source = read('apps/daemon/src/media/index.ts');
    const offenders = source
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      // Only lines that actually instruct the user, not prose comments.
      .filter(([, line]) => /configure[^\n]*\bin Settings\b|key in Settings\b/.test(line))
      .filter(([, line]) => !line.trimStart().startsWith('//'));
    expect(offenders).toEqual([]);
  });

  it('routes every media-credential error through the shared destination', () => {
    const source = read('apps/daemon/src/media/index.ts');
    // Sanity: the file really does still carry these errors, so an
    // accidental deletion cannot make the gate above vacuously pass.
    const routed = source.match(/\$\{SETTINGS_MEDIA_PROVIDERS_PATH\}/g) ?? [];
    expect(routed.length).toBeGreaterThanOrEqual(25);
  });

  it.each([
    'plugins/_official/scenarios/od-media-generation/SKILL.md',
    'apps/daemon/src/prompts/system.ts',
    'packages/contracts/src/prompts/system.ts',
    'skills/hatch-pet/SKILL.md',
    'plugins/_official/examples/hatch-pet/SKILL.md',
  ])('does not name a Settings section that the nav does not have: %s', (relative) => {
    // Markdown wraps mid-phrase, so compare against whitespace-normalized text
    // — otherwise "Settings → Media\n  providers" reads as a section named
    // "Media" and the gate reports a violation that isn't one.
    const text = read(relative).replace(/\s+/g, ' ');
    const known = [nav.SETTINGS_MEDIA_PROVIDERS, nav.SETTINGS_EXTERNAL_MCP, 'General'];
    for (const match of text.matchAll(/Settings\s*(?:→|->)\s*/g)) {
      const rest = text.slice(match.index! + match[0].length);
      // A template expression is the constant itself, already verified above.
      if (rest.startsWith('${')) continue;
      expect(
        known.some((section) => rest.startsWith(section)),
        `${relative} points at "Settings → ${rest.slice(0, 40)}…", which is not a Settings nav item. `
          + `Known sections: ${known.join(', ')}.`,
      ).toBe(true);
    }
  });
});
