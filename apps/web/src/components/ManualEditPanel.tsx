import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectDesignTokenSuggestion, ProjectDesignTokenSuggestionProp } from '../providers/registry';
import { useT } from '../i18n';
import {
  emptyManualEditStyles,
  type ManualEditHistoryEntry,
  type ManualEditPatch,
  type ManualEditResponsiveSizeValues,
  type ManualEditResponsiveViewport,
  type ManualEditStyles,
  type ManualEditTarget,
} from '../edit-mode/types';
import { Icon } from './Icon';

export interface ManualEditDraft {
  text: string;
  href: string;
  target: '_self' | '_blank';
  src: string;
  alt: string;
  styles: ManualEditStyles;
  attributesText: string;
  outerHtml: string;
  fullSource: string;
  responsiveViewport: ManualEditResponsiveViewport | null;
  responsiveSize: ManualEditResponsiveSizeValues | null;
}

export function emptyManualEditDraft(source = ''): ManualEditDraft {
  return {
    text: '', href: '', target: '_self', src: '', alt: '',
    styles: emptyManualEditStyles(),
    attributesText: '{}', outerHtml: '', fullSource: source,
    responsiveViewport: null,
    responsiveSize: null,
  };
}

export function ManualEditPanel({
  selectedTarget,
  draft,
  busy,
  resetAvailable = false,
  onDraftChange,
  onStyleChange,
  onInvalidStyle,
  onError,
  onCancelDraft,
  onSaveDraft,
  onResetDraft,
  onExit,
  onApplyPatch,
  onPickImage,
  tokenSuggestions = [],
  tokenSuggestionsLoading = false,
  onApplyTokenSuggestion,
  onInspectValueSelect,
  pageStylesEnabled = true,
  floatingStyle,
  floatingClassName,
  onFloatingPositionChange,
  locked = false,
  onToggleLock,
}: {
  targets: ManualEditTarget[];
  selectedTarget: ManualEditTarget | null;
  draft: ManualEditDraft;
  history: ManualEditHistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  resetAvailable?: boolean;
  pageStylesEnabled?: boolean;
  onSelectTarget: (target: ManualEditTarget) => void;
  onDraftChange: (draft: ManualEditDraft) => void;
  onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
  onInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  onPickImage?: (file: File) => Promise<string | null>;
  tokenSuggestions?: ProjectDesignTokenSuggestion[];
  tokenSuggestionsLoading?: boolean;
  onApplyTokenSuggestion?: (prop: keyof ManualEditStyles, value: string) => void;
  onInspectValueSelect?: (prop: ProjectDesignTokenSuggestionProp, value: string) => void;
  floatingStyle?: CSSProperties;
  floatingClassName?: string;
  onFloatingPositionChange?: (position: { left: number; top: number }) => void;
  /** When true the panel is pinned: no dragging, and it does not reposition
   *  when a different element is selected. Owned by the parent. */
  locked?: boolean;
  onToggleLock?: () => void;
  onError: (message: string) => void;
  onClearSelection: () => void;
  onExit?: () => void;
  onCancelDraft: () => void;
  onSaveDraft: () => void;
  onResetDraft: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = useT();
  const [uploadingImage, setUploadingImage] = useState(false);
  // Pin toggle: draggable (pin pulled out) vs locked/fixed (pin pushed in).
  // The lock lives in the parent so it can ALSO freeze the panel's position —
  // a locked panel never follows the selected element.
  const dragEnabled = !locked;
  const selectedTargetRef = useRef<ManualEditTarget | null>(selectedTarget);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const targetForInspector = selectedTarget;
  const panelTitle = targetForInspector ? readableManualEditTargetName(targetForInspector) : t('manualEdit.fallbackTitle');
  useEffect(() => {
    selectedTargetRef.current = selectedTarget;
  }, [selectedTarget]);

  const changeTargetStyle = (key: keyof ManualEditStyles, value: string) => {
    const nextStyles = { ...draft.styles, [key]: value };
    onDraftChange({ ...draft, styles: nextStyles });
    if (!targetForInspector) return;
    const normalized = normalizeManualEditStyles({ [key]: value }, {
      layoutEnabled: targetForInspector.isLayoutContainer,
    });
    if (!normalized.ok) {
      onError('error' in normalized ? normalized.error : 'Invalid style value.');
      onInvalidStyle?.(targetForInspector.id, [key]);
      return;
    }
    onError('');
    onStyleChange?.(targetForInspector.id, normalized.styles, `Style: ${targetForInspector.label}`);
  };

  const applyTargetStyles = (styles: Partial<ManualEditStyles>, label: string) => {
    if (!targetForInspector) return;
    const normalized = normalizeManualEditStyles(styles, {
      layoutEnabled: targetForInspector.isLayoutContainer,
    });
    if (!normalized.ok) {
      onError('error' in normalized ? normalized.error : 'Invalid style value.');
      onInvalidStyle?.(targetForInspector.id, Object.keys(styles) as Array<keyof ManualEditStyles>);
      return;
    }
    onError('');
    onDraftChange({ ...draft, styles: { ...draft.styles, ...normalized.styles } });
    onStyleChange?.(targetForInspector.id, normalized.styles, label);
  };

  // Drag the whole floating panel: a pointer-down anywhere on it starts the
  // move UNLESS it lands on an interactive control (input / button / field /
  // the HTML box / …), so the user can still select and edit inside the panel
  // normally. Only "empty" chrome — the titlebar, section headers, gaps —
  // initiates a drag.
  const DRAG_IGNORE_SELECTOR =
    'input, textarea, select, button, a[href], label, [contenteditable], [role="button"], [role="slider"], [role="combobox"], [role="textbox"]';
  const startPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!onFloatingPositionChange || !dragEnabled || event.button !== 0) return;
    const origin = event.target as HTMLElement | null;
    if (origin?.closest(DRAG_IGNORE_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest('.manual-edit-right') as HTMLElement | null;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = panel.offsetLeft;
    const startTop = panel.offsetTop;
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const pad = 8;
    const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad);
    const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad);
    const ownerDocument = panel.ownerDocument;
    const prevCursor = ownerDocument.body.style.cursor;
    const prevUserSelect = ownerDocument.body.style.userSelect;
    ownerDocument.body.style.cursor = 'grabbing';
    ownerDocument.body.style.userSelect = 'none';
    const move = (moveEvent: PointerEvent) => {
      onFloatingPositionChange({
        left: clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft),
        top: clamp(startTop + moveEvent.clientY - startY, pad, maxTop),
      });
    };
    const up = () => {
      ownerDocument.body.style.cursor = prevCursor;
      ownerDocument.body.style.userSelect = prevUserSelect;
      ownerDocument.removeEventListener('pointermove', move);
      ownerDocument.removeEventListener('pointerup', up);
      ownerDocument.removeEventListener('pointercancel', up);
    };
    ownerDocument.addEventListener('pointermove', move);
    ownerDocument.addEventListener('pointerup', up);
    ownerDocument.addEventListener('pointercancel', up);
  };

  return (
    <aside
      className={`manual-edit-right${floatingStyle ? ' manual-edit-floating' : ''}${floatingClassName ? ` ${floatingClassName}` : ''}`}
      style={floatingStyle}
    >
      <section
        className={`manual-edit-modal cc-panel${floatingStyle && !dragEnabled ? ' is-drag-locked' : ''}`}
        onPointerDown={floatingStyle ? startPanelDrag : undefined}
      >
        <div className="manual-edit-titlebar">
          {floatingStyle ? (
            <button
              type="button"
              className={`manual-edit-drag-handle${dragEnabled ? ' is-draggable' : ' is-locked'}`}
              onClick={() => onToggleLock?.()}
              aria-pressed={dragEnabled}
              aria-label={t('manualEdit.movePanel')}
              title={t('manualEdit.movePanel')}
            >
              {dragEnabled ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M13.8273 1.69L22.3126 10.1753L20.8984 11.5895L20.1913 10.8824L15.9486 15.125L15.2415 18.6606L13.8273 20.0748L9.58466 15.8321L4.63492 20.7819L3.2207 19.3677L8.17045 14.4179L3.92781 10.1753L5.34202 8.76107L8.87756 8.05396L13.1202 3.81132L12.4131 3.10422L13.8273 1.69ZM14.5344 5.22554L9.86358 9.89637L7.0417 10.4607L13.5418 16.9609L14.1062 14.139L18.7771 9.46818L14.5344 5.22554Z" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M18 3V5H17V11L19 14V16H13V23H11V16H5V14L7 11V5H6V3H18Z" />
                </svg>
              )}
            </button>
          ) : null}
          <span title={panelTitle}>{panelTitle}</span>
          {onExit ? (
            <button
              type="button"
              className="manual-edit-titlebar-close"
              aria-label={t('manualEdit.closePanel')}
              title={t('manualEdit.closePanel')}
              onClick={onExit}
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>
        <div className="manual-edit-scroll">
          {targetForInspector ? (
            <>
              <ContentInspector
                target={targetForInspector}
                draft={draft}
                onDraftChange={onDraftChange}
              />
              <StyleInspector
                target={targetForInspector}
                styles={draft.styles}
                responsiveSize={draft.responsiveSize}
                onChange={changeTargetStyle}
                onApply={(styles) => applyTargetStyles(styles, `Style: ${targetForInspector.label}`)}
                tokenSuggestions={tokenSuggestions}
                tokenSuggestionsLoading={tokenSuggestionsLoading}
                onApplyTokenSuggestion={onApplyTokenSuggestion}
                onInspectValueSelect={onInspectValueSelect}
              />
            </>
          ) : !targetForInspector ? (
            <PageInspector
              enabled={pageStylesEnabled}
              styles={draft.styles}
              onStyleChange={(styles) => {
                const normalized = normalizeManualEditStyles(styles, { layoutEnabled: true });
                if (!normalized.ok) {
                  onError('error' in normalized ? normalized.error : 'Invalid style value.');
                  onInvalidStyle?.('__body__', Object.keys(styles) as Array<keyof ManualEditStyles>);
                  return;
                }
                onError('');
                onDraftChange({
                  ...draft,
                  styles: { ...draft.styles, ...normalized.styles },
                });
                onStyleChange?.('__body__', normalized.styles, 'Page styles');
              }}
            />
          ) : null}

          {targetForInspector?.kind === 'image' && onPickImage ? (
            <div className="cc-section">
              <header className="cc-section-head">{t('manualEdit.sectionImage')}</header>
              <div className="cc-section-body">
                <button
                  type="button"
                  className="cc-action-btn"
                  disabled={uploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingImage ? t('manualEdit.uploadingImage') : t('manualEdit.uploadImage')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.currentTarget.files?.[0];
                    if (!file) return;
                    e.currentTarget.value = '';
                    setUploadingImage(true);
                    try {
                      const src = await onPickImage(file);
                      if (src) {
                        const activeTargetId = selectedTargetRef.current?.id ?? targetForInspector.id;
                        onApplyPatch(
                          { id: activeTargetId, kind: 'set-image', src, alt: draft.alt },
                          t('manualEdit.uploadImage'),
                        );
                      } else {
                        onError(t('manualEdit.uploadImageFailed'));
                      }
                    } finally {
                      setUploadingImage(false);
                    }
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="manual-edit-footer">
          <div className="manual-edit-footer-actions">
            <div className="manual-edit-footer-left">
              {targetForInspector ? (
                <button
                  type="button"
                  className="manual-edit-delete-btn"
                  aria-label={t('manualEdit.deleteElement')}
                  title={t('manualEdit.deleteElement')}
                  disabled={busy}
                  onClick={() => {
                    onApplyPatch(
                      { id: targetForInspector.id, kind: 'remove-element' },
                      t('manualEdit.deleteElement'),
                    );
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              ) : null}
            </div>
            <div className="manual-edit-footer-right">
              {resetAvailable ? (
                <button
                  type="button"
                  className="manual-edit-footer-btn subtle"
                  disabled={busy}
                  onClick={onResetDraft}
                >
                  {t('ds.reset')}
                </button>
              ) : null}
              <button
                type="button"
                className="manual-edit-footer-btn subtle"
                disabled={busy}
                onClick={onCancelDraft}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="manual-edit-footer-btn primary"
                disabled={busy}
                onClick={onSaveDraft}
              >
                {t('common.save')}
              </button>
            </div>
          </div>

        </div>
      </section>
    </aside>
  );
}

function ContentInspector({
  target,
  draft,
  onDraftChange,
}: {
  target: ManualEditTarget;
  draft: ManualEditDraft;
  onDraftChange: (draft: ManualEditDraft) => void;
}) {
  const t = useT();
  const update = (patch: Partial<ManualEditDraft>) => onDraftChange({ ...draft, ...patch });
  if (target.kind === 'image') {
    return (
      <div className="cc-inspector manual-edit-content-inspector">
        <Section title={t('manualEdit.sectionContent')}>
          <label className="manual-edit-field compact">
            <span>{t('manualEdit.imageUrl')}</span>
            <input value={draft.src} onChange={(event) => update({ src: event.currentTarget.value })} />
          </label>
          <label className="manual-edit-field compact">
            <span>{t('manualEdit.altText')}</span>
            <input value={draft.alt} onChange={(event) => update({ alt: event.currentTarget.value })} />
          </label>
        </Section>
      </div>
    );
  }
  if (target.kind === 'link') {
    return (
      <div className="cc-inspector manual-edit-content-inspector">
        <Section title={t('manualEdit.sectionContent')}>
          <label className="manual-edit-field">
            <span>{t('manualEdit.text')}</span>
            <textarea value={draft.text} rows={3} onChange={(event) => update({ text: event.currentTarget.value })} />
          </label>
          <label className="manual-edit-field compact">
            <span>{t('manualEdit.href')}</span>
            <input value={draft.href} onChange={(event) => update({ href: event.currentTarget.value })} />
          </label>
        </Section>
      </div>
    );
  }
  if (target.kind === 'action') {
    return (
      <div className="cc-inspector manual-edit-content-inspector">
        <Section title={t('manualEdit.sectionContent')}>
          <label className="manual-edit-field">
            <span>{t('manualEdit.text')}</span>
            <textarea value={draft.text} rows={3} onChange={(event) => update({ text: event.currentTarget.value })} />
          </label>
          <label className="manual-edit-field compact">
            <span>{t('manualEdit.href')}</span>
            <input
              value={draft.href}
              placeholder="#section · page.html · https://…"
              onChange={(event) => update({ href: event.currentTarget.value })}
            />
          </label>
          <label className="manual-edit-action-target">
            <input
              type="checkbox"
              checked={draft.target === '_blank'}
              onChange={(event) => update({ target: event.currentTarget.checked ? '_blank' : '_self' })}
            />
            <span>{t('common.openInNewTab')}</span>
          </label>
        </Section>
      </div>
    );
  }
  if (target.kind === 'text' || target.kind === 'token') {
    return (
      <div className="cc-inspector manual-edit-content-inspector">
        <Section title={t('manualEdit.sectionContent')}>
          <label className="manual-edit-field">
            <span>{t('manualEdit.text')}</span>
            <textarea value={draft.text} rows={4} onChange={(event) => update({ text: event.currentTarget.value })} />
          </label>
        </Section>
      </div>
    );
  }
  return (
    <div className="cc-inspector manual-edit-content-inspector">
      <Section title={t('manualEdit.sectionContent')}>
        <label className="manual-edit-field">
          <span>{t('manualEdit.selectedHtml')}</span>
          <textarea
            className="manual-edit-code"
            value={draft.outerHtml}
            onChange={(event) => update({ outerHtml: event.currentTarget.value })}
          />
        </label>
      </Section>
    </div>
  );
}

function readableManualEditTargetName(target: ManualEditTarget): string {
  const explicit = firstReadableText(
    target.attributes['data-od-label'],
    target.attributes['aria-label'],
    target.attributes.title,
  );
  if (explicit) return explicit;

  if (target.kind === 'text' || target.kind === 'link' || target.kind === 'action' || target.kind === 'token') {
    const textName = readableContentName(target.text || target.fields.text || target.label);
    if (textName) return textName;
  }
  if (target.kind === 'image') {
    const imageName = readableContentName(target.fields.alt || target.label);
    if (imageName) return imageName;
  }

  const identifierName = readableIdentifierName(
    target.attributes.id ||
    target.attributes['data-od-id'] ||
    target.id,
  );
  if (identifierName) return identifierName;

  const className = readableClassName(target.className);
  if (className) return className;

  const labelName = readableContentName(target.label);
  if (labelName && !looksCodeLikeLabel(labelName)) return labelName;

  if (target.kind === 'container') return 'Container';
  if (target.kind === 'image') return 'Image';
  if (target.kind === 'link') return 'Link';
  if (target.kind === 'action') return 'Button';
  return 'Text';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstReadableText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const readable = readableContentName(value);
    if (readable) return readable;
  }
  return '';
}

function readableContentName(value: string | undefined): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (looksGeneratedIdentifier(clean)) return '';
  return clean.length > 42 ? `${clean.slice(0, 39).trim()}...` : clean;
}

function readableIdentifierName(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw || looksGeneratedIdentifier(raw)) return '';
  const lastSelectorPart = (raw.includes('.') ? raw.split('.').filter(Boolean).at(-1) : raw) ?? '';
  const lastIdPart = (lastSelectorPart.includes('#') ? lastSelectorPart.split('#').filter(Boolean).at(-1) : lastSelectorPart) ?? '';
  return humanizeIdentifier(lastIdPart);
}

function readableClassName(value: string | undefined): string {
  const classes = (value ?? '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
  const candidate = classes.find((item) => {
    const lower = item.toLowerCase();
    return !looksGeneratedIdentifier(item) && !['container', 'wrapper', 'group', 'section', 'row', 'col'].includes(lower);
  }) ?? classes.find((item) => !looksGeneratedIdentifier(item));
  return humanizeIdentifier(candidate);
}

function humanizeIdentifier(value: string | undefined): string {
  const clean = (value ?? '')
    .replace(/^[_#.\s-]+|[_#.\s-]+$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || looksGeneratedIdentifier(clean)) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function looksCodeLikeLabel(value: string): boolean {
  return /^[a-z][a-z0-9-]*(?:[#.][\w-]+)+$/i.test(value) || /^[a-z][a-z0-9-]*\s+#/.test(value);
}

function looksGeneratedIdentifier(value: string): boolean {
  return /^path(?:-\d+)+$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

function PageInspector({
  enabled,
  styles,
  onStyleChange,
}: {
  enabled: boolean;
  styles: ManualEditStyles;
  onStyleChange: (styles: Partial<ManualEditStyles>) => void;
}) {
  const t = useT();
  const update = (next: { bg?: string; font?: string; size?: string }) => {
    if ('bg' in next) {
      const value = next.bg ?? '';
      onStyleChange({ backgroundColor: value });
    }
    if ('font' in next) {
      const value = next.font ?? '';
      onStyleChange({ fontFamily: value });
    }
    if ('size' in next) {
      const value = next.size ?? '';
      onStyleChange({ fontSize: value });
    }
  };

  return (
    <div className="cc-inspector" data-manual-edit-history-controls="true">
      <Section title={t('manualEdit.sectionPage')}>
        {enabled ? (
          <>
            <ColorRow label={t('manualEdit.pageBackground')} value={styles.backgroundColor} onChange={(value) => update({ bg: value })} />
            <FontRow label={t('manualEdit.fontFamily')} value={styles.fontFamily} onChange={(value) => update({ font: value })} />
            <UnitRow label={t('manualEdit.pageBaseSize')} value={styles.fontSize} onChange={(value) => update({ size: value })} unit="px" autoUnit />
          </>
        ) : (
          <p className="cc-section-hint">{t('manualEdit.pageStylesHtmlOnly')}</p>
        )}
      </Section>
    </div>
  );
}

const FONT_OPTS = [
  { label: 'inherit', value: '' },
  { label: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'monospace', value: 'SFMono-Regular, Consolas, "Liberation Mono", monospace' },
] as const;
const WEIGHT_OPTS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const ALIGN_OPTS = ['', 'left', 'center', 'right', 'justify', 'start', 'end'];
const DIRECTION_OPTS = ['', 'row', 'column', 'row-reverse', 'column-reverse'];
const JUSTIFY_OPTS = ['', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];
const ITEMS_OPTS = ['', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
const BORDER_STYLE_OPTS = ['', 'solid', 'dashed', 'dotted', 'double', 'none'];
const EDITOR_SWATCH_COLORS = [
  '#000000',
  '#ffffff',
  '#374151',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

type NormalizeResult =
  | { ok: true; styles: Partial<ManualEditStyles> }
  | { ok: false; error: string };

const PX_STYLE_PROPS = new Set<keyof ManualEditStyles>([
  'fontSize', 'letterSpacing', 'width', 'height', 'minHeight', 'gap',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius',
]);
const COLOR_STYLE_PROPS = new Set<keyof ManualEditStyles>(['color', 'backgroundColor', 'borderColor']);
const SELECT_STYLE_OPTIONS: Partial<Record<keyof ManualEditStyles, ReadonlyArray<string>>> = {
  fontFamily: FONT_OPTS.map((option) => option.value),
  fontWeight: WEIGHT_OPTS,
  fontStyle: ['', 'normal', 'italic', 'oblique'],
  textAlign: ALIGN_OPTS,
  flexDirection: DIRECTION_OPTS,
  justifyContent: JUSTIFY_OPTS,
  alignItems: ITEMS_OPTS,
  borderStyle: BORDER_STYLE_OPTS,
};
const LAYOUT_STYLE_PROPS = new Set<keyof ManualEditStyles>(['gap', 'flexDirection', 'justifyContent', 'alignItems']);

export function normalizeManualEditStyles(
  styles: Partial<ManualEditStyles>,
  { layoutEnabled }: { layoutEnabled: boolean },
): NormalizeResult {
  const normalized: Partial<ManualEditStyles> = {};
  for (const [rawKey, rawValue] of Object.entries(styles) as Array<[keyof ManualEditStyles, string]>) {
    if (LAYOUT_STYLE_PROPS.has(rawKey) && !layoutEnabled) continue;
    const value = rawValue.trim();
    if (value === '') {
      normalized[rawKey] = '';
      continue;
    }
    if (PX_STYLE_PROPS.has(rawKey)) {
      const px = normalizeLengthValue(value, rawKey);
      if (!px) return { ok: false, error: `${styleLabel(rawKey)} must be a number, px, %, or supported auto value.` };
      normalized[rawKey] = px;
      continue;
    }
    if (COLOR_STYLE_PROPS.has(rawKey)) {
      const color = normalizeCssColor(value);
      if (!color) return { ok: false, error: `${styleLabel(rawKey)} must be a hex color.` };
      normalized[rawKey] = color;
      continue;
    }
    if (rawKey === 'opacity') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Opacity must be a number.' };
      normalized.opacity = String(Math.max(0, Math.min(1, n)));
      continue;
    }
    if (rawKey === 'lineHeight') {
      const lineHeight = normalizeLineHeightValue(value);
      if (!lineHeight) return { ok: false, error: 'Line height must be a positive number or px value.' };
      normalized.lineHeight = lineHeight;
      continue;
    }
    if (rawKey === 'textDecorationLine') {
      const decoration = normalizeTextDecorationLine(value);
      if (decoration == null) return { ok: false, error: 'Text decoration has an unsupported value.' };
      normalized.textDecorationLine = decoration;
      continue;
    }
    const options = SELECT_STYLE_OPTIONS[rawKey];
    if (options) {
      if (!options.includes(value)) return { ok: false, error: `${styleLabel(rawKey)} has an unsupported value.` };
      normalized[rawKey] = value;
      continue;
    }
    normalized[rawKey] = value;
  }
  return { ok: true, styles: normalized };
}

function normalizeLengthValue(value: string, key: keyof ManualEditStyles): string | null {
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${value}px`;
  if (/^-?\d+(\.\d+)?px$/i.test(value)) return value.toLowerCase();
  if (/^-?\d+(\.\d+)?%$/i.test(value) && ['width', 'height', 'minHeight'].includes(key)) return value.toLowerCase();
  if (value.toLowerCase() === 'auto' && ['marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'margin'].includes(key)) return 'auto';
  return null;
}

function normalizeLineHeightValue(value: string): string | null {
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 0 ? String(n) : null;
  }
  if (/^\d+(\.\d+)?px$/i.test(value)) {
    const n = Number(value.slice(0, -2));
    return n > 0 ? value.toLowerCase() : null;
  }
  return null;
}

function normalizeCssColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (trimmed.toLowerCase() === 'transparent') return 'transparent';
  const rgba = parseCssColor(trimmed);
  if (rgba) return colorWithAlpha(rgba.hex, rgba.alpha);
  return null;
}

function normalizeTextDecorationLine(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return trimmed;
  const parts = trimmed.split(/\s+/);
  const allowed = new Set(['underline', 'line-through', 'overline', 'blink']);
  if (parts.every((part) => allowed.has(part))) return Array.from(new Set(parts)).join(' ');
  return null;
}

function styleLabel(key: keyof ManualEditStyles): string {
  return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

// Which style keys have project-token reference values, and the suggestion prop
// the daemon indexes them under. Keys absent here (opacity, textAlign, flex*,
// alignItems…) show no reference strip. Border sides collapse to `borderWidth`;
// padding/margin sides collapse to their shorthand prop.
const STYLE_TO_SUGGESTION_PROP: Partial<Record<keyof ManualEditStyles, ProjectDesignTokenSuggestionProp>> = {
  color: 'color',
  backgroundColor: 'backgroundColor',
  borderColor: 'borderColor',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  width: 'width',
  height: 'height',
  gap: 'gap',
  borderRadius: 'borderRadius',
  borderTopWidth: 'borderWidth',
  padding: 'padding',
  paddingTop: 'padding',
  paddingRight: 'padding',
  paddingBottom: 'padding',
  paddingLeft: 'padding',
  margin: 'margin',
  marginTop: 'margin',
  marginRight: 'margin',
  marginBottom: 'margin',
  marginLeft: 'margin',
};

// Applying a suggestion writes back to a real style key. `borderWidth` targets
// `borderTopWidth` (the parent's apply handler fans it to all four sides).
const SUGGESTION_TO_STYLE_KEY: Record<ProjectDesignTokenSuggestionProp, keyof ManualEditStyles> = {
  color: 'color',
  backgroundColor: 'backgroundColor',
  borderColor: 'borderColor',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  width: 'width',
  height: 'height',
  gap: 'gap',
  padding: 'padding',
  margin: 'margin',
  borderRadius: 'borderRadius',
  borderWidth: 'borderTopWidth',
};

const COLOR_SUGGESTION_PROPS: ReadonlySet<ProjectDesignTokenSuggestionProp> = new Set([
  'color', 'backgroundColor', 'borderColor',
]);

function StyleInspector({
  target, styles, onChange, onApply,
  tokenSuggestions = [], tokenSuggestionsLoading = false, onApplyTokenSuggestion, onInspectValueSelect,
}: {
  target: ManualEditTarget;
  styles: ManualEditStyles;
  responsiveSize?: ManualEditResponsiveSizeValues | null;
  onChange: (key: keyof ManualEditStyles, value: string) => void;
  onApply: (styles: Partial<ManualEditStyles>) => void;
  tokenSuggestions?: ProjectDesignTokenSuggestion[];
  tokenSuggestionsLoading?: boolean;
  onApplyTokenSuggestion?: (prop: keyof ManualEditStyles, value: string) => void;
  onInspectValueSelect?: (prop: ProjectDesignTokenSuggestionProp, value: string) => void;
}) {
  const t = useT();
  const u = (key: keyof ManualEditStyles, value: string) => onChange(key, value);
  const summary = target.computedSummary;

  // Which field is focused → drives the reference-values strip below the list.
  const [activeField, setActiveField] = useState<{ key: keyof ManualEditStyles; label: string } | null>(null);
  // Reset when the selected element changes (this component persists across selections).
  useEffect(() => { setActiveField(null); }, [target.id]);

  const activate = (key: keyof ManualEditStyles, label: string) => {
    setActiveField({ key, label });
    const prop = STYLE_TO_SUGGESTION_PROP[key];
    if (!prop || !onInspectValueSelect) return;
    const summaryValue = (summary as Partial<Record<string, string>> | undefined)?.[key];
    const current = (styles[key] || summaryValue || '').trim();
    if (current) onInspectValueSelect(prop, current);
  };

  const activeProp = activeField ? STYLE_TO_SUGGESTION_PROP[activeField.key] : undefined;
  const activeSuggestions = activeProp ? tokenSuggestions.filter((s) => s.prop === activeProp) : [];
  const activeIsColor = activeProp ? COLOR_SUGGESTION_PROPS.has(activeProp) : false;
  const textDecoration = styles.textDecorationLine || summary?.textDecorationLine || '';
  const applyBorderWidth = (value: string) => onApply({
    borderTopWidth: value,
    borderRightWidth: value,
    borderBottomWidth: value,
    borderLeftWidth: value,
  });

  return (
    <div className="cc-inspector" data-manual-edit-history-controls="true">
      <Section title={t('manualEdit.parameters')}>
        <div className="cc-style-grid">
          <ColorRow label={t('manualEdit.textColor')} value={styles.color} placeholder={summary?.color} onChange={(v) => u('color', v)} onFocus={() => activate('color', t('manualEdit.textColor'))} withAlpha />
          <FontRow label={t('manualEdit.fontFamily')} value={styles.fontFamily} placeholder={summary?.fontFamily} onChange={(v) => u('fontFamily', v)} onFocus={() => activate('fontFamily', t('manualEdit.fontFamily'))} />
          <DropdownRow label={t('manualEdit.weight')} value={styles.fontWeight} onChange={(v) => u('fontWeight', v)} options={fontWeightOptions(t)} placeholder={summary?.fontWeight} onFocus={() => activate('fontWeight', t('manualEdit.weight'))} />
          <UnitRow label={t('manualEdit.fontSize')} value={styles.fontSize} placeholder={summary?.fontSize || t('manualEdit.custom')} onChange={(v) => u('fontSize', v)} unit="px" autoUnit onFocus={() => activate('fontSize', t('manualEdit.fontSize'))} />
          <UnitRow label={t('manualEdit.letterSpacing')} value={styles.letterSpacing} placeholder={summary?.letterSpacing || '0'} onChange={(v) => u('letterSpacing', v)} unit="px" autoUnit onFocus={() => activate('letterSpacing', t('manualEdit.letterSpacing'))} />
          <UnitRow label={t('manualEdit.lineHeight')} value={styles.lineHeight} placeholder={summary?.lineHeight || '1.5'} onChange={(v) => u('lineHeight', v)} unit="" onFocus={() => activate('lineHeight', t('manualEdit.lineHeight'))} />
          <AlignControl label={t('manualEdit.align')} value={styles.textAlign || summary?.textAlign || ''} onChange={(v) => u('textAlign', v)} onFocus={() => activate('textAlign', t('manualEdit.align'))} t={t} />
          <TextStyleControl
            label={t('manualEdit.textStyle')}
            fontWeight={styles.fontWeight || summary?.fontWeight || ''}
            fontStyle={styles.fontStyle || summary?.fontStyle || ''}
            textDecorationLine={textDecoration}
            onBold={() => u('fontWeight', isBoldWeight(styles.fontWeight || summary?.fontWeight || '') ? '400' : '600')}
            onItalic={() => u('fontStyle', (styles.fontStyle || summary?.fontStyle) === 'italic' ? 'normal' : 'italic')}
            onDecoration={(part) => u('textDecorationLine', toggleDecoration(textDecoration, part))}
          />
        </div>
      </Section>

      <Section title={t('manualEdit.basic')}>
        <div className="cc-style-grid">
          <ColorRow label={t('manualEdit.background')} value={styles.backgroundColor} placeholder={summary?.backgroundColor} onChange={(v) => u('backgroundColor', v)} onFocus={() => activate('backgroundColor', t('manualEdit.background'))} withAlpha />
        </div>
      </Section>

      <Section title={t('manualEdit.stroke')}>
        <div className="cc-style-grid">
          <ColorRow label={t('manualEdit.borderColor')} value={styles.borderColor} placeholder={summary?.borderColor} onChange={(v) => u('borderColor', v)} onFocus={() => activate('borderColor', t('manualEdit.borderColor'))} withAlpha />
          <DropdownRow label={t('manualEdit.borderStyle')} value={styles.borderStyle} onChange={(v) => u('borderStyle', v)} options={borderStyleOptions(t)} />
          <UnitRow label={t('manualEdit.borderWidth')} value={styles.borderTopWidth} onChange={applyBorderWidth} unit="px" autoUnit onFocus={() => activate('borderTopWidth', t('manualEdit.borderWidth'))} />
        </div>
      </Section>

      <Section title={t('manualEdit.spacing')}>
        <div className="cc-style-grid">
          <AxisSpacingRow label={t('manualEdit.padding')} xLabel={t('manualEdit.horizontal')} yLabel={t('manualEdit.vertical')} values={{
            top: styles.paddingTop, right: styles.paddingRight, bottom: styles.paddingBottom, left: styles.paddingLeft,
          }} onChange={(axis, value) => onApply(axis === 'x'
            ? { paddingLeft: value, paddingRight: value }
            : { paddingTop: value, paddingBottom: value })}
          onFocus={() => activate('padding', t('manualEdit.padding'))} mixedLabel={t('manualEdit.mixed')} />
          <AxisSpacingRow label={t('manualEdit.margin')} xLabel={t('manualEdit.horizontal')} yLabel={t('manualEdit.vertical')} values={{
            top: styles.marginTop, right: styles.marginRight, bottom: styles.marginBottom, left: styles.marginLeft,
          }} onChange={(axis, value) => onApply(axis === 'x'
            ? { marginLeft: value, marginRight: value }
            : { marginTop: value, marginBottom: value })}
          onFocus={() => activate('margin', t('manualEdit.margin'))} mixedLabel={t('manualEdit.mixed')} />
        </div>
      </Section>

      <Section title={t('manualEdit.effects')}>
        <div className="cc-style-grid">
          <DropdownRow label={t('manualEdit.shadow')} value={styles.boxShadow} onChange={(v) => u('boxShadow', v)} options={shadowOptions(t)} placeholder={summary?.boxShadow} />
          <OpacityRow label={t('manualEdit.opacity')} value={styles.opacity} onChange={(v) => u('opacity', v)} onFocus={() => activate('opacity', t('manualEdit.opacity'))} />
          <UnitRow label={t('manualEdit.radius')} value={styles.borderRadius} placeholder={summary?.borderRadius} onChange={(v) => u('borderRadius', v)} unit="px" autoUnit onFocus={() => activate('borderRadius', t('manualEdit.radius'))} />
        </div>
      </Section>

      {activeField && activeProp ? (
        <div className="cc-suggest">
          <div className="cc-suggest-head">
            <span>{t('manualEdit.referenceValues')}</span>
            <em>{activeField.label}</em>
          </div>
          {tokenSuggestionsLoading ? (
            <div className="cc-suggest-empty">{t('manualEdit.referenceValuesLoading')}</div>
          ) : activeSuggestions.length === 0 ? (
            <div className="cc-suggest-empty">{t('manualEdit.referenceValuesEmpty')}</div>
          ) : (
            <div className="cc-suggest-list">
              {activeSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.token}-${suggestion.value}-${index}`}
                  type="button"
                  className="cc-suggest-chip"
                  title={`${suggestion.matchReason} · ${suggestion.sourceFile}:${suggestion.line}`}
                  onClick={() => onApplyTokenSuggestion?.(SUGGESTION_TO_STYLE_KEY[suggestion.prop], suggestion.value)}
                >
                  {activeIsColor ? (
                    <span className="cc-suggest-swatch" style={{ background: suggestion.value }} aria-hidden />
                  ) : null}
                  <span className="cc-suggest-token">{suggestion.token}</span>
                  <span className="cc-suggest-val">{suggestion.value}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type DropdownOption = string | { value: string; label: string };
type ManualEditTranslator = ReturnType<typeof useT>;

function layoutDirectionOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'row', label: t('manualEdit.directionRow') },
    { value: 'row-reverse', label: t('manualEdit.directionRowReverse') },
    { value: 'column', label: t('manualEdit.directionColumn') },
    { value: 'column-reverse', label: t('manualEdit.directionColumnReverse') },
  ];
}

function justifyOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'flex-start', label: t('manualEdit.justifyStart') },
    { value: 'center', label: t('manualEdit.justifyCenter') },
    { value: 'flex-end', label: t('manualEdit.justifyEnd') },
    { value: 'space-between', label: t('manualEdit.justifyBetween') },
    { value: 'space-around', label: t('manualEdit.justifyAround') },
    { value: 'space-evenly', label: t('manualEdit.justifyEvenly') },
  ];
}

function textAlignOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'left', label: t('manualEdit.textAlignLeft') },
    { value: 'center', label: t('manualEdit.textAlignCenter') },
    { value: 'right', label: t('manualEdit.textAlignRight') },
    { value: 'justify', label: t('manualEdit.textAlignJustify') },
  ];
}

function fontWeightOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: t('manualEdit.custom') },
    { value: '400', label: 'Regular' },
    { value: '500', label: 'Medium' },
    { value: '600', label: 'Semibold' },
    { value: '700', label: 'Bold' },
    { value: '800', label: 'Extra Bold' },
    { value: '900', label: 'Black' },
  ];
}

function shadowOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: t('manualEdit.shadowNone') },
    { value: 'none', label: t('manualEdit.shadowNone') },
    { value: '0 8px 24px rgba(15, 23, 42, 0.12)', label: t('manualEdit.shadowSoft') },
    { value: '0 16px 40px rgba(15, 23, 42, 0.18)', label: t('manualEdit.shadowMedium') },
  ];
}

function itemAlignOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'flex-start', label: t('manualEdit.alignStart') },
    { value: 'center', label: t('manualEdit.alignCenter') },
    { value: 'flex-end', label: t('manualEdit.alignEnd') },
    { value: 'stretch', label: t('manualEdit.alignStretch') },
    { value: 'baseline', label: t('manualEdit.alignBaseline') },
  ];
}

function borderStyleOptions(t: ManualEditTranslator): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'solid', label: t('manualEdit.borderStyleSolid') },
    { value: 'dashed', label: t('manualEdit.borderStyleDashed') },
    { value: 'dotted', label: t('manualEdit.borderStyleDotted') },
    { value: 'double', label: t('manualEdit.borderStyleDouble') },
    { value: 'none', label: t('manualEdit.borderStyleNone') },
  ];
}

