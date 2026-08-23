# Restore Migrated Pricing Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the retired Vela Pricing modal's compatible plan-exposure and pricing-click events on OpenDesign's migrated public Pricing page.

**Architecture:** Add a pure TypeScript compatibility controller inside the landing app. It builds and emits the old event contracts from the existing Pricing plan contract, while the Astro page connects its current audience, interval, CTA, and Enterprise interactions to that controller. Existing landing events stay in place and checkout/result facts remain owned by Vela.

**Tech Stack:** Astro 6, TypeScript, PostHog, Node test runner.

## Global Constraints

- Start from `nexu-io/open-design` latest `main`.
- Modify only landing Pricing analytics and tests plus internal design/plan documents.
- Do not restore the Vela Pricing modal or change checkout navigation.
- Do not add dependencies or a second analytics sink.
- Preserve existing landing `page_view`, `ui_click`, and lead events.
- Restore only equivalent old interactions that still exist: Plus/Pro/Max exposure, Personal paid-plan CTA, interval change, Enterprise lead open, and Enterprise lead submit.
- Keep checkout creation, return, lifecycle, and payment facts in Vela.
- Use TDD and observe the focused test failing before adding production code.

---

### Task 1: Define the compatibility controller through failing tests

**Files:**
- Create: `apps/landing-page/tests/pricing-compat-analytics.test.ts`
- Create later: `apps/landing-page/app/_lib/pricing-compat-analytics.ts`

**Interfaces:**
- Consumes: `PlanTierConfig[]`, URL search parameters, current audience/interval/eligibility/current-plan state, and a `(event, props) => void` tracker.
- Produces: `createPricingCompatibilityAnalytics(options)` with `exposePlans`, `changeInterval`, `clickPlan`, `openEnterpriseLead`, and `submitEnterpriseLead` methods.

- [ ] **Step 1: Write failing behavior tests**

Import the not-yet-created module and add literal assertions for these behaviors:

1. `pricingCompatibilityAttribution()` maps `od_origin`, `od_entry_id`, `od_entry_source`, `od_entry_at`, `od_conversion_source`, and `od_campaign_id`; it keeps `entryPoint='open_design_entry'` and falls back to `source`, the `/wallet` or `/dashboard` referrer, then `direct` for source detail.
2. Initial Personal yearly exposure emits exactly three `subscription_plan_exposure` events for Plus, Pro, and Max with literal price, monthly-normalized credit, deploy limit, intro, recommendation, and attribution fields.
3. Repeating the same visible state emits nothing; Team emits nothing; returning to Personal emits three new exposures.
4. A real yearly-to-monthly change emits one `subscription_pricing_click` with `element='change_interval'`, then three monthly exposures using introductory prices.
5. A Plus CTA emits one compatible plan click with `subscribe_now` for no current plan and `upgrade_now` with current-plan fields when a current plan exists.
6. Go, Team, disabled, and unknown CTA inputs emit no compatible plan click.
7. Enterprise open and submit emit `request_team_access` and `team_lead_submit` with `area='enterprise_contact'` and `targetDestination='lead_form'`.

Use the literal 2026-08-23 plan fixture:

```ts
const tiers = [
  {
    tier: 'plus', rank: 1, recommended: false,
    monthly: { priceUsd: 20, introPriceUsd: 16, grantUsd: 20 },
    yearly: { priceUsd: 168, discountPct: 30, grantUsd: 240 },
    deployLimit: 3,
  },
  {
    tier: 'pro', rank: 2, recommended: true,
    monthly: { priceUsd: 100, introPriceUsd: 70, grantUsd: 120 },
    yearly: { priceUsd: 720, discountPct: 40, grantUsd: 1440 },
    deployLimit: 20,
  },
  {
    tier: 'max', rank: 3, recommended: false,
    monthly: { priceUsd: 200, introPriceUsd: 120, grantUsd: 300 },
    yearly: { priceUsd: 1176, discountPct: 51, grantUsd: 3600 },
    deployLimit: 50,
  },
] satisfies PlanTierConfig[];
```

- [ ] **Step 2: Run the focused test to verify RED**

```bash
corepack pnpm --filter @open-design/landing-page test -- pricing-compat-analytics.test.ts
```

Expected: FAIL because `app/_lib/pricing-compat-analytics.ts` does not exist.

- [ ] **Step 3: Confirm the failure is valid**

The failure must be a missing-module failure for the intended production boundary, not a typo in the test filename or fixture.

### Task 2: Implement the pure compatibility controller

**Files:**
- Create: `apps/landing-page/app/_lib/pricing-compat-analytics.ts`
- Test: `apps/landing-page/tests/pricing-compat-analytics.test.ts`

**Interfaces:**
- Produces: `pricingCompatibilityAttribution(search, referrer)`, `personalPlanCompatibilityPayload(tier, interval, introEligible)`, and `createPricingCompatibilityAnalytics(options)`.
- Compatibility event properties use the original Vela camelCase field names.

- [ ] **Step 1: Define types and attribution mapping**

Implement:

```ts
export type CompatibilityTrack = (
  event: 'subscription_plan_exposure' | 'subscription_pricing_click',
  props: Record<string, unknown>,
) => void;

export function pricingCompatibilityAttribution(search: URLSearchParams, referrer = '') {
  const sourceDetail =
    search.get('od_entry_source') ?? search.get('source') ?? sourceFromReferrer(referrer);
  return {
    entryPoint: 'open_design_entry',
    sourceProduct: search.get('od_origin') ?? 'open_design',
    sourceDetail,
    conversionSource: search.get('od_conversion_source') ?? sourceDetail,
    entryId: search.get('od_entry_id') ?? undefined,
    entryOccurredAt: search.get('od_entry_at') ?? undefined,
    campaignId: search.get('od_campaign_id') ?? undefined,
  } as const;
}
```

