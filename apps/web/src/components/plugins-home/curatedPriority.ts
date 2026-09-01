// Shared curator ordering for Home examples and the Community shelf.
//
// These are the template styles we deliberately want in the first
// viewport. The ids are daemon plugin ids, so the ordering remains
// stable across locales and title-copy tweaks.

import type { InstalledPluginRecord } from '@open-design/contracts';

// Chamber first: the first-party `example-fhcoc-*` packages lead every chip
// they belong to (the id list lives in ./chamberCuration.ts). Upstream picks
// fill the tail so no chip goes thin, but a staffer's first row is always
// chamber collateral rather than a SaaS landing page.
const CURATED_PROTOTYPE_PLUGIN_IDS = [
  'example-fhcoc-event-flyer',
  'example-fhcoc-social-post',
  'example-fhcoc-event-landing',
  'example-fhcoc-member-onepager',
  'example-fhcoc-newsletter',
  'example-fhcoc-member-directory',
  'example-fhcoc-sponsorship-packet',
  'example-fhcoc-annual-report',
  'example-saas-landing',
  'example-kanban-board',
  'example-social-carousel',
  'example-blog-post',
  'example-pricing-page',
] as const;

// Wireframe scenario: lo-fi / sketch explorations across distinct styles —
// hand-drawn sketch, crisp greybox/blueprint, a multi-screen mobile flow, and
// an annotated/redline landing wireframe. The chip's tag-matching surfaces any
// other lo-fi templates behind these.
const CURATED_WIREFRAME_PLUGIN_IDS = [
  'example-wireframe-sketch',
  'example-wireframe-greybox',
  'example-wireframe-mobile-flow',
  'example-wireframe-annotated',
] as const;

// Mobile scenario: real native-app prototype mockups (iOS / Android phone
// screens), so the carousel reads as "this is what a mobile result looks
// like" rather than generic web prototypes.
const CURATED_MOBILE_PLUGIN_IDS = [
  'example-mobile-app',
  'example-mobile-onboarding',
] as const;

// Document scenario: polished, print-ready documents — resumes, reports,
// invoices, papers, briefs — chosen for visual quality.
const CURATED_DOCUMENT_PLUGIN_IDS = [
  'example-fhcoc-annual-report',
  'example-fhcoc-sponsorship-packet',
  'example-fhcoc-renewal-notice',
  'example-fhcoc-member-onepager',
  'example-data-report',
  'example-finance-report',
  'example-invoice',
  'example-resume-modern',
  'example-hps-academic-paper',
  'example-digital-eguide',
  'example-article-magazine',
  'example-meeting-notes',
  'example-design-brief',
] as const;

// Doubles as the Live Artifact CATEGORY definition (facets.ts reads it), so an
// id stays listed here to keep its bucket even when the gallery hides it:
// `example-github-dashboard` is gallery-hidden for this fork but must still
// resolve to Live Artifact rather than falling back to the dashboards bucket.
export const CURATED_LIVE_ARTIFACT_PLUGIN_IDS = [
  'example-live-dashboard',
  'example-flowai-live-dashboard-template',
  'example-social-media-dashboard',
  'example-github-dashboard',
  'example-live-artifact',
] as const;

// Pinned-to-front slide library (curator request): the community-sourced
// slides batch leads both the Home hero deck chip and the Home plugin grid's
// Slides shelf, ahead of the standing curated deck picks below. Order here is
// the exact display order requested (family roots first, then variants).
const PINNED_SLIDE_PLUGIN_IDS = [
  // `example-frontend-slides` (the bare family-root template) is intentionally
  // NOT pinned — its generic cover reads as filler at the top of the shelf, so
  // it drops to the uncurated tail while the styled variants below still lead.
  // The dev/AI/pop-culture members of this batch (notebook-tabs, memphis-pop,
  // retro-tv, true-blueprint, terminal-mono) are gallery-hidden for this fork,
  // so they are dropped here too rather than pinning ids that never render.
  'example-fs-creative-voltage',
  'example-fs-electric-studio',
  'example-fs-emerald-editorial',
  'example-fs-editorial-forest',
  'example-hps-bauhaus',
  'example-hps-y2k-chrome',
  'example-hps-academic-paper',
  'example-ve-midnight-editorial',
] as const;

const CURATED_DECK_PLUGIN_IDS = [
  // Chamber decks lead the slide library.
  'example-fhcoc-board-deck',
  'example-fhcoc-state-of-the-town-deck',
  ...PINNED_SLIDE_PLUGIN_IDS,
  'example-html-ppt-pitch-deck',
  'example-deck-swiss-international',
  'example-html-ppt-product-launch',
  'example-html-ppt-weekly-report',
  'example-simple-deck',
] as const;

const CURATED_IMAGE_PLUGIN_IDS = [
  'example-fhcoc-event-flyer',
  'example-fhcoc-social-post',
  'example-fhcoc-event-poster',
  'example-image-poster',
  'example-poster-hero',
  'example-magazine-poster',
  'example-social-carousel',
] as const;

const CURATED_VIDEO_PLUGIN_IDS = [
  'video-template-frame-product-promo',
  'video-template-frame-bold-poster',
  'video-template-frame-swiss-grid',
  'video-template-frame-kinetic-type',
  'video-template-frame-logo-outro',
] as const;

const CURATED_HYPERFRAMES_PLUGIN_IDS = [
  'example-hyperframes',
  'example-video-hyperframes',
  'example-motion-frames',
  'video-template-frame-data-chart-nyt',
  'video-template-frame-pentagram-stat',
] as const;

export const CURATED_PLUGIN_IDS_BY_CHIP = {
  prototype: CURATED_PROTOTYPE_PLUGIN_IDS,
  wireframe: CURATED_WIREFRAME_PLUGIN_IDS,
  mobile: CURATED_MOBILE_PLUGIN_IDS,
  document: CURATED_DOCUMENT_PLUGIN_IDS,
  'live-artifact': CURATED_LIVE_ARTIFACT_PLUGIN_IDS,
  deck: CURATED_DECK_PLUGIN_IDS,
  image: CURATED_IMAGE_PLUGIN_IDS,
  video: CURATED_VIDEO_PLUGIN_IDS,
  hyperframes: CURATED_HYPERFRAMES_PLUGIN_IDS,
};

const CURATED_GLOBAL_IDS = [
  ...CURATED_PROTOTYPE_PLUGIN_IDS,
  ...CURATED_WIREFRAME_PLUGIN_IDS,
  ...CURATED_MOBILE_PLUGIN_IDS,
  ...CURATED_DOCUMENT_PLUGIN_IDS,
  ...CURATED_LIVE_ARTIFACT_PLUGIN_IDS,
  ...CURATED_DECK_PLUGIN_IDS,
  ...CURATED_IMAGE_PLUGIN_IDS,
  ...CURATED_VIDEO_PLUGIN_IDS,
  ...CURATED_HYPERFRAMES_PLUGIN_IDS,
];

const CURATED_GLOBAL_RANK = new Map<string, number>(
  CURATED_GLOBAL_IDS.map((id, index) => [id, index]),
);

export function curatedPluginPriority(record: InstalledPluginRecord): number | null {
  return CURATED_GLOBAL_RANK.get(record.id) ?? null;
}

export function curatedPluginPriorityForChip(
  record: InstalledPluginRecord,
  chipId: string,
): number | null {
  const ids = (CURATED_PLUGIN_IDS_BY_CHIP as Record<string, readonly string[] | undefined>)[chipId];
  if (!ids) return null;
  const index = ids.indexOf(record.id);
  return index >= 0 ? index : null;
}
