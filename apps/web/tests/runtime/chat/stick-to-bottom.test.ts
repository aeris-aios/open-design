import { describe, expect, it } from 'vitest';
import { nextFollowIntent } from '../../../src/runtime/chat/stick-to-bottom';

describe('chat stick-to-bottom intent', () => {
  it('does not treat scroll anchoring during layout growth as a user scroll-down', () => {
    const intent = { following: false, escaped: true };
    const previous = { scrollTop: 1570, scrollHeight: 2000, clientHeight: 400 };
    // Content above the viewport grew by 30px. Native scroll anchoring moves
    // scrollTop by the same amount so the paragraph under the pointer stays put.
    const anchored = { scrollTop: 1600, scrollHeight: 2030, clientHeight: 400 };

    expect(nextFollowIntent(intent, previous, anchored)).toEqual(intent);
  });

  it('keeps the escape latch until a user scroll actually reaches the bottom', () => {
    const escaped = { following: false, escaped: true };
    const previous = { scrollTop: 1000, scrollHeight: 2000, clientHeight: 400 };
    const thirtyPixelsAboveBottom = {
      scrollTop: 1570,
      scrollHeight: 2000,
      clientHeight: 400,
    };

    const nearBottom = nextFollowIntent(escaped, previous, thirtyPixelsAboveBottom);
    expect(nearBottom).toEqual(escaped);

    // A sibling (Plan/queue/composer) disappearing can make those last 30px
    // vanish without another user gesture. That layout change must not rearm.
    const bottomAfterLayout = {
      scrollTop: 1570,
      scrollHeight: 2000,
      clientHeight: 430,
    };
    expect(nextFollowIntent(nearBottom, thirtyPixelsAboveBottom, bottomAfterLayout)).toEqual(
      escaped,
    );
  });

  it('does not rearm when scrollHeight shrink erases the final 30px', () => {
    const escaped = { following: false, escaped: true };
    const previous = { scrollTop: 1000, scrollHeight: 2000, clientHeight: 400 };
    const thirtyPixelsAboveBottom = {
      scrollTop: 1570,
      scrollHeight: 2000,
      clientHeight: 400,
    };

    const nearBottom = nextFollowIntent(escaped, previous, thirtyPixelsAboveBottom);
    expect(nearBottom).toEqual(escaped);

    // An in-log card/media row becoming 30px shorter puts this same scrollTop
    // at the mathematical bottom. There was no user scroll, so escaped stays.
    const bottomAfterLayout = {
      scrollTop: 1570,
      scrollHeight: 1970,
      clientHeight: 400,
    };
    expect(nextFollowIntent(nearBottom, thirtyPixelsAboveBottom, bottomAfterLayout)).toEqual(
      escaped,
    );
  });
});
