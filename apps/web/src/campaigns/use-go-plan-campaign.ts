import { useEffect, useState } from 'react';
import { CLOUD_DISABLED } from '../cf-deployment';
import {
  goPlanCampaignNextBoundary,
  isGoPlanCampaignWindowOpen,
} from './go-plan';

export function useGoPlanCampaignVisibility(): { now: number; visible: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (CLOUD_DISABLED) return;
    const boundary = goPlanCampaignNextBoundary(Date.now());
    if (boundary === null) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, boundary - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [now]);

  // Self-hosted deployment: there is no paid cloud plan to sell, so the
  // upstream "$5 first month" upsell can never become visible.
  return { now, visible: !CLOUD_DISABLED && isGoPlanCampaignWindowOpen(now) };
}
