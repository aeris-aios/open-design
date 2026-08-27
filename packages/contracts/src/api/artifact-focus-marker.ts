/**
 * The artifact-focus marker — the agent's say in what this turn *shows*.
 *
 * Two decisions in the chat panel have always been host guesswork:
 *
 *  · **which file the preview opens** when a turn ends (rank HTML over
 *    markdown over media, tie-break on mtime — `auto-open-file.ts`), and
 *  · **which produced files get a card** (everything the turn touched, which
 *    on a website turn means the page plus its stylesheet plus eleven images).
 *
 * The agent knows both answers and the host does not. This marker lets it say
 * so:
 *
 *     <od-focus key="a7f3c91ed2b40561" open="index.html"/>
 *     <od-focus key="a7f3c91ed2b40561" show="index.html, report.md"/>
 *     <od-focus key="a7f3c91ed2b40561" open="index.html" show="index.html"/>
 *
 * **Why one tag with two attributes, and not two tags.** The two answers have
 * different clocks: `open` wants to fire the moment the deliverable has content
 * (the user should not watch a spinner for the ninety seconds the agent spends
 * writing sidecar assets), while `show` is only knowable once the turn's output
 * set is final. A single *block* marker would force the early answer to wait
 * for the late one — precisely the wait this feature exists to remove. A single
 * *self-closing* marker with independent attributes lets the agent emit it
 * twice: early with `open`, late with `show`. Each attribute is last-wins on
 * its own, so a late `show`-only marker cannot retract an early `open`.
 *
 * Self-closing for the same reason `<od-done/>` is (see `done-marker.ts`): a
 * container holds the whole answer back until its closing tag arrives.
 *
 * **Why a key.** Same nonce as `<od-done>` / `<od-next>`, same reason. This
 * marker names a path that the host then reads and renders. An unkeyed form
 * would let any text the agent merely *read* — a cloned page, a quoted
 * document, an instruction hidden inside either — steer the user's preview at
 * a file of its choosing. A model cannot reproduce a nonce it was never shown.
 * Reusing the existing per-turn key costs no second nonce and no second event.
 *
 * **Stripping is unconditional.** A marker with a wrong, malformed, or missing
 * key is still protocol noise and never reaches the reader. That rule is not
 * theoretical: `CRITIQUE_INLINE_TAGS` once spelled `MUST_FIX` as `MUSTFIX`, so
 * the strip list matched nothing in real data and users read raw protocol in
 * their chat for four turns running. Spelling lives here, once, and both the
 * daemon's stream strip and the web's history strip import it.
 *
 * **The marker can only ever narrow.** `show` filters the produced-file list
 * the host already computed; it cannot add a file to it. So the worst a
 * misbehaving marker can do is hide a card — never fabricate one, and never
 * point a card at a file the turn did not produce.
 *
 * This module is the single source of truth for the marker's shape.
 */

/** Opening tag without its attribute list — for streaming hold-back. */
export const OD_FOCUS_OPEN_TAG = '<od-focus';

/**
 * Every `<od-focus …>` occurrence, valid key or not, self-closed or not, plus
 * a stray `</od-focus>` a model may write out of habit.
 *
 * Deliberately permissive about the attribute list, exactly like
 * `OD_DONE_TAG_RE`: what makes a marker protocol is the tag name, not whether
 * the model got the attributes right.
 *
 * Global + case-insensitive; callers that keep state must clone it
 * (`lastIndex` is shared on a module-level regex).
 */
export const OD_FOCUS_TAG_RE = /<\/?od-focus\b[^>]*>/gi;

/**
 * Pull the key out of one `<od-focus …>` tag. Quotes optional, both styles
 * accepted (model formatting drifts); charset restricted so a stray attribute
 * cannot smuggle markup through.
 */
