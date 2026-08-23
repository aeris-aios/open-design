import type {
  BillingInterval,
  PlanTier,
  PlanTierConfig,
} from './pricing.ts';

export type PricingCompatibilityEvent =
  | 'subscription_plan_exposure'
  | 'subscription_pricing_click';

export type PricingCompatibilityTrack = (
  event: PricingCompatibilityEvent,
  props: Record<string, unknown>,
) => void;

export type PricingCompatibilityAttribution = ReturnType<
  typeof pricingCompatibilityAttribution
>;

type PersonalExposureInput = {
  audience: 'creator' | 'team';
  interval: BillingInterval;
  introEligible: boolean;
  currentPlanId: PlanTier | 'go' | null;
  currentBillingInterval: BillingInterval | null;
};

type IntervalChangeInput = Omit<PersonalExposureInput, 'interval'> & {
  currentInterval: BillingInterval;
  targetInterval: BillingInterval;
  userInitiated: boolean;
};

type PlanClickInput = {
  planId: string;
  interval: BillingInterval;
  introEligible: boolean;
  enabled: boolean;
  currentPlanId: PlanTier | 'go' | null;
  currentBillingInterval: BillingInterval | null;
};

function sourceFromReferrer(referrer: string) {
  if (!referrer) return 'direct';
  try {
    const parsed = new URL(referrer);
    const hostname = parsed.hostname.toLowerCase();
    const trustedProductHost =
      hostname === 'open-design.ai' ||
      hostname.endsWith('.open-design.ai') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1';
    if (!trustedProductHost) return 'direct';
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.includes('/wallet')) return 'workspace_wallet';
    if (pathname.includes('/dashboard')) return 'workspace_dashboard';
    if (pathname.includes('/subscription')) return 'subscription_page';
  } catch {
    return 'direct';
  }
  return 'direct';
}

export function pricingCompatibilityAttribution(
  search: URLSearchParams,
  referrer = '',
) {
  const sourceDetail =
    search.get('od_entry_source') ??
    search.get('source') ??
    sourceFromReferrer(referrer);
  return {
    entryPoint: 'open_design_entry' as const,
    sourceProduct: search.get('od_origin') ?? 'open_design',
    sourceDetail,
    conversionSource: search.get('od_conversion_source') ?? sourceDetail,
    entryId: search.get('od_entry_id') ?? undefined,
    entryOccurredAt: search.get('od_entry_at') ?? undefined,
    campaignId: search.get('od_campaign_id') ?? undefined,
  };
}

export function personalPlanCompatibilityPayload(
  tier: PlanTierConfig,
  interval: BillingInterval,
  introEligible: boolean,
) {
  const introOfferApplied = introEligible && interval === 'monthly';
  const priceUsd =
    interval === 'monthly'
      ? introOfferApplied
        ? tier.monthly.introPriceUsd
        : tier.monthly.priceUsd
      : tier.yearly.priceUsd;
  const creditsGrantedUsd =
    interval === 'monthly' ? tier.monthly.grantUsd : tier.yearly.grantUsd / 12;

  return {
    planId: tier.tier,
    planName: tier.tier,
    billingInterval: interval,
    priceUsd: priceUsd.toFixed(2),
    creditsGrantedUsd: creditsGrantedUsd.toFixed(2),
    deployLimit: tier.deployLimit,
    introOfferApplied,
    firstMonthEligible: introEligible,
    isRecommended: tier.recommended,
    autoRechargeSupported: true,
  } as const;
}

export function createPricingCompatibilityAnalytics({
  tiers,
  attribution,
  track,
}: {
  tiers: readonly PlanTierConfig[];
  attribution: PricingCompatibilityAttribution;
  track: PricingCompatibilityTrack;
}) {
  const baseProps = {
    pageName: 'pricing',
    ...attribution,
  } as const;
  let lastExposureSignature: string | null = null;

  const exposePlans = (input: PersonalExposureInput) => {
    if (input.audience === 'team') {
      lastExposureSignature = null;
      return;
    }
    const signature = `${input.audience}:${input.interval}`;
    if (lastExposureSignature === signature) return;
    lastExposureSignature = signature;

    for (const tier of tiers) {
      track('subscription_plan_exposure', {
        ...baseProps,
        area: 'subscription_pricing',
        ...personalPlanCompatibilityPayload(
          tier,
          input.interval,
          input.introEligible,
        ),
        isCurrentPlan:
          input.currentPlanId === tier.tier &&
          input.currentBillingInterval === input.interval,
      });
    }
  };

  const changeInterval = (input: IntervalChangeInput) => {
    if (
      input.userInitiated &&
      input.currentInterval !== input.targetInterval
    ) {
      track('subscription_pricing_click', {
        ...baseProps,
        area: 'subscription_pricing',
        element: 'change_interval',
        currentPlanId: input.currentPlanId,
        currentBillingInterval: input.currentInterval,
        targetBillingInterval: input.targetInterval,
      });
    }
    exposePlans({
      audience: input.audience,
      interval: input.targetInterval,
      introEligible: input.introEligible,
      currentPlanId: input.currentPlanId,
      currentBillingInterval: input.currentBillingInterval,
    });
  };

  const clickPlan = (input: PlanClickInput) => {
    if (!input.enabled) return;
    const tier = tiers.find((candidate) => candidate.tier === input.planId);
    if (!tier) return;

    track('subscription_pricing_click', {
      ...baseProps,
      area: 'subscription_pricing',
      element: input.currentPlanId ? 'upgrade_now' : 'subscribe_now',
      currentPlanId: input.currentPlanId,
      currentBillingInterval: input.currentBillingInterval,
      targetPlanId: tier.tier,
      targetBillingInterval: input.interval,
      ...personalPlanCompatibilityPayload(
        tier,
        input.interval,
        input.introEligible,
      ),
      isCurrentPlan:
        input.currentPlanId === tier.tier &&
        input.currentBillingInterval === input.interval,
    });
  };

  const enterpriseClick = (
    element: 'request_team_access' | 'team_lead_submit',
  ) => {
    track('subscription_pricing_click', {
      ...baseProps,
      area: 'enterprise_contact',
      element,
      targetDestination: 'lead_form',
    });
  };

  return {
    exposePlans,
    changeInterval,
    clickPlan,
    openEnterpriseLead: () => enterpriseClick('request_team_access'),
    submitEnterpriseLead: () => enterpriseClick('team_lead_submit'),
  };
}