- [ ] **Step 2: Implement plan payload parity**

For monthly, use the intro price only when `introEligible` is true. For yearly, use the full annual price and divide the annual grant by 12. Format price and credit strings with `toFixed(2)`. Preserve `planId`, `planName`, `billingInterval`, `deployLimit`, `introOfferApplied`, `firstMonthEligible`, `isRecommended`, and `autoRechargeSupported=true`.

- [ ] **Step 3: Implement controller methods**

`createPricingCompatibilityAnalytics({ tiers, attribution, track })` maintains only the last exposure signature. `exposePlans` skips Team and immediate duplicate state, resetting the signature on Team. `changeInterval` emits the old click only for an actual user change and then calls `exposePlans`. `clickPlan` accepts only enabled Plus/Pro/Max inputs and chooses `subscribe_now` versus `upgrade_now` from `currentPlanId`. Enterprise methods emit their corresponding old click payloads.

- [ ] **Step 4: Run focused tests to verify GREEN**

```bash
corepack pnpm --filter @open-design/landing-page test -- pricing-compat-analytics.test.ts
```

Expected: all compatibility-controller tests pass.

### Task 3: Wire the existing Pricing page to the controller

**Files:**
- Modify: `apps/landing-page/app/pages/pricing/index.astro`
- Test: `apps/landing-page/tests/pricing-compat-analytics.test.ts`

**Interfaces:**
- Consumes: `createPricingCompatibilityAnalytics`, `pricingCompatibilityAttribution`, `PRICING_SNAPSHOT.tiers`, existing Pricing DOM state, and `window.__odTrack`.
- Produces: compatible events through the same PostHog sink as existing landing events.

- [ ] **Step 1: Expose analytics-only state transitions**

Extend existing custom events without altering rendering:

- `pricing:audience-changed` carries `{ audience }` after audience activation.
- `pricing:interval-changed` additionally carries `{ previousInterval, shouldTrack }`.
- `pricing:enterprise-open` fires alongside `team_lead_open`.
- `pricing:enterprise-submit` fires alongside `team_lead_submit`.

- [ ] **Step 2: Expose current Personal context**

Inside `applyPersonalActions`, write `data-current-personal-plan-id` and `data-current-personal-billing-interval` on the Pricing root from `pricingContext.current`. Do not change CTA enablement, copy, or URLs.

- [ ] **Step 3: Install the compatibility bridge**

Add a bundled module script after the existing Pricing scripts. It imports the controller and `PRICING_SNAPSHOT`, creates a tracker that delegates to `window.__odTrack`, derives attribution from `window.location.search`, and immediately calls `exposePlans` with the current DOM state.

- [ ] **Step 4: Connect state and interaction events**

The module script must:

- call `exposePlans` on `pricing:audience-changed`;
- call `changeInterval` on `pricing:interval-changed` using `shouldTrack` and current intro eligibility;
- listen to delegated Pricing CTA clicks, skip disabled and non-Plus/Pro/Max CTAs, and call `clickPlan` with root current-plan attributes;
- call the Enterprise controller methods on `pricing:enterprise-open` and `pricing:enterprise-submit`.

Do not remove or rename existing landing analytics calls.

- [ ] **Step 5: Re-run focused tests**

```bash
corepack pnpm --filter @open-design/landing-page test -- pricing-compat-analytics.test.ts
```

Expected: all focused tests still pass after wiring.

- [ ] **Step 6: Run diff checks**

```bash
git diff --check
git diff -- apps/landing-page/app/_lib/pricing-compat-analytics.ts \
  apps/landing-page/app/pages/pricing/index.astro \
  apps/landing-page/tests/pricing-compat-analytics.test.ts
```

Confirm the diff contains analytics hooks only and no checkout or visible UI behavior changes.

### Task 4: Verify, commit, and create the PR

**Files:**
- Verify all files changed by Tasks 1–3 and the design/plan documents.

**Interfaces:**
- Produces: a pushed `codex/restore-pricing-plan-exposure` branch and an OpenDesign PR against `main`.

- [ ] **Step 1: Run landing-page tests**

```bash
corepack pnpm --filter @open-design/landing-page test
```

Expected: zero failures.

- [ ] **Step 2: Run typecheck**

```bash
corepack pnpm --filter @open-design/landing-page typecheck
```

Expected: Astro check exits zero.

- [ ] **Step 3: Run the static build**

```bash
corepack pnpm --filter @open-design/landing-page build:static
```

Expected: static output and localized route verification complete successfully.

- [ ] **Step 4: Review the final diff**

```bash
git diff --check
git diff origin/main...HEAD
git status --short
```

Confirm no dependency, generated output, purchase-flow behavior, or unrelated file changed.

- [ ] **Step 5: Commit implementation**

```bash
git add apps/landing-page/app/_lib/pricing-compat-analytics.ts \
  apps/landing-page/app/pages/pricing/index.astro \
  apps/landing-page/tests/pricing-compat-analytics.test.ts \
  docs/superpowers/specs/2026-08-23-restore-pricing-plan-exposure-design.md
git commit -m "fix(analytics): restore migrated pricing funnel events"
```

- [ ] **Step 6: Push and create the PR**

Push `codex/restore-pricing-plan-exposure`, fill every section of `.github/pull_request_template.md`, and create a PR against `main`. State that checkout/result ownership is unchanged and URL attribution distinguishes migrated Pricing sources.