export const OD_FOCUS_KEY_ATTR_RE = /\bkey\s*=\s*["']?([A-Za-z0-9_-]{4,64})["']?/i;

/** `open="…"` — the single file the preview should show. */
export const OD_FOCUS_OPEN_ATTR_RE = /\bopen\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/i;

/** `show="…"` — the comma-separated deliverables that deserve a card. */
export const OD_FOCUS_SHOW_ATTR_RE = /\bshow\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/i;

/**
 * Ceiling on the `show` list. The whole point is a *shorter* list than the
 * host's inference produces, so a marker naming twenty files has misunderstood
 * the instruction; truncating is friendlier than rejecting and still bounds
 * the work the renderer does.
 */
export const MAX_ARTIFACT_FOCUS_SHOW = 8;

/** Longest path we will consider. Well past any real project layout. */
const MAX_FOCUS_PATH_LENGTH = 1024;
/** Deepest path we will consider, in segments. */
const MAX_FOCUS_PATH_SEGMENTS = 32;

/** Wrapping punctuation models add out of habit: backticks, quotes, brackets. */
const WRAPPING_RE = /^[`"'“”‘’\[(<]+|[`"'“”‘’\])>]+$/g;

/**
 * Normalize one declared path into a project-relative POSIX path, or `null`
 * when it is not one we are willing to act on.
 *
 * This is the **untrusted-input boundary for a path the host will read**, so it
 * rejects rather than repairs:
 *
 *  · anything absolute (`/etc/passwd`, `C:/Windows/…`) — the daemon rebases
 *    absolute paths against the project root *before* calling this, because
 *    only the daemon knows where the root is;
 *  · any `..` segment **anywhere**, not merely a leading one. `a/../b` has no
 *    legitimate reason to appear in a declaration, and refusing it outright
 *    removes the whole class of "my normalizer and your normalizer disagree"
 *    bugs that traversal checks are famous for;
 *  · URL-ish inputs (`file:`, `data:`, `//host/share`), NUL bytes, and paths
 *    past the length/depth ceilings.
 *
 * Backslashes normalize to `/` so a Windows-style declaration still resolves;
 * `./` prefixes and repeated slashes collapse.
 */
export function normalizeArtifactFocusPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().replace(WRAPPING_RE, '').trim();
  if (!value) return null;
  if (value.length > MAX_FOCUS_PATH_LENGTH) return null;
  // A NUL truncates the path at the OS boundary — classic poisoned-path trick.
  if (value.includes('\0')) return null;
  value = value.replace(/\\/g, '/');
  // `file:///…`, `data:…`, `http://…`: not filesystem paths at all.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  // Absolute POSIX, UNC, and drive-letter forms. The daemon rebases these
  // against the project root before we ever see them; anything still absolute
  // here escaped that check and is refused.
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return null;

  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  if (segments.length > MAX_FOCUS_PATH_SEGMENTS) return null;
  return segments.join('/');
}

/**
 * Split a `show="…"` attribute into normalized project-relative paths.
 *
 * Commas separate; newlines do too, because the tag body is matched with
 * `[^>]*` and a model that wraps a long list will put one there. Entries that
 * fail `normalizeArtifactFocusPath` are dropped individually — one bad path
 * must not discard the good ones alongside it.
 *
 * A path containing a literal comma cannot be expressed and is simply dropped;
 * the turn then falls back to the host's own inference for that file, which is
 * the same outcome as not writing the marker at all.
 */
export function parseArtifactFocusPathList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/[,\r\n]/)) {
    const normalized = normalizeArtifactFocusPath(piece);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_ARTIFACT_FOCUS_SHOW) break;
  }
  return out;
}

/** One parsed `<od-focus …>` tag. `open`/`show` are absent when unusable. */
export interface ParsedArtifactFocusMarker {
  /** The key as written, or `''`. Callers compare it against the turn nonce. */
  key: string;
  /** Normalized project-relative path, or `null` when absent/unusable. */
  open: string | null;
  /** Normalized project-relative paths; `[]` when absent/unusable. */
  show: string[];
}

/**
 * Parse one complete opening tag. Attribute values are NOT normalized against
 * the project root here — that needs the root, which is daemon-only knowledge.
 * `open` is returned raw when it looks absolute so the daemon can rebase it;
 * see `rawOpen`.
 */
export function parseArtifactFocusMarker(tag: string): ParsedArtifactFocusMarker & { rawOpen: string; rawShow: string } {
  const source = typeof tag === 'string' ? tag : '';
  const keyMatch = OD_FOCUS_KEY_ATTR_RE.exec(source);
  const openMatch = OD_FOCUS_OPEN_ATTR_RE.exec(source);
  const showMatch = OD_FOCUS_SHOW_ATTR_RE.exec(source);
  const rawOpen = (openMatch?.[1] ?? openMatch?.[2] ?? openMatch?.[3] ?? '').trim();
  const rawShow = (showMatch?.[1] ?? showMatch?.[2] ?? showMatch?.[3] ?? '').trim();
  return {
    key: keyMatch?.[1] ?? '',
    open: normalizeArtifactFocusPath(rawOpen),
    show: parseArtifactFocusPathList(rawShow),
    rawOpen,
    rawShow,
  };
}

/**
 * Remove every `<od-focus …>` tag from a string.
 *
 * Used on any text that could reach a reader — the persisted message body,
 * copy-to-clipboard, exports, and the web's render of a conversation recorded
 * before the daemon learned to strip it.
 *
 * Caller beware: this is context-free, matching `stripDoneMarkers` and
 * `stripCritiqueGrammar`. A call site that must preserve a marker an agent
 * deliberately quoted inside a code fence does its own fenced-region check.
 */
