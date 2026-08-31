// The docked composer at the foot of Community — its fold/unfold contract,
// end to end through the real entry shell.
//
// The bar is `HomeHero variant="dock"` hosted by EntryShell's
// `.community-composer-dock`. Four separate pieces decide whether it is folded,
// and three of them live in different files:
//   • it opens folded — the bar's resting state (per product: 用户进来的时候是
//     收起的);
//   • CommunityView raises `onTabsChange` on BOTH tab rows → EntryShell counts
//     up → HomeView passes `collapseSignal` down → HomeHero folds (per product:
//     tab 之间的切换的时候这个输入框默认是收起来的);
//   • scrolling the gallery folds it;
//   • a pointer anywhere on the bar unfolds it again.
//
// Only a real browser can hold the last one honest. Scrolling folds the bar
// WITHOUT blurring the editor, so clicking a bar the caret never left fires no
// focus event — and a jsdom `element.click()` does not move focus at all, so
// the component layer cannot tell the two apart. This spec drives real input.

import { expect, test } from '@/playwright/suite';
import type { Page } from '@playwright/test';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

const FUNDRAISING_DECK = {
  id: 'dock-fundraising-deck',
  title: 'Dock Fundraising Deck',
  version: '1.0.0',
  trust: 'bundled',
  sourceKind: 'bundled',
  source: '/tmp/dock-fundraising-deck',
  fsPath: '/tmp/dock-fundraising-deck',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'dock-fundraising-deck',
    title: 'Dock Fundraising Deck',
    version: '1.0.0',
    description: 'A decision-grade seed round narrative.',
    tags: ['deck'],
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      mode: 'deck',
      category: 'fundraising-pitch',
      useCase: { query: { en: 'Create a seed round pitch deck.' } },
    },
  },
} as const;

// Same type as the deck above, different category: this is what puts a second
// pill in the category row so it can be switched.
const SALES_DECK = {
  ...FUNDRAISING_DECK,
  id: 'dock-b2b-deck',
  title: 'Dock B2B Sales Deck',
  source: '/tmp/dock-b2b-deck',
  fsPath: '/tmp/dock-b2b-deck',
  manifest: {
    ...FUNDRAISING_DECK.manifest,
    name: 'dock-b2b-deck',
    title: 'Dock B2B Sales Deck',
    od: { ...FUNDRAISING_DECK.manifest.od, category: 'b2b-sales' },
  },
} as const;

// A second TYPE, so the type row has something to switch to.
const PROTOTYPE = {
  ...FUNDRAISING_DECK,
  id: 'dock-prototype',
  title: 'Dock Prototype',
  source: '/tmp/dock-prototype',
  fsPath: '/tmp/dock-prototype',
  manifest: {
    ...FUNDRAISING_DECK.manifest,
    name: 'dock-prototype',
    title: 'Dock Prototype',
    tags: ['prototype'],
    od: {
      ...FUNDRAISING_DECK.manifest.od,
      mode: 'prototype',
      category: 'product-prototype',
    },
  },
} as const;

// The two bundled scenarios the gallery's type tabs bind into the composer:
// `TEMPLATE_HOME_TARGET` maps Slides → the `deck` chip and Prototype → the
// `prototype` chip (CommunityView.tsx), and those chips resolve THESE plugin
// ids (home-hero/chips.ts). Without them in the catalog the tab's chip apply
// bails at `plugins.find(...)` before it ever touches the composer — which is
// exactly the shape of a spec that watches a tab switch and sees none of what
// a tab switch actually does.
const TAB_SCENARIOS = ['example-simple-deck', 'example-web-prototype'].map((id) => ({
  ...FUNDRAISING_DECK,
  id,
  title: id,
  source: `/tmp/${id}`,
  fsPath: `/tmp/${id}`,
  manifest: {
    ...FUNDRAISING_DECK.manifest,
    name: id,
    title: id,
    tags: id.includes('deck') ? ['deck'] : ['prototype'],
    od: {
      ...FUNDRAISING_DECK.manifest.od,
      mode: id.includes('deck') ? 'deck' : 'prototype',
      category: id.includes('deck') ? 'fundraising-pitch' : 'product-prototype',
    },
  },
}));

function dockHero(page: Page) {
  // Home's own hero stays mounted behind the community view, so BOTH heroes
  // answer `[data-testid="home-hero"]`. Every locator here is scoped to the
  // dock or Playwright's strict mode rejects it.
  return page.locator('.community-composer-dock [data-testid="home-hero"]');
}

function dockEditor(page: Page) {
  return page.locator('.community-composer-dock .composer-editable');
}

async function expectFolded(page: Page) {
  await expect(dockHero(page)).toHaveAttribute('data-collapsed', 'true');
}

async function expectOpen(page: Page) {
  await expect(dockHero(page)).not.toHaveAttribute('data-collapsed', 'true');
}

async function gotoCommunity(page: Page) {
  // Straight to the URL rather than through the rail: `/community` parses to
  // `{ kind: 'home', view: 'community' }` (router.ts), which IS the entry
  // shell's community view — the one that hosts the dock. (App.tsx's
  // standalone `community` route branch is a different, dockless surface and
  // this path does not reach it.) Going direct also keeps the spec off the
  // rail-expand affordance, which lives in the workspace chrome and is not
  // this feature's business.
  await page.goto('/community', { waitUntil: 'domcontentloaded' });
  await page.getByText('Loading Open Design…').waitFor({ state: 'hidden', timeout: T.long });
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve Open Design' });
  if (await privacyDialog.isVisible().catch(() => false)) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.locator('article.community-template-card').first()).toBeVisible({
    timeout: T.long,
  });
  await expect(page.locator('.community-composer-dock')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
  await page.route('**/api/plugins', async (route) => {
    await route.fulfill({
      json: { plugins: [FUNDRAISING_DECK, SALES_DECK, PROTOTYPE, ...TAB_SCENARIOS] },
    });
  });
});

test('[P1] the docked composer opens folded and folds again on every tab change', async ({ page }) => {
  await gotoCommunity(page);
  await expectFolded(page);

  await dockEditor(page).click();
  await expectOpen(page);

  // Type row.
  await page.getByRole('button', { name: 'Prototype', exact: true }).click();
  await expectFolded(page);

  await dockEditor(page).click();
  await expectOpen(page);

  // Category row — the half `onActiveTypeChange` never sees, since a category
  // leaves the composer's bound type alone.
  await page.getByRole('button', { name: 'Slides', exact: true }).click();
  await expectFolded(page);
  await dockEditor(page).click();
  await expectOpen(page);
  await page.getByRole('button', { name: 'B2B sales', exact: true }).click();
  await expectFolded(page);
});

test('[P1] scrolling folds the bar, and clicking it opens again with the draft intact', async ({ page }) => {
  await gotoCommunity(page);

  await dockEditor(page).click();
  await page.keyboard.type('half-written brief');
  await expectOpen(page);
  await expect(dockEditor(page)).toContainText('half-written brief');

  // Scroll the gallery under the bar. The editor keeps the caret through this
  // (deliberate — a blur would drop it mid-thought), which is exactly what
  // made the reopen below regress once.
  await page.mouse.move(700, 380);
  await page.mouse.wheel(0, 500);
  await expectFolded(page);
  await expect(dockEditor(page)).toContainText('half-written brief');

  // No focus event is available here: the caret never left. The bar has to
  // open on the pointer alone.
  await dockEditor(page).click();
  await expectOpen(page);
  await expect(dockEditor(page)).toContainText('half-written brief');
});
