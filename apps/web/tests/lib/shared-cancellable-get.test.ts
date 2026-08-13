import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetSharedCancellableGet,
  sharedCancellableGet,
} from '../../src/lib/shared-cancellable-get';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Stands in for `fetch`: pending until aborted, then rejects with the reason. */
function fetchLike(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('value'), 1000);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Collects unhandled rejections for the duration of one case. The shared read
 * is released deliberately when its last cancellable reader detaches; that
 * rejection has no consumer left by construction, so it must never escape to
 * the runtime (in the browser it reached the Next dev overlay as a stray
 * `AbortError` pointing at the abort call inside the helper).
 */
function trackUnhandledRejections(): { seen: unknown[]; stop: () => void } {
  const seen: unknown[] = [];
  const onProcess = (reason: unknown) => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onProcess);
  return {
    seen,
    stop: () => {
      process.off('unhandledRejection', onProcess);
    },
  };
}

describe('sharedCancellableGet', () => {
  let tracker: ReturnType<typeof trackUnhandledRejections>;

  beforeEach(() => {
    resetSharedCancellableGet();
    tracker = trackUnhandledRejections();
  });

  afterEach(() => {
    tracker.stop();
    resetSharedCancellableGet();
  });

  it('releases the shared read when its last cancellable reader detaches', async () => {
    let sharedSignal!: AbortSignal;
    const caller = new AbortController();
    const promise = sharedCancellableGet(
      'k-last-reader',
      (signal) => {
        sharedSignal = signal;
        return fetchLike(signal);
      },
      { signal: caller.signal },
    );

    caller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(true);
    // Named on purpose: the browser's own reason ("signal is aborted without
    // reason") reads as a fault and points into the helper.
    expect((sharedSignal.reason as DOMException).name).toBe('AbortError');
    expect((sharedSignal.reason as DOMException).message).toContain('Shared read released');
  });

  it('never surfaces the deliberate release as an unhandled rejection', async () => {
    const caller = new AbortController();
    // Deliberately no `.catch()` on the shared entry's own promise: only the
    // caller's promise is handled, exactly as a component-scoped reader does.
    void sharedCancellableGet('k-unhandled', fetchLike, { signal: caller.signal })
      .catch(() => {});
    caller.abort();

    await tick(20);
    expect(tracker.seen).toEqual([]);
  });

  it('keeps the shared read alive while another cancellable reader waits', async () => {
    let sharedSignal!: AbortSignal;
    const first = new AbortController();
    const second = new AbortController();
    const run = (signal: AbortSignal) => {
      sharedSignal = signal;
      return fetchLike(signal);
    };

    const a = sharedCancellableGet('k-two-readers', run, { signal: first.signal });
    const b = sharedCancellableGet('k-two-readers', run, { signal: second.signal });

    first.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(false);

    second.abort();
    await expect(b).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(true);
    await tick(20);
    expect(tracker.seen).toEqual([]);
  });

  it('never releases a read that a signal-less reader pinned', async () => {
    let sharedSignal!: AbortSignal;
    const caller = new AbortController();
    const run = (signal: AbortSignal) => {
      sharedSignal = signal;
      return fetchLike(signal);
    };

    const cancellable = sharedCancellableGet('k-pinned', run, { signal: caller.signal });
    const pinned = sharedCancellableGet('k-pinned', run);

    caller.abort();
    await expect(cancellable).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal.aborted).toBe(false);

    await expect(pinned).resolves.toBe('value');
  });
});
