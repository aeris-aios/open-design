import { useSyncExternalStore } from 'react';
import { isMacPlatform } from './platform';

export type EnterKeyMode = 'newline' | 'send';

const STORAGE_KEY = 'od.composer.enterKey';
const CHANGE_EVENT = 'od:composer-enter-key-change';

/**
 * Commerce Fountain default: Enter opens a new line, sending is deliberate.
 *
 * Upstream sends on a bare Enter, the messaging-app convention. A pilot with
 * chamber staff showed why that convention is wrong for this composer: its
 * real job is a multi-line event brief (name, date, venue, audience, what to
 * include), and the Enter that starts line two fired the turn instead. AERIS
 * then began designing from half a brief, and the box cleared under the writer
 * mid-thought.
 *
 * The two failure modes are not symmetric, which is what decides the default.
 * Sending early is unrecoverable: the turn is spent and the writer has lost
 * their place. Pressing Enter and getting a line break when you meant to send
 * costs one glance at the hint under the composer, with every character still
 * on screen. Prefer the mistake that keeps the text.
 *
 * Set `od.composer.enterKey` to `send` in local storage to restore upstream
 * behavior for a browser.
 */
export const DEFAULT_ENTER_KEY_MODE: EnterKeyMode = 'newline';

function readMode(): EnterKeyMode {
  if (typeof window === 'undefined') return DEFAULT_ENTER_KEY_MODE;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'send' ? 'send' : DEFAULT_ENTER_KEY_MODE;
  } catch {
    // Storage is unavailable in some privacy modes; the composer still works.
    return DEFAULT_ENTER_KEY_MODE;
  }
}

export function getEnterKeyMode(): EnterKeyMode {
  return readMode();
}

export function setEnterKeyMode(mode: EnterKeyMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Fall through: the in-memory default still applies for this session.
  }
  // `storage` only fires in *other* tabs, so announce the change locally too.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useEnterKeyMode(): EnterKeyMode {
  return useSyncExternalStore(subscribe, readMode, () => DEFAULT_ENTER_KEY_MODE);
}

/** The send chord as staff should read it: "⌘↵" on a Mac, "Ctrl+Enter" elsewhere. */
export function sendShortcutLabel(): string {
  return isMacPlatform() ? '⌘↵' : 'Ctrl+Enter';
}
