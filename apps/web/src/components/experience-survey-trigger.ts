// Trigger + frequency state for the experience survey (CSAT + NPS).
//
// The survey is armed by a DELIVERED design run — a run that finished and
// actually wrote an artifact — and then stays armed until the user answers or
// closes it. It deliberately outlives the screen that armed it, so a user who
// generates inside a project and immediately navigates back to home still sees
// the card. That is why the arm state lives in a module singleton rather than
// in the generating component's React tree.
//
// WHY DELIVERY AND NOT EXPORT. The survey used to be armed by a successful
// export. Export is a late, narrow event: over 30 days ~13k users exported
// while ~37k produced an artifact, so roughly two thirds of the people who got
// real work out of the product could never be asked — and the ones who tried
// it, got something, and left without exporting are exactly the ones worth
// hearing from.
//
// Two qualifications:
//
//   1. The run delivered. A run that only answered in text, stopped to ask a
//      clarifying question, or failed is not a product someone can judge.
//      `resolveDesignDeliveryOutcome` already draws that line; this module
//      trusts its `delivered` verdict rather than re-deriving one.
//
//   2. It is at least the user's SURVEY_MIN_DELIVERIES-th delivery. The first
//      delivery measures a first impression, not an experience, and it lands
//      at the one moment the user most wants to look at what they just got.
//      Waiting for the second costs almost no reach — a user who produces one
//      artifact almost always produces another (30-day average: ~13 each) —
//      and buys an opinion formed on more than a single run.
//
// Frequency rule: once the user answers or closes the card, it never comes
// back. A single dismissal is treated as a real answer to "do you want to be
// asked this", and re-asking would spend goodwill for a marginal sample gain.

const RETIRED_KEY = 'open-design:experience-survey:v1:retired';
const DELIVERY_COUNT_KEY = 'open-design:experience-survey:v1:deliveries';

/** Deliveries a user must reach before the card may be armed. See note above. */
export const SURVEY_MIN_DELIVERIES = 2;

/** Breathing room after the artifact lands before the card animates in. */
export const SURVEY_DELAY_MS = 3_000;

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * True once the user has answered or closed the survey. Read fail-closed: when
 * the store is unreadable we cannot persist a dismissal either, so answering
 * "retired" avoids showing a card the user can never permanently dismiss.
 */
export function isSurveyRetired(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(RETIRED_KEY) === '1';
  } catch {
    return true;
  }
}

export function retireSurvey(): void {
  try {
    window.localStorage.setItem(RETIRED_KEY, '1');
  } catch {
    // Frequency control is advisory. A locked-down store must never break
    // generating, so a failed write is swallowed the same way the campaign
    // modal swallows its own.
  }
}

/**
 * Deliveries counted so far. Fail-closed for the same reason as
 * `isSurveyRetired`: without a readable store the count can never advance, so
 * reporting zero keeps the card away rather than showing it on every run.
 */
export function deliveredCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(DELIVERY_COUNT_KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Records one delivery and returns the new running total. */
function recordDelivery(): number {
  const next = deliveredCount() + 1;
  try {
    window.localStorage.setItem(DELIVERY_COUNT_KEY, String(next));
  } catch {
    // Same contract as `retireSurvey`: an unwritable store degrades to never
    // qualifying, never to asking on every run.
    return 0;
  }
  return next;
}

/**
 * Called by the run path once a design run is confirmed delivered. Counts the
 * delivery first — the count has to advance on the first one too, or the
 * second can never arrive — and only then arms the card.
 */
export function notifyArtifactDelivered(): void {
  if (isSurveyRetired()) return;
  if (recordDelivery() < SURVEY_MIN_DELIVERIES) return;
  for (const listener of listeners) listener();
}

export function onArtifactDelivered(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
