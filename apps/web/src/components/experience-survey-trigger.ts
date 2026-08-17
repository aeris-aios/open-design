// Trigger + frequency state for the experience survey (CSAT + NPS).
//
// The survey is armed by a SUCCESSFUL export and then stays armed until the
// user answers or closes it — it deliberately outlives the screen that armed
// it, so a user who exports inside a project and immediately navigates back to
// home still sees the card. That is why the arm/disarm state lives in a module
// singleton rather than in the exporting component's React tree.
//
// Frequency rule (product decision): once the user closes the card, it never
// comes back. There is no re-ask window. A single dismissal is treated as a
// real answer to "do you want to be asked this" and re-asking would spend
// goodwill for a marginal sample gain.

const STORAGE_PREFIX = 'open-design:experience-survey:v1';
const RETIRED_KEY = `${STORAGE_PREFIX}:retired`;
const FIRST_SEEN_KEY = `${STORAGE_PREFIX}:first-seen`;
const EXPORT_COUNT_KEY = `${STORAGE_PREFIX}:export-count`;

/** Qualification: the user has finished this many successful exports. */
export const MIN_SUCCESSFUL_EXPORTS = 3;
/** Qualification: this long since we first saw the install. */
export const MIN_INSTALL_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Breathing room after the export lands before the card animates in. */
export const SURVEY_DELAY_MS = 3_000;

type Listener = () => void;

const listeners = new Set<Listener>();

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Frequency control is advisory. A locked-down store must never break
    // exporting, so a failed write is swallowed the same way the campaign
    // modal swallows its own.
  }
}

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
  writeStorage(RETIRED_KEY, '1');
}

/**
 * Stamps the first time this install was seen. Called on mount so install age
 * starts counting from the first launch that carries this build, not from the
 * first export.
 */
export function markInstallSeen(): void {
  if (readStorage(FIRST_SEEN_KEY)) return;
  writeStorage(FIRST_SEEN_KEY, String(Date.now()));
}

function installAgeMs(): number {
  const raw = readStorage(FIRST_SEEN_KEY);
  if (!raw) return 0;
  const stamped = Number(raw);
  if (!Number.isFinite(stamped)) return 0;
  return Math.max(0, Date.now() - stamped);
}

function successfulExports(): number {
  const raw = readStorage(EXPORT_COUNT_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function isQualified(): boolean {
  return (
    successfulExports() >= MIN_SUCCESSFUL_EXPORTS &&
    installAgeMs() >= MIN_INSTALL_AGE_MS
  );
}

/**
 * Called by the export path on a successful export. Increments the lifetime
 * counter first so the export that crosses the threshold is itself allowed to
 * arm the survey, then notifies listeners.
 */
export function notifyExportSucceeded(): void {
  if (isSurveyRetired()) return;
  writeStorage(EXPORT_COUNT_KEY, String(successfulExports() + 1));
  if (!isQualified()) return;
  for (const listener of listeners) listener();
}

export function onExportSucceeded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test/debug seam: force the card to arm without meeting the gates. */
export function forceArmForDebug(): void {
  for (const listener of listeners) listener();
}
