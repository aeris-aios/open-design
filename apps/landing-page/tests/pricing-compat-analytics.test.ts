import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPricingCompatibilityAnalytics,
  pricingCompatibilityAttribution,
  type PricingCompatibilityEvent,
} from '../app/_lib/pricing-compat-analytics.ts';
import type { PlanTierConfig } from '../app/_lib/pricing.ts';

const tiers = [
  {
    tier: 'plus',
    rank: 1,
    recommended: false,
    monthly: { priceUsd: 20, introPriceUsd: 16, grantUsd: 20 },
    yearly: { priceUsd: 168, discountPct: 30, grantUsd: 240 },
    deployLimit: 3,
  },
  {
    tier: 'pro',
    rank: 2,
    recommended: true,
    monthly: { priceUsd: 100, introPriceUsd: 70, grantUsd: 120 },
    yearly: { priceUsd: 720, discountPct: 40, grantUsd: 1440 },
    deployLimit: 20,
  },
  {
    tier: 'max',
    rank: 3,
    recommended: false,
    monthly: { priceUsd: 200, introPriceUsd: 120, grantUsd: 300 },
    yearly: { priceUsd: 1176, discountPct: 51, grantUsd: 3600 },
    deployLimit: 50,
  },
] satisfies PlanTierConfig[];

type CapturedEvent = {
  event: PricingCompatibilityEvent;
  props: Record<string, unknown>;
};

function harness(search = '') {
  const events: CapturedEvent[] = [];
  const attribution = pricingCompatibilityAttribution(
    new URLSearchParams(search),
  );
  const analytics = createPricingCompatibilityAnalytics({
    tiers,
    attribution,
    track: (event, props) => events.push({ event, props }),
  });
  return { analytics, attribution, events };
}

