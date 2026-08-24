# Free Pricing Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Go plan with the historical Free plan across the latest Open Design Pricing page and open a verified local Chinese demo.

**Architecture:** Keep the existing Astro Pricing page, paid-plan snapshot, layout, and interactions. Model Free as a content-only, non-billing tier at the rendering and analytics boundaries while Plus, Pro, Max remain the only paid individual tiers. Preserve legacy Go only as an inbound membership normalization case when needed; never render or emit it.

**Tech Stack:** Astro, TypeScript, static JSX, Node test runner, pnpm 10.33.2, Playwright/browser verification.

## Global Constraints

- Preserve the current four-column Pricing design and the `Free / Plus / Pro / Max` order.
- Free is `$0 / month`, free forever, does not react to monthly/yearly switching, and does not promise hosted model credits.
- Free CTA opens the generic Cloud Console and must not include `plan=go`, billing interval, or automatic checkout parameters.
- Plus, Pro, Max and all Team pricing, entitlements, recommendation state, and checkout behavior remain unchanged.
- Remove Go from visible Pricing content, comparison, FAQ, JSON-LD, CTA targets, analytics output, and Pricing tests.
- Keep all existing locales buildable; visually validate Chinese desktop and mobile.
- Do not publish, push, create a PR, or trigger Cloudflare workflows.

---

### Task 1: Restore the Free content and paid-tier contract

**Files:**
- Modify: `apps/landing-page/app/_lib/pricing-content.ts`
- Modify: `apps/landing-page/app/_lib/pricing.ts`
- Modify: `apps/landing-page/tests/pricing-contract.test.ts`

**Interfaces:**
- Produces: `FreePlanCopy`, `PricingContent.free`, and `PlanTier = 'plus' | 'pro' | 'max'`.
- Removes: `GoPlanCopy`, `PricingContent.go`, and `GO_PLAN`.

- [ ] **Step 1: Replace Go contract assertions with failing Free assertions**

Update the pricing contract test to require historical Free copy and reject Go billing constants:

```ts
assert.equal(getPricingContent('zh').free.ctaLabel, '免费开始');
assert.equal(getPricingContent('zh').free.concurrency, '1 个任务并发');
assert.doesNotMatch(pricingSource, /export const GO_PLAN/);
assert.doesNotMatch(pricingContentSource, /\bgo:\s*\{/);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @open-design/landing-page test -- pricing-contract.test.ts`

Expected: FAIL because `PricingContent.free` is absent and `GO_PLAN` still exists.

- [ ] **Step 3: Restore the historical Free localized contract**

Replace the Go-specific content shape with:

```ts
export interface FreePlanCopy {
  tagline: string;
  ctaLabel: string;
  concurrency: string;
  features: string[];
}

export interface PricingContent {
  labels: PricingLabels;
  free: FreePlanCopy;
  plans: Record<PlanTierId, PlanCopy>;
}
```

For Chinese use:

```ts
free: {
  tagline: '配置自己的 Agent 或 BYOK，免费使用',
  ctaLabel: '免费开始',
  concurrency: '1 个任务并发',
  features: ['BYOK 自带密钥，支持本地 Coding Agent', '社区支持'],
},
```

Restore equivalent historical translations for every existing locale. Add localized `freeForever` and `free` tier-use labels. Remove `GO_PLAN` and narrow the paid plan type:

```ts
export type PlanTier = 'plus' | 'pro' | 'max';
```

- [ ] **Step 4: Run the focused test and verify pass**

Run: `pnpm --filter @open-design/landing-page test -- pricing-contract.test.ts`

Expected: PASS for the content and contract assertions touched in this task.

- [ ] **Step 5: Commit the contract change**

```bash
git add apps/landing-page/app/_lib/pricing-content.ts apps/landing-page/app/_lib/pricing.ts apps/landing-page/tests/pricing-contract.test.ts
git commit -m "feat(pricing): restore Free plan contract"
```

### Task 2: Replace the Go card and comparison column with Free

**Files:**
- Modify: `apps/landing-page/app/_components/pricing-individual-plans.astro`
- Modify: `apps/landing-page/tests/pricing-contract.test.ts`

**Interfaces:**
- Consumes: `PricingContent.free` from Task 1 and `CLOUD_CONSOLE_URL` from `pricing.ts`.
- Produces: a content-only `free` card and `free / plus / pro / max` comparison order.

- [ ] **Step 1: Add failing rendering assertions**

Require a Free card that has no billing view and no Go wordmark:

