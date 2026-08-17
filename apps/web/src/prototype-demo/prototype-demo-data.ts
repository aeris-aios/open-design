/**
 * Fixture data for the prototype-path review demo (`/prototype-demo`).
 *
 * Everything here is hard-coded on purpose. The demo exists so the team can
 * click through a PROPOSED end-to-end prototype journey and sign off on the
 * shape of it; it deliberately talks to no daemon route, starts no run, and
 * writes no project files. Swap these fixtures for real state only once the
 * flow itself is agreed.
 */

/** Which surface the prototype targets. Drives the preview device frame. */
export type DemoPlatform = 'web' | 'mobile' | 'desktop';

/** Wireframe vs. high-fidelity — mirrors `newproj.fidelity*` in the real panel. */
export type DemoFidelity = 'wireframe' | 'high';

/** Where the first pass draws its structure from. */
export type DemoStartingPoint = 'blank' | 'reference' | 'url' | 'design-system';

/**
 * A block inside a mocked screen. The renderer paints each kind as a skeleton
 * shape, so a screen is described by its layout rhythm rather than real copy —
 * enough for the team to judge structure without anyone drawing pixels.
 */
export type DemoBlockKind =
  | 'appbar'
  | 'hero'
  | 'search'
  | 'stat-row'
  | 'list'
  | 'card-grid'
  | 'table'
  | 'chart'
  | 'form'
  | 'timeline'
  | 'text'
  | 'cta'
  | 'tabbar';

export interface DemoBlock {
  kind: DemoBlockKind;
  label?: string;
  /** Repeat count for the list / grid / table families. */
  rows?: number;
}

/**
 * A clickable region the mocked prototype exposes. `to` is a screen id, so the
 * preview can walk the flow the same way a real clickable prototype would.
 */
export interface DemoHotspot {
  label: string;
  to: string;
}

/**
 * Per-screen generation state. `stale` is the one that matters for the
 * proposal: it marks a screen the user has asked to change but not yet re-run,
 * which is what makes per-screen iteration legible instead of a whole-artifact
 * rebuild.
 */
export type DemoScreenStatus = 'queued' | 'generating' | 'ready' | 'stale';

export interface DemoScreen {
  id: string;
  name: string;
  /** One line on what the screen is for — shown in the screen map step. */
  purpose: string;
  blocks: DemoBlock[];
  hotspots: DemoHotspot[];
  status: DemoScreenStatus;
}

export interface DemoBriefPreset {
  id: string;
  /** Natural-language brief seeded into the entry composer. */
  brief: string;
  label: string;
  platform: DemoPlatform;
  screens: DemoScreen[];
}

export const PLATFORM_LABELS: Record<DemoPlatform, string> = {
  web: 'Responsive web',
  mobile: 'Mobile app',
  desktop: 'Desktop app',
};

export const FIDELITY_LABELS: Record<DemoFidelity, string> = {
  wireframe: 'Wireframe',
  high: 'High fidelity',
};

export const STARTING_POINT_LABELS: Record<DemoStartingPoint, string> = {
  blank: 'From scratch',
  reference: 'From a reference image',
  url: 'From a live URL',
  'design-system': 'From my design system',
};

/**
 * Device frame sizes for the preview step. Mirrors the viewport presets the
 * real FileViewer already ships (`PREVIEW_VIEWPORT_PRESETS`) so the demo does
 * not invent a competing set of breakpoints.
 */
export const DEVICE_FRAMES: Record<DemoPlatform, { width: number; height: number; label: string }> = {
  web: { width: 1280, height: 800, label: 'Desktop · 1280 × 800' },
  mobile: { width: 390, height: 844, label: 'Mobile · 390 × 844' },
  desktop: { width: 1440, height: 900, label: 'Desktop app · 1440 × 900' },
};

const ORDERS_SCREENS: DemoScreen[] = [
  {
    id: 'sign-in',
    name: 'Sign in',
    purpose: 'Email + SSO entry, with the error state for a rejected code.',
    blocks: [
      { kind: 'hero', label: 'Welcome back' },
      { kind: 'form', rows: 2 },
      { kind: 'cta', label: 'Continue' },
      { kind: 'text', rows: 1 },
    ],
    hotspots: [{ label: 'Continue', to: 'orders' }],
    status: 'ready',
  },
  {
    id: 'orders',
    name: 'Orders',
    purpose: 'The default landing surface: filterable order list plus today’s counters.',
    blocks: [
      { kind: 'appbar', label: 'Orders' },
      { kind: 'stat-row', rows: 4 },
      { kind: 'search' },
      { kind: 'table', rows: 6 },
    ],
    hotspots: [
      { label: 'Open an order row', to: 'order-detail' },
      { label: 'Account menu', to: 'settings' },
    ],
    status: 'ready',
  },
  {
    id: 'order-detail',
    name: 'Order detail',
    purpose: 'Line items, payment state, and the jump into shipment tracking.',
    blocks: [
      { kind: 'appbar', label: 'Order #4821' },
      { kind: 'stat-row', rows: 3 },
      { kind: 'list', rows: 4 },
      { kind: 'cta', label: 'Track shipment' },
    ],
    hotspots: [
      { label: 'Track shipment', to: 'tracking' },
      { label: 'Back to orders', to: 'orders' },
    ],
    status: 'ready',
  },
  {
    id: 'tracking',
    name: 'Shipment tracking',
    purpose: 'Carrier timeline with the delayed-delivery exception state.',
    blocks: [
      { kind: 'appbar', label: 'Tracking' },
      { kind: 'timeline', rows: 5 },
      { kind: 'chart' },
      { kind: 'text', rows: 2 },
    ],
    hotspots: [{ label: 'Back to order', to: 'order-detail' }],
    status: 'ready',
  },
  {
    id: 'settings',
    name: 'Notification settings',
    purpose: 'Per-event notification toggles and the digest schedule.',
    blocks: [
      { kind: 'appbar', label: 'Settings' },
      { kind: 'list', rows: 5 },
      { kind: 'cta', label: 'Save changes' },
    ],
    hotspots: [{ label: 'Back to orders', to: 'orders' }],
    status: 'ready',
  },
];