function Section({ title, children, inactive }: { title: string; children: ReactNode; inactive?: boolean }) {
  return (
    <section className={`cc-section${inactive ? ' cc-section-inactive' : ''}`}>
      <header className="cc-section-head">{title}</header>
      <div className="cc-section-body">{children}</div>
    </section>
  );
}

function PairRow({ children }: { children: ReactNode }) {
  return <div className="cc-pair">{children}</div>;
}

function AlignControl({ label, value, onChange, onFocus, t }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  t: ManualEditTranslator;
}) {
  const options = [
    { value: 'left', icon: '☰', label: t('manualEdit.textAlignLeft') },
    { value: 'center', icon: '☷', label: t('manualEdit.textAlignCenter') },
    { value: 'right', icon: '☰', label: t('manualEdit.textAlignRight') },
    { value: 'justify', icon: '▤', label: t('manualEdit.textAlignJustify') },
  ];
  return (
    <div className="cc-row cc-row-stack" onFocus={onFocus}>
      <span className="cc-label">{label}</span>
      <div className="cc-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`cc-icon-btn cc-align-${option.value}${value === option.value ? ' is-active' : ''}`}
            aria-label={option.label}
            aria-pressed={value === option.value}
            title={option.label}
            onClick={() => onChange(option.value)}
          >
            <span aria-hidden>{option.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TextStyleControl({ label, fontWeight, fontStyle, textDecorationLine, onBold, onItalic, onDecoration }: {
  label: string;
  fontWeight: string;
  fontStyle: string;
  textDecorationLine: string;
  onBold: () => void;
  onItalic: () => void;
  onDecoration: (part: 'underline' | 'line-through') => void;
}) {
  const underline = hasDecoration(textDecorationLine, 'underline');
  const strike = hasDecoration(textDecorationLine, 'line-through');
  return (
    <div className="cc-row cc-row-stack">
      <span className="cc-label">{label}</span>
      <div className="cc-text-style" role="group" aria-label={label}>
        <button type="button" className={`cc-style-btn${isBoldWeight(fontWeight) ? ' is-active' : ''}`} aria-label="Bold" aria-pressed={isBoldWeight(fontWeight)} onClick={onBold}>B</button>
        <button type="button" className={`cc-style-btn cc-style-italic${fontStyle === 'italic' ? ' is-active' : ''}`} aria-label="Italic" aria-pressed={fontStyle === 'italic'} onClick={onItalic}>I</button>
        <button type="button" className={`cc-style-btn cc-style-underline${underline ? ' is-active' : ''}`} aria-label="Underline" aria-pressed={underline} onClick={() => onDecoration('underline')}>U</button>
        <button type="button" className={`cc-style-btn cc-style-strike${strike ? ' is-active' : ''}`} aria-label="Strikethrough" aria-pressed={strike} onClick={() => onDecoration('line-through')}>S</button>
      </div>
    </div>
  );
}

function OpacityRow({ label, value, onChange, onFocus }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
}) {
  const percent = opacityToPercent(value);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return onChange(raw);
    onChange(String(Math.max(0, Math.min(100, n)) / 100));
  };
  return (
    <label className="cc-row cc-opacity-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value">
        <input
          type="range"
          min="0"
          max="100"
          value={percent}
          onFocus={onFocus}
          onChange={(event) => commit(event.currentTarget.value)}
        />
        <input
          className="cc-opacity-number"
          value={percent}
          onFocus={onFocus}
          onChange={(event) => commit(event.currentTarget.value)}
        />
        <em className="cc-unit">%</em>
      </span>
    </label>
  );
}

function AxisSpacingRow({ label, xLabel, yLabel, values, onChange, onFocus, mixedLabel }: {
  label: string;
  xLabel: string;
  yLabel: string;
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (axis: 'x' | 'y', value: string) => void;
  onFocus?: () => void;
  mixedLabel: string;
}) {
  const x = axisValue(values.left, values.right, mixedLabel);
  const y = axisValue(values.top, values.bottom, mixedLabel);
  return (
    <div className="cc-row cc-row-stack cc-axis-row" onFocus={onFocus}>
      <span className="cc-label">{label}</span>
      <div className="cc-axis-grid">
        <AxisInput axis={xLabel} value={x} mixedLabel={mixedLabel} onChange={(v) => onChange('x', v)} />
        <AxisInput axis={yLabel} value={y} mixedLabel={mixedLabel} onChange={(v) => onChange('y', v)} />
      </div>
    </div>
  );
}

function AxisInput({ axis, value, mixedLabel, onChange }: {
  axis: string;
  value: string;
  mixedLabel: string;
  onChange: (value: string) => void;
}) {
  const display = value === mixedLabel ? '' : stripPxUnit(value);
  return (
    <label className="cc-axis-input">
      <span>{axis}</span>
      <input
        value={display}
        placeholder={value === mixedLabel ? mixedLabel : '0'}
        onChange={(event) => {
          const raw = event.currentTarget.value.trim();
          if (raw === '') onChange('');
          else if (isNumericInput(raw)) onChange(`${raw}px`);
          else if (/^-?\d+(\.\d+)?px$/i.test(raw)) onChange(raw.toLowerCase());
          else onChange(event.currentTarget.value);
        }}
      />
    </label>
  );
}

function UnitRow({ label, value, onChange, unit, autoUnit, disabled, placeholder, onFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  unit: string; autoUnit?: boolean; disabled?: boolean; placeholder?: string; onFocus?: () => void;
}) {
  const display = unit === 'px' ? stripPxUnit(value) : value;
  const step = unit === 'px' ? 1 : 0.1;
  const canStep = !disabled && isNumericInput(display);
  const valueFromDisplay = (raw: string) => {
    const trimmed = raw.trim();
    if (autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`;
    if (autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
    return raw;
  };
  const handle = (raw: string) => {
    const next = valueFromDisplay(raw);
    if (next !== value) onChange(next);
  };
  const stepBy = (direction: -1 | 1) => {
    if (!canStep) return;
    const next = formatSteppedNumber(Number(display) + direction * step, display, step);
    onChange(valueFromDisplay(next));
  };
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value">
        <button type="button" className="cc-step" disabled={!canStep} aria-label={`${label} decrease`} onClick={() => stepBy(-1)}>−</button>
        <input value={display} placeholder={placeholder ? stripPxUnit(placeholder) : ''} disabled={disabled} onFocus={onFocus} onChange={(e) => onChange(valueFromDisplay(e.currentTarget.value))} onBlur={(e) => handle(e.currentTarget.value)} />
        <button type="button" className="cc-step" disabled={!canStep} aria-label={`${label} increase`} onClick={() => stepBy(1)}>+</button>
        {/* px is implied for length fields — the unit is stored internally but
            not shown as a trailing label. Any non-px unit still renders. */}
        {unit && unit !== 'px' ? <em className="cc-unit">{unit}</em> : null}
      </span>
    </label>
  );
}

function DropdownRow({ label, value, onChange, options, placeholder, disabled, onFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  options: ReadonlyArray<DropdownOption>; placeholder?: string; disabled?: boolean; onFocus?: () => void;
}) {
  const optionValues = options.map(dropdownOptionValue);
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value cc-select">
        <select value={value} disabled={disabled} onFocus={onFocus} onChange={(e) => onChange(e.currentTarget.value)}>
          {!optionValues.includes(value) && value ? <option value={value}>{value}</option> : null}
          {options.map((opt) => {
            const optionValue = dropdownOptionValue(opt);
            return <option key={optionValue || '__'} value={optionValue}>{dropdownOptionLabel(opt, placeholder)}</option>;
          })}
        </select>
        <em className="cc-chevron">▾</em>
      </span>
    </label>
  );
}

function dropdownOptionValue(option: DropdownOption): string {
  return typeof option === 'string' ? option : option.value;
}

function dropdownOptionLabel(option: DropdownOption, placeholder?: string): string {
  if (typeof option === 'string') return option || (placeholder ?? '–');
  return option.label;
}

function FontRow({ label, value, placeholder, onChange, onFocus }: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
}) {
  const normalizedValue = normalizeFontFamilyForSelect(value);
  const customValue = normalizedValue === value ? value : '';
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value cc-select">
        <select value={normalizedValue} onFocus={onFocus} onChange={(event) => onChange(event.currentTarget.value)}>
          {!normalizedValue && placeholder ? <option value="">{fontFamilyLabel(placeholder)}</option> : null}
          {customValue && !FONT_OPTS.some((option) => option.value === customValue) ? (
            <option value={customValue}>{fontFamilyLabel(customValue)}</option>
          ) : null}
          {FONT_OPTS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
        <em className="cc-chevron">▾</em>
      </span>
    </label>
  );
}

function normalizeFontFamilyForSelect(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const direct = FONT_OPTS.find((option) => option.value === trimmed);
  if (direct) return direct.value;
  const families = parseFontFamilies(trimmed);
  const primaryFamily = families[0];
  const match = FONT_OPTS.find((option) => {
    if (!option.value) return false;
    const optionFamilies = parseFontFamilies(option.value);
    return optionFamilies[0] === primaryFamily;
  });
  return match?.value ?? trimmed;
}

function fontFamilyLabel(value: string): string {
  return parseFontFamilies(value)[0] ?? value;
}

function parseFontFamilies(value: string): string[] {
  return value
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
}

function ColorRow({ label, value, placeholder, onChange, compact, onFocus, withAlpha }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void; compact?: boolean; onFocus?: () => void; withAlpha?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const parsed = parseCssColor(value || placeholder || '');
  const displayColor = parsed?.hex ?? value;
  const displayAlpha = parsed ? String(Math.round(parsed.alpha * 100)) : '100';
  const changeColor = (raw: string) => {
    onChange(withAlpha ? colorWithAlpha(raw, Number(displayAlpha) / 100) : raw);
  };
  const changeAlpha = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(colorWithAlpha(displayColor || '#000000', Math.max(0, Math.min(100, n)) / 100));
  };
  useEffect(() => {
    if (!open) return;
    const positionPopover = () => {
      const row = ref.current;
      if (!row || typeof window === 'undefined') return;
      const rect = row.getBoundingClientRect();
      const width = Math.min(260, Math.max(220, window.innerWidth - 16));
      const height = popoverRef.current?.offsetHeight || 320;
      const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 6);
      setPopoverStyle({ position: 'fixed', left, top, width });
    };
    positionPopover();
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [open]);
  return (
    <div className="cc-row cc-color-row" ref={ref}>
      {compact ? null : <span className="cc-label">{label}</span>}
      <span className={`cc-value cc-color ${compact ? 'cc-color-compact' : ''}`}>
        <button type="button" className="cc-swatch" style={{ background: value || placeholder || 'transparent' }}
          onClick={() => setOpen((v) => !v)} aria-label={`Pick ${label}`} />
        <input value={displayColor} placeholder={normalizeColorForPicker(placeholder || '#000000')}
          onChange={(e) => changeColor(e.currentTarget.value)} onFocus={() => { setOpen(true); onFocus?.(); }} />
        {withAlpha ? (
          <>
            <span className="cc-color-divider" aria-hidden />
            <input className="cc-color-alpha" value={displayAlpha} aria-label={`${label} opacity`}
              onChange={(e) => changeAlpha(e.currentTarget.value)} onFocus={onFocus} />
            <em className="cc-unit">%</em>
          </>
        ) : null}
      </span>
      {open && typeof document !== 'undefined' ? createPortal(
        <ColorPickerPopover
          label={label}
          value={value}
          placeholder={placeholder}
          withAlpha={withAlpha}
          onChange={onChange}
          setPopoverNode={(node) => {
            popoverRef.current = node;
          }}
          style={popoverStyle ?? undefined}
        />
      , document.body) : null}
    </div>
  );
}

function ColorPickerPopover({ label, value, placeholder, withAlpha, onChange, setPopoverNode, style }: {
  label: string;
  value: string;
  placeholder?: string;
  withAlpha?: boolean;
  onChange: (v: string) => void;
  setPopoverNode?: (node: HTMLDivElement | null) => void;
  style?: CSSProperties;
}) {
  const state = colorPickerState(value || placeholder || '#000000');
  const commit = (next: Partial<ColorPickerState>) => {
    const hue = next.hue ?? state.hue;
    const saturation = next.saturation ?? state.saturation;
    const brightness = next.brightness ?? state.brightness;
    const alpha = withAlpha ? next.alpha ?? state.alpha : 1;
    const hex = rgbToHex(hsvToRgb({ h: hue, s: saturation, v: brightness }));
    onChange(withAlpha ? colorWithAlpha(hex, alpha) : hex);
  };
  const commitSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const brightness = clamp(1 - ((event.clientY - rect.top) / rect.height), 0, 1);
    event.currentTarget.setPointerCapture(event.pointerId);
    commit({ saturation, brightness });
  };
  const pickWithEyeDropper = async () => {
    const EyeDropperCtor = (window as typeof window & {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
    }).EyeDropper;
    if (!EyeDropperCtor) return;
    const result = await new EyeDropperCtor().open();
    onChange(withAlpha ? colorWithAlpha(result.sRGBHex, state.alpha) : result.sRGBHex);
  };
  const supportsEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  return (
    <div
      ref={setPopoverNode}
      className="cc-color-popover"
      style={style}
      role="dialog"
      aria-label={`Pick ${label} color`}
    >
      <div
        className="cc-color-selection"
        role="slider"
        aria-label={`${label} saturation and brightness`}
        aria-valuetext={`${Math.round(state.saturation * 100)}%, ${Math.round(state.brightness * 100)}%`}
        style={{ '--cc-hue-color': `hsl(${state.hue} 100% 50%)` } as CSSProperties}
        onPointerDown={commitSelection}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          commitSelection(event);
        }}
      >
        <span
          className="cc-color-handle"
          style={{
            left: `${state.saturation * 100}%`,
            top: `${(1 - state.brightness) * 100}%`,
            background: state.hex,
          }}
        />
      </div>
      <div className="cc-color-controls">
        <span className="cc-color-preview" style={{ '--cc-preview-color': colorWithAlpha(state.hex, state.alpha) } as CSSProperties} />
        <div className="cc-color-sliders">
          <input
            className="cc-color-slider cc-color-hue"
            type="range"
            min="0"
            max="360"
            value={Math.round(state.hue)}
            aria-label={`${label} hue`}
            style={{ '--cc-slider-thumb-color': `hsl(${state.hue} 100% 50%)` } as CSSProperties}
            onChange={(event) => commit({ hue: Number(event.currentTarget.value) })}
          />
          {withAlpha ? (
            <input
              className="cc-color-slider cc-color-alpha-slider"
              type="range"
              min="0"
              max="100"
              value={Math.round(state.alpha * 100)}
              aria-label={`${label} alpha`}
              style={{ '--cc-alpha-color': state.hex, '--cc-slider-thumb-color': state.hex } as CSSProperties}
              onChange={(event) => commit({ alpha: Number(event.currentTarget.value) / 100 })}
            />
          ) : null}
        </div>
      </div>
      <div className={`cc-color-output-row${withAlpha ? '' : ' cc-color-output-row-no-alpha'}`}>
        <input
          className="cc-color-output"
          value={state.hex}
          aria-label={`${label} hex`}
          onChange={(event) => onChange(withAlpha ? colorWithAlpha(event.currentTarget.value, state.alpha) : event.currentTarget.value)}
        />
        {withAlpha ? (
          <label className="cc-color-output-alpha">
            <input
              value={Math.round(state.alpha * 100)}
              aria-label={`${label} picker opacity`}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) commit({ alpha: clamp(next, 0, 100) / 100 });
              }}
            />
            <span>%</span>
          </label>
        ) : null}
        <button
          type="button"
          className="cc-color-eyedropper"
          disabled={!supportsEyeDropper}
          aria-label={`${label} eyedropper`}
          title="EyeDropper"
          onClick={() => void pickWithEyeDropper()}
        >
          ⊕
        </button>
      </div>
      <div className="cc-color-presets" aria-label={`${label} presets`}>
        {EDITOR_SWATCH_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            className="cc-color-tile"
            style={{ background: hex }}
            onClick={() => onChange(withAlpha ? colorWithAlpha(hex, state.alpha) : hex)}
            aria-label={hex}
          />
        ))}
      </div>
    </div>
  );
}

function QuadRow({ label, axes, values, onChange, onFocus }: {
  label: string; values: { t: string; r: string; b: string; l: string };
  axes?: { t: string; r: string; b: string; l: string };
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const allEqualValue = (() => {
    const v = values.t;
    return v === values.r && v === values.b && v === values.l ? v : null;
  })();
  return (
    // React onFocus bubbles, so any focused cell input activates the row.
    <div className="cc-quad" onFocus={onFocus}>
      <button type="button" className="cc-quad-head" onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        {!open && allEqualValue !== null ? <em>{stripPxUnit(allEqualValue) || '0'}</em> : <span className="cc-chevron-small">{open ? '▾' : '▸'}</span>}
      </button>
      {open ? (
        <div className="cc-quad-grid">
          <QuadCell axis={axes?.t ?? 'T'} value={values.t} onChange={(v) => onChange('t', v)} />
          <QuadCell axis={axes?.r ?? 'R'} value={values.r} onChange={(v) => onChange('r', v)} />
          <QuadCell axis={axes?.b ?? 'B'} value={values.b} onChange={(v) => onChange('b', v)} />
          <QuadCell axis={axes?.l ?? 'L'} value={values.l} onChange={(v) => onChange('l', v)} />
        </div>
      ) : null}
    </div>
  );
}

function QuadCell({ axis, value, onChange }: { axis: string; value: string; onChange: (v: string) => void }) {
  const display = stripPxUnit(value);
  const canStep = isNumericInput(display);
  const stepBy = (direction: -1 | 1) => {
    if (!canStep) return;
    onChange(`${formatSteppedNumber(Number(display) + direction, display, 1)}px`);
  };
  return (
    <span className="cc-quad-cell">
      <em className="cc-quad-axis">{axis}</em>
      <button type="button" className="cc-step cc-step-quad" disabled={!canStep} aria-label={`${axis} decrease`} onClick={() => stepBy(-1)}>−</button>
      <input value={display} placeholder="0"
        onChange={(e) => {
          const raw = e.currentTarget.value.trim();
          if (raw === '') onChange('');
          else if (isNumericInput(raw)) onChange(`${raw}px`);
          else if (/^-?\d+(\.\d+)?px$/i.test(raw)) onChange(raw.toLowerCase());
          else onChange(e.currentTarget.value);
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          const next = v && isNumericInput(v) ? `${v}px` : e.currentTarget.value;
          if (next !== value) onChange(next);
        }} />
      <button type="button" className="cc-step cc-step-quad" disabled={!canStep} aria-label={`${axis} increase`} onClick={() => stepBy(1)}>+</button>
    </span>
  );
}

function stripPxUnit(value: string): string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  return match?.[1] ?? value;
}

function isNumericInput(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function axisValue(a: string, b: string, mixedLabel: string): string {
  if (a && b && a !== b) return mixedLabel;
  return a || b || '';
}

function opacityToPercent(value: string): string {
  const n = Number(value || '1');
  if (!Number.isFinite(n)) return '100';
  return String(Math.round(Math.max(0, Math.min(1, n)) * 100));
}

function isBoldWeight(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) ? n >= 600 : ['bold', 'bolder', 'semibold'].includes(value.toLowerCase());
}

function hasDecoration(value: string, part: 'underline' | 'line-through'): boolean {
  return value.toLowerCase().split(/\s+/).includes(part);
}

function toggleDecoration(value: string, part: 'underline' | 'line-through'): string {
  const parts = new Set(value.toLowerCase().split(/\s+/).filter(Boolean).filter((item) => item !== 'none'));
  if (parts.has(part)) parts.delete(part);
  else parts.add(part);
  return Array.from(parts).join(' ');
}

function parseCssColor(value: string): { hex: string; alpha: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'transparent') return { hex: '#000000', alpha: 0 };
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return { hex: trimmed.toLowerCase(), alpha: 1 };
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return { hex: `#${r}${r}${g}${g}${b}${b}`.toLowerCase(), alpha: 1 };
  }
  const match = trimmed.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d?(?:\.\d+)?|1(?:\.0+)?|0(?:\.0+)?))?\s*\)$/i);
  if (!match) return null;
  const toHex = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw)))).toString(16).padStart(2, '0');
  const alpha = match[4] == null ? 1 : Math.max(0, Math.min(1, Number(match[4])));
  return { hex: `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`, alpha };
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