```ts
assert.match(individualPlans, /tier:\s*'free' as const/);
assert.match(individualPlans, /content\.free\.ctaLabel/);
assert.match(individualPlans, /href:\s*CLOUD_CONSOLE_URL/);
assert.doesNotMatch(individualPlans, /plan-go-wordmark/);
assert.doesNotMatch(individualPlans, /tier === 'go'/);
assert.match(individualPlans, /\['free', 'plus', 'pro', 'max'\]/);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @open-design/landing-page test -- pricing-contract.test.ts`

Expected: FAIL because the component still builds the first card from `GO_PLAN`.

- [ ] **Step 3: Implement the Free card data boundary**

Use a discriminated first-card record instead of a fabricated billing view:

```ts
type TierId = 'free' | PlanTierId;

const cardData = [
  {
    tier: 'free' as const,
    logo: null,
    href: CLOUD_CONSOLE_URL,
  },
  ...tiers.map((tier) => ({
    tier: tier.tier as PlanTierId,
    logo: `/pricing/plan-${tier.tier}.svg`,
    view: individualView(tier),
    regularMonthlyPrice: tier.monthly.priceUsd,
  })),
];
```

Render Free with a text wordmark, fixed `$0 / month`, localized `freeForever`, generic Cloud Console CTA, one concurrency item, and two historical feature items. Do not render discount tags, renewal text, hosted-model unlimited modules, or price-roll animation for Free.

- [ ] **Step 4: Update model access and comparison behavior**

Set all hosted model categories to unavailable for `free`, use `free / plus / pro / max` in comparison loops, and remove `.plan-go*` and `.plan-go-wordmark` rules. Keep paid-tier model ordering and status unchanged.

- [ ] **Step 5: Run the focused test and verify pass**

Run: `pnpm --filter @open-design/landing-page test -- pricing-contract.test.ts`

Expected: PASS, including no Go card/component references.

- [ ] **Step 6: Commit the component change**

```bash
git add apps/landing-page/app/_components/pricing-individual-plans.astro apps/landing-page/tests/pricing-contract.test.ts
git commit -m "feat(pricing): replace Go card with Free"
```

### Task 3: Remove Go from SEO, current-plan state, CTA handoff, and analytics

**Files:**
- Modify: `apps/landing-page/app/pages/pricing/index.astro`
- Modify: `apps/landing-page/app/_lib/pricing-current-plan.ts`
- Modify: `apps/landing-page/app/_lib/pricing-analytics-bridge.ts`
- Modify: `apps/landing-page/app/_lib/pricing-compat-analytics.ts`
- Modify: `apps/landing-page/tests/pricing-current-plan.test.ts`
- Modify: `apps/landing-page/tests/pricing-analytics-bridge.test.ts`
- Modify: `apps/landing-page/tests/pricing-analytics-browser.test.ts`
- Modify: `apps/landing-page/tests/pricing-compat-analytics.test.ts`
- Modify: `apps/landing-page/tests/pricing-contract.test.ts`

**Interfaces:**
- Consumes: paid tiers from `PRICING_SNAPSHOT` and `PricingContent.free`.
- Produces: Free zero-price exposure metadata, Free JSON-LD Offer, and paid CTA behavior for Plus/Pro/Max only.

- [ ] **Step 1: Write failing page, state, and analytics assertions**

Require the new public tier set and reject outbound Go:

```ts
assert.deepEqual(PERSONAL_PRICING_TIERS.map((tier) => tier.tier), [
  'free', 'plus', 'pro', 'max',
]);
assert.deepEqual(PERSONAL_PRICING_TIERS[0]?.monthly, {
  priceUsd: 0,
  introPriceUsd: 0,
  grantUsd: 0,
});
assert.doesNotMatch(page, /cloudSubscribeUrl\('go'/);
assert.match(page, /name:\s*'OpenDesign Free'/);
```

Add current-plan coverage that treats `free` as the lowest public tier and normalizes legacy inbound `go` without making it selectable or emit-able.

- [ ] **Step 2: Run focused state and analytics tests and verify failure**

Run:

```bash
pnpm --filter @open-design/landing-page test -- pricing-current-plan.test.ts pricing-analytics-bridge.test.ts pricing-compat-analytics.test.ts pricing-analytics-browser.test.ts pricing-contract.test.ts
```

Expected: FAIL on existing Go tier arrays, Go price facts, and Go JSON-LD.

- [ ] **Step 3: Update page SEO and browser tier handling**

Replace the Go Product Offer with:

```ts
{
  '@type': 'Offer',
  name: 'OpenDesign Free',
  price: '0',
  priceCurrency: 'USD',
  url: CLOUD_CONSOLE_URL,
},
```

Use `new Set(['free', 'plus', 'pro', 'max'])` for public personal tiers. Ensure only Plus, Pro, Max receive paid subscription URLs and interval updates.

- [ ] **Step 4: Update state and analytics boundaries**

Expose Free as the zero-value catalog entry:

```ts
const FREE_PRICING_TIER = {
  tier: 'free' as const,
  rank: 0,
  recommended: false,
  monthly: { priceUsd: 0, introPriceUsd: 0, grantUsd: 0 },
  yearly: { priceUsd: 0, discountPct: 0, grantUsd: 0 },
  deployLimit: 1,
};
```

Keep `go` only in an explicit legacy inbound parser if required by membership payloads; return `free` for relation calculations and never serialize `go` into Pricing exposure, interval-change, CTA, or checkout events. Free CTA exposure is permitted, but checkout-start emission is not.

- [ ] **Step 5: Run focused state and analytics tests and verify pass**

Run the command from Step 2.

Expected: PASS with public tier order `free / plus / pro / max` and no outbound Go facts.

- [ ] **Step 6: Commit the integration change**

```bash
git add apps/landing-page/app/pages/pricing/index.astro apps/landing-page/app/_lib/pricing-current-plan.ts apps/landing-page/app/_lib/pricing-analytics-bridge.ts apps/landing-page/app/_lib/pricing-compat-analytics.ts apps/landing-page/tests/pricing-*.test.ts
git commit -m "fix(pricing): remove Go from public pricing flow"
```

### Task 4: Verify the complete local demo and open it for review

**Files:**
- Modify if required by verified failures: `apps/landing-page/app/_lib/pricing-extras-content.ts`
- Modify if required by verified failures: `apps/landing-page/public/pricing.md`
- Test: `apps/landing-page/tests/pricing-contract.test.ts`
- Test: `apps/landing-page/tests/pricing-current-plan.test.ts`
- Test: `apps/landing-page/tests/pricing-analytics-bridge.test.ts`
- Test: `apps/landing-page/tests/pricing-analytics-browser.test.ts`
- Test: `apps/landing-page/tests/pricing-compat-analytics.test.ts`

**Interfaces:**
- Consumes: complete Pricing implementation from Tasks 1–3.
- Produces: a tested local server at `http://127.0.0.1:17574/zh/pricing/` and visual evidence.

- [ ] **Step 1: Scan Pricing scope for remaining public Go references**

Run:

```bash
rg -n -i '\bgo\b|GO_PLAN|plan=go' \
  apps/landing-page/app/pages/pricing \
  apps/landing-page/app/_components/pricing-individual-plans.astro \
  apps/landing-page/app/_lib/pricing*.ts \
  apps/landing-page/tests/pricing* \
  apps/landing-page/public/pricing.md
```

Expected: no public/rendered/output Go references. An explicitly commented legacy inbound membership normalization case is allowed.

- [ ] **Step 2: Run all Pricing tests**

Run:

```bash
pnpm --filter @open-design/landing-page test -- pricing-contract.test.ts pricing-current-plan.test.ts pricing-analytics-bridge.test.ts pricing-analytics-browser.test.ts pricing-compat-analytics.test.ts
```

Expected: PASS, zero failures.

- [ ] **Step 3: Run Landing Page typecheck and build**

Run:

```bash
pnpm --filter @open-design/landing-page typecheck
pnpm --filter @open-design/landing-page build
```

Expected: both exit 0; static localized Pricing pages are emitted.

- [ ] **Step 4: Start the local server**

Run: `pnpm --filter @open-design/landing-page dev --host 127.0.0.1`

Expected: server listens on `http://127.0.0.1:17574`.

- [ ] **Step 5: Verify desktop and mobile rendering in a real browser**

Open `http://127.0.0.1:17574/zh/pricing/`. Confirm:

- the plan cards read `Free / Plus / Pro / Max`;
- Free remains `$0` when switching monthly/yearly;
- no Go text or Go checkout link exists;
- Plus, Pro, Max still change price and CTA interval;
- comparison, FAQ, personal/team switch, and expand controls work;
- 1440px desktop and 390px mobile screenshots show no clipping or overlap;
- reduced-motion and keyboard focus behavior remain intact.

- [ ] **Step 6: Commit any verification fixes**

```bash
git add apps/landing-page
git commit -m "test(pricing): verify Free pricing demo"
```

Skip this commit if verification required no additional changes.
