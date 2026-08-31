/**
 * Stable DOM anchor used when an in-chat control swaps content with a
 * different height. The root stays mounted while the marked anchor may be
 * replaced (for example QuestionForm's collapsed/expanded "own answer" row).
 */
export interface ElementScrollAnchor {
  root: HTMLElement;
  anchorId: string;
  viewportTop: number;
}

const CONTROL_ATTRIBUTE = 'data-chat-preserve-scroll-anchor';
const ANCHOR_ATTRIBUTE = 'data-chat-scroll-anchor';

function anchorInRoot(root: HTMLElement, anchorId: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTRIBUTE}]`)).find(
    (candidate) => candidate.getAttribute(ANCHOR_ATTRIBUTE) === anchorId,
  ) ?? null;
}

export function captureElementScrollAnchor(
  container: HTMLElement,
  eventTarget: HTMLElement,
): ElementScrollAnchor | null {
  const control = eventTarget.closest<HTMLElement>(`[${CONTROL_ATTRIBUTE}]`);
  if (!control || !container.contains(control)) return null;
  const anchorId = control.getAttribute(CONTROL_ATTRIBUTE);
  const root = control.closest<HTMLElement>('[data-form-id]');
  if (!anchorId || !root) return null;
  const anchor = anchorInRoot(root, anchorId);
  if (!anchor) return null;
  return {
    root,
    anchorId,
    viewportTop: anchor.getBoundingClientRect().top,
  };
}

export function scrollTopForElementScrollAnchor(
  container: HTMLElement,
  snapshot: ElementScrollAnchor,
): number | null {
  if (!snapshot.root.isConnected || !container.contains(snapshot.root)) return null;
  const anchor = anchorInRoot(snapshot.root, snapshot.anchorId);
  if (!anchor) return null;
  return Math.max(
    0,
    container.scrollTop + anchor.getBoundingClientRect().top - snapshot.viewportTop,
  );
}
