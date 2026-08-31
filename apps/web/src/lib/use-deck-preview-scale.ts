import { useEffect } from 'react';
import type { RefObject } from 'react';

// Logical width every deck preview iframe is rendered at before being scaled
// down to its card frame. Matches PreviewModal's `designWidth` so a deck's first
// slide lays out at its authored 16:9 canvas (templates that declare a stage all
// use 1280) and then shrinks proportionally instead of overflowing the thumbnail.
export const DECK_PREVIEW_DESIGN_WIDTH = 1280;

// The matching logical height (16:9). Only the `cover` fit needs it.
export const DECK_PREVIEW_DESIGN_HEIGHT = 720;

// Deck template previews render their real HTML inside a small iframe. Letting
// the iframe fill the frame natively (width/height:100%, transform:none) only
// looks right for decks that self-scale to their viewport; a template authored
// on a fixed pixel canvas (`.deck{width:100vw;height:100vh}` + fixed-px content,
// no fit script) then renders full-size in the tiny iframe and its content
// overflows into an overlapping mess. The robust fix — matching PreviewModal —
// is to render the iframe at a fixed 1280×720 logical viewport and visually
// scale it down to the frame, so every template previews proportionally
// regardless of its internal strategy.
//
// CSS cannot divide two lengths, so the scale factor (frame width / 1280) is
// measured here and published as the `--deck-preview-scale` custom property on
// the frame; the frame's own CSS default covers the gap before the observer's
// first callback. A no-op when `enabled` is false (non-deck previews keep their
// own treatment) or when ResizeObserver is unavailable (SSR / jsdom).
// `fit: 'width'` (default) fits the stage to the frame's width and letterboxes
// whatever height is left over. `fit: 'cover'` scales to the LARGER of the two
// ratios so the stage reaches all four edges and the overflow clips — used by
// the Home example-preset tiles, whose cells are wider than 16:9 and must show
// a full-bleed thumbnail.
export function useDeckPreviewScale(
  frameRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  fit: 'width' | 'cover' = 'width',
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const width = el.clientWidth;
      if (width > 0) {
        const widthScale = width / DECK_PREVIEW_DESIGN_WIDTH;
        const height = el.clientHeight;
        const scale =
          fit === 'cover' && height > 0
            ? Math.max(widthScale, height / DECK_PREVIEW_DESIGN_HEIGHT)
            : widthScale;
        el.style.setProperty('--deck-preview-scale', String(scale));
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frameRef, enabled, fit]);
}
