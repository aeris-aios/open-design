import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { DEEPSEEK_V4_PRO_CAMPAIGN } from "../app/_lib/deepseek-v4-pro-campaign.ts";
import { CLOUD_CONSOLE_URL } from "../app/_lib/pricing.ts";

const DEMO_PAGE_PATH = new URL(
  "../app/pages/cloud-team-demo/index.astro",
  import.meta.url,
);
const TRACKER_PATH = new URL(
  "../app/_lib/posthog-analytics.ts",
  import.meta.url,
);

function attributedCloudUrl(
  href: string,
  attribution: { campaign_id?: string } | undefined,
) {
  const target = new URL(href);
  if (attribution?.campaign_id) {
    target.searchParams.set("od_campaign_id", attribution.campaign_id);
  }
  return target.toString();
}

function demoUpgradeAttribution(now: number, preview: boolean) {
  const startAt = Date.parse(DEEPSEEK_V4_PRO_CAMPAIGN.startAt);
  const endAt = Date.parse(DEEPSEEK_V4_PRO_CAMPAIGN.endAtExclusive);
  const campaignEligible = now >= startAt && now < endAt;
  const campaignVisible = preview || campaignEligible;
  const attribution = {
    campaign_id: campaignEligible ? "deepseek_v4_pro" : undefined,
  };
  return {
    campaignVisible,
    campaignEligible,
    url: attributedCloudUrl(CLOUD_CONSOLE_URL, attribution),
  };
}

describe("cloud team demo campaign attribution", () => {
  it("keeps preview visibility separate from conversion eligibility", async () => {
    const page = await readFile(DEMO_PAGE_PATH, "utf8");

    assert.match(
      page,
      /campaignEligible = now >= campaignStartAt && now < campaignEndAt/,
    );
    assert.match(page, /campaignVisible = campaignPreview \|\| campaignEligible/);
    assert.match(page, /surface\.hidden = !campaignVisible/);
    assert.doesNotMatch(
      page,
      /campaignActive = campaignPreview \|\| \(now >= campaignStartAt && now < campaignEndAt\)/,
    );
  });

  it("stamps the campaign on Upgrade only while the real clock window is open", async () => {
    const page = await readFile(DEMO_PAGE_PATH, "utf8");

    assert.match(
      page,
      /__odRecordCampaignEntry\?\.\(\s*source,\s*campaignEligible \? 'deepseek_v4_pro' : undefined,\s*\)/,
    );
    assert.match(
      page,
      /__odAttributedUrl\?\.\(upgradeUrl, attribution\)/,
    );
    assert.doesNotMatch(
      page,
      /__odRecordCampaignEntry\?\.\(source, 'deepseek_v4_pro'\)/,
    );
  });

  it("omits od_campaign_id from an out-of-window Upgrade Cloud URL, even in preview", async () => {
    const tracker = await readFile(TRACKER_PATH, "utf8");
    assert.match(
      tracker,
      /if \(attribution\.campaign_id\) target\.searchParams\.set\('od_campaign_id', attribution\.campaign_id\)/,
    );

    const afterClose = Date.parse("2026-08-27T20:00:00+08:00");
    const previewAfterClose = demoUpgradeAttribution(afterClose, true);
    assert.equal(previewAfterClose.campaignVisible, true);
    assert.equal(previewAfterClose.campaignEligible, false);
    assert.equal(
      new URL(previewAfterClose.url).searchParams.get("od_campaign_id"),
      null,
    );

    const beforeOpen = Date.parse("2026-08-05T23:59:59+08:00");
    const previewBeforeOpen = demoUpgradeAttribution(beforeOpen, true);
    assert.equal(previewBeforeOpen.campaignVisible, true);
    assert.equal(
      new URL(previewBeforeOpen.url).searchParams.get("od_campaign_id"),
      null,
    );

    const insideWindow = Date.parse("2026-08-13T12:00:00+08:00");
    const liveClick = demoUpgradeAttribution(insideWindow, false);
    assert.equal(liveClick.campaignEligible, true);
    assert.equal(
      new URL(liveClick.url).searchParams.get("od_campaign_id"),
      "deepseek_v4_pro",
    );
  });
});
