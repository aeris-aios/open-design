// Fountain Hills Chamber gallery curation.
//
// This fork ships to one customer: the Fountain Hills Chamber of Commerce.
// The two surfaces a staffer meets first — the Home hero "Examples" rail and
// the Community template gallery — are projections of the bundled plugin
// catalogue, so left alone they show whatever upstream happened to bundle
// (SaaS landings, shader demos, investment-banking pitch books). Both are
// meant to read as "here is the work this office makes", so this module is the
// single place that says which ids lead and which never appear.
//
// Two lists, both consumed by BOTH surfaces:
//   • CHAMBER_PLUGIN_IDS — the first-party `example-fhcoc-*` packages, in the
//     order a staffer should meet them. They lead every facet they belong to.
//   • GALLERY_HIDDEN_PLUGIN_IDS — upstream templates that are not work a
//     chamber does (developer tooling, shader art, IB/clinical documents, and
//     the mode-seed scenarios that are bound to a chip rather than shown as an
//     example). Hidden from the gallery only: the plugins stay installed, keep
//     their ids, and remain reachable from Plugins / Templates, so nothing that
//     binds one by id (scenario-defaults, powered previews, orbit) breaks.
//
// Deleting an upstream package is the other lever, and the right one when a
// template is pure dead weight — see the 16 shader/3D/codex examples dropped
// alongside this file. Prefer hiding whenever an id is referenced by code.

/** First-party chamber templates, in curated display order. */
export const CHAMBER_PLUGIN_IDS = [
  'example-fhcoc-event-flyer',
  'example-fhcoc-social-post',
  'example-fhcoc-event-landing',
  'example-fhcoc-member-onepager',
  'example-fhcoc-newsletter',
  'example-fhcoc-member-directory',
  'example-fhcoc-sponsorship-packet',
  'example-fhcoc-annual-report',
  'example-fhcoc-renewal-notice',
  'example-fhcoc-board-deck',
  'example-fhcoc-state-of-the-town-deck',
  'example-fhcoc-event-poster',
] as const;

const CHAMBER_RANK = new Map<string, number>(
  CHAMBER_PLUGIN_IDS.map((id, index) => [id, index]),
);

/** Curated rank for a chamber template, or null when the id is upstream. */
export function chamberPluginRank(id: string): number | null {
  return CHAMBER_RANK.get(id) ?? null;
}

export function isChamberPlugin(id: string): boolean {
  return CHAMBER_RANK.has(id);
}

/** Upstream templates withheld from the Examples rail and the Community grid. */
export const GALLERY_HIDDEN_PLUGIN_IDS: ReadonlySet<string> = new Set<string>([
  // Mode seeds bound to a chip / powered preview rather than shown as examples.
  // `example-webgl-experience` is the webgl chip's own scenario binding
  // (contracts/scenario-defaults) and `example-worker-visualizer` is a
  // powered-preview intent, so both must keep existing while staying off the
  // gallery, where they read as shader toys next to chamber collateral.
  'example-webgl-experience',
  'example-worker-visualizer',
  // Developer / design-tool meta. A chamber office does not ship runbooks,
  // API docs, PRDs, OKR boards, or repo dashboards.
  'example-eng-runbook',
  'example-docs-page',
  'example-pm-spec',
  'example-team-okrs',
  'example-github-dashboard',
  'example-orbit-github',
  'example-orbit-linear',
  'example-orbit-notion',
  'example-critique',
  'example-tweaks',
  'example-pptx-html-fidelity-audit',
  // Off-brand or wrong-industry documents.
  'example-clinical-case-report',
  'example-dcf-valuation',
  'example-ib-pitch-book',
  'example-x-research',
  'example-card-twitter',
  'example-last30days',
  'example-gamified-app',
  // Loud style demos that fight the chamber design system.
  'example-html-ppt-taste-brutalist',
  'example-web-prototype-taste-brutalist',
  // Decks whose whole premise is a scene a chamber never presents: incident
  // retros, CLI walkthroughs, model-choice sessions, capstone defenses,
  // family-history and pop-culture talks.
  'example-deck-open-slide-canvas',
  'example-hps-true-blueprint',
  'example-hps-retro-tv',
  'example-hps-memphis-pop',
  'example-fs-notebook-tabs',
  'example-html-ppt-graphify-dark-graph',
  'example-html-ppt-hermes-cyber-terminal',
  'example-html-ppt-knowledge-arch-blueprint',
  'example-html-ppt-obsidian-claude-gradient',
  'example-html-ppt-presenter-mode-reveal',
  'example-html-ppt-tech-sharing',
  'example-ve-terminal-mono',
]);

export function isGalleryHidden(id: string): boolean {
  return GALLERY_HIDDEN_PLUGIN_IDS.has(id);
}
