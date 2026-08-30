export type ManualEditKind = 'text' | 'link' | 'action' | 'image' | 'container' | 'token';

/** Which side of the drop anchor a dragged element lands on when the drop
 * creates (or would create) a horizontal group inside a vertical container. */
export type ManualEditSidePlacement = 'left' | 'right';

/** Inline style for the auto-created horizontal group wrapper. Normal document
 * flow with natural content widths; wraps to a vertical stack when the row
 * runs out of horizontal space. The bridge preview and the source patcher must
 * produce the identical wrapper so an optimistic drop matches the saved
 * document byte for byte. */
export const MANUAL_EDIT_SIDE_GROUP_STYLE =
  'display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px';

export interface ManualEditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualEditComputedSummary {
  display: string;
  position: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle?: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  textAlign?: string;
  textDecorationLine?: string;
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  boxShadow?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderStyle?: string;
  padding: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  opacity?: string;
}

export interface ManualEditMeasurement {
  label: string;
  value: number;
  orientation: 'horizontal' | 'vertical';
  from: ManualEditRect;
  to: ManualEditRect;
}

export interface ManualEditAlignmentGuide {
  orientation: 'horizontal' | 'vertical';
  position: number;
  label: string;
}

export interface ManualEditFields {
  text?: string;
  href?: string;
  target?: string;
  src?: string;
  alt?: string;
}

export interface ManualEditStyles {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  textAlign: string;
  textDecorationLine: string;
  lineHeight: string;
  letterSpacing: string;
  width: string;
  height: string;
  minHeight: string;
  gap: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  backgroundColor: string;
  opacity: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  border: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderStyle: string;
  borderColor: string;
  borderRadius: string;
  boxShadow: string;
  /* Authored transform/display values remain editable in the inspector.
     Canvas dragging itself uses structural DOM reordering, not these styles. */
  transform: string;
  display: string;
}

/** Viewport buckets used by responsive element-size overrides. */
export type ManualEditResponsiveViewport = 'desktop' | 'tablet' | 'mobile';

/**
 * Persisted responsive sizing values. Percentages are represented as numbers
 * so the source patcher, rather than an iframe-provided CSS string, owns their
 * validation and serialization.
 */
export interface ManualEditResponsiveSizeValues {
  widthPercent?: number;
  minHeight?: number;
  leftPercent?: number;
  topPx?: number;
}

/** A missing key is untouched; null removes only that key's viewport rule. */
export type ManualEditResponsiveSizePatch = Partial<{
  widthPercent: number | null;
  minHeight: number | null;
  leftPercent: number | null;
  topPx: number | null;
}>;

/** Read-only box-model facts collected by the iframe for resize decisions. */
export interface ManualEditSizingMetadata {
  resizable: boolean;
  boxSizing: string;
  position: string;
  containingBlockWidth: number;
  paddingBorderX: number;
  paddingBorderY: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  hasUnsupportedTransform: boolean;
}

export interface ManualEditTarget {
  id: string;
  kind: ManualEditKind;
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: ManualEditRect;
  fields: ManualEditFields;
  attributes: Record<string, string>;
  styles: ManualEditStyles;
  computedSummary?: ManualEditComputedSummary;
  parentRect?: ManualEditRect;
  siblingRects?: ManualEditRect[];
  measurements?: ManualEditMeasurement[];
  alignmentGuides?: ManualEditAlignmentGuide[];
  isLayoutContainer: boolean;
  sizing?: ManualEditSizingMetadata;
  isHidden?: boolean;
  outerHtml: string;
}

export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-action'; text: string; href: string; target: '_self' | '_blank' }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { id: string; kind: 'remove-element' }
  | {
      id: string;
      kind: 'move-element';
      parentId: string;
      beforeId?: string | null;
      /** When set, the move wraps the anchor and the moved element into a new
       * horizontal group instead of inserting at beforeId. */
      placement?: ManualEditSidePlacement;
      anchorId?: string;
      groupId?: string;
    }
  | { kind: 'set-token'; token: string; value: string }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { id: string; kind: 'set-responsive-size'; viewport: ManualEditResponsiveViewport; size: ManualEditResponsiveSizePatch }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { kind: 'set-full-source'; source: string };

export interface ManualEditHistoryEntry {
  id: string;
  label: string;
  patch: ManualEditPatch;
  beforeSource: string;
  afterSource: string;
  createdAt: number;
}

export interface ManualEditTargetMessage {
  type: 'od-edit-targets';
  targets: ManualEditTarget[];
}

export interface ManualEditSelectMessage {
  type: 'od-edit-select';
  target: ManualEditTarget;
}

