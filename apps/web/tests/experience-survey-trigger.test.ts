// The survey's whole value is that it is asked once, at a defensible moment.
// Both halves of that are enforced here rather than in the component: the
// component can only render what the trigger arms, so an off-by-one in the
// delivery count or a leak past `retired` is invisible until the card shows up
// on someone's first run — or never shows up at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SURVEY_MIN_DELIVERIES,
  deliveredCount,
  isSurveyRetired,
  notifyArtifactDelivered,
  onArtifactDelivered,
  retireSurvey,
} from '../src/components/experience-survey-trigger';

// Minimal in-memory localStorage stub. Vitest runs in a node env, so we
// provide just enough of the Storage interface for the module's code paths.
function createStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

function useStorage(storage: unknown) {
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
}

/** Subscribes a spy for the duration of one test. */
function listen() {
  const listener = vi.fn();
  const unsubscribe = onArtifactDelivered(listener);
  unsubscribers.push(unsubscribe);
  return listener;
}

let unsubscribers: Array<() => void> = [];

beforeEach(() => {
  useStorage(createStorageStub());
});

afterEach(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('experience survey delivery trigger', () => {
  it('stays silent on the first delivery and arms on the second', () => {
    const listener = listen();

    notifyArtifactDelivered();
    expect(listener).not.toHaveBeenCalled();
    expect(deliveredCount()).toBe(1);

    notifyArtifactDelivered();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(deliveredCount()).toBe(SURVEY_MIN_DELIVERIES);
  });

  it('keeps arming on later deliveries so a dropped chance is not the last one', () => {
    const listener = listen();

    notifyArtifactDelivered();
    notifyArtifactDelivered();
    notifyArtifactDelivered();
    notifyArtifactDelivered();

    // Three arms from four deliveries: every delivery from the second on is a
    // fresh chance, because the component drops the ones the user types over.
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('counts deliveries across reloads', () => {
    const storage = createStorageStub();
    useStorage(storage);
    notifyArtifactDelivered();

    // Same store, new page load.
    useStorage(storage);
    const listener = listen();
    notifyArtifactDelivered();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never arms again once retired, and stops counting', () => {
    const listener = listen();
    retireSurvey();

    notifyArtifactDelivered();
    notifyArtifactDelivered();
    notifyArtifactDelivered();

    expect(listener).not.toHaveBeenCalled();
    expect(isSurveyRetired()).toBe(true);
    expect(deliveredCount()).toBe(0);
  });

  it('never arms when the store is unwritable', () => {
    // Fail-closed: a count that cannot advance must read as "not yet
    // qualified", never as "qualified every time".
    useStorage({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
    const listener = listen();

    for (let i = 0; i < 5; i += 1) notifyArtifactDelivered();

    expect(listener).not.toHaveBeenCalled();
  });

  it('treats a corrupted count as zero rather than qualifying on it', () => {
    const storage = createStorageStub();
    storage.setItem('open-design:experience-survey:v1:deliveries', 'not-a-number');
    useStorage(storage);
    const listener = listen();

    notifyArtifactDelivered();
    expect(listener).not.toHaveBeenCalled();

    notifyArtifactDelivered();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
