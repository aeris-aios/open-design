import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { ManualEditPanel, emptyManualEditDraft, manualEditPatchSummary, normalizeManualEditStyles, type ManualEditDraft } from '../../src/components/ManualEditPanel';
import type { ProjectDesignTokenSuggestion, ProjectDesignTokenSuggestionProp } from '../../src/providers/registry';
import { emptyManualEditStyles, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';

// The rewritten panel keeps the selected HTML editor above a compact grouped
// style form, so tests address controls by their translated row label.
const PARAMETERS = 'Parameters';

const target: ManualEditTarget = {
  id: 'hero-title',
  kind: 'text',
  label: 'Hero Title',
  tagName: 'h1',
  className: 'hero',
  text: 'Original',
  rect: { x: 0, y: 0, width: 120, height: 40 },
  fields: { text: 'Original' },
  attributes: { 'data-od-id': 'hero-title' },
  styles: emptyManualEditStyles(),
  isLayoutContainer: false,
  outerHtml: '<h1 data-od-id="hero-title">Original</h1>',
};

type OnDraftChange = (draft: ManualEditDraft) => void;
type OnStyleChange = (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
type OnInvalidStyle = (id: string, keys: Array<keyof ManualEditStyles>) => void;
type OnApplyPatch = (patch: ManualEditPatch, label: string) => void;
type OnError = (message: string) => void;
type OnClearSelection = () => void;
type OnSaveDraft = () => void;
type OnCancelDraft = () => void;
type OnResetDraft = () => void;

describe('ManualEditPanel', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = dom.window.document.querySelector('#root') as HTMLDivElement;
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    dom.window.close();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'HTMLElement');
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });

  it('renders the style inspector without the advanced editor entry', () => {
    renderPanel();

    const parameters = sectionByTitle(PARAMETERS);
    expect(parameters.closest('[data-manual-edit-history-controls="true"]')).not.toBeNull();
    for (const label of ['Text color', 'Font', 'Weight', 'Font size', 'Letter spacing', 'Line height', 'Align', 'Text style']) {
      expect(host.textContent).toContain(label);
    }
    for (const head of ['Basic', 'Stroke', 'Spacing', 'Effects']) {
      expect(sectionHeads()).toContain(head);
    }
    for (const legacyHead of ['TYPOGRAPHY', 'SIZE', 'LAYOUT', 'BOX', 'Direction', 'Distribution', 'Gap', 'Width', 'Height']) {
      expect(sectionHeads()).not.toContain(legacyHead);
    }
    expect(host.textContent).not.toContain('Advanced');
  });

  it('shows a readable selected element name in the titlebar', () => {
    renderPanel({
      selectedTarget: {
        ...target,
        id: 'path-0-0',
        kind: 'container',
        label: 'div.container.hero-split',
        className: 'container hero-split',
        text: 'Turn a brand brief into an editorial collage system.',
        attributes: { 'data-od-source-path': 'path-0-0' },
      },
    });

    expect(host.querySelector('.manual-edit-titlebar')?.textContent).toContain('Hero split');
    expect(host.querySelector('.manual-edit-titlebar')?.textContent).not.toContain('div.container');
  });

  it('shows a drag handle for floating edit panels', () => {
    renderPanel({ floatingStyle: { left: 20, top: 24, width: 320, height: 380 } });

    expect(host.querySelector('.manual-edit-drag-handle')).not.toBeNull();
    expect(host.querySelector('.manual-edit-drag-handle')?.getAttribute('aria-label')).toBe('Move edit panel');
  });

  it('does not show page-level controls inside an element inspector', () => {
    const onClearSelection = vi.fn();
    renderPanel({ onClearSelection });

    expect(host.querySelector('button[aria-label="Show page inspector"]')).toBeNull();
    expect(host.textContent).not.toContain('PAGE');
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('keeps inspector controls scrollable separately from footer actions', () => {
    renderPanel();

    const scrollRegion = host.querySelector('.manual-edit-scroll');
    const footer = host.querySelector('.manual-edit-footer');
    const deleteButton = host.querySelector('button[aria-label="Delete element"]');

    expect(scrollRegion?.textContent).toContain(PARAMETERS);
    expect(scrollRegion?.contains(deleteButton)).toBe(false);
    expect(footer?.contains(deleteButton)).toBe(true);
    expect(deleteButton?.textContent).toBe('');
    expect(footer?.textContent).toContain('Cancel');
    expect(footer?.textContent).toContain('Save');
  });

  it('routes delete as a direct icon-only action', () => {
    const onApplyPatch = vi.fn<OnApplyPatch>();
    renderPanel({ onApplyPatch });

    const footer = host.querySelector('.manual-edit-footer');
    const deleteButton = host.querySelector('button[aria-label="Delete element"]') as HTMLButtonElement | null;
    if (!deleteButton) throw new Error('Delete button not found');

    act(() => {
      deleteButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(footer?.contains(deleteButton)).toBe(true);
    expect(deleteButton.textContent).toBe('');
    expect(deleteButton.className).toContain('manual-edit-delete-btn');
    expect(onApplyPatch).toHaveBeenCalledWith(
      { id: 'hero-title', kind: 'remove-element' },
      'Delete element',
    );
  });

  it('routes footer reset, cancel, and save actions', () => {
    const onResetDraft = vi.fn<OnResetDraft>();
    const onCancelDraft = vi.fn<OnCancelDraft>();
    const onSaveDraft = vi.fn<OnSaveDraft>();
    renderPanel({ resetAvailable: true, onResetDraft, onCancelDraft, onSaveDraft });

    const footerButtons = Array.from(host.querySelectorAll('.manual-edit-footer button'));
    const reset = footerButtons.find((button) => button.textContent === 'Reset') as HTMLButtonElement | undefined;
    const cancel = footerButtons.find((button) => button.textContent === 'Cancel') as HTMLButtonElement | undefined;
    const save = footerButtons.find((button) => button.textContent === 'Save') as HTMLButtonElement | undefined;
    if (!reset || !cancel || !save) throw new Error('Footer action buttons not found');

    act(() => {
      reset.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      cancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onResetDraft).toHaveBeenCalledTimes(1);
    expect(onCancelDraft).toHaveBeenCalledTimes(1);
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it('edits selected text content from the panel', () => {
    const onDraftChange = vi.fn<OnDraftChange>();
    renderPanel({ onDraftChange });

    const textArea = sectionByTitle('CONTENT').querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textArea) throw new Error('Content textarea not found');

    act(() => {
      textArea.value = 'Panel edited copy';
      Simulate.change(textArea);
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'Panel edited copy' }));
  });

  it('keeps the selected HTML editor above the grouped style controls', () => {
    renderPanel({
      selectedTarget: {
        ...target,
        kind: 'container',
        tagName: 'div',
        fields: {},
        outerHtml: '<div data-od-id="hero-title"><h1>Original</h1></div>',
      },
    });

    const htmlSection = sectionByTitle('CONTENT');
    const htmlEditor = htmlSection.querySelector('textarea.manual-edit-code') as HTMLTextAreaElement | null;
    if (!htmlEditor) throw new Error('Selected HTML editor not found');

    expect(htmlSection.textContent).toContain('Selected element HTML');
    expect(htmlEditor.value).toBe('<h1 data-od-id="hero-title">Original</h1>');
    expect(htmlSection.compareDocumentPosition(sectionByTitle(PARAMETERS)) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('edits button text, navigation href, and new-tab behavior from the action inspector', () => {
    const onDraftChange = vi.fn<OnDraftChange>();
    renderPanel({
      onDraftChange,
      selectedTarget: {
        ...target,
        id: 'hero-cta',
        kind: 'action',
        label: 'Explore work',
        tagName: 'button',
        text: 'Explore work',
        fields: { text: 'Explore work', href: '/work.html', target: '_self' },
        outerHtml: '<button data-od-id="hero-cta">Explore work</button>',
      },
    });

    const content = sectionByTitle('CONTENT');
    const textArea = content.querySelector('textarea') as HTMLTextAreaElement | null;
    const hrefInput = content.querySelector('input:not([type="checkbox"])') as HTMLInputElement | null;
    const newTabInput = content.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (!textArea || !hrefInput || !newTabInput) throw new Error('Action inspector controls not found');

    expect(content.textContent).toContain('Text');
    expect(content.textContent).toContain('Href');
    expect(content.textContent).toContain('Open in new tab');

    act(() => {
      textArea.value = 'Launch project';
      Simulate.change(textArea);
      hrefInput.value = '/launch.html';
      Simulate.change(hrefInput);
      newTabInput.checked = true;
      Simulate.change(newTabInput);
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'Launch project' }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ href: '/launch.html' }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ target: '_blank' }));
  });

  it('normalizes font stacks and writes a usable font-family value', () => {
    const onDraftChange = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onDraftChange,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        fontFamily: '"Roboto", sans-serif',
        fontSize: '32px',
        color: '#111111',
        paddingTop: '8px',
      },
    });

    const fontSelect = host.querySelector('select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');
    expect(fontSelect.value).toBe('Roboto, Arial, sans-serif');

    act(() => {
      fontSelect.value = 'Georgia, serif';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      styles: expect.objectContaining({ fontFamily: 'Georgia, serif' }),
    }));
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontFamily: 'Georgia, serif' }, 'Style: Hero Title');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      'hero-title',
      expect.objectContaining({ fontSize: '32px', color: '#111111', paddingTop: '8px' }),
      'Style: Hero Title',
    );
  });

  it('shows px-backed values without px in numeric inputs', () => {
    renderPanel({
      styles: {
        ...emptyManualEditStyles(),
        fontSize: '32px',
      },
    });

    const sizeInput = rowInput('Font size');

    expect(sizeInput.value).toBe('32');
  });

  it('increments text typography rows with normalized values', () => {
    const onStyleChange = vi.fn();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        fontSize: '32px',
        lineHeight: '1.4',
        letterSpacing: '1px',
      },
    });

    const sizeIncrease = stepper('Font size', 'increase');
    const lineIncrease = stepper('Line height', 'increase');
    const trackingDecrease = stepper('Letter spacing', 'decrease');

    act(() => {
      sizeIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      lineIncrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      trackingDecrease.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontSize: '33px' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { lineHeight: '1.5' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { letterSpacing: '0px' }, 'Style: Hero Title');
    expect(sectionHeads().filter((head) => head === PARAMETERS)).toHaveLength(1);
    expect(sectionByTitle('Effects').textContent).toContain('Opacity');
    expect(sectionByTitle('Spacing').textContent).toContain('Padding');
  });

  it('does not persist an unchanged target style when the inspector opens', () => {
    vi.useFakeTimers();
    try {
      const onApplyPatch = vi.fn();
      renderPanel({ onApplyPatch });

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(onApplyPatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes valid style values before host preview/persistence', () => {
    expect(normalizeManualEditStyles({
      fontSize: '48',
      color: '#f00',
      opacity: '2',
      lineHeight: '1.4',
    }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: {
        fontSize: '48px',
        color: '#ff0000',
        opacity: '1',
        lineHeight: '1.4',
      },
    });
    expect(normalizeManualEditStyles({ lineHeight: '49px' }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: { lineHeight: '49px' },
    });
  });

  it('rejects invalid style values before host preview/persistence', () => {
    expect(normalizeManualEditStyles({ color: 'tomato' }, { layoutEnabled: true })).toEqual({
      ok: false,
      error: 'color must be a hex color.',
    });
    expect(normalizeManualEditStyles({ lineHeight: '-1px' }, { layoutEnabled: true })).toEqual({
      ok: false,
      error: 'Line height must be a positive number or px value.',
    });
  });

  it('treats empty values as inline style clears', () => {
    expect(normalizeManualEditStyles({ fontSize: '', color: '' }, { layoutEnabled: true })).toEqual({
      ok: true,
      styles: { fontSize: '', color: '' },
    });
  });

  it('does not validate unchanged computed line-height values on blur', () => {
    const onError = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onError,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        lineHeight: '48.96px',
      },
    });

    const lineInput = rowInput('Line height');

    act(() => {
      lineInput.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: true }));
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('accepts edited computed pixel line-height values', () => {
    const onError = vi.fn();
    const onStyleChange = vi.fn();
    renderPanel({
      onError,
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        lineHeight: '48.96px',
      },
    });

    const lineInput = rowInput('Line height');

    act(() => {
      lineInput.value = '49px';
      Simulate.change(lineInput);
    });

    expect(onError).toHaveBeenCalledWith('');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { lineHeight: '49px' }, 'Style: Hero Title');
  });

  it('does not persist unchanged page styles when no target is selected', () => {
    vi.useFakeTimers();
    try {
      const onApplyPatch = vi.fn();
      renderPanel({ onApplyPatch, selectedTarget: null });

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      expect(onApplyPatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits only the changed page style field', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const bgSwatch = host.querySelector('button[aria-label="Pick Background"]') as HTMLButtonElement | null;
    if (!bgSwatch) throw new Error('Background swatch not found');

    act(() => {
      bgSwatch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    const colorTile = document.querySelector('button[aria-label="#3b82f6"]') as HTMLButtonElement | null;
    if (!colorTile) throw new Error('Background color tile not found');
    act(() => {
      colorTile.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { backgroundColor: '#3b82f6' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontFamily: expect.any(String) }),
      'Page styles',
    );
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontSize: expect.any(String) }),
      'Page styles',
    );
  });

  it('opens the full picker UI for manual edit colors', () => {
    renderPanel({ styles: { ...emptyManualEditStyles(), color: '#336699' } });

    const textSwatch = host.querySelector('button[aria-label="Pick Text color"]') as HTMLButtonElement | null;
    if (!textSwatch) throw new Error('Text color swatch not found');
    act(() => {
      textSwatch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('.cc-color-selection')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Text color hue"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Text color alpha"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Text color hex"]')).not.toBeNull();
  });

  it('updates color alpha and hex through the picker controls', () => {
    const onStyleChange = vi.fn<OnStyleChange>();
    renderPanel({ onStyleChange, styles: { ...emptyManualEditStyles(), color: '#336699' } });

    const textSwatch = host.querySelector('button[aria-label="Pick Text color"]') as HTMLButtonElement | null;
    if (!textSwatch) throw new Error('Text color swatch not found');
    act(() => {
      textSwatch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const alpha = document.querySelector('input[aria-label="Text color alpha"]') as HTMLInputElement | null;
    if (!alpha) throw new Error('Text color alpha slider not found');
    act(() => {
      alpha.value = '50';
      Simulate.change(alpha);
    });
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { color: 'rgba(51, 102, 153, 0.5)' }, 'Style: Hero Title');

    const output = document.querySelector('input[aria-label="Text color hex"]') as HTMLInputElement | null;
    if (!output) throw new Error('Text color hex output not found');
    act(() => {
      output.value = '#112233';
      Simulate.change(output);
    });
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { color: '#112233' }, 'Style: Hero Title');
  });

  it('does not emit untouched page fields when changing the page font', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const fontSelect = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');

    act(() => {
      fontSelect.value = 'Georgia, serif';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: 'Georgia, serif' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ backgroundColor: expect.any(String) }),
      'Page styles',
    );
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ fontSize: expect.any(String) }),
      'Page styles',
    );
  });

  it('shows an inactive Page inspector for fragment HTML sources', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null, pageStylesEnabled: false });

    expect(host.textContent).toContain('Page styles are available only for full HTML documents.');
    expect(host.textContent).not.toContain('Background');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('select')).toBeNull();
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it('keeps explicit empty page values as field-specific clears', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, selectedTarget: null });

    const fontSelect = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!fontSelect) throw new Error('Font select not found');

    act(() => {
      fontSelect.value = '';
      fontSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('__body__', { fontFamily: '' }, 'Page styles');
    expect(onStyleChange).not.toHaveBeenCalledWith(
      '__body__',
      expect.objectContaining({ backgroundColor: expect.any(String), fontFamily: expect.any(String) }),
      'Page styles',
    );
  });

  it('reflects page style values reset by the host undo history', () => {
    renderPanel({
      selectedTarget: null,
      styles: { ...emptyManualEditStyles(), fontFamily: 'Georgia, serif' },
    });
    const pageFont = host.querySelector('.cc-row select') as HTMLSelectElement | null;
    if (!pageFont) throw new Error('Font select not found');
    expect(pageFont.closest('[data-manual-edit-history-controls="true"]')).not.toBeNull();
    expect(pageFont.value).toBe('Georgia, serif');

    renderPanel({ selectedTarget: null, styles: emptyManualEditStyles() });
    expect((host.querySelector('.cc-row select') as HTMLSelectElement | null)?.value).toBe('');
  });

  it('edits text alignment with compact icon controls', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange });
    const justify = host.querySelector('button[aria-label="Justify"]') as HTMLButtonElement | null;
    if (!justify) throw new Error('Justify button not found');
    act(() => {
      justify.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { textAlign: 'justify' }, 'Style: Hero Title');
  });

  it('edits text style through B/I/U/S buttons', () => {
    const onStyleChange = vi.fn();
    renderPanel({ onStyleChange, styles: { ...emptyManualEditStyles(), fontWeight: '400' } });

    for (const label of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
      const button = host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
      if (!button) throw new Error(`${label} button not found`);
      act(() => {
        button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
    }

    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontWeight: '600' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { fontStyle: 'italic' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { textDecorationLine: 'underline' }, 'Style: Hero Title');
    expect(onStyleChange).toHaveBeenCalledWith('hero-title', { textDecorationLine: 'line-through' }, 'Style: Hero Title');
  });

  it('edits padding as horizontal and vertical pairs', () => {
    const onStyleChange = vi.fn<OnStyleChange>();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        paddingTop: '8px',
        paddingRight: '8px',
        paddingBottom: '8px',
        paddingLeft: '8px',
      },
    });

    expect(axisInput('Padding', 'Horizontal').value).toBe('8');

    const horizontal = axisInput('Padding', 'Horizontal');
    act(() => {
      horizontal.value = '24';
      Simulate.change(horizontal);
    });
    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { paddingLeft: '24px', paddingRight: '24px' },
      'Style: Hero Title',
    );

    const vertical = axisInput('Padding', 'Vertical');
    act(() => {
      vertical.value = '12';
      Simulate.change(vertical);
    });
    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { paddingTop: '12px', paddingBottom: '12px' },
      'Style: Hero Title',
    );
  });

  it('shows mixed spacing values until a pair is overwritten', () => {
    const onStyleChange = vi.fn<OnStyleChange>();
    renderPanel({
      onStyleChange,
      styles: {
        ...emptyManualEditStyles(),
        marginTop: '12px',
        marginRight: '20px',
        marginBottom: '16px',
        marginLeft: '12px',
      },
    });

    const horizontal = axisInput('Margin', 'Horizontal');
    expect(horizontal.placeholder).toBe('Mixed');

    act(() => {
      horizontal.value = '4';
      Simulate.change(horizontal);
    });
    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { marginLeft: '4px', marginRight: '4px' },
      'Style: Hero Title',
    );
  });

  it('fans a single border width out to all four sides', () => {
    const onStyleChange = vi.fn<OnStyleChange>();
    renderPanel({ onStyleChange, styles: { ...emptyManualEditStyles(), borderTopWidth: '1px' } });

    const borderWidth = rowInput('Border width');
    act(() => {
      borderWidth.value = '3';
      Simulate.change(borderWidth);
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      'hero-title',
      { borderTopWidth: '3px', borderRightWidth: '3px', borderBottomWidth: '3px', borderLeftWidth: '3px' },
      'Style: Hero Title',
    );
  });

  it('asks the host for reference values matching the focused field', () => {
    const onInspectValueSelect = vi.fn<(prop: ProjectDesignTokenSuggestionProp, value: string) => void>();
    renderPanel({
      onInspectValueSelect,
      styles: { ...emptyManualEditStyles(), color: '#111111' },
    });

    act(() => {
      Simulate.focus(rowInput('Text color'));
    });

    expect(onInspectValueSelect).toHaveBeenCalledWith('color', '#111111');
    // Focusing surfaces the strip, scoped to the field the user is editing.
    expect(host.querySelector('.cc-suggest')).not.toBeNull();
    expect(host.querySelector('.cc-suggest-head')?.textContent).toContain('Reference values');
    expect(host.querySelector('.cc-suggest-head em')?.textContent).toBe('Text color');
  });

  it('falls back to the computed value when asking for reference values', () => {
    const onInspectValueSelect = vi.fn<(prop: ProjectDesignTokenSuggestionProp, value: string) => void>();
    renderPanel({
      onInspectValueSelect,
      selectedTarget: {
        ...target,
        computedSummary: {
          display: 'block', position: 'static',
          fontFamily: 'Inter', fontSize: '18px', fontWeight: '400',
          lineHeight: '1.4', letterSpacing: 'normal',
          color: 'rgb(20, 20, 20)', backgroundColor: 'transparent', borderColor: 'transparent',
          borderRadius: '0px', padding: '0px', margin: '0px',
        },
      },
    });

    act(() => {
      Simulate.focus(rowInput('Font size'));
    });

    expect(onInspectValueSelect).toHaveBeenCalledWith('fontSize', '18px');
  });

  it('shows only the reference values for the focused property and applies the picked one', () => {
    const onApplyTokenSuggestion = vi.fn<(prop: keyof ManualEditStyles, value: string) => void>();
    renderPanel({
      onApplyTokenSuggestion,
      tokenSuggestions: [
        tokenSuggestion({ prop: 'color', token: '--brand-ink', value: '#101828' }),
        tokenSuggestion({ prop: 'color', token: '--brand-muted', value: '#667085' }),
        tokenSuggestion({ prop: 'fontSize', token: '--text-lg', value: '20px' }),
      ],
    });

    act(() => {
      Simulate.focus(rowInput('Text color'));
    });

    const chips = Array.from(host.querySelectorAll('.cc-suggest-chip'));
    expect(chips.map((chip) => chip.querySelector('.cc-suggest-token')?.textContent))
      .toEqual(['--brand-ink', '--brand-muted']);
    // Colour references carry a swatch so the value is judgeable at a glance.
    expect(chips[0]?.querySelector('.cc-suggest-swatch')).not.toBeNull();

    act(() => {
      chips[1]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onApplyTokenSuggestion).toHaveBeenCalledWith('color', '#667085');
  });

  it('maps a border-width reference back onto the border side props', () => {
    const onApplyTokenSuggestion = vi.fn<(prop: keyof ManualEditStyles, value: string) => void>();
    renderPanel({
      onApplyTokenSuggestion,
      tokenSuggestions: [tokenSuggestion({ prop: 'borderWidth', token: '--hairline', value: '1px' })],
    });

    act(() => {
      Simulate.focus(rowInput('Border width'));
    });
    const chip = host.querySelector('.cc-suggest-chip') as HTMLButtonElement | null;
    if (!chip) throw new Error('Border width reference chip not found');
    act(() => {
      chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onApplyTokenSuggestion).toHaveBeenCalledWith('borderTopWidth', '1px');
  });

  it('distinguishes loading reference values from having none', () => {
    renderPanel({ tokenSuggestionsLoading: true });
    act(() => {
      Simulate.focus(rowInput('Text color'));
    });
    expect(host.querySelector('.cc-suggest-empty')?.textContent).toBe('Loading…');
    expect(host.querySelector('.cc-suggest-chip')).toBeNull();

    renderPanel({ tokenSuggestions: [] });
    act(() => {
      Simulate.focus(rowInput('Text color'));
    });
    expect(host.querySelector('.cc-suggest-empty')?.textContent).toBe('No matching reference values');
  });

  it('drops the reference strip when the selection moves to another element', () => {
    renderPanel({
      tokenSuggestions: [tokenSuggestion({ prop: 'color', token: '--brand-ink', value: '#101828' })],
    });
    act(() => {
      Simulate.focus(rowInput('Text color'));
    });
    expect(host.querySelector('.cc-suggest')).not.toBeNull();

    renderPanel({
      tokenSuggestions: [tokenSuggestion({ prop: 'color', token: '--brand-ink', value: '#101828' })],
      selectedTarget: { ...target, id: 'other-title', label: 'Other Title' },
    });

    expect(host.querySelector('.cc-suggest')).toBeNull();
  });

  it('shows no reference strip for properties with no token vocabulary', () => {
    const onInspectValueSelect = vi.fn<(prop: ProjectDesignTokenSuggestionProp, value: string) => void>();
    renderPanel({
      onInspectValueSelect,
      styles: { ...emptyManualEditStyles(), opacity: '0.5' },
    });

    act(() => {
      Simulate.focus(rowInput('Opacity'));
    });

    expect(host.querySelector('.cc-suggest')).toBeNull();
    expect(onInspectValueSelect).not.toHaveBeenCalled();
  });

  it('summarizes full-source history entries without rendering the full file', () => {
    const source = '<html><body>' + 'x'.repeat(10_000) + '</body></html>';

    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).toBe(
      JSON.stringify({ kind: 'set-full-source', bytes: source.length }),
    );
    expect(manualEditPatchSummary({ kind: 'set-full-source', source })).not.toContain('x'.repeat(100));
  });

  function tokenSuggestion(
    overrides: Partial<ProjectDesignTokenSuggestion> & Pick<ProjectDesignTokenSuggestion, 'prop' | 'token' | 'value'>,
  ): ProjectDesignTokenSuggestion {
    return {
      sourceFile: 'design-system/tokens.css',
      line: 12,
      matchReason: 'exact',
      score: 1,
      ...overrides,
    };
  }

  function sectionByTitle(title: string): HTMLElement {
    const section = Array.from(host.querySelectorAll('.cc-section'))
      .find((candidate) => candidate.querySelector('.cc-section-head')?.textContent === title) as HTMLElement | undefined;
    if (!section) throw new Error(`${title} section not found`);
    return section;
  }

  function sectionHeads(): string[] {
    return Array.from(host.querySelectorAll('.cc-section-head')).map((head) => head.textContent ?? '');
  }

  /** A parameter row is identified by its localized `.cc-label`, so a renamed
   *  or re-grouped control fails loudly instead of silently matching a
   *  neighbour whose text happens to contain the same substring. */
  function rowByLabel(label: string): HTMLElement {
    const row = Array.from(host.querySelectorAll('.cc-row'))
      .find((candidate) => candidate.querySelector('.cc-label')?.textContent === label) as HTMLElement | undefined;
    if (!row) throw new Error(`${label} row not found`);
    return row;
  }

  function rowInput(label: string): HTMLInputElement {
    const input = rowByLabel(label).querySelector('input') as HTMLInputElement | null;
    if (!input) throw new Error(`${label} input not found`);
    return input;
  }

  function rowSelect(label: string): HTMLSelectElement {
    const select = rowByLabel(label).querySelector('select') as HTMLSelectElement | null;
    if (!select) throw new Error(`${label} select not found`);
    return select;
  }

  function axisInput(label: string, axis: string): HTMLInputElement {
    const row = rowByLabel(label);
    const input = Array.from(row.querySelectorAll('.cc-axis-input'))
      .find((candidate) => candidate.querySelector('span')?.textContent === axis)
      ?.querySelector('input') as HTMLInputElement | undefined;
    if (!input) throw new Error(`${label} ${axis} input not found`);
    return input;
  }

  function stepper(label: string, direction: 'increase' | 'decrease'): HTMLButtonElement {
    const button = host.querySelector(`button[aria-label="${label} ${direction}"]`) as HTMLButtonElement | null;
    if (!button) throw new Error(`${label} ${direction} control not found`);
    return button;
  }

  /** The four-way padding/margin editor, addressed by its collapsible head. */
  function quadRow(label: string): HTMLElement {
    const quad = Array.from(host.querySelectorAll('.cc-quad'))
      .find((candidate) => candidate.querySelector('.cc-quad-head span')?.textContent === label) as HTMLElement | undefined;
    if (!quad) throw new Error(`${label} quad row not found`);
    return quad;
  }

  function quadCellInput(label: string, axis: string): HTMLInputElement {
    const cell = Array.from(quadRow(label).querySelectorAll('.cc-quad-cell'))
      .find((candidate) => candidate.querySelector('.cc-quad-axis')?.textContent === axis) as HTMLElement | undefined;
    if (!cell) throw new Error(`${label} ${axis} cell not found`);
    const input = cell.querySelector('input') as HTMLInputElement | null;
    if (!input) throw new Error(`${label} ${axis} input not found`);
    return input;
  }

  function renderPanel({
    onDraftChange = vi.fn<OnDraftChange>(),
    onApplyPatch = vi.fn<OnApplyPatch>(),
    onError = vi.fn<OnError>(),
    onStyleChange = vi.fn<OnStyleChange>(),
    onInvalidStyle = vi.fn<OnInvalidStyle>(),
    onClearSelection = vi.fn<OnClearSelection>(),
    onCancelDraft = vi.fn<OnCancelDraft>(),
    onSaveDraft = vi.fn<OnSaveDraft>(),
    onResetDraft = vi.fn<OnResetDraft>(),
    attributesText = '{}',
    selectedTarget = target,
    styles = emptyManualEditStyles(),
    resetAvailable = false,
    pageStylesEnabled = true,
    floatingStyle,
    onFloatingPositionChange,
    tokenSuggestions,
    tokenSuggestionsLoading,
    onApplyTokenSuggestion,
    onInspectValueSelect,
  }: {
    onDraftChange?: OnDraftChange;
    onApplyPatch?: OnApplyPatch;
    onError?: OnError;
    onStyleChange?: OnStyleChange;
    onInvalidStyle?: OnInvalidStyle;
    onClearSelection?: OnClearSelection;
    onCancelDraft?: OnCancelDraft;
    onSaveDraft?: OnSaveDraft;
    onResetDraft?: OnResetDraft;
    attributesText?: string;
    selectedTarget?: ManualEditTarget | null;
    styles?: ReturnType<typeof emptyManualEditStyles>;
    resetAvailable?: boolean;
    pageStylesEnabled?: boolean;
    floatingStyle?: CSSProperties;
    onFloatingPositionChange?: (position: { left: number; top: number }) => void;
    tokenSuggestions?: ProjectDesignTokenSuggestion[];
    tokenSuggestionsLoading?: boolean;
    onApplyTokenSuggestion?: (prop: keyof ManualEditStyles, value: string) => void;
    onInspectValueSelect?: (prop: ProjectDesignTokenSuggestionProp, value: string) => void;
  } = {}) {
    const draft = {
      ...emptyManualEditDraft('<html></html>'),
      text: 'Updated copy',
      attributesText,
      styles,
      outerHtml: target.outerHtml,
    };
    act(() => {
      root.render(
        <ManualEditPanel
          targets={[target]}
          selectedTarget={selectedTarget}
          draft={draft}
          history={[]}
          canUndo={false}
          canRedo={false}
          resetAvailable={resetAvailable}
          pageStylesEnabled={pageStylesEnabled}
          onSelectTarget={vi.fn<(target: ManualEditTarget) => void>()}
          onDraftChange={onDraftChange}
          onStyleChange={onStyleChange}
          onInvalidStyle={onInvalidStyle}
          onApplyPatch={onApplyPatch}
          onError={onError}
          onClearSelection={onClearSelection}
          onCancelDraft={onCancelDraft}
          onSaveDraft={onSaveDraft}
          onResetDraft={onResetDraft}
          onUndo={vi.fn<() => void>()}
          onRedo={vi.fn<() => void>()}
          floatingStyle={floatingStyle}
          onFloatingPositionChange={onFloatingPositionChange}
          tokenSuggestions={tokenSuggestions}
          tokenSuggestionsLoading={tokenSuggestionsLoading}
          onApplyTokenSuggestion={onApplyTokenSuggestion}
          onInspectValueSelect={onInspectValueSelect}
        />,
      );
    });
  }

});
