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
  generatedAt: '2026-08-31',
  windowDays: 28,
  weights: { users: 0.6, runs: 0.4 },
  minUsers: 20,
  count: 93,
};

// Plugin id -> blended popularity score in [0, 1], most-popular first.
export const PLUGIN_POPULARITY: Readonly<Record<string, number>> = {
  'example-web-prototype': 1.0,
  'example-simple-deck': 0.8732,
  'example-web-clone': 0.8325,
  'example-mobile-app': 0.6938,
  'example-open-design-landing': 0.6706,
  'example-webgl-experience': 0.653,
  'example-wireframe-mobile-flow': 0.6004,
  'example-gamified-app': 0.5953,
  'example-kanban-board': 0.5928,
  'image-template-anime-martial-arts-battle-illustration': 0.5718,
  'example-fs-creative-voltage': 0.5586,
  'example-guizang-ppt': 0.5344,
  'example-digital-eguide': 0.533,
  'example-wireframe-sketch': 0.5268,
  'example-social-carousel': 0.5254,
  'example-webgl-caustic-pool': 0.5217,
  'example-dashboard': 0.5178,
  'example-fs-notebook-tabs': 0.5107,
  'example-mobile-onboarding': 0.5082,
  'example-fs-electric-studio': 0.5053,
  'image-template-e-commerce-live-stream-ui-mockup': 0.5022,
  'video-template-video-seedance-three-kingdoms-lyubu-yuanmen-archery': 0.4987,
  'example-resume-modern': 0.4921,
  'example-motion-frames': 0.4891,
  'example-blog-post': 0.484,
  'image-template-profile-avatar-anime-girl-to-cinematic-photo': 0.479,
  'example-video-hyperframes': 0.4767,
  'video-template-seedance-2-0-15-second-cinematic-japanese-romance-short-film': 0.4707,
  'image-template-profile-avatar-casual-fashion-grid-photoshoot': 0.4633,
  'example-codex-interactive-capability-map': 0.4539,
  'example-wireframe-greybox': 0.4538,
  'image-template-3d-stone-staircase-evolution-infographic': 0.453,
  'example-velar-luxury-real-estate': 0.4473,
  'example-html-ppt-zhangzara-creative-mode': 0.4468,
  'example-huashu-bento-insight': 0.4387,
  'example-wireframe-annotated': 0.435,
  'example-huashu-keynote-black': 0.4334,
  'example-social-media-matrix-tracker-template': 0.4304,
  'example-mockup-device-3d': 0.4295,
  'example-hps-academic-paper': 0.4258,
  'image-template-illustration-crayon-kid-drawing-rework': 0.4204,
  'example-html-ppt-course-module': 0.4196,
  'example-image-poster': 0.4174,
  'video-template-frame-kinetic-type': 0.414,
  'example-webgl-aurora-veil': 0.4139,
  'example-html-ppt-knowledge-arch-blueprint': 0.4117,
  'video-template-luxury-supercar-cinematic-narrative': 0.4089,
  'example-html-ppt-zhangzara-capsule': 0.4036,
  'video-template-3d-animated-boy-building-lego': 0.4032,
  'example-trading-analysis-dashboard-template': 0.4028,
  'example-live-dashboard': 0.3964,
  'example-flowai-live-dashboard-template': 0.3951,
  'example-docs-page': 0.3915,
  'example-html-ppt-hermes-cyber-terminal': 0.3851,
  'example-deck-swiss-international': 0.3817,
  'example-webgl-distortion-grain': 0.3807,
  'example-critique': 0.3803,
  'example-doc-kami-parchment': 0.3803,
  'image-template-illustrated-city-food-map': 0.3779,
  'example-kami-deck': 0.3767,
  'example-huashu-slides': 0.3763,
  'example-fs-editorial-forest': 0.376,
  'example-webgl-depth-gallery': 0.3756,
  'example-pm-spec': 0.374,
  'example-audio-jingle': 0.3737,
  'example-html-ppt-zhangzara-block-frame': 0.3658,
  'image-template-momotaro-explainer-slide-in-hybrid-style': 0.3648,
  'example-github-dashboard': 0.3644,
  'example-html-ppt-zhangzara-studio': 0.3609,
  'example-hps-true-blueprint': 0.3589,
  'video-template-frame-bold-poster': 0.3573,
  'video-template-frame-liquid-bg-hero': 0.3567,
  'video-template-frame-logo-outro': 0.3561,
  'example-frame-flowchart-sticky': 0.3526,
  'example-html-ppt-zhangzara-scatterbrain': 0.3451,
  'example-open-design-landing-deck': 0.3425,
  'image-template-game-screenshot-anime-fighting-game-captain-ryuuga-vs-kaze-renshin': 0.3414,
  'video-template-frame-build-minimal': 0.3378,
  'example-huashu-golden-circle': 0.3353,
  'example-finance-report': 0.334,
  'example-email-marketing': 0.3335,
  'example-hps-bauhaus': 0.332,
  'example-deck-open-slide-canvas': 0.3281,
  'image-template-notion-team-dashboard-live-artifact': 0.327,
  'example-ib-pitch-book': 0.3267,
  'example-social-media-dashboard': 0.3267,
  'image-template-profile-avatar-cyberpunk-anime-portrait-with-neon-face-text': 0.3229,
  'example-webgl-raymarched-hero': 0.3181,
  'example-video-shortform': 0.3157,
  'example-dating-web': 0.3086,
  'video-template-cinematic-east-asian-woman-hand-dance': 0.3064,
  'video-template-a-decade-of-refinement-glow-up': 0.3044,
  'video-template-frame-glitch-title': 0.2986,
};

// Templates with no renderable preview — suppressed from the visual gallery
// grid so they never show as an empty letter card. They still reach users
// through the composer's mode picker. Repo-derived (baked manifest + on-disk
// `od.preview` entry existence), refreshed alongside the scores above.
export const PLUGIN_NO_PREVIEW: readonly string[] = [
  'example-dcf-valuation',
  'example-design-brief',
  'example-hatch-pet',
  'example-html-ppt',
  'example-hyperframes',
  'example-last30days',
  'example-live-artifact',
  'example-pptx-html-fidelity-audit',
  'example-x-research',
];
