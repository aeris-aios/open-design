// The limited-time 「Unlimited」 promise on the public Pricing page cannot
// import the workbench's AMR model-id table. Keep the campaign's display names
// mapped here and verify that each advertised model is actually unlimited for
// every Individual tier. Pricing intentionally advertises only the active
// campaign models, while the workbench may contain additional entitlements.
//
// The name ↔ id map below is the only translation layer; adding a popular model
// means adding it here too.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const PRICING_PAGE = `${repoRoot}apps/landing-page/app/_components/pricing-individual-plans.astro`;
const RUNTIME_TABLE = `${repoRoot}apps/web/src/runtime/amr-unlimited-models.ts`;

/** Pricing display name → the AMR model id the workbench receives. */
const MODEL_ID_BY_DISPLAY_NAME: Record<string, string> = {
  'DeepSeek V4 Flash Vision Exp': 'deepseek-v4-flash-vision-exp',
  'DeepSeek V4 Flash': 'deepseek-v4-flash',
  'DeepSeek V4 Pro': 'deepseek-v4-pro',
  'GLM-5.2': 'glm-5.2',
  'GLM-5.1': 'glm-5.1',
  'Kimi K2.7 Code': 'kimi-k2.7-code',
  'Kimi K2.6': 'kimi-k2.6',
  'MiMo V2.5 Pro': 'mimo-v2.5-pro',
  'MiniMax M2.7': 'minimax-m2.7',
};

const TIERS = ['go', 'plus', 'pro', 'max'] as const;
type Tier = (typeof TIERS)[number];

/** Prose in a comment ("Pro's fifth slot…") carries apostrophes that the
 *  quote-scanning below would read as model names, so comments come out first. */
function stripLineComments(source: string): string {
  // The whole LINE goes, newline included: leaving a blank line behind would
  // break the "next entry starts here" lookahead the tier scanner relies on.
  return source.replace(/^[ \t]*\/\/.*\n?/gm, '');
}

/** First capture group, or a failure naming what could not be found. */
function captureOne(source: string, pattern: RegExp, what: string): string {
  const captured = source.match(pattern)?.[1];
  if (captured === undefined) throw new Error(`${what} not found — did it get renamed?`);
  return captured;
}

/** Every first capture group across all matches. */
function captureAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** The `tier: …` entry inside an object literal body, up to the next entry. */
function tierEntry(body: string, tier: Tier, what: string): string {
  return captureOne(
    body,
    new RegExp(`\\n  ${tier}: ([\\s\\S]*?),(?=\\n  [a-z]+:|$)`),
    `tier ${tier} in ${what}`,
  );
}

/** Every `{ name: '…' }` entry in the page's `popularModels` list, in order. */
async function pricingPopularModelNames(): Promise<string[]> {
  const source = stripLineComments(await readFile(PRICING_PAGE, 'utf8'));
  const block = captureOne(
    source,
    /const popularModels: ModelItem\[\] = \[([\s\S]*?)\n\];/,
    'popularModels on the Pricing page',
  );
  return captureAll(block, /name: '([^']+)'/g);
}

/** The page's campaign-only unlimited models, resolved to AMR model ids. */
async function pricingCampaignUnlimitedIds(): Promise<string[]> {
  const source = stripLineComments(await readFile(PRICING_PAGE, 'utf8'));
  const block = captureOne(
    source,
    /const campaignUnlimitedModelNames = \[([\s\S]*?)\] as const;/,
    'campaignUnlimitedModelNames on the Pricing page',
  );
  return captureAll(block, /'([^']+)'/g).map((name) => {
    const id = MODEL_ID_BY_DISPLAY_NAME[name];
    expect(id, `no AMR model id mapped for the Pricing name "${name}"`).toBeTruthy();
    return id ?? name;
  });
}

/** The workbench's own table, read as source so this guard stays dependency-free. */
async function runtimeUnlimitedIdsByTier(): Promise<Record<Tier, string[]>> {
  const source = stripLineComments(await readFile(RUNTIME_TABLE, 'utf8'));

  // `const PLUS_UNLIMITED_MODELS = [...GO_UNLIMITED_MODELS, 'kimi-k2.7-code']`
  // — each list may spread an earlier one, so they resolve in declaration
  // order and a spread is replaced by what it names.
  const lists = new Map<string, string[]>();
  for (const match of source.matchAll(
    /const (\w+_UNLIMITED_MODELS) = \[([\s\S]*?)\] as const;/g,
  )) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue;
    const models: string[] = [];
    for (const entry of body.split(',')) {
      const spread = entry.match(/\.\.\.(\w+_UNLIMITED_MODELS)/)?.[1];
      if (spread) {
        models.push(...(lists.get(spread) ?? []));
        continue;
      }
      models.push(...captureAll(entry, /'([^']+)'/g));
    }
    lists.set(name, models);
  }

  const body = captureOne(
    source,
    /const UNLIMITED_MODELS_BY_PLAN[^=]*= \{([\s\S]*?)\n\};/,
    'UNLIMITED_MODELS_BY_PLAN in the runtime table',
  );
  const out = {} as Record<Tier, string[]>;
  for (const tier of TIERS) {
    const listName = captureOne(
      body,
      new RegExp(`\\n  ${tier}: new Set\\((\\w+_UNLIMITED_MODELS)\\)`),
      `tier ${tier} in UNLIMITED_MODELS_BY_PLAN`,
    );
    const models = lists.get(listName);
    if (models === undefined) {
      throw new Error(`${listName} is referenced but never declared`);
    }
    out[tier] = models;
  }
  return out;
}

describe('Pricing campaign models stay unlimited in the workbench', () => {
  it.each(TIERS)('is available on %s', async (tier) => {
    const pricing = await pricingCampaignUnlimitedIds();
    const runtime = await runtimeUnlimitedIdsByTier();
    expect(runtime[tier]).toEqual(expect.arrayContaining(pricing));
  });

  it('advertises only the two active DeepSeek campaign models', async () => {
    expect(await pricingCampaignUnlimitedIds()).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ]);
  });

  it('puts DeepSeek V4 Flash Vision Exp first in the popular-model list', async () => {
    expect((await pricingPopularModelNames())[0]).toBe('DeepSeek V4 Flash Vision Exp');
  });

  it('maps every popular model the Pricing page lists to an AMR model id', async () => {
    for (const name of await pricingPopularModelNames()) {
      expect(MODEL_ID_BY_DISPLAY_NAME[name], `unmapped Pricing model "${name}"`).toBeTruthy();
    }
  });
});
