/**
 * The next-step marker — the agent's three follow-up suggestions for the turn
 * it just finished.
 *
 * The chat panel closes a delivered turn with three one-line actions the user
 * can send as-is ("再加一页订单列表", "把商品卡换成两列布局", "补一套深色模式").
 * They are written by the model, in the conversation's own language, about the
 * thing that was just built — not picked from a fixed catalogue. The agent
 * says what they are by emitting one block at the very end of its answer:
 *
 *     <od-next key="a7f3c91ed2b40561">
 *     再加一页订单列表
 *     把商品卡换成两列布局
 *     补一套深色模式
 *     </od-next>
 *
 * **Why a key.** Clicking a suggestion sends that exact sentence as the user's
 * next message. A bare `<od-next>` would therefore be a way for any text the
 * agent read — a cloned page, a summarised document, a file it was asked to
 * quote — to plant a sentence in the user's own composer path and dress it as
 * product UI. The turn key already exists (the daemon mints one per run for
 * `<od-done>`), so keying this marker costs one nonce we already have and one
 * prompt sentence, and a model cannot reproduce a nonce it was never shown.
 *
 * The key is validated entirely inside the daemon: the client is handed
 * already-parsed suggestions on a typed event and never sees the raw marker,
 * so this adds no protocol surface on the wire.
 *
 * **Stripping is unconditional.** Removing the marker from visible text does
 * NOT depend on the key matching. A marker with a wrong, malformed, or missing
 * key is still protocol noise and must never reach the user — exactly the
 * lesson `<od-title>` taught when its "only strip it when we asked for a
 * title" behaviour leaked raw tags into production chat.
 *
 * This module is the single source of truth for the marker's shape.
 */

/** Opening tag, without the attribute list — for streaming hold-back. */
export const OD_NEXT_OPEN_TAG = '<od-next';

/** Closing tag. */
export const OD_NEXT_CLOSE_TAG = '</od-next>';

/**
 * Every `<od-next …>…</od-next>` block, plus any orphaned opening/closing tag.
 *
 * Deliberately permissive: an unbalanced or wrongly-keyed marker is still
 * protocol noise. The alternation order matters — the balanced form must be
 * tried first, or the orphan branch would eat only the opening tag and leave
 * the suggestion lines behind as prose.
 *
 * Global + case-insensitive; callers that keep state must clone it
 * (`lastIndex` is shared on a module-level regex).
 */
export const OD_NEXT_BLOCK_RE = /<od-next\b[^>]*>[\s\S]*?<\/od-next\s*>|<\/?od-next\b[^>]*>/gi;

/**
 * Pull the key out of one `<od-next …>` opening tag. Quotes optional and both
 * styles accepted because model formatting drifts; the charset is restricted
 * so a stray attribute cannot smuggle markup through.
 */
export const OD_NEXT_KEY_ATTR_RE = /\bkey\s*=\s*["']?([A-Za-z0-9_-]{4,64})["']?/i;

/**
 * How many suggestions the UI shows. Three is what the design calls for; a
 * model that writes more is truncated rather than rejected, because four good
 * suggestions are not a protocol error.
 */
export const MAX_NEXT_STEP_SUGGESTIONS = 3;

/**
 * Per-suggestion character ceiling. A suggestion is one sendable sentence; a
 * paragraph means the model misunderstood the marker, and rendering it would
 * blow up a row that the design fixes at one line.
 */
export const NEXT_STEP_SUGGESTION_MAX_LENGTH = 120;

/** Leading list punctuation models add out of habit: `- `, `* `, `1. `, `1) `. */
const LIST_BULLET_RE = /^\s*(?:[-*+•]|\d{1,2}[.)])\s+/;

/**
 * Turn one marker's inner text into the suggestion list.
 *
 * One suggestion per line. Empty lines, list bullets, wrapping quotes, and
 * inline markdown emphasis are normalised away so a model that writes
 * `- **再加一页订单列表**` still yields a sendable sentence — the row's text IS
 * the message that gets sent, so it has to read like something a person typed.
 *
 * Returns at most `MAX_NEXT_STEP_SUGGESTIONS` entries; returns `[]` for
 * anything unusable, which the caller must treat as "this turn has no
 * suggestions" rather than as an error.
 */
export function parseNextStepSuggestions(inner: string): string[] {
  if (typeof inner !== 'string' || !inner.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of inner.split(/\r?\n/)) {
    let line = rawLine.replace(LIST_BULLET_RE, '');
    // Inline emphasis / code ticks around the whole line, and any stray tag.
    line = line
      .replace(/<[^>]*>/g, ' ')
      .replace(/[*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '')
      .trim();
    if (!line) continue;
    if (line.length > NEXT_STEP_SUGGESTION_MAX_LENGTH) continue;
    const dedupeKey = line.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(line);
    if (out.length >= MAX_NEXT_STEP_SUGGESTIONS) break;
  }
  return out;
}

/**
 * Remove every `<od-next …>` block from a string.
 *
 * Used on any text that could reach a user — the persisted message body,
 * copy-to-clipboard, exports — so the marker never shows up as raw protocol.
 *
 * Caller beware: this is context-free. A call site that must preserve a marker
 * an agent deliberately quoted inside a code fence has to do its own
 * fenced-region check first.
 */
export function stripNextStepMarkers(text: string): string {
  if (!text || !text.includes('<')) return text;
  return text.replace(new RegExp(OD_NEXT_BLOCK_RE.source, OD_NEXT_BLOCK_RE.flags), '');
}

/**
 * Render the marker for a given key. The one place the wire format is written,
 * so the prompt example and the parser can never drift apart.
 */
export function renderNextStepMarkerExample(key: string, suggestions: string[]): string {
  const body = suggestions.slice(0, MAX_NEXT_STEP_SUGGESTIONS).join('\n');
  return `<od-next key="${key}">\n${body}\n${OD_NEXT_CLOSE_TAG}`;
}
