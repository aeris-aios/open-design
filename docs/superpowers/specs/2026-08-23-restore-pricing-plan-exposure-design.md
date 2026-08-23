# Restore Migrated Pricing Analytics Design

## Goal

Restore the retired Vela Pricing modal's compatible analytics events on the
migrated OpenDesign `/pricing/` page without restoring the modal or changing
checkout behavior.

## Scope

- Start from the latest `nexu-io/open-design` `main` branch.
- Change only the landing Pricing analytics and its regression coverage.
- Emit one exposure for each visible paid Personal plan: Plus, Pro, and Max.
- Do not include Go or Team plans because the retired event covered the
  Personal Plus/Pro/Max catalog.
- Emit again when the visitor changes the billing interval because the visible
  price and grant context changes, matching the retired catalog behavior.
- Do not emit when the Team audience is active because the Personal cards are
  hidden.
- Do not restore any modal, route, or purchase-flow code.
- Restore `subscription_pricing_click` for equivalent controls that still
  exist on the migrated page: Personal plan CTA, billing-interval change,
  Enterprise lead open, and Enterprise lead submit.
- Do not recreate analytics for removed UI such as proof samples or customer
  stories.
- Keep checkout creation, return, lifecycle, and payment-result events in Vela;
  the landing page must not duplicate those downstream facts.

## Event Contract

Use the existing event names `subscription_plan_exposure` and
`subscription_pricing_click`. Preserve the old Personal plan fields and Vela's
camelCase PostHog representation while adapting the page context to the
migrated surface:

- `pageName=pricing`
- `area=subscription_pricing`
- `entryPoint=open_design_entry`, preserving the old registry enum for the new
  OpenDesign-owned surface
- `sourceDetail`: derive from `od_entry_source`, then `source`, then the
  previous page's `/wallet` or `/dashboard` referrer, then `direct`
- `conversionSource`: derive from `od_conversion_source`, then
  `sourceDetail`
- `planId` and `planName`: `plus | pro | max`
- `billingInterval`: the visible `monthly | yearly` selection
- `priceUsd`: introductory monthly price or full yearly price, formatted with
  two decimals
- `creditsGrantedUsd`: monthly grant; yearly grants normalized to one month,
  formatted with two decimals
- `deployLimit`: the plan contract value, including zero if introduced later
- `introOfferApplied`: true only for the monthly introductory price
- `isRecommended`: the plan contract recommendation flag
- `autoRechargeSupported=true`

The landing page already supplies `locale` and routes the event through its
existing `window.__odTrack` PostHog helper. PostHog also attaches
`$current_url`; preserve inbound `od_*` attribution fields in the compatible
event payload. `entryPoint` remains the valid `open_design_entry` enum while
`sourceDetail` and `conversionSource` distinguish the explicit URL source and
fall back to the same-origin referrer when the redirect omitted query
parameters. No
new event name, analytics sink, dependency, or Feishu taxonomy row is
introduced.

For `subscription_pricing_click`:

- a Personal paid-plan CTA emits `subscribe_now` when there is no current
  Personal subscription and `upgrade_now` when the loaded pricing context has
  a current Personal plan;
- interval controls emit `change_interval` with current and target intervals;
- Enterprise lead opening emits `request_team_access` with
  `area=enterprise_contact` and `targetDestination=lead_form`;
- Enterprise lead submission emits `team_lead_submit` with the same area and
  destination;
- plan CTA payloads include target plan, target interval, plan price/grant
  fields, recommendation, and intro-offer state.

## Data Flow

1. Astro passes the existing `PRICING_SNAPSHOT.tiers` contract into the Pricing
   page's inline enhancement script.
2. After the analytics helper is available, the script reads the active
   audience and interval.
3. If the Personal audience is visible, it emits one
   `subscription_plan_exposure` per paid Personal tier.
4. The existing interval activation path emits the new interval's three plan
   exposures after updating the visible state and emits one
   `subscription_pricing_click` for the interval control.
5. Audience switching into Personal emits the current interval's three plan
   exposures; switching to Team emits none.
6. Existing CTA and Enterprise handlers dual-report their current `ui_click` /
   lead event and the old compatible `subscription_pricing_click` event.

## Duplicate Control

Deduplicate by `audience + billingInterval` during a page session. Initial
state synchronization and repeated activation of the same state must not emit
duplicates. A genuine interval change or returning from Team to Personal may
emit again because a newly visible plan surface is being exposed.

## Testing

Add a Pricing contract regression test before production code. It must fail on
the current `main` branch and prove that:

- both compatible event names are present;
- only Plus, Pro, and Max are traversed;
- payloads retain the old plan, interval, price, grant, deploy-limit, intro,
  recommendation, and auto-recharge fields;
- Personal initial load and interval changes trigger exposure tracking;
- Team activation does not report Personal plan exposures;
- the equivalent plan, interval, and Enterprise controls emit the old click
  event with URL-derived attribution;
- checkout/result events are not added to the landing page;
- the old Vela modal is not reintroduced.

Run the focused Pricing contract suite, the full landing-page test suite,
landing-page typecheck, and landing-page static build before creating the PR.