describe('migrated Pricing compatibility analytics', () => {
  it('preserves URL attribution while keeping the old entry-point enum', () => {
    assert.deepEqual(
      pricingCompatibilityAttribution(
        new URLSearchParams({
          od_origin: 'open_design',
          od_entry_id: 'entry-21',
          od_entry_source: 'workspace_usage_card',
          od_entry_at: '2026-08-23T12:00:00.000Z',
          od_conversion_source: 'workspace_upgrade_button',
          od_campaign_id: 'deepseek_v4_pro',
        }),
      ),
      {
        entryPoint: 'open_design_entry',
        sourceProduct: 'open_design',
        sourceDetail: 'workspace_usage_card',
        conversionSource: 'workspace_upgrade_button',
        entryId: 'entry-21',
        entryOccurredAt: '2026-08-23T12:00:00.000Z',
        campaignId: 'deepseek_v4_pro',
      },
    );

    assert.deepEqual(
      pricingCompatibilityAttribution(new URLSearchParams('source=workbench')),
      {
        entryPoint: 'open_design_entry',
        sourceProduct: 'open_design',
        sourceDetail: 'workbench',
        conversionSource: 'workbench',
        entryId: undefined,
        entryOccurredAt: undefined,
        campaignId: undefined,
      },
    );

    assert.deepEqual(
      pricingCompatibilityAttribution(
        new URLSearchParams(),
        'https://open-design.ai/cloud/dashboard?billing=plan',
      ),
      {
        entryPoint: 'open_design_entry',
        sourceProduct: 'open_design',
        sourceDetail: 'workspace_dashboard',
        conversionSource: 'workspace_dashboard',
        entryId: undefined,
        entryOccurredAt: undefined,
        campaignId: undefined,
      },
    );

    assert.equal(
      pricingCompatibilityAttribution(
        new URLSearchParams(),
        'https://example.com/dashboard',
      ).sourceDetail,
      'direct',
    );
  });

  it('emits the three retired yearly plan exposures with literal plan facts', () => {
    const { analytics, events } = harness(
      'od_entry_source=workspace&od_conversion_source=pricing_redirect',
    );

    analytics.exposePlans({
      audience: 'creator',
      interval: 'yearly',
      introEligible: true,
      currentPlanId: null,
      currentBillingInterval: null,
    });

    assert.equal(events.length, 3);
    assert.deepEqual(events[0], {
      event: 'subscription_plan_exposure',
      props: {
        pageName: 'pricing',
        area: 'subscription_pricing',
        entryPoint: 'open_design_entry',
        sourceProduct: 'open_design',
        sourceDetail: 'workspace',
        conversionSource: 'pricing_redirect',
        entryId: undefined,
        entryOccurredAt: undefined,
        campaignId: undefined,
        planId: 'plus',
        planName: 'plus',
        billingInterval: 'yearly',
        priceUsd: '168.00',
        creditsGrantedUsd: '20.00',
        deployLimit: 3,
        introOfferApplied: false,
        firstMonthEligible: true,
        isCurrentPlan: false,
        isRecommended: false,
        autoRechargeSupported: true,
      },
    });
    assert.deepEqual(
      events.map(({ props }) => [
        props.planId,
        props.priceUsd,
        props.creditsGrantedUsd,
        props.deployLimit,
        props.isRecommended,
      ]),
      [
        ['plus', '168.00', '20.00', 3, false],
        ['pro', '720.00', '120.00', 20, true],
        ['max', '1176.00', '300.00', 50, false],
      ],
    );
  });

  it('deduplicates only the same visible state and reports a returning surface', () => {
    const { analytics, events } = harness();
    const creator = {
      audience: 'creator' as const,
      interval: 'yearly' as const,
      introEligible: true,
      currentPlanId: null,
      currentBillingInterval: null,
    };

    analytics.exposePlans(creator);
    analytics.exposePlans(creator);
    assert.equal(events.length, 3);

    analytics.exposePlans({ ...creator, audience: 'team' });
    assert.equal(events.length, 3);

    analytics.exposePlans(creator);
    assert.equal(events.length, 6);
  });

  it('reports a real interval click before the newly visible monthly plans', () => {
    const { analytics, events } = harness('source=workspace_wallet');
    analytics.exposePlans({
      audience: 'creator',
      interval: 'yearly',
      introEligible: true,
      currentPlanId: null,
      currentBillingInterval: null,
    });
    events.length = 0;

    analytics.changeInterval({
      audience: 'creator',
      currentInterval: 'yearly',
      targetInterval: 'monthly',
      introEligible: true,
      currentPlanId: null,
      currentBillingInterval: null,
      userInitiated: true,
    });

    assert.deepEqual(events[0], {
      event: 'subscription_pricing_click',
      props: {
        pageName: 'pricing',
        area: 'subscription_pricing',
        element: 'change_interval',
        entryPoint: 'open_design_entry',
        sourceProduct: 'open_design',
        sourceDetail: 'workspace_wallet',
        conversionSource: 'workspace_wallet',
        entryId: undefined,
        entryOccurredAt: undefined,
        campaignId: undefined,
        currentPlanId: null,
        currentBillingInterval: 'yearly',
        targetBillingInterval: 'monthly',
      },
    });
    assert.equal(events.length, 4);
    assert.deepEqual(
      events.slice(1).map(({ props }) => [
        props.planId,
        props.priceUsd,
        props.introOfferApplied,
      ]),
      [
        ['plus', '16.00', true],
        ['pro', '70.00', true],
        ['max', '120.00', true],
      ],
    );
  });

  it('restores subscribe and upgrade clicks only for enabled paid Personal plans', () => {
    const { analytics, events } = harness();

    analytics.clickPlan({
      planId: 'plus',
      interval: 'monthly',
      introEligible: true,
      enabled: true,
      currentPlanId: null,
      currentBillingInterval: null,
    });
    analytics.clickPlan({
      planId: 'pro',
      interval: 'yearly',
      introEligible: false,
      enabled: true,
      currentPlanId: 'plus',
      currentBillingInterval: 'monthly',
    });
    for (const planId of ['go', 'team', 'unknown']) {
      analytics.clickPlan({
        planId,
        interval: 'yearly',
        introEligible: true,
        enabled: true,
        currentPlanId: null,
        currentBillingInterval: null,
      });
    }
    analytics.clickPlan({
      planId: 'max',
      interval: 'yearly',
      introEligible: true,
      enabled: false,
      currentPlanId: null,
      currentBillingInterval: null,
    });

    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map(({ props }) => [
        props.element,
        props.currentPlanId,
        props.currentBillingInterval,
        props.targetPlanId,
        props.targetBillingInterval,
        props.priceUsd,
      ]),
      [
        ['subscribe_now', null, null, 'plus', 'monthly', '16.00'],
        ['upgrade_now', 'plus', 'monthly', 'pro', 'yearly', '720.00'],
      ],
    );
  });

  it('restores the equivalent Enterprise lead clicks', () => {
    const { analytics, events } = harness('source=pricing_nav');

    analytics.openEnterpriseLead();
    analytics.submitEnterpriseLead();

    assert.deepEqual(
      events.map(({ event, props }) => ({
        event,
        area: props.area,
        element: props.element,
        target: props.targetDestination,
        source: props.sourceDetail,
      })),
      [
        {
          event: 'subscription_pricing_click',
          area: 'enterprise_contact',
          element: 'request_team_access',
          target: 'lead_form',
          source: 'pricing_nav',
        },
        {
          event: 'subscription_pricing_click',
          area: 'enterprise_contact',
          element: 'team_lead_submit',
          target: 'lead_form',
          source: 'pricing_nav',
        },
      ],
    );
  });
});
