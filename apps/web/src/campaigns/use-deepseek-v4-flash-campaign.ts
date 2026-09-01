import { useEffect, useState } from 'react';
import { CLOUD_DISABLED } from '../cf-deployment';
import {
  deepSeekV4FlashCampaignNextBoundary,
  isDeepSeekV4FlashCampaignVisible,
} from './deepseek-v4-flash';

/**
 * Keeps campaign surfaces in sync with the fixed launch window while the app
 * stays open. The real time window is the only visibility input.
 */
export function useDeepSeekV4FlashCampaignVisibility(): {
  now: number;
  visible: boolean;
} {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (CLOUD_DISABLED) return;
    const boundary = deepSeekV4FlashCampaignNextBoundary(Date.now());
    if (boundary === null) return;
    const delay = Math.max(0, boundary - Date.now()) + 50;
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [now]);

  // Self-hosted deployment: upstream's model-promo campaign is a cloud-plan
  // marketing surface, so it can never become visible here.
  return {
    now,
    visible: !CLOUD_DISABLED && isDeepSeekV4FlashCampaignVisible(now),
  };
}