interface ColorPickerState {
  hex: string;
  alpha: number;
  hue: number;
  saturation: number;
  brightness: number;
}

function colorPickerState(value: string): ColorPickerState {
  const parsed = parseCssColor(value) ?? { hex: normalizeColorForPicker(value), alpha: 1 };
  const hsv = rgbToHsv(hexToRgb(parsed.hex) ?? { r: 0, g: 0, b: 0 });
  return {
    hex: parsed.hex,
    alpha: parsed.alpha,
    hue: hsv.h,
    saturation: hsv.s,
    brightness: hsv.v,
  };
}

function hexToRgb(hex: string): RgbColor | null {
  const parsed = parseCssColor(hex);
  if (!parsed) return null;
  return {
    r: parseInt(parsed.hex.slice(1, 3), 16),
    g: parseInt(parsed.hex.slice(3, 5), 16),
    b: parseInt(parsed.hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let rn = 0, gn = 0, bn = 0;
  if (hue < 60) [rn, gn, bn] = [c, x, 0];
  else if (hue < 120) [rn, gn, bn] = [x, c, 0];
  else if (hue < 180) [rn, gn, bn] = [0, c, x];
  else if (hue < 240) [rn, gn, bn] = [0, x, c];
  else if (hue < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  return {
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const parsed = parseCssColor(color);
  if (!parsed) return color;
  const normalized = parsed.hex;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  if (clampedAlpha >= 1) return normalized;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${formatAlpha(clampedAlpha)})`;
}

function formatAlpha(alpha: number): string {
  return alpha.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatSteppedNumber(value: number, current: string, step: number): string {
  const decimals = Math.max(decimalPlaces(current), decimalPlaces(String(step)));
  return decimals > 0
    ? value.toFixed(decimals).replace(/\.?0+$/, '')
    : String(Math.round(value));
}

function decimalPlaces(value: string): number {
  const match = value.match(/\.(\d+)/);
  return match?.[1]?.length ?? 0;
}

function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles;
}
function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left';
}

function normalizeColorForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`;
  }
  return '#000000';
}

export function manualEditPatchSummary(patch: ManualEditPatch): string {
  if (patch.kind === 'set-full-source') return JSON.stringify({ kind: patch.kind, bytes: patch.source.length });
  if (patch.kind === 'set-outer-html') return JSON.stringify({ id: patch.id, kind: patch.kind, bytes: patch.html.length });
  return JSON.stringify(patch);
}