const FITNESS_SCREENS: DemoScreen[] = [
  {
    id: 'onboarding',
    name: 'Goal setup',
    purpose: 'Three-question intake that seeds the weekly plan.',
    blocks: [
      { kind: 'hero', label: 'What are you training for?' },
      { kind: 'card-grid', rows: 4 },
      { kind: 'cta', label: 'Build my plan' },
    ],
    hotspots: [{ label: 'Build my plan', to: 'plan' }],
    status: 'ready',
  },
  {
    id: 'plan',
    name: 'Weekly plan',
    purpose: 'Seven-day strip with today’s session pinned to the top.',
    blocks: [
      { kind: 'appbar', label: 'This week' },
      { kind: 'stat-row', rows: 3 },
      { kind: 'list', rows: 5 },
      { kind: 'tabbar', rows: 4 },
    ],
    hotspots: [
      { label: 'Open today’s session', to: 'session' },
      { label: 'Progress tab', to: 'progress' },
    ],
    status: 'ready',
  },
  {
    id: 'session',
    name: 'Workout check-in',
    purpose: 'Set-by-set logging with the rest timer running.',
    blocks: [
      { kind: 'appbar', label: 'Lower body' },
      { kind: 'list', rows: 6 },
      { kind: 'cta', label: 'Finish session' },
      { kind: 'tabbar', rows: 4 },
    ],
    hotspots: [{ label: 'Finish session', to: 'progress' }],
    status: 'ready',
  },
  {
    id: 'progress',
    name: 'Progress review',
    purpose: 'Four-week trend plus the streak the coach nudges against.',
    blocks: [
      { kind: 'appbar', label: 'Progress' },
      { kind: 'chart' },
      { kind: 'stat-row', rows: 3 },
      { kind: 'list', rows: 3 },
      { kind: 'tabbar', rows: 4 },
    ],
    hotspots: [{ label: 'Back to plan', to: 'plan' }],
    status: 'ready',
  },
];

const ORDERS_PRESET: DemoBriefPreset = {
  id: 'orders',
  label: 'Order tracking dashboard',
  brief:
    'Build an order tracking dashboard for an ops team — order list with filters, order detail, shipment tracking, and notification settings.',
  platform: 'web',
  screens: ORDERS_SCREENS,
};

const FITNESS_PRESET: DemoBriefPreset = {
  id: 'fitness',
  label: 'Fitness coaching app',
  brief:
    'Build a mobile fitness coaching app covering goal setup, a weekly plan, workout check-in, and progress review.',
  platform: 'mobile',
  screens: FITNESS_SCREENS,
};

/**
 * The briefs the demo can start from. Each one carries the screen map the
 * proposal claims we can produce BEFORE spending a generation run — that
 * pre-generation map is the whole point of step 2.
 */
export const BRIEF_PRESETS: DemoBriefPreset[] = [ORDERS_PRESET, FITNESS_PRESET];

/**
 * Named rather than `BRIEF_PRESETS[0]` so the initial state reads as a
 * definite preset under `noUncheckedIndexedAccess`.
 */
export const DEFAULT_BRIEF_PRESET = ORDERS_PRESET;

/**
 * Screens the user can append to the map in step 2. Kept as a short menu
 * rather than free text: the point of the step is that the structure is
 * reviewable and cheap to correct, not that it is another writing task.
 */
export const SUGGESTED_EXTRA_SCREENS: Array<Pick<DemoScreen, 'id' | 'name' | 'purpose' | 'blocks'>> = [
  {
    id: 'empty-state',
    name: 'Empty state',
    purpose: 'What a brand-new account sees before any data exists.',
    blocks: [
      { kind: 'appbar', label: 'Orders' },
      { kind: 'hero', label: 'Nothing here yet' },
      { kind: 'cta', label: 'Import orders' },
    ],
  },
  {
    id: 'error-state',
    name: 'Error state',
    purpose: 'Sync failure with a retry affordance.',
    blocks: [
      { kind: 'appbar', label: 'Orders' },
      { kind: 'text', rows: 2 },
      { kind: 'cta', label: 'Retry sync' },
    ],
  },
  {
    id: 'search-results',
    name: 'Search results',
    purpose: 'Cross-entity search with grouped result sections.',
    blocks: [
      { kind: 'search' },
      { kind: 'list', rows: 4 },
      { kind: 'list', rows: 3 },
    ],
  },
];

/** Canned iteration replies, cycled so the demo reads differently each turn. */
const ITERATION_REPLIES = [
  'Rebuilt this screen only — the other screens were left untouched.',
  'Applied to this screen. Shared tokens updated, siblings not re-run.',
  'Done. This screen re-ran in isolation; its links into the flow still resolve.',
] as const;

/** Cycles the canned replies; total so callers need no undefined handling. */
export function iterationReply(turn: number): string {
  const index = ((turn % ITERATION_REPLIES.length) + ITERATION_REPLIES.length) % ITERATION_REPLIES.length;
  return ITERATION_REPLIES[index] ?? ITERATION_REPLIES[0];
}
