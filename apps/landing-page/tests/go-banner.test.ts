import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const home = readFileSync(
  new URL('../app/pages/index.astro', import.meta.url),
  'utf8',
);
const banner = readFileSync(
  new URL('../app/_components/go-banner.astro', import.meta.url),
  'utf8',
);
const copy = readFileSync(
  new URL('../app/go-banner-i18n.ts', import.meta.url),
  'utf8',
);

test('homepage mounts Go ahead of the existing paid-user DeepSeek banner', () => {
  assert.match(home, /import GoBanner from ['"]\.\.\/_components\/go-banner\.astro['"]/);
  assert.match(home, /<GoBanner locale=\{locale\} \/>[\s\S]*data-home-campaign-banner/);
  assert.match(banner, /html\.go-banner-active \.home-campaign-banner/);
});

test('Go banner classifies signed-out and unpaid visitors during the fixed window', () => {
  assert.match(banner, /2026-08-20T20:00:00\+08:00/);
  assert.match(banner, /2026-09-03T20:00:00\+08:00/);
  assert.match(banner, /\/api\/auth\/get-session/);
  assert.match(banner, /if \(!session\?\.user\) \{\s*show\(\)/);
  assert.match(banner, /\/api\/v1\/billing\/summary/);
  assert.match(banner, /tier === 'free' \|\| tier === 'none'/);
  assert.doesNotMatch(banner, /data-campaign-review-param|campaignPreview|previewEndAt/);
  assert.match(banner, /A failed entitlement probe cannot safely classify a signed-in visitor/);
});

test('Go banner uses the confirmed short copy and links to localized Pricing', () => {
  assert.match(copy, /detail: '首月 \$5 · 无限用'/);
  assert.match(copy, /detail: '\$5 first month · unlimited use'/);
  assert.match(banner, /localizedHref\('\/pricing\/', locale\)/);
  assert.match(banner, /data-go-banner-cta/);
});
