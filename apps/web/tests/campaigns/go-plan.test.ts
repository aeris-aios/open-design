import { describe, expect, it } from 'vitest';
import {
  GO_PLAN_CAMPAIGN,
  GO_PLAN_PRICING_URL,
  goPlanCampaignNextBoundary,
  isGoPlanCampaignWindowOpen,
  resolveSubscriptionAudience,
} from '../../src/campaigns/go-plan';
import { getGoPlanCampaignCopy } from '../../src/campaigns/go-plan-content';

describe('Go plan touchpoints', () => {
  it('uses the fixed two-week NEW window while keeping a stable Pricing target', () => {
    const start = Date.parse(GO_PLAN_CAMPAIGN.window.startAt);
    const end = Date.parse(GO_PLAN_CAMPAIGN.window.endAtExclusive);

    expect(isGoPlanCampaignWindowOpen(start - 1)).toBe(false);
    expect(isGoPlanCampaignWindowOpen(start)).toBe(true);
    expect(isGoPlanCampaignWindowOpen(end - 1)).toBe(true);
    expect(isGoPlanCampaignWindowOpen(end)).toBe(false);
    expect(goPlanCampaignNextBoundary(start - 1)).toBe(start);
    expect(goPlanCampaignNextBoundary(start)).toBe(end);
    expect(goPlanCampaignNextBoundary(end)).toBeNull();
    expect(GO_PLAN_PRICING_URL).toBe('https://open-design.ai/pricing/');
  });

  it('resolves paid and unpaid state independently of the campaign window', () => {
    expect(resolveSubscriptionAudience({ plan: 'free', loggedIn: true })).toBe('unpaid');
    expect(resolveSubscriptionAudience({ plan: 'plus', loggedIn: true })).toBe('paid');
    expect(resolveSubscriptionAudience({ plan: null, loggedIn: false })).toBe('unpaid');
    expect(resolveSubscriptionAudience({ plan: null, loggedIn: true })).toBe('unknown');
  });

  it('keeps the confirmed Chinese lightweight-entry copy', () => {
    expect(getGoPlanCampaignCopy('zh-CN').workbenchBadge).toBe('Go 首月 $5 · 无限用');
    expect(getGoPlanCampaignCopy('en').workbenchBadge).toBe('Go first month $5 · unlimited use');
  });
});