export function stripArtifactFocusMarkers(text: string): string {
  if (!text || !text.includes('<')) return text;
  return text.replace(new RegExp(OD_FOCUS_TAG_RE.source, OD_FOCUS_TAG_RE.flags), '');
}

/**
 * Render the marker for a given key — the one place the wire format is
 * written, so the prompt example and the parser can never drift apart.
 */
export function renderArtifactFocusMarkerExample(
  key: string,
  parts: { open?: string; show?: readonly string[] },
): string {
  const attrs = [`key="${key}"`];
  if (parts.open) attrs.push(`open="${parts.open}"`);
  if (parts.show && parts.show.length > 0) {
    attrs.push(`show="${parts.show.slice(0, MAX_ARTIFACT_FOCUS_SHOW).join(', ')}"`);
  }
  return `<od-focus ${attrs.join(' ')}/>`;
}

/** The payload the daemon hands the client once a marker is accepted. */
export interface ArtifactFocusSelection {
  /** Project-relative path the preview should open, when the turn declared one. */
  open?: string;
  /** Project-relative paths that deserve a card, when the turn declared them. */
  show?: string[];
}

/**
 * Fold this turn's `artifact_focus` events into one selection, last-wins per
 * field.
 *
 * Per-field rather than per-event: a turn that says `open` early and `show`
 * late must end up with both. Folding whole events would let the late
 * `show`-only event blank the early `open`.
 */
export function foldArtifactFocusSelections(
  events: readonly ArtifactFocusSelection[],
): ArtifactFocusSelection {
  const folded: ArtifactFocusSelection = {};
  for (const event of events) {
    if (typeof event?.open === 'string' && event.open) folded.open = event.open;
    if (Array.isArray(event?.show) && event.show.length > 0) folded.show = [...event.show];
  }
  return folded;
}

/** Minimal shape `narrowProducedFilesToFocus` needs — matches `ProjectFile`. */
export interface FocusCandidateFile {
  readonly name: string;
  readonly path?: string;
}

function focusMatchKeys(file: FocusCandidateFile): string[] {
  const keys: string[] = [];
  for (const value of [file.path, file.name]) {
    const normalized = normalizeArtifactFocusPath(value);
    if (!normalized) continue;
    keys.push(normalized);
    const basename = normalized.split('/').pop();
    if (basename && basename !== normalized) keys.push(basename);
  }
  return keys;
}

/**
 * Narrow a turn's produced-file list to the ones the agent declared.
 *
 * Three rules, all of them load-bearing:
 *
 *  1. **No declaration → no change.** A turn without a marker keeps exactly the
 *     list the host inferred. "No marker" must never mean "show nothing";
 *     every conversation recorded before this marker existed is in that state.
 *  2. **Narrow only, never widen.** A declared path that is not in the list is
 *     ignored rather than added, so the marker cannot conjure a card for a file
 *     the turn did not produce.
 *  3. **An empty intersection is a no-op, not an empty panel.** If the agent
 *     names only files the host did not attribute to this turn, we keep the
 *     inferred list. Hiding every card because the agent mis-typed a path is a
 *     strictly worse outcome than showing one card too many.
 *
 * Matching accepts a full project-relative path or a bare basename on either
 * side, because agents write `index.html` about as often as `site/index.html`.
 * Original order is preserved — the panel's ordering is not the agent's call.
 */
export function narrowProducedFilesToFocus<T extends FocusCandidateFile>(
  files: readonly T[],
  show: readonly string[] | null | undefined,
): readonly T[] {
  if (files.length === 0) return files;
  const wanted = new Set<string>();
  for (const entry of Array.isArray(show) ? show : []) {
    const normalized = normalizeArtifactFocusPath(entry);
    if (!normalized) continue;
    wanted.add(normalized);
    const basename = normalized.split('/').pop();
    if (basename) wanted.add(basename);
  }
  /*
   * Rules 1 and 3 are the SAME line, deliberately.
   *
   * Earlier drafts guarded "no declaration" and "nothing usable in the
   * declaration" with their own early returns. Both are unreachable-by-
   * observation: an absent, empty, or entirely-unusable `show` yields an empty
   * `wanted`, so the filter keeps nothing and the fallback below returns
   * `files` regardless. Ablating either guard left every test green — the
   * signature of a branch that no test is really covering.
   *
   * One mechanism, one line, one ablation that actually goes red.
   */
  const kept = files.filter((file) => focusMatchKeys(file).some((key) => wanted.has(key)));
  return kept.length > 0 ? kept : files;
}
