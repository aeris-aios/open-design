/**
 * Structural outline of a generated page, used by the Design Structure panel's
 * "Layers" tab.
 *
 * The tab describes what a page is MADE OF, and the only honest source for that
 * is the page's own markup — there is no live canvas next to this panel to read
 * a selection from. So the outline is derived from the file's real HTML rather
 * than from a design-time model the project does not have.
 */

export interface HtmlOutlineNode {
  /** Stable list key: the node's position path in the walk. */
  key: string;
  /** Human-readable name — aria-label, heading text, id, or class. */
  label: string;
  /** Short type hint rendered on the trailing edge (the tag name). */
  meta: string;
  /** 0 for a top-level region, 1 for its direct structural child. */
  depth: number;
}

/** Deepest level emitted. Two levels keep a real page readable in a rail. */
const MAX_DEPTH = 1;

/** Upper bound on emitted nodes so a 5000-element page cannot flood the rail. */
const DEFAULT_LIMIT = 60;

/** Never structural: metadata, scripting, and void formatting elements. */
const IGNORED_TAGS = new Set([
  'script',
  'style',
  'template',
  'link',
  'meta',
  'noscript',
  'title',
  'base',
  'br',
  'hr',
  'wbr',
]);

/**
 * Landmarks and grouping elements that always earn a row, because their tag
 * alone already tells the reader what the block is.
 */
const STRUCTURAL_TAGS = new Set([
  'header',
  'nav',
  'main',
  'aside',
  'footer',
  'section',
  'article',
  'form',
  'table',
  'figure',
  'dialog',
  'fieldset',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

/** Longest label kept; longer names are ellipsized by CSS after truncation. */
const MAX_LABEL_LENGTH = 40;

/**
 * Parses a page's HTML into a shallow structural outline.
 *
 * Returns an empty list for markup with no structure worth showing, and for
 * environments without a DOM parser — callers render their own empty state
 * rather than a fabricated one.
 */
export function parseHtmlOutline(source: string, limit = DEFAULT_LIMIT): HtmlOutlineNode[] {
  if (!source.trim()) return [];
  if (typeof DOMParser === 'undefined') return [];
  let root: Element | null = null;
  try {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    root = parsed.body ?? parsed.documentElement;
  } catch {
    return [];
  }
  if (!root) return [];
  const out: HtmlOutlineNode[] = [];
  collect(root, 0, '', out, limit);
  return out;
}

function collect(
  parent: Element,
  depth: number,
  keyPrefix: string,
  out: HtmlOutlineNode[],
  limit: number,
): void {
  const children = Array.from(parent.children);
  for (const [index, child] of children.entries()) {
    if (out.length >= limit) return;
    const tag = child.tagName.toLowerCase();
    if (IGNORED_TAGS.has(tag)) continue;
    const key = `${keyPrefix}/${index}`;
    // A wrapper that exists only to hold one child (the ubiquitous
    // `<div class="app"><div class="page">…`) would otherwise burn both
    // available depth levels and show the reader nothing. Descend through it
    // at the SAME depth so the first real region still lands at depth 0.
    if (isPassThroughWrapper(child)) {
      collect(child, depth, key, out, limit);
      continue;
    }
    if (!isStructural(child)) continue;
    out.push({
      key,
      label: outlineLabel(child, tag),
      meta: tag,
      depth,
    });
    if (depth < MAX_DEPTH) collect(child, depth + 1, key, out, limit);
  }
}

/**
 * True for a generic box that carries no identity of its own and wraps exactly
 * one element with no text beside it.
 */
function isPassThroughWrapper(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'div' && tag !== 'span') return false;
  if (el.children.length !== 1) return false;
  return directTextContent(el).length === 0;
}

/** Text owned by the element itself, ignoring text inside its children. */
function directTextContent(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) text += node.nodeValue ?? '';
  }
  return text.trim();
}

/**
 * A node earns a row when its tag is a landmark, or when it is a generic box
 * that was given an identity (id / class / annotation) by whoever built it.
 */
function isStructural(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (STRUCTURAL_TAGS.has(tag)) return true;
  if (tag !== 'div' && tag !== 'span') return false;
  return (
    el.id.trim().length > 0
    || el.className.toString().trim().length > 0
    || el.hasAttribute('data-od-id')
  );
}

/**
 * Best available human name, in descending order of how deliberately it was
 * authored: an explicit label, then the block's own heading, then the
 * identifiers a stylesheet would use, then the bare tag.
 */
function outlineLabel(el: Element, tag: string): string {
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) return truncate(ariaLabel);

  if (isHeading(tag)) {
    const ownText = el.textContent?.trim();
    if (ownText) return truncate(ownText);
  }

  const heading = el.querySelector(HEADING_SELECTOR)?.textContent?.trim();
  if (heading) return truncate(heading);

  const id = el.id.trim();
  if (id) return truncate(`#${id}`);

  const firstClass = el.className.toString().trim().split(/\s+/u)[0];
  if (firstClass) return truncate(`.${firstClass}`);

  return tag;
}

function isHeading(tag: string): boolean {
  return /^h[1-6]$/u.test(tag);
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  return collapsed.length > MAX_LABEL_LENGTH
    ? `${collapsed.slice(0, MAX_LABEL_LENGTH - 1)}…`
    : collapsed;
}
