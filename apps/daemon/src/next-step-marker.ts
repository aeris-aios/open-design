/**
 * Streaming half of the `<od-next key="…">` marker (shape lives in
 * `@open-design/contracts`, `api/next-step-marker`).
 *
 * Two hard requirements, both of them scars:
 *
 *  1. **Never flash half a tag.** SSE cuts the stream wherever it likes, so a
 *     delta can end mid-marker — `<od-ne`, or `<od-next key="a7f`. Anything we
 *     cannot yet prove is prose gets held back until the next delta resolves
 *     it. `<od-title>` shipped without a wide enough look-back once and users
 *     watched a half tag paint and then vanish.
 *
 *  2. **Never swallow the user's words.** Holding back is a bet that more
 *     characters are coming. When the stream ends and the bet was wrong — the
 *     held tail was just prose that happened to start with `<` — `flush()`
 *     returns it verbatim. Silently eating a sentence is worse than briefly
 *     delaying one.
 *
 * Stripping is unconditional; only *acceptance* is keyed. A marker with the
 * wrong key, no key, or a malformed one is still removed from the visible
 * text and simply produces no suggestions.
 */

import {
  MAX_NEXT_STEP_SUGGESTIONS,
  OD_NEXT_KEY_ATTR_RE,
  OD_NEXT_OPEN_TAG,
  parseNextStepSuggestions,
} from '@open-design/contracts';

/** Tolerates `</od-next >`, which models write often enough to matter. */
const CLOSE_TAG_RE = /<\/od-next\s*>/i;

export interface NextStepMarkerStripper {
  strip(delta: string): string;
  /** Stream ended: give back whatever is still held, verbatim. */
  flush(): string;
}

export interface NextStepMarkerStripperOptions {
  /**
   * This turn's nonce. A marker is only *accepted* when its `key` matches.
   * `null` means the turn has no key (the marker was never taught this turn),
   * so every marker is stripped and none is accepted.
   */
  key: string | null;
  /** Called at most once per turn, with 1..3 suggestions. Never with `[]`. */
  emit: (suggestions: string[]) => void;
  /**
   * How far past an opening tag we keep waiting for `</od-next>` before giving
   * up and releasing the buffer as prose. Three short sentences plus the tag
   * fit comfortably; a model that writes an essay in here loses the marker,
   * which is the right outcome.
   */
  maxScanLength?: number;
}

const DEFAULT_SCAN_LIMIT = 1024;

/**
 * How many characters at the end of `text` could still grow into an opening
 * tag. Two cases, mirroring the done-marker's client-side hold-back:
 *
 *   · the tail is a prefix of `<od-next` — the tag name is not finished;
 *   · the tail already IS `<od-next` but no `>` has arrived — the key
 *     attribute is still in flight.
 *
 * Bounded by `MAX_OPEN_TAG_HOLD` so a lone `<` in prose that never closes
 * cannot hold the rest of the answer hostage.
 */
const MAX_OPEN_TAG_HOLD = 96;

function pendingOpenTagTail(text: string): number {
  const open = text.lastIndexOf('<');
  if (open < 0) return 0;
  const held = text.length - open;
  if (held > MAX_OPEN_TAG_HOLD) return 0;
  const tail = text.slice(open).toLowerCase();
  if (OD_NEXT_OPEN_TAG.startsWith(tail)) return held;
  if (tail.startsWith(OD_NEXT_OPEN_TAG) && !tail.includes('>')) return held;
  return 0;
}

export function createNextStepMarkerStripper(
  options: NextStepMarkerStripperOptions,
): NextStepMarkerStripper {
  const maxScanLength = options.maxScanLength ?? DEFAULT_SCAN_LIMIT;
  const runKey = typeof options.key === 'string' && options.key ? options.key : null;
  /** Text held back because it might still turn into a marker. */
  let held = '';
  /** True once we have seen an opening tag and are waiting for its close. */
  let inMarker = false;
  /** Opening tag of the marker we are inside, kept so we can spit it back out. */
  let markerHead = '';
  let emitted = false;

  const accept = (inner: string, openTag: string) => {
    if (emitted) return;
    const attrKey = OD_NEXT_KEY_ATTR_RE.exec(openTag)?.[1] ?? '';
    // Unforgeable-by-content: a model can only produce this turn's nonce if the
    // daemon showed it to the model this turn.
    if (!runKey || attrKey !== runKey) return;
    const suggestions = parseNextStepSuggestions(inner).slice(0, MAX_NEXT_STEP_SUGGESTIONS);
    if (suggestions.length === 0) return;
    emitted = true;
    options.emit(suggestions);
  };

  const strip = (delta: string): string => {
    let buffer = held + String(delta ?? '');
    held = '';
    let visible = '';

    for (;;) {
      if (inMarker) {
        const close = CLOSE_TAG_RE.exec(buffer);
        if (!close) {
          if (buffer.length > maxScanLength) {
            /*
             * Bet lost: no `</od-next>` within a sane distance, so this was
             * either prose that opened with the tag or a model that never
             * closed it. Release the CONTENT (requirement 2 — never swallow
             * words) but keep the opening tag suppressed (requirement 1 — a
             * protocol tag never paints). Dropping both would eat up to a
             * kilobyte of a real answer; releasing both would put
             * `<od-next key="…">` on screen. Neither is acceptable, so the
             * tag is the only thing that dies.
             */
            visible += buffer;
            inMarker = false;
            markerHead = '';
            buffer = '';
            break;
          }
          held = buffer;
          break;
        }
        accept(buffer.slice(0, close.index), markerHead);
        buffer = buffer.slice(close.index + close[0].length);
        inMarker = false;
        markerHead = '';
        continue;
      }

      const openIndex = buffer.toLowerCase().indexOf(OD_NEXT_OPEN_TAG);
      if (openIndex === -1) {
        const keep = pendingOpenTagTail(buffer);
        visible += keep > 0 ? buffer.slice(0, buffer.length - keep) : buffer;
        held = keep > 0 ? buffer.slice(buffer.length - keep) : '';
        break;
      }

      visible += buffer.slice(0, openIndex);
      buffer = buffer.slice(openIndex);
      const gt = buffer.indexOf('>');
      if (gt === -1) {
        if (buffer.length > MAX_OPEN_TAG_HOLD) {
          // A `<od-next` that never closes its own tag is prose, not protocol.
          visible += buffer;
          buffer = '';
          break;
        }
        held = buffer;
        break;
      }
      markerHead = buffer.slice(0, gt + 1);
      buffer = buffer.slice(gt + 1);
      inMarker = true;
    }

    return visible;
  };

  return {
    strip,
    /*
     * Stream over. What is still held falls into two cases:
     *
     *  · We never saw a complete opening tag, so the tail is an ambiguous
     *    `<`-prefix that turned out to be prose — return it verbatim. This is
     *    the "don't swallow the user's words" half.
     *  · We are inside a marker whose close never arrived. Everything after
     *    the opening tag is protocol payload, so the tag itself is dropped
     *    (it must never paint) and only its content is returned, for the same
     *    reason the overflow path above returns it.
     */
    flush() {
      const rest = held;
      held = '';
      inMarker = false;
      markerHead = '';
      return rest;
    },
  };
}
