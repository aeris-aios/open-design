// AUTO-GENERATED — DO NOT EDIT BY HAND.
//
// Blended template popularity, used to order the plugin/example grid and the
// Home rail so the templates users actually reach for lead each category and
// sub-category (OPEND-449). Higher score = more popular; range [0, 1].
//
// How it is built (deterministic, creds-free transform):
//   score = 0.6 * norm(log1p(distinctUsers)) + 0.4 * norm(log1p(runs))
//   • window: trailing 28 days of `run_finished` events (by plugin_id)
//   • distinct users are the anti-gaming signal; runs add engagement depth
//   • log1p tames the head-template scale gap; min-max normalized over the
//     live-catalog template set so both metrics land in [0, 1]
//   • RETIRED plugins (absent from the live catalog) are dropped
//   • templates with no renderable preview are EXCLUDED — mode-seed entries
//     (e.g. the generic Live Artifact / HyperFrames options) live in the
//     composer mode picker, not the gallery, so usage must not float them up
//   • templates below 20 distinct users are OMITTED so thin-sample
//     tail templates keep their curated/visual fallback order
//
// Regenerate with: pnpm exec tsx scripts/refresh-plugin-popularity.ts --write
// Refreshed weekly by .github/workflows/refresh-plugin-popularity.yml.
// See pluginPopularity.RUNBOOK.md here.

export interface PluginPopularityMeta {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly weights: { readonly users: number; readonly runs: number };
  readonly minUsers: number;
  readonly count: number;
}

export const PLUGIN_POPULARITY_META: PluginPopularityMeta = {
  generatedAt: '2026-07-20',
  windowDays: 28,
  weights: { users: 0.6, runs: 0.4 },
  minUsers: 20,
  count: 71,
};

// Plugin id -> blended popularity score in [0, 1], most-popular first.
export const PLUGIN_POPULARITY: Readonly<Record<string, number>> = {
  'example-web-prototype': 1.0,
  'example-simple-deck': 0.876,
  'example-mobile-app': 0.6979,
  'example-web-clone': 0.6679,
  'example-gamified-app': 0.6248,
  'example-fs-creative-voltage': 0.5995,
  'example-kanban-board': 0.5899,
  'example-wireframe-mobile-flow': 0.5811,
  'example-wireframe-sketch': 0.5784,
  'example-fs-electric-studio': 0.5546,
  'example-dashboard': 0.5505,
  'example-mobile-onboarding': 0.5456,
  'example-fs-notebook-tabs': 0.5377,
  'example-video-hyperframes': 0.5249,
  'example-wireframe-greybox': 0.5198,
  'example-social-carousel': 0.5154,
  'example-motion-frames': 0.5065,
  'example-fs-editorial-forest': 0.5061,
  'example-html-ppt-knowledge-arch-blueprint': 0.5042,
  'example-webgl-experience': 0.5031,
  'example-html-ppt-course-module': 0.4994,
  'example-digital-eguide': 0.4962,
  'example-resume-modern': 0.4893,
  'example-hps-academic-paper': 0.4718,
  'example-fs-emerald-editorial': 0.471,
  'example-wireframe-annotated': 0.4709,
  'example-html-ppt-hermes-cyber-terminal': 0.4547,
  'example-audio-jingle': 0.4461,
  'example-blog-post': 0.4425,
  'example-html-ppt-weekly-report': 0.4278,
  'example-docs-page': 0.4241,
  'example-hps-bauhaus': 0.4174,
  'example-deck-swiss-international': 0.4071,
  'example-image-poster': 0.4039,
  'video-template-frame-kinetic-type': 0.4018,
  'example-pm-spec': 0.4008,
  'example-hps-true-blueprint': 0.3997,
  'example-finance-report': 0.3962,
  'example-html-ppt-presenter-mode-reveal': 0.3936,
  'video-template-frame-bold-poster': 0.3919,
  'example-html-ppt-obsidian-claude-gradient': 0.3917,
  'example-web-prototype-taste-soft': 0.391,
  'example-social-media-dashboard': 0.3899,
  'example-html-ppt-tech-sharing': 0.387,
  'video-template-frame-liquid-bg-hero': 0.3843,
  'example-github-dashboard': 0.3777,
  'video-template-frame-glitch-title': 0.3722,
  'example-invoice': 0.3705,
  'example-web-prototype-taste-brutalist': 0.3705,
  'example-html-ppt-graphify-dark-graph': 0.3692,
  'example-hps-memphis-pop': 0.3666,
  'example-frontend-slides': 0.3564,
  'example-eng-runbook': 0.3546,
  'video-template-frame-build-minimal': 0.353,
  'example-frame-logo-outro': 0.3523,
  'video-template-frame-logo-outro': 0.3516,
  'example-ppt-keynote': 0.3512,
  'example-critique': 0.3492,
  'example-html-ppt-product-launch': 0.3429,
  'example-hps-y2k-chrome': 0.3425,
  'example-html-ppt-testing-safety-alert': 0.3423,
  'example-html-ppt-taste-brutalist': 0.3402,
  'video-template-frame-creative-voltage': 0.3385,
  'example-flowai-live-dashboard-template': 0.3364,
  'video-template-frame-pentagram-stat': 0.3358,
  'video-template-frame-bold-signal': 0.3332,
  'example-ve-terminal-mono': 0.3318,
  'example-video-shortform': 0.3313,
  'example-frame-glitch-title': 0.3216,
  'example-frame-flowchart-sticky': 0.3214,
  'example-ve-midnight-editorial': 0.3213,
};

// Templates with no renderable preview — suppressed from the visual gallery
// grid so they never show as an empty letter card. They still reach users
// through the composer's mode picker. Repo-derived (baked manifest + on-disk
// `od.preview` entry existence), refreshed alongside the scores above.
export const PLUGIN_NO_PREVIEW: readonly string[] = [
  'example-dcf-valuation',
  'example-design-brief',
  'example-html-ppt',
  'example-hyperframes',
  'example-last30days',
  'example-live-artifact',
  'example-pptx-html-fidelity-audit',
  'example-x-research',
];