export interface ManualEditHoverMessage {
  type: 'od-edit-hover';
  target: ManualEditTarget;
}

export interface ManualEditInspectHoverMessage {
  type: 'od-edit-inspect-hover';
  target: ManualEditTarget;
}

export interface ManualEditInspectSelectMessage {
  type: 'od-edit-inspect-select';
  target: ManualEditTarget;
}

export interface ManualEditBackgroundMessage {
  type: 'od-edit-background';
}

export interface ManualEditPreviewAppliedMessage {
  type: 'od-edit-preview-style-applied';
  id: string;
  version: number;
  ok: boolean;
  error?: string;
}

export interface ManualEditTextCommitMessage {
  type: 'od-edit-text-commit';
  id: string;
  value: string;
  /** Immutable srcdoc generation that produced this locator. */
  generation?: string;
}

export interface ManualEditTextSessionMessage {
  type: 'od-edit-text-session';
  id: string;
  active: boolean;
  changed?: boolean;
  committed?: boolean;
}

/** Wheel/trackpad navigation captured inside the editable iframe. Keeping this
 *  in the iframe bridge means a focused contenteditable cannot bypass canvas
 *  zoom and pan handling. */
export interface ManualEditCanvasWheelMessage {
  type: 'od-edit-canvas-wheel';
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  /** Optional for retained iframes mounted before Command-wheel support. */
  metaKey?: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

/** Undo intent captured inside the sandboxed edit iframe. The host owns the
 * persisted edit history, so the bridge delegates the shortcut instead of
 * attempting to mutate the preview document independently. */
export interface ManualEditUndoHotkeyMessage {
  type: 'od-edit-undo-hotkey';
}

/** Structure-aware drag finished: move the element into a valid HTML parent
 *  and insert it before the optional sibling. No free-position style is
 *  produced by canvas dragging. */
export interface ManualEditDragCommitMessage {
  type: 'od-edit-drag-commit';
  id: string;
  parentId?: string;
  beforeId?: string | null;
  /** Present when the drop targeted the left/right side of a sibling inside a
   * vertical container: the host must create a horizontal group wrapping the
   * anchor and the dragged element rather than reorder the parent's children. */
  placement?: ManualEditSidePlacement;
  /** The sibling the dragged element grouped with. Required with placement. */
  anchorId?: string;
  /** Stable id minted by the bridge for the optimistic wrapper so the saved
   * source and the previewed canvas address the same group element. */
  groupId?: string;
  /** SrcDoc transport generation that produced this structural locator. */
  generation?: string;
  /** Identifies the optimistic in-frame reorder so the host can confirm it or
   * roll it back while the authoritative source is being saved. */
  requestId?: string;
  /** @deprecated Read only from an iframe that was mounted before the
   * structure-aware bridge hot-updated. New bridges never send free-position
   * styles. */
  transform?: string;
  /** @deprecated See transform. */
  display?: string;
}

/** Responsive resize intent emitted after the iframe finishes a drag. */
export interface ManualEditResizeCommitMessage {
  type: 'od-edit-resize-commit';
  id: string;
  requestId: string;
  viewport: ManualEditResponsiveViewport;
  size: ManualEditResponsiveSizePatch;
  /** Immutable srcdoc generation that produced this locator. */
  generation?: string;
}

/** The editable document's natural (unscrolled) size. Every Manual Edit
 * viewport uses this to make its iframe artboard as tall as the page instead
 * of hiding the rest of the document behind an inner scrollbar. */
export interface ManualEditDocumentSizeMessage {
  type: 'od-edit-document-size';
  width: number;
  height: number;
}

export type ManualEditBridgeMessage =
  | ManualEditTargetMessage
  | ManualEditSelectMessage
  | ManualEditHoverMessage
  | ManualEditInspectHoverMessage
  | ManualEditInspectSelectMessage
  | ManualEditBackgroundMessage
  | ManualEditPreviewAppliedMessage
  | ManualEditTextCommitMessage
  | ManualEditTextSessionMessage
  | ManualEditCanvasWheelMessage
  | ManualEditUndoHotkeyMessage
  | ManualEditDragCommitMessage
  | ManualEditResizeCommitMessage
  | ManualEditDocumentSizeMessage;

export const MANUAL_EDIT_STYLE_PROPS: readonly (keyof ManualEditStyles)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'textAlign', 'textDecorationLine', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight',
  'gap', 'flexDirection', 'justifyContent', 'alignItems',
  'backgroundColor', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius', 'boxShadow',
  'transform', 'display',
];

export function emptyManualEditStyles(): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as ManualEditStyles);
}
