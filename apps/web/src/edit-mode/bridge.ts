import { MANUAL_EDIT_SIDE_GROUP_STYLE } from './types';

export const MANUAL_EDIT_DISCOVERY_SELECTOR =
  'main, nav, section, article, aside, header, footer, div, form, fieldset, legend, details, dialog, address, h1, h2, h3, h4, h5, h6, p, a, button, [role="button"], img, picture, ul, ol, menu, li, dl, dt, dd, table, thead, tbody, tfoot, tr, td, th, caption, blockquote, figure, figcaption, label, summary, pre, code, strong, em, b, i, small, mark, span, [data-od-id], [data-od-edit], [data-od-source-path]';
export const MANUAL_EDIT_SOURCE_PATH_ATTR = 'data-od-source-path';
export const MANUAL_EDIT_HOST_NODE_SELECTOR = [
  '[data-od-sandbox-shim]',
  '[data-od-deck-bridge]',
  '[data-od-comment-bridge]',
  '[data-od-edit-bridge]',
  '[data-od-comment-bridge-style]',
  '[data-od-edit-bridge-style]',
  '[data-od-deck-fix]',
].join(',');

export type ManualEditKind = 'text' | 'link' | 'action' | 'image' | 'container';

export function manualEditDomPathForElement(el: Element): string {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parentEl: Element | null = node.parentElement;
    if (!parentEl) break;
    const children = Array.from(parentEl.children).filter((child) => !isManualEditHostNode(child));
    parts.unshift(children.indexOf(node));
    node = parentEl;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

export function isManualEditHostNode(el: Element): boolean {
  return el.matches(MANUAL_EDIT_HOST_NODE_SELECTOR);
}

export function manualEditStableIdForElement(el: Element): string {
  const explicit = el.getAttribute('data-od-id');
  if (explicit && !el.hasAttribute('data-od-generated-id')) return explicit;
  const generated = el.getAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR) || el.getAttribute('data-od-runtime-id') || manualEditDomPathForElement(el);
  if (generated) el.setAttribute('data-od-runtime-id', generated);
  if (generated && generatedPathCollidesWithAuthoredId(el, generated)) {
    return sourcePathLocatorWithoutAuthoredCollision(el, generated);
  }
  return generated || 'unknown';
}

function generatedPathCollidesWithAuthoredId(el: Element, id: string): boolean {
  if (!/^path-\d+(?:-\d+)*$/.test(id)) return false;
  return Array.from(el.ownerDocument.querySelectorAll(`[data-od-id="${id}"]`)).some((candidate) => (
    candidate !== el && !candidate.hasAttribute('data-od-generated-id')
  ));
}

function sourcePathLocatorWithoutAuthoredCollision(el: Element, path: string): string {
  let locator = `source-path:${path}`;
  while (el.ownerDocument.querySelector(`[data-od-id="${locator}"]`)) {
    locator = `source-path:${locator}`;
  }
  return locator;
}

export function isMeaningfulManualEditElement(el: Element, rect: Pick<DOMRect, 'width' | 'height'>): boolean {
  return isSourceMappableManualEditElement(el) && el.matches(MANUAL_EDIT_DISCOVERY_SELECTOR) && rect.width >= 4 && rect.height >= 4;
}

export function isSourceMappableManualEditElement(el: Element): boolean {
  if (isManualEditHostNode(el)) return false;
  return el.hasAttribute('data-od-id') || el.hasAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR);
}

/**
 * A "text leaf" carries visible text and has NO element children, so a click
 * can drop a caret and the committed text round-trips through the source
 * patcher. This — not the tag name — is what makes a bare `<div>Title</div>`,
 * an `<li>`, a `<td>`, or an `<h4>` editable, exactly like a `<p>`.
 *
 * Elements with element children (even inline ones like `<strong>`/`<a>`) are
 * deliberately NOT text leaves. `applyManualEditPatch` can persist a flat
 * text edit through nested markup when exactly one descendant text node
 * carries the visible text (an icon `<span>` beside a label being the common
 * case), but it still refuses whenever that target is ambiguous — so
 * classifying every container as a text leaf would let the user type over
 * genuinely mixed inline content (e.g. `<p><strong>Nested</strong> copy</p>`)
 * and then fail to persist. Those stay containers (style-only) until caret
 * availability itself is worth broadening beyond this per-kind allowlist.
 */
export function manualEditElementIsTextLeaf(el: Element): boolean {
  const text = (el.textContent || '').trim();
  if (!text) return false;
  return el.children.length === 0;
}

/**
 * Classify what a click on an element should do in manual edit mode. `text`
 * and `link` drop a text caret (and still expose styles); `container` and
 * `image` only select for styling. An explicit `data-od-edit` attribute always
 * wins so authored markup can opt a node in or out.
 */
export function manualEditKindForElement(el: Element): ManualEditKind {
  const explicit = el.getAttribute('data-od-edit');
  if (explicit) return explicit as ManualEditKind;
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (tag === 'a') return 'link';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'action';
  if (tag === 'img') return 'image';
  if (manualEditElementIsTextLeaf(el)) return 'text';
  return 'container';
}

export function buildManualEditKeyboardGuard(): string {
  return `<script data-od-edit-keyboard-guard>(function(){
  window.__odEditGuard = window.__odEditGuard || { editingEl: null };
  window.__odEditWheelBridge = window.__odEditWheelBridge || null;
  function shouldBlock(){
    var el = window.__odEditGuard && window.__odEditGuard.editingEl;
    return el && el.isConnected;
  }
  function captureFromOptions(options){
    if (options == null) return false;
    if (typeof options === 'boolean') return options;
    return !!(options && options.capture);
  }
  function onceFromOptions(options){
    if (options == null) return false;
    if (typeof options === 'boolean') return false;
    return !!(options && options.once);
  }
  function signalFromOptions(options){
    if (options == null) return null;
    if (typeof options === 'boolean') return null;
    return (options && options.signal) || null;
  }
  function removeWrappedEntry(wrapped, handler){
    for (var i = wrapped.length - 1; i >= 0; i--) {
      if (wrapped[i].handler === handler) {
        wrapped.splice(i, 1);
        return;
      }
    }
  }
  function patchTarget(target){
    var originalAdd = target.addEventListener.bind(target);
    var originalRemove = target.removeEventListener.bind(target);
    var wrapped = []; // [{ original, handler, capture }] so removeEventListener can map back to the registered wrapper
    target.addEventListener = function(type, listener, options){
      if (type === 'keydown' && typeof listener === 'function') {
        var capture = captureFromOptions(options);
        for (var i = 0; i < wrapped.length; i++) {
          if (wrapped[i].original === listener && wrapped[i].capture === capture) return;
        }
        var once = onceFromOptions(options);
        var signal = signalFromOptions(options);
        if (signal && signal.aborted) {
          // Already aborted — browser will not register the listener; skip bookkeeping entirely
          return originalAdd(type, listener, options);
        }
        var handler = function(ev){
          if (once) removeWrappedEntry(wrapped, handler);
          if (shouldBlock() && (window.__odEditGuard.editingEl === ev.target || window.__odEditGuard.editingEl.contains(ev.target))) {
            return;
          }
          return listener.call(this, ev);
        };
        wrapped.push({ original: listener, handler: handler, capture: capture });
        if (signal) {
          signal.addEventListener('abort', function(){
            removeWrappedEntry(wrapped, handler);
          });
        }
        return originalAdd(type, handler, options);
      }
      return originalAdd(type, listener, options);
    };
    target.removeEventListener = function(type, listener, options){
      if (type === 'keydown' && typeof listener === 'function') {
        var capture = captureFromOptions(options);
        for (var i = wrapped.length - 1; i >= 0; i--) {
          var entry = wrapped[i];
          if (entry.original === listener && entry.capture === capture) {
            originalRemove(type, entry.handler, options);
            wrapped.splice(i, 1);
            return;
          }
        }
      }
      return originalRemove(type, listener, options);
    };
  }
  patchTarget(document);
  patchTarget(window);
  window.addEventListener('wheel', function(ev){
    if (!document.documentElement || !document.documentElement.hasAttribute('data-od-edit-mode')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    if (typeof window.__odEditWheelBridge === 'function') window.__odEditWheelBridge(ev);
  }, { capture: true, passive: false });
})();</script>`;
}

export function buildManualEditBridge(enabled: boolean, generation = ''): string {
  return `<script data-od-edit-bridge>(function(){
  var enabled = ${JSON.stringify(enabled)};
  // This value belongs to the parsed document. It must never be replaced by
  // a later host mode message: that message may still reach the old WindowProxy
  // while a new srcdoc navigation is pending.
  var documentGeneration = ${JSON.stringify(generation)};
  function postEditMessage(message){
    var payload = documentGeneration
      ? Object.assign({}, message, { generation: documentGeneration })
      : message;
    window.parent.postMessage(payload, '*');
  }
  var discoverySelector = ${JSON.stringify(MANUAL_EDIT_DISCOVERY_SELECTOR)};
  var hostNodeSelector = ${JSON.stringify(MANUAL_EDIT_HOST_NODE_SELECTOR)};
  var sourcePathAttr = ${JSON.stringify(MANUAL_EDIT_SOURCE_PATH_ATTR)};
  var styleProps = ['fontFamily','fontSize','fontWeight','fontStyle','color','textAlign','textDecorationLine','lineHeight','letterSpacing','width','height','minHeight','gap','flexDirection','justifyContent','alignItems','backgroundColor','opacity','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius','boxShadow','transform','display'];
  function isHostNode(el){
    return !!(el && el.matches && el.matches(hostNodeSelector));
  }
  function domPath(el){
    var parts = [];
    var node = el;
    while (node && node !== document.body) {
      var parent = node.parentElement;
      if (!parent) break;
      var children = Array.prototype.slice.call(parent.children).filter(function(child){ return !isHostNode(child); });
      parts.unshift(children.indexOf(node));
      node = parent;
    }
    return parts.length ? 'path-' + parts.join('-') : '';
  }
  function stableId(el){
    var explicit = el.getAttribute('data-od-id');
    if (explicit && !el.hasAttribute('data-od-generated-id')) return explicit;
    var generated = el.getAttribute(sourcePathAttr) || el.getAttribute('data-od-runtime-id') || domPath(el);
    if (generated) el.setAttribute('data-od-runtime-id', generated);
    if (generated && /^path-\\d+(?:-\\d+)*$/.test(generated)) {
      var candidates = document.querySelectorAll('[data-od-id="' + cssEscapeId(generated) + '"]');
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] !== el && !candidates[i].hasAttribute('data-od-generated-id')) {
          var locator = 'source-path:' + generated;
          while (document.querySelector('[data-od-id="' + cssEscapeId(locator) + '"]')) {
            locator = 'source-path:' + locator;
          }
          return locator;
        }
      }
    }
    return generated || 'unknown';
  }
  function isSourceMappable(el){
    if (!el || !el.hasAttribute || isHostNode(el)) return false;
    return !!(el.hasAttribute('data-od-id') || el.hasAttribute(sourcePathAttr));
  }
  function markBrandKitTarget(el, id, kind, label){
    if (!el || !el.setAttribute || isHostNode(el)) return;
    if (!el.hasAttribute('data-od-id')) el.setAttribute('data-od-id', id);
    if (kind && !el.hasAttribute('data-od-edit')) el.setAttribute('data-od-edit', kind);
    if (label && !el.hasAttribute('data-od-label')) el.setAttribute('data-od-label', label);
  }
  function markBrandKitOne(selector, id, kind, label){
    markBrandKitTarget(document.querySelector(selector), id, kind, label);
  }
  function annotateBrandKitRuntimeTargets(){
    if (!document.getElementById('od-brand-payload')) return;
    markBrandKitOne('.kit-head', 'brand-header', 'container', 'Brand header');
    markBrandKitOne('.kit-title', 'brand-name', 'text');
    markBrandKitOne('.kit-tagline', 'brand-tagline', 'text');
    markBrandKitOne('.kit-source', 'brand-source', 'link');
    markBrandKitOne('.head-actions', 'brand-header-actions', 'container');
    markBrandKitOne('.logo-empty', 'brand-logo-empty', 'container', 'Logo empty state');
    markBrandKitOne('.logo-stage', 'brand-logo-stage', 'container', 'Logo stage');
    markBrandKitOne('#logo-img', 'brand-logo-img', 'image');
    markBrandKitOne('.logo-notes', 'brand-logo-notes', 'text');
    Array.prototype.forEach.call(document.querySelectorAll('.logo-thumb'), function(el, i){ markBrandKitTarget(el, 'brand-logo-thumb-' + i, 'image'); });
    markBrandKitOne('.fonts', 'brand-fonts', 'container');
    Array.prototype.forEach.call(document.querySelectorAll('.font-tile'), function(el, i){
      markBrandKitTarget(el, 'brand-font-tile-' + i, 'container');
      markBrandKitTarget(el.querySelector('.ag'), 'brand-font-sample-' + i, 'text');
      markBrandKitTarget(el.querySelector('.ft-name'), 'brand-font-name-' + i, 'text');
      markBrandKitTarget(el.querySelector('.ft-role'), 'brand-font-role-' + i, 'text');
    });
    markBrandKitOne('.kit-hero', 'brand-hero-image', 'container');
    markBrandKitOne('.kit-hero img', 'brand-hero-img', 'image');
    Array.prototype.forEach.call(document.querySelectorAll('.type-row'), function(el, i){
      markBrandKitTarget(el, 'brand-type-' + i, 'container');
      markBrandKitTarget(el.querySelector('.type-label'), 'brand-type-label-' + i, 'text');
      markBrandKitTarget(el.querySelector('.type-font'), 'brand-type-font-' + i, 'text');
      markBrandKitTarget(el.querySelector('.type-sample'), 'brand-type-sample-' + i, 'text');
    });
    markBrandKitOne('.palette', 'brand-palette', 'container');
    Array.prototype.forEach.call(document.querySelectorAll('.swatch'), function(el, i){
      markBrandKitTarget(el, 'brand-color-' + i, 'container');
      markBrandKitTarget(el.querySelector('.hex'), 'brand-color-hex-' + i, 'text');
      markBrandKitTarget(el.querySelector('.swatch-name'), 'brand-color-name-' + i, 'text');
      markBrandKitTarget(el.querySelector('.swatch-role'), 'brand-color-role-' + i, 'text');
      markBrandKitTarget(el.querySelector('.swatch-usage'), 'brand-color-usage-' + i, 'text');
    });
    markBrandKitOne('.voice-tone', 'brand-voice-tone', 'text');
    markBrandKitOne('.vocab .use .v', 'brand-voice-vocab-use', 'text');
    markBrandKitOne('.vocab .avoid .v', 'brand-voice-vocab-avoid', 'text');
    Array.prototype.forEach.call(document.querySelectorAll('.chips .chip'), function(el, i){ markBrandKitTarget(el, 'brand-voice-adjective-' + i, 'text'); });
    Array.prototype.forEach.call(document.querySelectorAll('.pillars li span:last-child'), function(el, i){ markBrandKitTarget(el, 'brand-voice-pillar-' + i, 'text'); });
    markBrandKitOne('.imagery', 'brand-imagery-card', 'container');
    markBrandKitOne('.imagery p:first-child', 'brand-imagery-style', 'text');
    markBrandKitOne('.gallery', 'brand-images-section', 'container');
    Array.prototype.forEach.call(document.querySelectorAll('.shot'), function(el, i){
      markBrandKitTarget(el, 'brand-image-' + i, 'container');
      markBrandKitTarget(el.querySelector('img'), 'brand-image-img-' + i, 'image');
      markBrandKitTarget(el.querySelector('.shot-cap'), 'brand-image-caption-' + i, 'text');
      markBrandKitTarget(el.querySelector('.shot-kind'), 'brand-image-kind-' + i, 'text');
    });
    markBrandKitOne('.ds-frame-wrap', 'brand-system-section', 'container');
    markBrandKitOne('.assets', 'brand-assets-section', 'container');
    Array.prototype.forEach.call(document.querySelectorAll('.asset'), function(el, i){
      markBrandKitTarget(el, 'brand-asset-' + i, 'container');
      markBrandKitTarget(el.querySelector('.asset-name'), 'brand-asset-name-' + i, 'text');
      markBrandKitTarget(el.querySelector('.asset-desc'), 'brand-asset-desc-' + i, 'text');
    });
  }
  function isDiscoveryTarget(el){
    return !!(el && el.matches && el.matches(discoverySelector));
  }
  function isTextLeaf(el){
    var text = (el.textContent || '').trim();
    if (!text) return false;
    return el.children.length === 0;
  }
  function inferKind(el){
    var explicit = el.getAttribute('data-od-edit');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'a') return 'link';
    if (tag === 'button' || el.getAttribute('role') === 'button') return 'action';
    if (tag === 'img') return 'image';
    if (isTextLeaf(el)) return 'text';
    return 'container';
  }
  function actionLabelFor(el){
    var direct = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var child = el.childNodes[i];
      if (child.nodeType === 3 && String(child.nodeValue || '').trim()) direct.push(String(child.nodeValue).trim());
    }
    return direct.length === 1 ? direct[0] : (el.textContent || '').trim();
  }
  function labelFor(el, id, kind){
    var explicit = el.getAttribute('data-od-label');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    var text = (kind === 'action' ? actionLabelFor(el) : (el.textContent || '')).replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 42);
    if (kind === 'image') return el.getAttribute('alt') || id;
    return tag + ' #' + id;
  }
  function attrsFor(el){
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (!attr || attr.name.indexOf('data-od-runtime') === 0 || attr.name === 'data-od-edit-selected') continue;
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }
  function stylesFor(el){
    var computed = window.getComputedStyle(el);
    var styles = {};
    styleProps.forEach(function(prop){ styles[prop] = el.style[prop] || computed[prop] || ''; });
    return styles;
  }
  function rectFor(el){
    if (!el || !el.getBoundingClientRect) return null;
    var rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }
  function numericStyleValue(style, name){
    var value = style ? parseFloat(style[name]) : 0;
    return Number.isFinite(value) ? value : 0;
  }
  function optionalNumericStyleValue(style, name){
    var value = style ? parseFloat(style[name]) : NaN;
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
  }
  function hasUnsupportedSizeTransform(style){
    var transform = style && style.transform ? String(style.transform) : 'none';
    if (!transform || transform === 'none') return false;
    var matrix = transform.match(/^matrix\\(\\s*([^)]*)\\)$/);
    if (!matrix) return true;
    var values = matrix[1].split(',').map(function(value){ return Number(value.trim()); });
    if (values.length !== 6 || values.some(function(value){ return !Number.isFinite(value); })) return true;
    return Math.abs(values[0] - 1) > 0.0001
      || Math.abs(values[1]) > 0.0001
      || Math.abs(values[2]) > 0.0001
      || Math.abs(values[3] - 1) > 0.0001;
  }
  function hasResizableBox(style){
    var display = style && style.display ? String(style.display) : '';
    return display !== 'none'
      && display !== 'inline'
      && display !== 'contents'
      && display !== 'table-row'
      && display !== 'table-row-group'
      && display !== 'table-header-group'
      && display !== 'table-footer-group'
      && display !== 'table-cell'
      && display !== 'table-column'
      && display !== 'table-column-group'
      && display !== 'table-caption'
      && display !== 'ruby'
      && display !== 'ruby-base'
      && display !== 'ruby-text'
      && display !== 'ruby-base-container'
      && display !== 'ruby-text-container';
  }
  function resizeContainingBlock(el, style){
    var position = style && style.position ? String(style.position) : 'static';
    if (position === 'fixed') {
      return {
        el: document.documentElement,
        width: Math.max(1, Number(document.documentElement && document.documentElement.clientWidth) || Number(window.innerWidth) || 1),
        rect: { left: 0, top: 0 },
        borderLeft: 0,
        borderTop: 0
      };
    }
    var positioned = position === 'absolute';
    var block = positioned ? (el.offsetParent || el.parentElement) : el.parentElement;
    if (!block || !block.getBoundingClientRect) block = document.documentElement;
    var blockStyle = window.getComputedStyle(block);
    var blockRect = block.getBoundingClientRect();
    var width = Number(block.clientWidth) || Number(blockRect.width) || 1;
    if (!positioned) {
      width -= numericStyleValue(blockStyle, 'paddingLeft') + numericStyleValue(blockStyle, 'paddingRight');
    }
    return {
      el: block,
      width: Math.max(1, width),
      rect: blockRect,
      borderLeft: numericStyleValue(blockStyle, 'borderLeftWidth'),
      borderTop: numericStyleValue(blockStyle, 'borderTopWidth')
    };
  }
  function sizingFor(el, kind){
    var style = window.getComputedStyle(el);
    var paddingBorderX = numericStyleValue(style, 'paddingLeft')
      + numericStyleValue(style, 'paddingRight')
      + numericStyleValue(style, 'borderLeftWidth')
      + numericStyleValue(style, 'borderRightWidth');
    var paddingBorderY = numericStyleValue(style, 'paddingTop')
      + numericStyleValue(style, 'paddingBottom')
      + numericStyleValue(style, 'borderTopWidth')
      + numericStyleValue(style, 'borderBottomWidth');
    var unsupportedTransform = hasUnsupportedSizeTransform(style);
    return {
      resizable: kind === 'container' && isSourceMappable(el) && hasResizableBox(style) && !unsupportedTransform,
      boxSizing: style.boxSizing || 'content-box',
      position: style.position || 'static',
      containingBlockWidth: Math.round(resizeContainingBlock(el, style).width * 1000) / 1000,
      paddingBorderX: Math.round(paddingBorderX * 1000) / 1000,
      paddingBorderY: Math.round(paddingBorderY * 1000) / 1000,
      minWidth: optionalNumericStyleValue(style, 'minWidth'),
      maxWidth: optionalNumericStyleValue(style, 'maxWidth'),
      minHeight: optionalNumericStyleValue(style, 'minHeight'),
      maxHeight: optionalNumericStyleValue(style, 'maxHeight'),
      hasUnsupportedTransform: unsupportedTransform
    };
  }
  function computedSummaryFor(el){
    var computed = window.getComputedStyle(el);
    return {
      display: computed.display || '',
      position: computed.position || '',
      fontFamily: computed.fontFamily || '',
      fontSize: computed.fontSize || '',
      fontWeight: computed.fontWeight || '',
      fontStyle: computed.fontStyle || '',
      lineHeight: computed.lineHeight || '',
      letterSpacing: computed.letterSpacing || '',
      color: computed.color || '',
      textAlign: computed.textAlign || '',
      textDecorationLine: computed.textDecorationLine || '',
      backgroundColor: computed.backgroundColor || '',
      borderColor: computed.borderColor || '',
      borderRadius: computed.borderRadius || '',
      borderTopWidth: computed.borderTopWidth || '',
      borderRightWidth: computed.borderRightWidth || '',
      borderBottomWidth: computed.borderBottomWidth || '',
      borderLeftWidth: computed.borderLeftWidth || '',
      borderStyle: computed.borderStyle || '',
      boxShadow: computed.boxShadow || '',
      padding: computed.padding || '',
      paddingTop: computed.paddingTop || '',
      paddingRight: computed.paddingRight || '',
      paddingBottom: computed.paddingBottom || '',
      paddingLeft: computed.paddingLeft || '',
      margin: computed.margin || '',
      marginTop: computed.marginTop || '',
      marginRight: computed.marginRight || '',
      marginBottom: computed.marginBottom || '',
      marginLeft: computed.marginLeft || '',
      opacity: computed.opacity || ''
    };
  }
  function siblingRectsFor(el){
    var parent = el && el.parentElement;
    if (!parent) return [];
    return Array.prototype.slice.call(parent.children)
      .filter(function(child){ return child !== el && !isHostNode(child); })
      .map(rectFor)
      .filter(Boolean)
      .slice(0, 24);
  }
  function alignmentGuidesFor(rect, parentRect){
    var guides = [];
    if (!rect) return guides;
    guides.push({ orientation: 'vertical', position: rect.x, label: 'left' });
    guides.push({ orientation: 'vertical', position: rect.x + Math.round(rect.width / 2), label: 'center' });
    guides.push({ orientation: 'vertical', position: rect.x + rect.width, label: 'right' });
    guides.push({ orientation: 'horizontal', position: rect.y, label: 'top' });
    guides.push({ orientation: 'horizontal', position: rect.y + Math.round(rect.height / 2), label: 'middle' });
    guides.push({ orientation: 'horizontal', position: rect.y + rect.height, label: 'bottom' });
    if (parentRect) {
      guides.push({ orientation: 'vertical', position: parentRect.x + Math.round(parentRect.width / 2), label: 'parent center' });
      guides.push({ orientation: 'horizontal', position: parentRect.y + Math.round(parentRect.height / 2), label: 'parent middle' });
    }
    return guides;
  }
  function measurementsFor(rect, parentRect, siblings){
    var measurements = [];
    if (!rect || !parentRect) return measurements;
    measurements.push({
      label: 'left',
      value: Math.max(0, Math.round(rect.x - parentRect.x)),
      orientation: 'horizontal',
      from: parentRect,
      to: rect
    });
    measurements.push({
      label: 'top',
      value: Math.max(0, Math.round(rect.y - parentRect.y)),
      orientation: 'vertical',
      from: parentRect,
      to: rect
    });
    measurements.push({
      label: 'right',
      value: Math.max(0, Math.round(parentRect.x + parentRect.width - rect.x - rect.width)),
      orientation: 'horizontal',
      from: rect,
      to: parentRect
    });
    measurements.push({
      label: 'bottom',
      value: Math.max(0, Math.round(parentRect.y + parentRect.height - rect.y - rect.height)),
      orientation: 'vertical',
      from: rect,
      to: parentRect
    });
    var nearest = (siblings || [])
      .map(function(sibling){
        var horizontalGap = sibling.x >= rect.x + rect.width
          ? sibling.x - rect.x - rect.width
          : rect.x >= sibling.x + sibling.width
            ? rect.x - sibling.x - sibling.width
            : null;
        var verticalGap = sibling.y >= rect.y + rect.height
          ? sibling.y - rect.y - rect.height
          : rect.y >= sibling.y + sibling.height
            ? rect.y - sibling.y - sibling.height
            : null;
        var gap = horizontalGap !== null ? horizontalGap : verticalGap;
        return gap === null ? null : { sibling: sibling, gap: Math.round(gap), orientation: horizontalGap !== null ? 'horizontal' : 'vertical' };
      })
      .filter(Boolean)
      .sort(function(a, b){ return a.gap - b.gap; })[0];
    if (nearest) {
      measurements.push({
        label: 'nearest',
        value: Math.max(0, nearest.gap),
        orientation: nearest.orientation,
        from: rect,
        to: nearest.sibling
      });
    }
    return measurements;
  }
  function isLayoutContainer(el){
    var display = window.getComputedStyle(el).display || '';
    if (display.indexOf('flex') >= 0 || display.indexOf('grid') >= 0) return true;
    return hasOwnDisplayHiddenState(el) && inferKind(el) === 'container';
  }
  function hasOwnDisplayHiddenState(el){
    var computed = window.getComputedStyle(el);
    return computed.display === 'none' || el.hasAttribute('hidden');
  }
  function hasHiddenAncestorDisplayState(el){
    var node = el;
    while (node && node !== document.documentElement) {
      if (hasOwnDisplayHiddenState(node)) return true;
      node = node.parentElement;
    }
    return false;
  }
  function isHiddenTarget(el, rect){
    var targetVisibility = window.getComputedStyle(el).visibility;
    if (targetVisibility === 'hidden' || targetVisibility === 'collapse') return true;
    return hasHiddenAncestorDisplayState(el);
  }
  function sourceShapedOuterHtml(el){
    var clone = el.cloneNode(true);
    var nodes = [clone];
    if (clone.querySelectorAll) {
      var descendants = clone.querySelectorAll('*');
      for (var i = 0; i < descendants.length; i++) nodes.push(descendants[i]);
    }
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      // Only ids carrying our explicit marker are preview annotations. An
      // author is allowed to use a path-shaped data-od-id of their own.
      if (node.hasAttribute('data-od-generated-id')) node.removeAttribute('data-od-id');
      node.removeAttribute('data-od-runtime-id');
      node.removeAttribute('data-od-source-path');
      node.removeAttribute('data-od-generated-id');
      node.removeAttribute('data-od-edit-selected');
    }
    return clone.outerHTML || '';
  }
  function targetFrom(el, includeOuterHtml){
    var rect = el.getBoundingClientRect();
    var ownRect = rectFor(el);
    var parentRect = rectFor(el.parentElement);
    var siblingRects = siblingRectsFor(el);
    var kind = inferKind(el);
    var id = stableId(el);
    var hidden = isHiddenTarget(el, rect);
    var fields = {};
    if (kind === 'link') {
      fields.text = (el.textContent || '').trim();
      fields.href = el.getAttribute('href') || '';
    } else if (kind === 'action') {
      fields.text = actionLabelFor(el);
      fields.href = el.getAttribute('data-od-href') || '';
      fields.target = el.getAttribute('data-od-target') === '_blank' ? '_blank' : '_self';
    } else if (kind === 'image') {
      fields.src = el.getAttribute('src') || '';
      fields.alt = el.getAttribute('alt') || '';
    } else {
      fields.text = (el.textContent || '').trim();
    }
    return {
      id: id,
      kind: kind,
      label: labelFor(el, id, kind),
      tagName: el.tagName ? el.tagName.toLowerCase() : 'element',
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      fields: fields,
      attributes: attrsFor(el),
      styles: stylesFor(el),
      computedSummary: computedSummaryFor(el),
      parentRect: parentRect,
      siblingRects: siblingRects,
      measurements: measurementsFor(ownRect, parentRect, siblingRects),
      alignmentGuides: alignmentGuidesFor(ownRect, parentRect),
      isLayoutContainer: isLayoutContainer(el),
      sizing: sizingFor(el, kind),
      isHidden: hidden,
      outerHtml: includeOuterHtml ? sourceShapedOuterHtml(el) : ''
    };
  }
  function allTargets(){
    annotateBrandKitRuntimeTargets();
    var nodes = document.body ? document.body.querySelectorAll(discoverySelector) : [];
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (!isSourceMappable(nodes[i])) continue;
      if (!isHiddenTarget(nodes[i], rect) && (rect.width < 4 || rect.height < 4)) continue;
      targets.push(targetFrom(nodes[i], false));
    }
    return targets;
  }
  function postTargets(){
    if (!enabled) return;
    postEditMessage({ type: 'od-edit-targets', targets: allTargets() });
  }
  var viewportUnitRestores = [];
  function frozenViewportValue(value, viewportWidth, viewportHeight){
    if (!value || !/(?:dvh|svh|lvh|vh|dvw|svw|lvw|vw|vmin|vmax)\\b/i.test(value)) return value;
    return String(value).replace(/(-?(?:\\d+\\.?\\d*|\\.\\d+))(dvh|svh|lvh|vh|dvw|svw|lvw|vw|vmin|vmax)\\b/gi, function(_, amount, unit){
      var number = Number(amount);
      var normalized = String(unit).toLowerCase();
      var basis = normalized.indexOf('vh') >= 0
        ? viewportHeight
        : normalized.indexOf('vw') >= 0
          ? viewportWidth
          : normalized === 'vmin'
            ? Math.min(viewportWidth, viewportHeight)
            : Math.max(viewportWidth, viewportHeight);
      return ((number * basis) / 100) + 'px';
    });
  }
  function freezeStyleViewportUnits(style, viewportWidth, viewportHeight){
    if (!style) return;
    var names = [];
    for (var i = 0; i < style.length; i++) names.push(style[i]);
    for (var j = 0; j < names.length; j++) {
      var name = names[j];
      var value = style.getPropertyValue(name);
      var frozen = frozenViewportValue(value, viewportWidth, viewportHeight);
      if (frozen === value) continue;
      var priority = style.getPropertyPriority(name);
      viewportUnitRestores.push({ style: style, name: name, value: value, priority: priority });
      try { style.setProperty(name, frozen, priority); } catch (_) {}
    }
  }
  function freezeRuleViewportUnits(rules, viewportWidth, viewportHeight){
    if (!rules) return;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule && rule.style) freezeStyleViewportUnits(rule.style, viewportWidth, viewportHeight);
      try {
        if (rule && rule.cssRules) freezeRuleViewportUnits(rule.cssRules, viewportWidth, viewportHeight);
      } catch (_) {}
    }
  }
  function restoreViewportUnits(){
    for (var i = viewportUnitRestores.length - 1; i >= 0; i--) {
      var restore = viewportUnitRestores[i];
      try { restore.style.setProperty(restore.name, restore.value, restore.priority); } catch (_) {}
    }
    viewportUnitRestores = [];
  }
  var editViewportWidth = 0;
  var editViewportHeight = 0;
  function freezeViewportUnits(requestedWidth, requestedHeight){
    restoreViewportUnits();
    var viewportWidth = Math.max(1, Number(requestedWidth) || editViewportWidth || Number(window.innerWidth) || 1);
    var viewportHeight = Math.max(1, Number(requestedHeight) || editViewportHeight || Number(window.innerHeight) || 1);
    editViewportWidth = viewportWidth;
    editViewportHeight = viewportHeight;
    for (var i = 0; i < document.styleSheets.length; i++) {
      try { freezeRuleViewportUnits(document.styleSheets[i].cssRules, viewportWidth, viewportHeight); } catch (_) {}
    }
    var inline = document.querySelectorAll('[style]');
    for (var j = 0; j < inline.length; j++) freezeStyleViewportUnits(inline[j].style, viewportWidth, viewportHeight);
  }
  var documentSizePending = false;
  var lastDocumentWidth = -1;
  var lastDocumentHeight = -1;
  function naturalDocumentSize(){
    var root = document.documentElement;
    var body = document.body;
    if (!root || !body) return null;
    var width = Math.max(Number(root.scrollWidth) || 0, Number(body.scrollWidth) || 0, Number(root.clientWidth) || 0);
    var viewportFloor = Math.max(Number(root.clientHeight) || 0, Number(window.innerHeight) || 0);
    var scrollHeight = Math.max(Number(root.scrollHeight) || 0, Number(body.scrollHeight) || 0);
    var contentBottom = 0;
    var nodes = body.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var ancestor = node;
      var fixed = false;
      while (ancestor && ancestor !== body) {
        try {
          if (window.getComputedStyle(ancestor).position === 'fixed') { fixed = true; break; }
        } catch (_) {}
        ancestor = ancestor.parentElement;
      }
      if (fixed || node.closest('[data-od-edit-guides-layer]')) continue;
      var rect = node.getBoundingClientRect();
      if (!Number.isFinite(rect.bottom) || (rect.width <= 0 && rect.height <= 0)) continue;
      contentBottom = Math.max(contentBottom, rect.bottom + (Number(window.scrollY) || 0));
    }
    var descendantBottom = contentBottom;
    var bodyIntrinsicBottom = 0;
    var bodyRect = body.getBoundingClientRect();
    var bodyHeight = Number(body.offsetHeight) || 0;
    if (bodyHeight > 0 && bodyHeight < viewportFloor - 1) {
      bodyIntrinsicBottom = bodyRect.top + (Number(window.scrollY) || 0) + bodyHeight;
    }
    var tailInset = 0;
    try {
      var bodyStyle = window.getComputedStyle(body);
      tailInset = (parseFloat(bodyStyle.paddingBottom) || 0)
        + (parseFloat(bodyStyle.borderBottomWidth) || 0)
        + (parseFloat(bodyStyle.marginBottom) || 0);
    } catch (_) {}
    contentBottom = Math.max(descendantBottom + tailInset, bodyIntrinsicBottom);
    // scrollHeight is authoritative while content really overflows the compact
    // iframe. Once the host expands the iframe it becomes a viewport floor and
    // can no longer shrink on its own, so fall back to the last visible content
    // edge. This breaks the height feedback loop without clipping long pages.
    var height = scrollHeight > viewportFloor + 1
      ? scrollHeight
      : Math.max(contentBottom, editViewportHeight, 1);
    return { width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) };
  }
  function postDocumentSize(){
    if (!enabled) return;
    var size = naturalDocumentSize();
    if (!size || (size.width === lastDocumentWidth && size.height === lastDocumentHeight)) return;
    lastDocumentWidth = size.width;
    lastDocumentHeight = size.height;
    postEditMessage({ type: 'od-edit-document-size', width: size.width, height: size.height });
  }
  function scheduleDocumentSize(){
    if (!enabled || documentSizePending) return;
    documentSizePending = true;
    var schedule = window.requestAnimationFrame || function(cb){ return setTimeout(cb, 16); };
    schedule(function(){ documentSizePending = false; postDocumentSize(); });
  }
  function resetDocumentScroll(){
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }
  var lastHoverId = null;
  var lastHoverEl = null;
  // Hover-guides memory: which element's guides were rendered last and when
  // the hover was cleared. Survives od-edit-hover-reset so the host can ask
  // for the guides back (od-edit-guides-restore) right before a capture —
  // reaching a toolbar button always clears the live hover first.
  var guidesMemoryEl = null;
  var guidesMemoryId = null;
  var guidesMemoryClearedAt = 0;
  var guidesEnabled = true;
  var selectedTargetId = null;
  // Structure-aware drag state. The element never leaves normal HTML flow
  // while the pointer is moving. Instead we resolve a compatible parent plus
  // an insertion sibling and draw that slot. The host persists a DOM reorder
  // on drop, so dragging cannot create arbitrary left/top/translate offsets.
  var DRAG_THRESHOLD = 4;
  var dragPending = null;
  var dragCommitSequence = 0;
  var pendingStructuralMove = null;
  var justDragged = false;
  // Corner resize stays inside the iframe so pointer deltas, DOMRect geometry,
  // and the selection chrome all share the same logical CSS-pixel space. The
  // host scales/pans the entire iframe as one artboard, so dividing by host zoom
  // here would apply the scale twice.
  var RESIZE_MIN_BORDER_BOX = 16;
  var resizePending = null;
  var resizeCommitSequence = 0;
  var pendingResizeCommit = null;
  var resizeAnimationFrame = null;
  var justResized = false;
  var editViewport = 'desktop';
  // Accepted rules must remain in the retained iframe until that document is
  // rebuilt from the newly saved source. Keying by target + viewport lets a
  // second resize coexist with the first and lets viewport switches reactivate
  // the matching responsive preview without touching iframe identity.
  var responsiveSizePreviewRules = Object.create(null);
  var responsiveSizePreviewStyle = null;
  var dropVoidTags = { area:1, base:1, br:1, col:1, embed:1, hr:1, img:1, input:1, link:1, meta:1, param:1, source:1, track:1, wbr:1 };
  var dropRequiredParents = {
    li: ['ul','ol','menu'], dt: ['dl','div'], dd: ['dl','div'],
    tr: ['table','thead','tbody','tfoot'], td: ['tr'], th: ['tr'],
    caption: ['table'], colgroup: ['table'], thead: ['table'], tbody: ['table'], tfoot: ['table'],
    option: ['select','optgroup','datalist'], optgroup: ['select']
  };
  var dropRestrictedChildren = {
    ul: ['li'], ol: ['li'], menu: ['li'], dl: ['dt','dd','div'],
    table: ['caption','colgroup','thead','tbody','tfoot','tr'],
    thead: ['tr'], tbody: ['tr'], tfoot: ['tr'], tr: ['td','th'],
    select: ['option','optgroup'], optgroup: ['option']
  };
  var dropPhrasingParents = {
    p:1, h1:1, h2:1, h3:1, h4:1, h5:1, h6:1, span:1, strong:1, em:1,
    b:1, i:1, small:1, mark:1, code:1, pre:1, label:1, legend:1, summary:1,
    a:1, button:1, abbr:1, cite:1, dfn:1, kbd:1, q:1, s:1, samp:1,
    sub:1, sup:1, time:1, u:1, var:1
  };
  var dropPhrasingChildren = {
    a:1, abbr:1, b:1, br:1, button:1, cite:1, code:1, dfn:1, em:1, i:1,
    img:1, kbd:1, label:1, mark:1, q:1, s:1, samp:1, small:1, span:1,
    strong:1, sub:1, sup:1, time:1, u:1, var:1, wbr:1
  };
  var reparentedTextStyleResets = {
    position:'static', inset:'auto', top:'auto', right:'auto', bottom:'auto', left:'auto',
    transform:'none', translate:'none', width:'auto', height:'auto', minWidth:'0', minHeight:'0',
    maxWidth:'100%', maxHeight:'none', margin:'0', padding:'0', gridArea:'auto',
    gridColumn:'auto', gridRow:'auto', flex:'0 1 auto', flexBasis:'auto', alignSelf:'auto',
    justifySelf:'auto', whiteSpace:'normal', wordSpacing:'normal', textIndent:'0',
    overflowWrap:'anywhere'
  };
  var whitespacePreservingTextTags = { pre:1, code:1, textarea:1 };
  var dropBoxTags = {
    main:1, nav:1, section:1, article:1, aside:1, header:1, footer:1, div:1,
    form:1, fieldset:1, details:1, dialog:1, address:1, blockquote:1, figure:1,
    figcaption:1, ul:1, ol:1, menu:1, li:1, dl:1, dt:1, dd:1, table:1,
    thead:1, tbody:1, tfoot:1, tr:1, td:1, th:1
  };
  function includesTag(list, tag){ return !list || list.indexOf(tag) >= 0; }
  function isVisualDropBox(el){
    if (!el) return false;
    if (inferKind(el) === 'container') return true;
    // A populated text leaf is an insertion sibling, not a box to nest into.
    // Empty visual elements remain valid drop containers.
    if (String(el.textContent || '').trim()) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (dropBoxTags[tag]) return true;
    var display = window.getComputedStyle ? String(window.getComputedStyle(el).display || '') : '';
    return display === 'inline-block' || display === 'flex'
      || display === 'inline-flex' || display === 'grid' || display === 'inline-grid'
      || display === 'list-item' || display === 'table-cell';
  }
  function canAcceptDrop(parent, child){
    if (!parent || !child || parent === child || child.contains(parent)) return false;
    if (parent !== document.body && !isSourceMappable(parent)) return false;
    if (parent.namespaceURI && parent.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
    var parentTag = (parent.tagName || '').toLowerCase();
    var childTag = (child.tagName || '').toLowerCase();
    if (!parentTag || parentTag === 'html' || dropVoidTags[parentTag]) return false;
    if (!includesTag(dropRequiredParents[childTag], parentTag)) return false;
    if (!includesTag(dropRestrictedChildren[parentTag], childTag)) return false;
    if (dropPhrasingParents[parentTag] && !dropPhrasingChildren[childTag]) return false;
    return parent === document.body || isVisualDropBox(parent);
  }
  function shouldNormalizeReparentedText(el, parent){
    return !!(el && parent && el.parentElement !== parent && inferKind(el) === 'text');
  }
  function normalizeReparentedText(el, parent){
    if (!shouldNormalizeReparentedText(el, parent)) return;
    Object.keys(reparentedTextStyleResets).forEach(function(prop){
      el.style.setProperty(camelToKebab(prop), reparentedTextStyleResets[prop]);
    });
    var tag = (el.tagName || '').toLowerCase();
    if (!whitespacePreservingTextTags[tag] && el.children.length === 0) {
      el.textContent = String(el.textContent || '').replace(/\\s+/g, ' ').trim();
    }
  }
  function promoteGeneratedSourceId(el, id){
    if (!el || !id || id === '__body__' || id.indexOf('source-path:') === 0 || /^path-\\d+(?:-\\d+)*$/.test(id)) return;
    if (!el.hasAttribute('data-od-id')) el.setAttribute('data-od-id', id);
    el.removeAttribute('data-od-runtime-id');
  }
  function dropId(el){ return el === document.body ? '__body__' : stableId(el); }
  function dropChildren(parent, dragged){
    return Array.prototype.slice.call(parent.children).filter(function(child){
      return child !== dragged && !isHostNode(child) && isSourceMappable(child);
    });
  }
  function dropAxis(parent, nearestRect, clientY){
    var computed = window.getComputedStyle(parent);
    var display = computed.display || '';
    var direction = computed.flexDirection || '';
    if (display.indexOf('flex') >= 0) return direction.indexOf('row') === 0 ? 'horizontal' : 'vertical';
    if (display.indexOf('grid') >= 0 && nearestRect) {
      return Math.abs(clientY - (nearestRect.y + nearestRect.height / 2)) < nearestRect.height * 0.42
        ? 'horizontal'
        : 'vertical';
    }
    return 'vertical';
  }
  // A side drop wraps the anchor and the dragged element into a generated
  // horizontal <div> group, so both elements must be legal flow children of a
  // div and the parent must be allowed to hold one. Lists, tables, selects,
  // and phrasing-only containers therefore never offer left/right slots.
  function canGroupSideBySide(parent, anchor, dragged){
    if (!parent || !anchor || !dragged || anchor === dragged) return false;
    if (dragged === parent || dragged.contains(parent)) return false;
    var parentTag = parent === document.body ? 'body' : (parent.tagName || '').toLowerCase();
    if (!parentTag || dropVoidTags[parentTag] || dropPhrasingParents[parentTag]) return false;
    if (!includesTag(dropRestrictedChildren[parentTag], 'div')) return false;
    if (!includesTag(dropRequiredParents['div'], parentTag)) return false;
    var anchorTag = (anchor.tagName || '').toLowerCase();
    var draggedTag = (dragged.tagName || '').toLowerCase();
    if (!includesTag(dropRequiredParents[anchorTag], 'div')) return false;
    if (!includesTag(dropRequiredParents[draggedTag], 'div')) return false;
    return true;
  }
  // Pointer inside the anchor's row and within its outer horizontal third
  // targets that side; the middle third keeps ordinary vertical insertion.
  function sidePlacementFor(rect, clientX, clientY){
    if (clientY < rect.y || clientY > rect.y + rect.height) return null;
    if (clientX <= rect.x + rect.width / 3) return 'left';
    if (clientX >= rect.x + rect.width * 2 / 3) return 'right';
    return null;
  }
  function slotForParent(parent, dragged, clientX, clientY){
    var children = dropChildren(parent, dragged);
    if (!children.length) return { parent: parent, before: null, axis: 'vertical', children: children };
    var nearest = children.map(function(child){
      var rect = child.getBoundingClientRect();
      var cx = rect.x + rect.width / 2;
      var cy = rect.y + rect.height / 2;
      return { child: child, rect: rect, distance: Math.pow(clientX - cx, 2) + Math.pow(clientY - cy, 2) };
    }).sort(function(a, b){ return a.distance - b.distance; })[0];
    var axis = dropAxis(parent, nearest.rect, clientY);
    if (axis === 'vertical') {
      // Existing horizontal flex/grid containers reorder through the normal
      // horizontal-axis path above; only vertical containers grow a group.
      var placement = sidePlacementFor(nearest.rect, clientX, clientY);
      if (placement && canGroupSideBySide(parent, nearest.child, dragged)) {
        return {
          parent: parent, before: null, axis: axis, children: children,
          placement: placement, anchor: nearest.child
        };
      }
    }
    var beforeNearest = axis === 'horizontal'
      ? clientX < nearest.rect.x + nearest.rect.width / 2
      : clientY < nearest.rect.y + nearest.rect.height / 2;
    var nearestIndex = children.indexOf(nearest.child);
    var before = beforeNearest ? nearest.child : (children[nearestIndex + 1] || null);
    return { parent: parent, before: before, axis: axis, children: children };
  }
  function elementDepth(el){
    var depth = 0;
    while (el && el !== document.body) { depth += 1; el = el.parentElement; }
    return depth;
  }
  function findDropSlot(clientX, clientY, dragged, eventTarget){
    var stack = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [eventTarget];
    var candidates = [];
    var seen = [];
    for (var i = 0; i < stack.length; i++) {
      var node = stack[i] && stack[i].nodeType === 1 ? stack[i] : null;
      while (node && node !== document.documentElement) {
        if (node !== dragged && !dragged.contains(node) && canAcceptDrop(node, dragged) && seen.indexOf(node) < 0) {
          seen.push(node);
          var direct = dropChildren(node, dragged);
          var sameTag = direct.some(function(child){ return child.tagName === dragged.tagName; });
          var computed = window.getComputedStyle(node);
          var layout = (computed.display || '').indexOf('flex') >= 0 || (computed.display || '').indexOf('grid') >= 0;
          candidates.push({
            parent: node,
            // Prefer the deepest compatible box under the pointer. The former
            // current-parent bonus dominated nested targets, so dropping onto
            // a card inside the same page silently snapped back to the page.
            score: elementDepth(node) * 1000 + (layout ? 100 : 0) + (sameTag ? 20 : 0)
              + (node === dragged.parentElement ? 10 : 0)
          });
        }
        node = node.parentElement;
      }
    }
    candidates.sort(function(a, b){ return b.score - a.score; });
    return candidates.length ? slotForParent(candidates[0].parent, dragged, clientX, clientY) : null;
  }
  function isNoopDrop(slot, dragged){
    if (!slot) return false;
    // A side drop always restructures the document (it creates a group), so it
    // is never a same-position noop.
    if (slot.placement) return false;
    if (slot.parent !== dragged.parentElement) return false;
    var originalChildren = Array.prototype.slice.call(slot.parent.children).filter(function(child){
      return !isHostNode(child) && isSourceMappable(child);
    });
    var currentIndex = originalChildren.indexOf(dragged);
    var currentNext = currentIndex >= 0 ? (originalChildren[currentIndex + 1] || null) : null;
    return slot.before === currentNext;
  }
  function renderDropSlot(slot, dragged){
    var layer = ensureGuidesLayer();
    layer.replaceChildren();
    renderSelectedChrome(layer, targetFrom(dragged, false));
    if (!slot) return;
    var parentRect = slot.parent.getBoundingClientRect();
    renderBox(layer, { rect: { x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height } }, 'drop');
    if (slot.placement && slot.anchor) {
      // Side drops pair with one anchor row: the insertion line is vertical and
      // spans that anchor, not the whole parent.
      var anchorRect = slot.anchor.getBoundingClientRect();
      var lineX = slot.placement === 'left' ? anchorRect.x : anchorRect.x + anchorRect.width;
      addGuideNode(layer, 'od-edit-guide-drop-line od-edit-guide-drop-line-v', {
        left: Math.round(lineX) + 'px',
        top: Math.round(anchorRect.y + 2) + 'px',
        height: Math.max(12, Math.round(anchorRect.height - 4)) + 'px'
      });
      return;
    }
    var beforeRect = slot.before ? slot.before.getBoundingClientRect() : null;
    var lastRect = !slot.before && slot.children.length
      ? slot.children[slot.children.length - 1].getBoundingClientRect()
      : null;
    if (slot.axis === 'horizontal') {
      var x = beforeRect ? beforeRect.x : (lastRect ? lastRect.x + lastRect.width : parentRect.x + 8);
      addGuideNode(layer, 'od-edit-guide-drop-line od-edit-guide-drop-line-v', {
        left: Math.round(x) + 'px', top: Math.round(parentRect.y + 6) + 'px', height: Math.max(12, Math.round(parentRect.height - 12)) + 'px'
      });
    } else {
      var y = beforeRect ? beforeRect.y : (lastRect ? lastRect.y + lastRect.height : parentRect.y + 8);
      addGuideNode(layer, 'od-edit-guide-drop-line od-edit-guide-drop-line-h', {
        left: Math.round(parentRect.x + 6) + 'px', top: Math.round(y) + 'px', width: Math.max(12, Math.round(parentRect.width - 12)) + 'px'
      });
    }
  }
  function cancelPendingDrag(){
    if (!dragPending) return;
    dragPending.el.removeAttribute('data-od-edit-dragging');
    dragPending = null;
    renderSelectedChromeForCurrent();
  }
  function clearHoverTracking(){
    if (lastHoverEl) guidesMemoryClearedAt = Date.now();
    lastHoverId = null;
    lastHoverEl = null;
  }
  function ensureGuidesLayer(){
    var layer = document.querySelector('[data-od-edit-guides-layer]');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.setAttribute('data-od-edit-guides-layer', 'true');
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  }
  function clearGuidesLayer(){
    var layer = document.querySelector('[data-od-edit-guides-layer]');
    if (layer) layer.replaceChildren();
  }
  function addGuideNode(layer, className, style, text){
    var node = document.createElement('div');
    node.className = className;
    Object.keys(style || {}).forEach(function(key){ node.style[key] = style[key]; });
    if (text) node.textContent = text;
    layer.appendChild(node);
    return node;
  }
  function normalizeEditViewport(value){
    return value === 'mobile' || value === 'tablet' ? value : 'desktop';
  }
  function roundedResizePercent(value){
    return Math.round(Number(value || 0) * 100) / 100;
  }
  function roundedResizePixels(value){
    return Math.round(Number(value || 0));
  }
  function clampedResizePercent(value, min, max){
    return Math.max(min, Math.min(max, roundedResizePercent(value)));
  }
  function resizeRuleKey(viewport, id){
    return viewport + '::' + id;
  }
  function responsiveSizeSelectors(viewport, id){
    var gate = 'html[data-od-edit-viewport=' + JSON.stringify(normalizeEditViewport(viewport)) + '] ';
    var value = JSON.stringify(String(id || ''));
    return [
      gate + '[data-od-id=' + value + ']',
      gate + '[data-od-runtime-id=' + value + ']',
      gate + '[' + sourcePathAttr + '=' + value + ']'
    ];
  }
  function responsiveSizeRuleCss(rule){
    var size = rule && rule.size ? rule.size : {};
    var declarations = [];
    if (Number.isFinite(size.widthPercent)) {
      declarations.push('width:' + roundedResizePercent(size.widthPercent) + '% !important');
    }
    if (Number.isFinite(size.minHeight)) {
      declarations.push('min-height:' + roundedResizePixels(size.minHeight) + 'px !important');
    }
    if (Number.isFinite(size.leftPercent)) {
      declarations.push('left:' + roundedResizePercent(size.leftPercent) + '% !important');
      declarations.push('right:auto !important');
    }
    if (Number.isFinite(size.topPx)) {
      declarations.push('top:' + roundedResizePixels(size.topPx) + 'px !important');
      declarations.push('bottom:auto !important');
    }
    if (!declarations.length) return '';
    return responsiveSizeSelectors(rule.viewport, rule.id).join(',') + '{' + declarations.join(';') + ';}';
  }
  function renderResponsiveSizePreviewRules(){
    var keys = Object.keys(responsiveSizePreviewRules).sort();
    if (!keys.length) {
      if (responsiveSizePreviewStyle && responsiveSizePreviewStyle.parentNode) {
        responsiveSizePreviewStyle.parentNode.removeChild(responsiveSizePreviewStyle);
      }
      responsiveSizePreviewStyle = null;
      return;
    }
    if (!responsiveSizePreviewStyle || !responsiveSizePreviewStyle.isConnected) {
      responsiveSizePreviewStyle = document.createElement('style');
      responsiveSizePreviewStyle.setAttribute('data-od-responsive-size-preview', 'true');
      (document.head || document.documentElement).appendChild(responsiveSizePreviewStyle);
    }
    responsiveSizePreviewStyle.textContent = keys.map(function(key){
      return responsiveSizeRuleCss(responsiveSizePreviewRules[key]);
    }).filter(Boolean).join('\\n');
  }
  function setResponsiveSizePreviewRule(key, rule){
    if (rule) responsiveSizePreviewRules[key] = rule;
    else delete responsiveSizePreviewRules[key];
    renderResponsiveSizePreviewRules();
  }
  function restoreResizePreviewSnapshot(state){
    if (!state) return;
    setResponsiveSizePreviewRule(
      state.ruleKey,
      state.hadPreviousRule ? state.previousRule : null
    );
  }
  function positionedResizeOrigin(el, style, block, rect){
    var position = style.position || 'static';
    var left = parseFloat(style.left);
    var top = parseFloat(style.top);
    if (!Number.isFinite(left)) {
      if (position === 'relative' || position === 'sticky') {
        left = 0;
      } else {
        left = rect.left
          - Number(block.rect && block.rect.left || 0)
          - Number(block.borderLeft || 0)
          - numericStyleValue(style, 'marginLeft')
          + (position === 'fixed' ? 0 : Number(block.el && block.el.scrollLeft || 0));
      }
    }
    if (!Number.isFinite(top)) {
      if (position === 'relative' || position === 'sticky') {
        top = 0;
      } else {
        top = rect.top
          - Number(block.rect && block.rect.top || 0)
          - Number(block.borderTop || 0)
          - numericStyleValue(style, 'marginTop')
          + (position === 'fixed' ? 0 : Number(block.el && block.el.scrollTop || 0));
      }
    }
    return { left: left, top: top };
  }
  function startResizeGesture(ev, handle){
    if (!enabled || resizePending || pendingResizeCommit || pendingStructuralMove) return false;
    if (ev.button !== undefined && ev.button !== 0) return false;
    var direction = handle && handle.getAttribute ? handle.getAttribute('data-od-edit-resize-handle') : '';
    if (direction !== 'nw' && direction !== 'ne' && direction !== 'sw' && direction !== 'se') return false;
    var el = selectedTargetId ? findById(selectedTargetId) : null;
    if (!el || !el.isConnected || inferKind(el) !== 'container' || !isSourceMappable(el)) return false;
    var style = window.getComputedStyle(el);
    if (!hasResizableBox(style) || hasUnsupportedSizeTransform(style)) return false;
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    var block = resizeContainingBlock(el, style);
    var paddingBorderX = numericStyleValue(style, 'paddingLeft')
      + numericStyleValue(style, 'paddingRight')
      + numericStyleValue(style, 'borderLeftWidth')
      + numericStyleValue(style, 'borderRightWidth');
    var paddingBorderY = numericStyleValue(style, 'paddingTop')
      + numericStyleValue(style, 'paddingBottom')
      + numericStyleValue(style, 'borderTopWidth')
      + numericStyleValue(style, 'borderBottomWidth');
    var positioned = style.position === 'absolute' || style.position === 'fixed';
    var origin = positionedResizeOrigin(el, style, block, rect);
    var id = stableId(el);
    var ruleKey = resizeRuleKey(editViewport, id);
    var hadPreviousRule = Object.prototype.hasOwnProperty.call(responsiveSizePreviewRules, ruleKey);
    resizePending = {
      el: el,
      id: id,
      direction: direction,
      pointerId: ev.pointerId,
      startX: Number(ev.clientX) || 0,
      startY: Number(ev.clientY) || 0,
      clientX: Number(ev.clientX) || 0,
      clientY: Number(ev.clientY) || 0,
      shiftKey: !!ev.shiftKey,
      startRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      },
      boxSizing: style.boxSizing || 'content-box',
      paddingBorderX: paddingBorderX,
      paddingBorderY: paddingBorderY,
      block: block,
      positioned: positioned,
      origin: origin,
      viewport: editViewport,
      ruleKey: ruleKey,
      hadPreviousRule: hadPreviousRule,
      previousRule: hadPreviousRule ? responsiveSizePreviewRules[ruleKey] : null,
      latestSize: null,
      changed: false
    };
    el.setAttribute('data-od-edit-resizing', direction);
    dragPending = null;
    if (ev.pointerId !== undefined && el.setPointerCapture) {
      try { el.setPointerCapture(ev.pointerId); } catch (_) {}
    }
    ev.preventDefault();
    ev.stopPropagation();
    return true;
  }
  function resizeIntentForState(state){
    var start = state.startRect;
    var west = state.direction.charAt(1) === 'w';
    var north = state.direction.charAt(0) === 'n';
    var width = west ? start.right - state.clientX : state.clientX - start.x;
    var height = north ? start.bottom - state.clientY : state.clientY - start.y;
    width = Math.max(RESIZE_MIN_BORDER_BOX, width);
    height = Math.max(RESIZE_MIN_BORDER_BOX, height);
    if (state.shiftKey && start.width > 0 && start.height > 0) {
      var widthScale = width / start.width;
      var heightScale = height / start.height;
      var scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
      scale = Math.max(
        RESIZE_MIN_BORDER_BOX / start.width,
        RESIZE_MIN_BORDER_BOX / start.height,
        scale
      );
      width = start.width * scale;
      height = start.height * scale;
    }
    var x = west ? start.right - width : start.x;
    var y = north ? start.bottom - height : start.y;
    return { x: x, y: y, width: width, height: height };
  }
  function responsiveSizeForIntent(state, intent){
    var contentBox = state.boxSizing !== 'border-box';
    var cssWidth = Math.max(0, intent.width - (contentBox ? state.paddingBorderX : 0));
    var cssMinHeight = Math.max(0, intent.height - (contentBox ? state.paddingBorderY : 0));
    var size = {
      widthPercent: clampedResizePercent((cssWidth / Math.max(1, state.block.width)) * 100, 0, 10000),
      minHeight: Math.max(0, roundedResizePixels(cssMinHeight))
    };
    if (state.positioned) {
      size.leftPercent = clampedResizePercent((
        (state.origin.left + intent.x - state.startRect.x) / Math.max(1, state.block.width)
      ) * 100, -10000, 10000);
      size.topPx = Math.max(
        -250000,
        Math.min(250000, roundedResizePixels(state.origin.top + intent.y - state.startRect.y))
      );
    }
    return size;
  }
  function flushResizeFrame(){
    resizeAnimationFrame = null;
    var state = resizePending;
    if (!state || !state.el || !state.el.isConnected) return;
    var intent = resizeIntentForState(state);
    var size = responsiveSizeForIntent(state, intent);
    state.changed = state.changed
      || Math.abs(intent.width - state.startRect.width) > 0.1
      || Math.abs(intent.height - state.startRect.height) > 0.1;
    state.latestSize = size;
    setResponsiveSizePreviewRule(state.ruleKey, {
      id: state.id,
      viewport: state.viewport,
      size: size
    });
    // CSS constraints and layout containers may not honor the intent exactly.
    // Always redraw from the browser's rendered truth rather than the pointer
    // math, so the frame never drifts away from the selected element.
    renderSelectedChromeForCurrent();
    scheduleDocumentSize();
  }
  function scheduleResizeFrame(ev){
    if (!resizePending) return;
    resizePending.clientX = Number(ev.clientX) || 0;
    resizePending.clientY = Number(ev.clientY) || 0;
    resizePending.shiftKey = !!ev.shiftKey;
    if (resizeAnimationFrame !== null) return;
    var schedule = window.requestAnimationFrame || function(cb){ return setTimeout(cb, 16); };
    resizeAnimationFrame = schedule(flushResizeFrame);
  }
  function cancelResizeFrame(){
    if (resizeAnimationFrame === null) return;
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(resizeAnimationFrame);
    else clearTimeout(resizeAnimationFrame);
    resizeAnimationFrame = null;
  }
  function releaseResizeCapture(state){
    if (!state || state.pointerId === undefined || !state.el || !state.el.releasePointerCapture) return;
    try {
      if (!state.el.hasPointerCapture || state.el.hasPointerCapture(state.pointerId)) {
        state.el.releasePointerCapture(state.pointerId);
      }
    } catch (_) {}
  }
  function finishResizeGesture(ev, cancelled){
    var state = resizePending;
    if (!state) return false;
    if (ev && ev.pointerId !== undefined && state.pointerId !== undefined && ev.pointerId !== state.pointerId) return false;
    cancelResizeFrame();
    if (!cancelled && ev) {
      var finalClientX = Number(ev.clientX);
      var finalClientY = Number(ev.clientY);
      if (Number.isFinite(finalClientX)) state.clientX = finalClientX;
      if (Number.isFinite(finalClientY)) state.clientY = finalClientY;
      state.shiftKey = !!ev.shiftKey;
      flushResizeFrame();
    }
    resizePending = null;
    if (state.el && state.el.removeAttribute) state.el.removeAttribute('data-od-edit-resizing');
    releaseResizeCapture(state);
    justResized = !cancelled;
    if (cancelled || !state.changed || !state.latestSize) {
      restoreResizePreviewSnapshot(state);
      renderSelectedChromeForCurrent();
      scheduleDocumentSize();
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return true;
    }
    var requestId = 'resize-' + Date.now() + '-' + (++resizeCommitSequence);
    pendingResizeCommit = {
      requestId: requestId,
      id: state.id,
      el: state.el,
      ruleKey: state.ruleKey,
      hadPreviousRule: state.hadPreviousRule,
      previousRule: state.previousRule
    };
    postEditMessage({
      type: 'od-edit-resize-commit',
      id: state.id,
      requestId: requestId,
      viewport: state.viewport,
      size: state.latestSize
    });
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    return true;
  }
  function settleResizeCommit(message){
    if (!pendingResizeCommit || message.requestId !== pendingResizeCommit.requestId) return false;
    var commit = pendingResizeCommit;
    pendingResizeCommit = null;
    if (message.accepted !== true) {
      setResponsiveSizePreviewRule(
        commit.ruleKey,
        commit.hadPreviousRule ? commit.previousRule : null
      );
    }
    postTargets();
    scheduleDocumentSize();
    renderSelectedChromeForCurrent();
    return true;
  }
  function renderBox(layer, target, mode){
    if (!target || !target.rect) return;
    var rect = target.rect;
    addGuideNode(layer, 'od-edit-guide-box od-edit-guide-box-' + mode, {
      left: rect.x + 'px',
      top: rect.y + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    });
  }
  function renderSelectedChrome(layer, target){
    if (!target || !target.rect) return;
    renderBox(layer, target, 'selected');
    if (!(target.sizing && target.sizing.resizable)) return;
    var rect = target.rect;
    var points = [
      { x: rect.x, y: rect.y, direction: 'nw' },
      { x: rect.x + rect.width, y: rect.y, direction: 'ne' },
      { x: rect.x, y: rect.y + rect.height, direction: 'sw' },
      { x: rect.x + rect.width, y: rect.y + rect.height, direction: 'se' }
    ];
    for (var i = 0; i < points.length; i++) {
      var point = points[i];
      var handle = addGuideNode(layer, 'od-edit-guide-handle', {
        left: Math.round(point.x) + 'px',
        top: Math.round(point.y) + 'px'
      });
      handle.setAttribute('data-od-edit-resize-handle', point.direction);
    }
  }
  function renderSelectedChromeForCurrent(){
    if (!enabled || !guidesEnabled || !selectedTargetId) {
      clearGuidesLayer();
      return;
    }
    var selectedEl = findById(selectedTargetId);
    if (!selectedEl) {
      clearGuidesLayer();
      return;
    }
    var layer = ensureGuidesLayer();
    layer.replaceChildren();
    renderSelectedChrome(layer, targetFrom(selectedEl, false));
  }
  function rectCenter(rect){
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2)
    };
  }
  function addRelationMeasurement(layer, selectedRect, hoverRect){
    var selectedCenter = rectCenter(selectedRect);
    var hoverCenter = rectCenter(hoverRect);
    var horizontalGap = null;
    var verticalGap = null;
    if (hoverRect.x >= selectedRect.x + selectedRect.width) {
      horizontalGap = {
        value: Math.round(hoverRect.x - selectedRect.x - selectedRect.width),
        x1: selectedRect.x + selectedRect.width,
        x2: hoverRect.x,
        y: hoverCenter.y
      };
    } else if (selectedRect.x >= hoverRect.x + hoverRect.width) {
      horizontalGap = {
        value: Math.round(selectedRect.x - hoverRect.x - hoverRect.width),
        x1: hoverRect.x + hoverRect.width,
        x2: selectedRect.x,
        y: hoverCenter.y
      };
    }
    if (hoverRect.y >= selectedRect.y + selectedRect.height) {
      verticalGap = {
        value: Math.round(hoverRect.y - selectedRect.y - selectedRect.height),
        y1: selectedRect.y + selectedRect.height,
        y2: hoverRect.y,
        x: hoverCenter.x
      };
    } else if (selectedRect.y >= hoverRect.y + hoverRect.height) {
      verticalGap = {
        value: Math.round(selectedRect.y - hoverRect.y - hoverRect.height),
        y1: hoverRect.y + hoverRect.height,
        y2: selectedRect.y,
        x: hoverCenter.x
      };
    }
    var chosen = horizontalGap && (!verticalGap || horizontalGap.value <= verticalGap.value)
      ? { orientation: 'horizontal', gap: horizontalGap }
      : verticalGap
        ? { orientation: 'vertical', gap: verticalGap }
        : null;
    if (!chosen) {
      return;
    }
    if (chosen.orientation === 'horizontal') {
      var hg = chosen.gap;
      addGuideNode(layer, 'od-edit-guide-line od-edit-guide-line-h od-edit-guide-line-distance', {
        left: Math.min(hg.x1, hg.x2) + 'px',
        top: hg.y + 'px',
        width: Math.abs(hg.x2 - hg.x1) + 'px'
      });
      addGuideNode(layer, 'od-edit-guide-measure', {
        left: Math.max(6, Math.min(window.innerWidth - 72, Math.min(hg.x1, hg.x2) + Math.abs(hg.x2 - hg.x1) / 2 - 18)) + 'px',
        top: Math.max(6, Math.min(window.innerHeight - 24, hg.y + 8)) + 'px'
      }, hg.value + 'px');
    } else {
      var vg = chosen.gap;
      addGuideNode(layer, 'od-edit-guide-line od-edit-guide-line-v od-edit-guide-line-distance', {
        left: vg.x + 'px',
        top: Math.min(vg.y1, vg.y2) + 'px',
        height: Math.abs(vg.y2 - vg.y1) + 'px'
      });
      addGuideNode(layer, 'od-edit-guide-measure', {
        left: Math.max(6, Math.min(window.innerWidth - 72, vg.x + 8)) + 'px',
        top: Math.max(6, Math.min(window.innerHeight - 24, Math.min(vg.y1, vg.y2) + Math.abs(vg.y2 - vg.y1) / 2 - 10)) + 'px'
      }, vg.value + 'px');
    }
  }
  function renderReferenceGuides(layer, rect){
    [rect.x, rect.x + rect.width].forEach(function(x){
      addGuideNode(layer, 'od-edit-guide-line od-edit-guide-line-v od-edit-guide-line-reference', {
        left: x + 'px',
        top: '0px',
        height: window.innerHeight + 'px'
      });
    });
    [rect.y, rect.y + rect.height].forEach(function(y){
      addGuideNode(layer, 'od-edit-guide-line od-edit-guide-line-h od-edit-guide-line-reference', {
        left: '0px',
        top: y + 'px',
        width: window.innerWidth + 'px'
      });
    });
  }
  function renderHoverRelation(hoverTarget){
    if (!enabled || !guidesEnabled || !hoverTarget || !hoverTarget.rect) {
      clearGuidesLayer();
      return;
    }
    var selectedEl = selectedTargetId ? findById(selectedTargetId) : null;
    if (selectedEl && stableId(selectedEl) === hoverTarget.id) {
      // Hovering the selected element itself: the selection outline already
      // marks it, and self-relative guides would only double-draw.
      renderSelectedChromeForCurrent();
      return;
    }
    var layer = ensureGuidesLayer();
    layer.replaceChildren();
    renderReferenceGuides(layer, hoverTarget.rect);
    if (selectedEl) {
      renderSelectedChrome(layer, targetFrom(selectedEl, false));
    }
    renderBox(layer, hoverTarget, 'hover');
    if (selectedEl) {
      addRelationMeasurement(layer, targetFrom(selectedEl, false).rect, hoverTarget.rect);
    }
  }
  function postHoverTarget(el){
    if (!enabled || !el) return;
    var id = stableId(el);
    if (id === lastHoverId) return;
    lastHoverId = id;
    lastHoverEl = el;
    guidesMemoryEl = el;
    guidesMemoryId = id;
    var target = targetFrom(el, true);
    renderHoverRelation(target);
    postEditMessage({ type: 'od-edit-hover', target: target });
    postEditMessage({ type: 'od-edit-inspect-hover', target: target });
  }
  function renderHoverRelationOnly(el){
    if (!enabled || !el) return;
    var id = stableId(el);
    if (id === lastHoverId) return;
    lastHoverId = id;
    lastHoverEl = el;
    guidesMemoryEl = el;
    guidesMemoryId = id;
    renderHoverRelation(targetFrom(el, false));
  }
  function clearSelectedTarget(){
    var selected = document.querySelectorAll('[data-od-edit-selected]');
    for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
  }
  function setSelectedTarget(id){
    clearSelectedTarget();
    selectedTargetId = id || null;
    if (!id) return;
    var el = findById(id);
    if (el) el.setAttribute('data-od-edit-selected', 'true');
    renderSelectedChromeForCurrent();
  }
  function closestTarget(event){
    annotateBrandKitRuntimeTargets();
    var el = event.target;
    var interactive = el && el.closest ? el.closest('a,button,[role="button"]') : null;
    if (
      interactive &&
      interactive !== document.body &&
      interactive !== document.documentElement &&
      isSourceMappable(interactive) &&
      isDiscoveryTarget(interactive)
    ) {
      return interactive;
    }
    while (el && el !== document.documentElement) {
      if (el !== document.body && el !== document.documentElement && isSourceMappable(el) && isDiscoveryTarget(el)) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }
  function caretRangeFromClick(clickEvent){
    try {
      if (document.caretPositionFromPoint) {
        var position = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
        if (!position) return null;
        var positionRange = document.createRange();
        positionRange.setStart(position.offsetNode, position.offset);
        positionRange.collapse(true);
        return positionRange;
      }
      if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
      }
    } catch (e) {}
    return null;
  }
  function placeCaretFromClick(clickEvent, el){
    var range = caretRangeFromClick(clickEvent);
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    try {
      var sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }
  var guard = window.__odEditGuard || null;
  // A single in-flight inline text edit. The session is deliberately NOT tied
  // to iframe blur: moving the pointer to the host's floating inspector blurs
  // the iframe, and committing/ending on blur is exactly the #3646 focus-loss
  // bug. The session ends only on an explicit action — Enter, Escape, picking
  // another target, clicking empty background, leaving edit mode, or an
  // od-edit-text-finish message from the host.
  var activeTextEdit = null;
  function postTextSession(el, active, extra){
    if (!el) return;
    postEditMessage(Object.assign({
      type: 'od-edit-text-session',
      id: stableId(el),
      active: !!active
    }, extra || {}));
  }
  function finishActiveTextEdit(commit){
    if (!activeTextEdit) return false;
    var session = activeTextEdit;
    activeTextEdit = null;
    var el = session.el;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-od-editing');
    el.removeEventListener('keydown', session.onKey);
    if (guard) guard.editingEl = null;
    var value = (el.textContent || '').trim();
    var changed = value !== session.originalText.trim();
    if (commit && changed) {
      postEditMessage({
        type: 'od-edit-text-commit',
        id: stableId(el),
        value: value
      });
    } else if (!commit) {
      el.textContent = session.originalText;
    }
    postTextSession(el, false, { committed: !!commit, changed: changed });
    return true;
  }
  function makeEditable(el, clickEvent){
    if (!el) return;
    if (activeTextEdit && activeTextEdit.el === el) {
      placeCaretFromClick(clickEvent, el);
      return;
    }
    if (activeTextEdit) finishActiveTextEdit(true);
    if (el.getAttribute('contenteditable') === 'true') return;
    var originalText = el.textContent || '';
    clearSelectedTarget();
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('data-od-editing', 'true');
    if (guard) guard.editingEl = el;
    try { el.focus(); } catch (e) {}
    placeCaretFromClick(clickEvent, el);
    function onKey(ev){
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finishActiveTextEdit(true);
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finishActiveTextEdit(false);
      }
    }
    activeTextEdit = { el: el, originalText: originalText, onKey: onKey };
    el.addEventListener('keydown', onKey);
    postTextSession(el, true);
  }
  function camelToKebab(name){ return String(name).replace(/[A-Z]/g, function(m){ return '-' + m.toLowerCase(); }); }
  function cssEscapeId(value){ if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value); return String(value).replace(/"/g, '\\\\"'); }
  function findById(id){
    if (!id) return null;
    if (id === '__body__') return document.body;
    var authored = document.querySelector('[data-od-id="' + cssEscapeId(id) + '"]');
    if (authored) return authored;
    if (id.indexOf('source-path:') === 0) {
      var currentPath = id;
      while (currentPath.indexOf('source-path:') === 0) {
        currentPath = currentPath.slice('source-path:'.length);
      }
      return document.querySelector('[' + sourcePathAttr + '="' + cssEscapeId(currentPath) + '"]');
    }
    var el = document.querySelector('[data-od-runtime-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[' + sourcePathAttr + '="' + cssEscapeId(id) + '"]');
    if (el) return el;
    if (typeof id === 'string' && id.indexOf('path-') === 0) {
      var parts = id.slice('path-'.length).split('-').map(function(s){ return Number(s); });
      var node = document.body;
      for (var i = 0; i < parts.length; i++) {
        if (!node) return null;
        var idx = parts[i];
        if (!Number.isInteger(idx) || idx < 0) return null;
        var children = Array.prototype.slice.call(node.children).filter(function(c){ return !isHostNode(c); });
        node = children[idx] || null;
      }
      return node;
    }
    return null;
  }
  function applyPreviewStyles(id, styles, version){
    var el = findById(id);
    if (!el) {
      postEditMessage({ type: 'od-edit-preview-style-applied', id: id || '', version: Number(version) || 0, ok: false, error: 'Target not found' });
      return;
    }
    var keys = Object.keys(styles || {});
    try {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = styles[key];
        var cssName = camelToKebab(key);
        if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
        else el.style.setProperty(cssName, value.trim());
      }
      postEditMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: true });
    } catch (e) {
      postEditMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: false, error: e && e.message ? String(e.message) : 'Could not apply preview styles' });
    }
  }
  window.addEventListener('message', function(ev){
    if (!ev.data) return;
    if (ev.data.type === 'od-edit-resize-result') {
      settleResizeCommit(ev.data);
      return;
    }
    if (ev.data.type === 'od-edit-drag-result') {
      if (!pendingStructuralMove || ev.data.requestId !== pendingStructuralMove.requestId) return;
      var move = pendingStructuralMove;
      pendingStructuralMove = null;
      if (ev.data.accepted !== true) {
        // Unwrap a rejected side group first: the anchor returns to the
        // wrapper's slot so the element restore below can resolve its original
        // next sibling (which may be that very anchor).
        if (move.group && move.anchor && move.anchorParent && move.anchorParent.isConnected) {
          if (move.group.parentNode === move.anchorParent) {
            move.anchorParent.insertBefore(move.anchor, move.group);
          } else if (move.anchor.parentNode === move.group) {
            move.anchorParent.appendChild(move.anchor);
          }
        }
        if (move.parent && move.parent.isConnected && move.el && move.el.isConnected) {
          var restoreBefore = move.before && move.before.parentNode === move.parent ? move.before : null;
          move.parent.insertBefore(move.el, restoreBefore);
          if (move.style === null) move.el.removeAttribute('style');
          else move.el.setAttribute('style', move.style);
          if (move.text !== null) move.el.textContent = move.text;
        }
        if (move.group && move.group.parentNode) move.group.parentNode.removeChild(move.group);
      } else {
        // Authored semantic ids may stay durable until the saved source is
        // mounted. Generated path ids are intentionally ignored because the
        // rebuilt document recalculates them for the new structure.
        promoteGeneratedSourceId(move.el, move.id);
        promoteGeneratedSourceId(move.destinationParent, move.parentId);
        promoteGeneratedSourceId(move.destinationBefore, move.beforeId);
        if (move.anchor) promoteGeneratedSourceId(move.anchor, move.anchorId);
      }
      postTargets();
      scheduleDocumentSize();
      renderSelectedChromeForCurrent();
      return;
    }
    if (ev.data.type === 'od-edit-mode') {
      var nextEditViewport = normalizeEditViewport(ev.data.viewport);
      if (resizePending && nextEditViewport !== editViewport) finishResizeGesture(null, true);
      editViewport = nextEditViewport;
      document.documentElement.setAttribute('data-od-edit-viewport', editViewport);
      enabled = !!ev.data.enabled;
      document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
      document.documentElement.toggleAttribute(
        'data-od-edit-expand-document',
        enabled && ev.data.expandDocument !== false
      );
      if (!enabled) {
        // Leaving edit mode commits the pending inline edit rather than
        // dropping it (the #3647 exit-path regression).
        finishActiveTextEdit(true);
        finishResizeGesture(null, true);
        cancelPendingDrag();
        clearSelectedTarget();
        clearGuidesLayer();
        // Re-entering Edit must treat the first pointerover as fresh. Keeping
        // lastHoverId here made the same element look deduplicated forever
        // after an exit -> enter cycle, so its green guides never came back.
        clearHoverTracking();
        guidesMemoryEl = null;
        guidesMemoryId = null;
        guidesMemoryClearedAt = 0;
        restoreViewportUnits();
      }
      if (enabled) {
        // Expanding the iframe changes the meaning of vh/vmin/vmax. Freeze
        // those authored values against the compact edit viewport first, or a
        // page with min-height:100vh grows again every time we expand it.
        freezeViewportUnits(ev.data.viewportWidth, ev.data.viewportHeight);
        // The expanded document is navigated by the outer canvas. Clear any
        // preview-mode root scroll so Edit cannot retain a second, hidden
        // coordinate system inside the iframe.
        if (ev.data.expandDocument !== false) resetDocumentScroll();
        lastDocumentWidth = -1;
        lastDocumentHeight = -1;
        setTimeout(postTargets, 0);
        scheduleDocumentSize();
        setTimeout(scheduleDocumentSize, 80);
        setTimeout(function(){
          if (ev.data.expandDocument !== false) resetDocumentScroll();
          scheduleDocumentSize();
        }, 260);
      }
      return;
    }
    if (ev.data.type === 'od-edit-selected-target') {
      setSelectedTarget(ev.data.id || null);
      if (!ev.data.id) clearGuidesLayer();
      else {
        renderSelectedChromeForCurrent();
      }
      return;
    }
    if (ev.data.type === 'od-edit-guides-mode') {
      guidesEnabled = ev.data.enabled !== false;
      if (!guidesEnabled) clearGuidesLayer();
      return;
    }
    if (ev.data.type === 'od-edit-capture-chrome') {
      document.documentElement.toggleAttribute('data-od-hide-edit-chrome', !!ev.data.hidden);
      return;
    }
    if (ev.data.type === 'od-edit-hover-reset') {
      // Host signals the cursor truly left the canvas, so the next pointerover
      // re-announces the hovered element (defeats the per-element dedupe) and
      // any hover guides stop lingering over the preview.
      clearHoverTracking();
      renderSelectedChromeForCurrent();
      return;
    }
    if (ev.data.type === 'od-edit-guides-restore') {
      // Re-renders the hover guides the user was looking at before the cursor
      // left the canvas (e.g. to reach a toolbar button) so a capture can
      // include them. Deliberately does NOT touch lastHoverEl and does NOT
      // post od-edit-hover: the host hover affordance stays dismissed and the
      // next od-edit-hover-reset cleanly clears the restored guides.
      var maxAge = Number(ev.data.maxAgeMs) || 0;
      var restored = false;
      var liveHoverEl = null;
      if (enabled && guidesEnabled) {
        liveHoverEl = lastHoverEl && lastHoverEl.isConnected ? lastHoverEl : null;
        var memoryEl = null;
        if (!liveHoverEl && guidesMemoryClearedAt && (!maxAge || Date.now() - guidesMemoryClearedAt <= maxAge)) {
          memoryEl = guidesMemoryEl && guidesMemoryEl.isConnected
            ? guidesMemoryEl
            : (guidesMemoryId ? findById(guidesMemoryId) : null);
        }
        var restoreEl = liveHoverEl || memoryEl;
        if (restoreEl) {
          renderHoverRelation(targetFrom(restoreEl, false));
          restored = true;
        }
      }
      // "live" tells the host the guides belong to a still-active hover (e.g.
      // a keyboard-triggered capture): clearing them afterwards would blank
      // the guides under the user's cursor, so the host must skip the clear.
      postEditMessage({
        type: 'od-edit-guides-restore:result',
        id: ev.data.id || null,
        restored: restored,
        live: !!(restored && liveHoverEl)
      });
      return;
    }
    if (ev.data.type === 'od-edit-preview-style') {
      applyPreviewStyles(ev.data.id, ev.data.styles || {}, ev.data.version);
      return;
    }
    if (ev.data.type === 'od-edit-preview-text') {
      // Live text preview from the host panel's 文本 textarea — the counterpart
      // to od-edit-preview-style. Setting textContent on the (blurred, the host
      // textarea holds focus) element mirrors exactly what the set-text patch
      // will persist, so a newline typed in the panel shows immediately instead
      // of only after Save. Guarded to text leaves (no element children) so it
      // can never clobber nested markup — set-text rejects those anyway. When an
      // inline session is live on the same element, updating its textContent is
      // safe: the session commits the current textContent on save and restores
      // its own originalText on cancel, so both paths still reconcile.
      var ptEl = findById(ev.data.id || '');
      if (ptEl && ptEl !== document.body && ptEl.children.length === 0) {
        ptEl.textContent = String(ev.data.value == null ? '' : ev.data.value);
      }
      return;
    }
    if (ev.data.type === 'od-edit-text-finish') {
      finishActiveTextEdit(ev.data.commit !== false);
      return;
    }
  });
  function postCanvasWheel(ev){
    postEditMessage({
      type: 'od-edit-canvas-wheel',
      clientX: Number(ev.clientX) || 0,
      clientY: Number(ev.clientY) || 0,
      ctrlKey: !!ev.ctrlKey,
      metaKey: !!ev.metaKey,
      deltaMode: Number(ev.deltaMode) || 0,
      deltaX: Number(ev.deltaX) || 0,
      deltaY: Number(ev.deltaY) || 0
    });
  }
  window.__odEditWheelBridge = postCanvasWheel;
  // Capture wheel/trackpad navigation at the iframe window boundary. The
  // head guard above normally sees the event first and stops artifact deck
  // runtimes from treating a pinch/trackpad sample as slide navigation. Keep
  // this listener as a fallback for older srcdoc documents without that guard.
  window.addEventListener('wheel', function(ev){
    if (!enabled) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    postCanvasWheel(ev);
  }, { capture: true, passive: false });
  // pointerdown records a candidate drag; the actual move/commit happens in
  // pointermove/pointerup. We don't preventDefault here so a plain press that
  // never moves still behaves as a normal click (select / enter text-edit).
  document.addEventListener('pointerdown', function(ev){
    if (!enabled) return;
    var resizeHandle = ev.target && ev.target.closest
      ? ev.target.closest('[data-od-edit-resize-handle]')
      : null;
    if (resizeHandle) {
      startResizeGesture(ev, resizeHandle);
      return;
    }
    if (activeTextEdit || pendingStructuralMove || pendingResizeCommit || resizePending) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    var el = closestTarget(ev);
    if (!el) { dragPending = null; return; }
    dragPending = {
      el: el,
      id: stableId(el),
      startX: ev.clientX,
      startY: ev.clientY,
      started: false,
      slot: null
    };
    if (ev.pointerId !== undefined && el.setPointerCapture) {
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
    }
  }, true);
  function uniqueSideGroupId(){
    var id = 'od-group-' + Date.now().toString(36) + '-' + dragCommitSequence;
    while (document.querySelector('[data-od-id="' + cssEscapeId(id) + '"]')) id += '-x';
    return id;
  }
  // A left/right drop inside a vertical container: optimistically wrap the
  // anchor and the dragged element into one horizontal group so the drop is
  // visible immediately, then ask the host to persist the identical structure.
  function commitSideGroupDrag(drag, requestId){
    var parent = drag.slot.parent;
    var anchor = drag.slot.anchor;
    var groupId = uniqueSideGroupId();
    var parentId = dropId(parent);
    var anchorId = stableId(anchor);
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-od-id', groupId);
    wrapper.setAttribute('style', ${JSON.stringify(MANUAL_EDIT_SIDE_GROUP_STYLE)});
    pendingStructuralMove = {
      requestId: requestId,
      el: drag.el,
      id: drag.id,
      parent: drag.el.parentNode,
      before: drag.el.nextSibling,
      destinationParent: parent,
      destinationBefore: null,
      parentId: parentId,
      beforeId: null,
      group: wrapper,
      anchor: anchor,
      anchorParent: anchor.parentNode,
      anchorId: anchorId,
      style: drag.el.getAttribute('style'),
      text: shouldNormalizeReparentedText(drag.el, wrapper) && drag.el.children.length === 0
        ? drag.el.textContent
        : null
    };
    normalizeReparentedText(drag.el, wrapper);
    parent.insertBefore(wrapper, anchor);
    wrapper.appendChild(anchor);
    if (drag.slot.placement === 'left') wrapper.insertBefore(drag.el, anchor);
    else wrapper.appendChild(drag.el);
    postTargets();
    scheduleDocumentSize();
    postEditMessage({
      type: 'od-edit-drag-commit',
      id: drag.id,
      parentId: parentId,
      beforeId: null,
      placement: drag.slot.placement,
      anchorId: anchorId,
      groupId: groupId,
      generation: documentGeneration,
      requestId: requestId
    });
  }
  function finishPendingDrag(ev, cancelled){
    if (!dragPending) return;
    var drag = dragPending;
    dragPending = null;
    if (!drag.started) return; // never moved past threshold → let click select
    justDragged = true;
    ev.preventDefault();
    ev.stopPropagation();
    drag.el.removeAttribute('data-od-edit-dragging');
    if (!cancelled && drag.slot && !isNoopDrop(drag.slot, drag.el)) {
      var requestId = 'move-' + Date.now() + '-' + (++dragCommitSequence);
      if (drag.slot.placement && drag.slot.anchor) {
        commitSideGroupDrag(drag, requestId);
      } else {
        var normalizeText = shouldNormalizeReparentedText(drag.el, drag.slot.parent);
        var destinationParent = drag.slot.parent;
        var destinationBefore = drag.slot.before;
        var parentId = dropId(destinationParent);
        var beforeId = destinationBefore ? stableId(destinationBefore) : null;
        pendingStructuralMove = {
          requestId: requestId,
          el: drag.el,
          id: drag.id,
          parent: drag.el.parentNode,
          before: drag.el.nextSibling,
          destinationParent: destinationParent,
          destinationBefore: destinationBefore,
          parentId: parentId,
          beforeId: beforeId,
          style: drag.el.getAttribute('style'),
          text: normalizeText && drag.el.children.length === 0 ? drag.el.textContent : null
        };
        // Apply the DOM reorder immediately so the drop feels responsive while
        // the host saves it. A rejected save rolls this preview back; a successful
        // save replaces it with a freshly addressed document.
        normalizeReparentedText(drag.el, drag.slot.parent);
        drag.slot.parent.insertBefore(drag.el, drag.slot.before);
        postTargets();
        scheduleDocumentSize();
        postEditMessage({
          type: 'od-edit-drag-commit',
          id: drag.id,
          parentId: parentId,
          beforeId: beforeId,
          generation: documentGeneration,
          requestId: requestId
        });
      }
    }
    renderSelectedChromeForCurrent();
  }
  document.addEventListener('pointerup', function(ev){
    if (finishResizeGesture(ev, false)) return;
    finishPendingDrag(ev, false);
  }, true);
  document.addEventListener('pointercancel', function(ev){
    if (finishResizeGesture(ev, true)) return;
    finishPendingDrag(ev, true);
  }, true);
  document.addEventListener('lostpointercapture', function(ev){
    if (!resizePending) return;
    finishResizeGesture(ev, true);
  }, true);
  document.documentElement.addEventListener('keydown', function(ev){
    if (!resizePending || ev.key !== 'Escape') return;
    finishResizeGesture(ev, true);
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', function(ev){
    if (!enabled) return;
    if (justResized) { justResized = false; ev.preventDefault(); ev.stopPropagation(); return; }
    if (justDragged) { justDragged = false; ev.preventDefault(); ev.stopPropagation(); return; }
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    var el = closestTarget(ev);
    if (!el) {
      // Clicking empty canvas (no source-mapped ancestor) is the gesture for
      // page-level styles; commit any in-flight edit first so the host and
      // iframe stay in sync, then let the host decide whether to surface the
      // page-styles card.
      if (activeTextEdit) finishActiveTextEdit(true);
      postEditMessage({ type: 'od-edit-background' });
      return;
    }
    // Switching to a different target commits the in-flight edit first, so the
    // previous edit is never silently dropped.
    if (activeTextEdit && activeTextEdit.el !== el) finishActiveTextEdit(true);
    var kind = inferKind(el);
    var selectedTarget = targetFrom(el, true);
    setSelectedTarget(selectedTarget.id);
    renderSelectedChromeForCurrent();
    postEditMessage({ type: 'od-edit-select', target: selectedTarget });
    postEditMessage({ type: 'od-edit-inspect-select', target: selectedTarget });
    if (kind === 'text' || kind === 'link') {
      makeEditable(el, ev);
      return;
    }
  }, true);
  function previewHtmlFileForLink(link){
    if (!link || link.hasAttribute('download')) return null;
    var target = String(link.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return null;
    var href = link.getAttribute('href');
    return previewHtmlFileForHref(href, target);
  }
  function previewHtmlFileForHref(href, target){
    target = String(target || '').toLowerCase();
    if (target && target !== '_self') return null;
    if (!href || href.charAt(0) === '#') return null;
    try {
      var baseUrl = new URL(document.baseURI || location.href);
      var nextUrl = new URL(href, baseUrl);
      var rawMarker = '/raw/';
      var rawIndex = baseUrl.pathname.lastIndexOf(rawMarker);
      if (nextUrl.origin !== baseUrl.origin || rawIndex < 0) return null;
      var rawRoot = baseUrl.pathname.slice(0, rawIndex + rawMarker.length);
      if (nextUrl.pathname.indexOf(rawRoot) !== 0) return null;
      var fileName = decodeURIComponent(nextUrl.pathname.slice(rawRoot.length));
      if (
        !fileName ||
        fileName.charAt(0) === '/' ||
        fileName.split('/').some(function(part){ return !part || part === '.' || part === '..'; }) ||
        !/\\.html?$/i.test(fileName)
      ) return null;
      return { fileName: fileName, search: nextUrl.search || '', hash: nextUrl.hash || '' };
    } catch (_) {
      return null;
    }
  }
  function previewExternalUrlForHref(href){
    if (!href) return null;
    try {
      var nextUrl = new URL(href, document.baseURI || location.href);
      var protocol = String(nextUrl.protocol || '').toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:' && protocol !== 'tel:') return null;
      return nextUrl.href;
    } catch (_) {
      return null;
    }
  }
  // Once Manual Edit has activated srcDoc, keep same-project HTML navigation
  // in the host workspace. Letting the iframe navigate itself replaces this
  // document (and therefore this bridge) with a raw URL response; a later Edit
  // toggle then looks active in the toolbar but cannot draw/select anything.
  document.addEventListener('click', function(ev){
    if (enabled || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var origin = ev.target;
    var link = origin && origin.closest ? origin.closest('a[href]') : null;
    var destination = previewHtmlFileForLink(link);
    if (!destination) return;
    ev.preventDefault();
    window.parent.postMessage({
      type: 'od:preview-open-file',
      fileName: destination.fileName,
      search: destination.search,
      hash: destination.hash
    }, '*');
  }, true);
  document.addEventListener('click', function(ev){
    if (enabled || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var origin = ev.target;
    var action = origin && origin.closest
      ? origin.closest('button[data-od-action="navigate"],[role="button"][data-od-action="navigate"]')
      : null;
    if (!action) return;
    var href = String(action.getAttribute('data-od-href') || '').trim();
    if (!href) return;
    var target = action.getAttribute('data-od-target') === '_blank' ? '_blank' : '_self';
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    if (href.charAt(0) === '#') {
      var anchorId = href.slice(1);
      var anchor = anchorId ? document.getElementById(anchorId) : document.documentElement;
      if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ block: 'start' });
      try { if (anchorId) history.replaceState(null, '', href); } catch (_) {}
      return;
    }
    var destination = previewHtmlFileForHref(href, target);
    if (destination) {
      window.parent.postMessage({
        type: 'od:preview-open-file',
        fileName: destination.fileName,
        search: destination.search,
        hash: destination.hash
      }, '*');
      return;
    }
    var url = previewExternalUrlForHref(href);
    if (!url) return;
    window.parent.postMessage({ type: 'od:preview-open-url', url: url, target: target }, '*');
  }, true);
  document.addEventListener('pointerover', function(ev){
    if (!enabled) return;
    if (resizePending) return;
    // A drag in progress owns the overlay (selection chrome only); pointerover
    // must not surface hover reference guides that would clutter the move.
    if (dragPending && dragPending.started) return;
    // While editing, hovering must not retarget the inspector or surface a new
    // affordance — that's the other half of the #3646 instability. It should
    // still draw the selected-vs-hover spacing overlay, though.
    if (activeTextEdit) {
      var hoverEditEl = closestTarget(ev);
      if (!hoverEditEl) {
        clearHoverTracking();
        renderSelectedChromeForCurrent();
        return;
      }
      renderHoverRelationOnly(hoverEditEl);
      return;
    }
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    var el = closestTarget(ev);
    if (!el) return;
    postHoverTarget(el);
  }, true);
  document.addEventListener('pointermove', function(ev){
    if (!enabled) return;
    if (resizePending) {
      if (resizePending.pointerId === undefined || ev.pointerId === undefined || resizePending.pointerId === ev.pointerId) {
        scheduleResizeFrame(ev);
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }
    // Active/candidate drag takes over pointermove: resolve a structural drop
    // slot and skip the hover-guides bookkeeping below.
    if (dragPending) {
      var dx = ev.clientX - dragPending.startX;
      var dy = ev.clientY - dragPending.startY;
      if (!dragPending.started && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragPending.started = true;
        dragPending.el.setAttribute('data-od-edit-dragging', 'true');
        // Move the in-frame selection chrome without replacing the host's
        // inspector draft. The host flushes or preserves that draft before it
        // accepts this structural move.
        if (selectedTargetId !== dragPending.id) {
          setSelectedTarget(dragPending.id);
        }
      }
      if (dragPending.started) {
        dragPending.slot = findDropSlot(ev.clientX, ev.clientY, dragPending.el, ev.target);
        // Live guides show the receiving component frame plus the exact DOM
        // insertion line. The dragged element stays in normal document flow.
        if (guidesEnabled) {
          renderDropSlot(dragPending.slot, dragPending.el);
        } else {
          renderSelectedChromeForCurrent();
        }
        ev.preventDefault();
      }
      return;
    }
    var hoveredEl = closestTarget(ev);
    if (activeTextEdit) {
      if (!hoveredEl || (activeTextEdit.el && stableId(activeTextEdit.el) === stableId(hoveredEl))) {
        clearHoverTracking();
        renderSelectedChromeForCurrent();
      }
      return;
    }
    if (!hoveredEl) {
      clearHoverTracking();
      renderSelectedChromeForCurrent();
      return;
    }
    // A toolbar toggle or iframe visibility swap can leave the pointer inside
    // the same DOM element without producing a fresh pointerover. Treat normal
    // movement as the recovery path; postHoverTarget keeps this cheap through
    // its stable-id dedupe during ordinary movement.
    postHoverTarget(hoveredEl);
  }, true);
  window.addEventListener('resize', function(){ postTargets(); scheduleDocumentSize(); });
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var documentSizeObserver = new ResizeObserver(scheduleDocumentSize);
      documentSizeObserver.observe(document.documentElement);
      if (document.body) documentSizeObserver.observe(document.body);
    } catch (_) {}
  }
  if (typeof MutationObserver !== 'undefined' && document.body) {
    try {
      var documentMutationObserver = new MutationObserver(scheduleDocumentSize);
      documentMutationObserver.observe(document.body, { attributes: true, characterData: true, childList: true, subtree: true });
    } catch (_) {}
  }
  document.addEventListener('load', scheduleDocumentSize, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleDocumentSize).catch(function(){});
  var hoverGuidesScrollScheduled = false;
  var scheduleGuideFrame = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function(cb){ return setTimeout(cb, 16); };
  // Guides are drawn in viewport (fixed) coordinates, so any scroll — page or
  // inner container — invalidates them; re-measure the tracked hover element.
  window.addEventListener('scroll', function(){
    if (!enabled || hoverGuidesScrollScheduled) return;
    hoverGuidesScrollScheduled = true;
    scheduleGuideFrame(function(){
      hoverGuidesScrollScheduled = false;
      if (!lastHoverEl) return;
      if (!lastHoverEl.isConnected) {
        lastHoverEl = null;
        clearGuidesLayer();
        return;
      }
      renderHoverRelation(targetFrom(lastHoverEl, false));
    });
  }, true);
  // Double-tap Command screenshot hotkey (edit mode only). Keyboard focus can
  // live inside the sandboxed iframe, where the host's window listener never
  // hears the keys — detect here and delegate the capture to the host. Two
  // quick bare Meta taps trigger; any non-Meta key cancels (so ⌘C never
  // fires), and holding BOTH Meta keys is the module-capture chord owned by
  // the snapshot bridge, so it resets instead of triggering.
  // Registered on documentElement, NOT window/document: the keyboard guard
  // wraps window/document keydown listeners and suppresses them during inline
  // text editing, which would silently eat the hotkey exactly when the user
  // is editing a text element.
  var screenshotTap = { at: 0, left: false, right: false };
  function isNativeUndoTarget(value){
    var el = value && value.nodeType === 1 ? value : null;
    if (!el) return false;
    var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return !!(el.closest && el.closest('[contenteditable]:not([contenteditable="false"])'));
  }
  document.documentElement.addEventListener('keydown', function(ev){
    if (!enabled || ev.defaultPrevented || ev.isComposing) return;
    if (String(ev.key || '').toLowerCase() !== 'z') return;
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey || ev.shiftKey) return;
    // Inline text editing owns character-level undo. Only delegate a shortcut
    // after it has actual text changes. Merely clicking a text element starts
    // a session too; consuming Command+Z on that unchanged session makes the
    // shortcut appear broken instead of undoing the previous real edit.
    if (activeTextEdit) {
      var liveText = (activeTextEdit.el.textContent || '').trim();
      if (liveText !== activeTextEdit.originalText.trim()) return;
      finishActiveTextEdit(false);
    }
    if (
      (guard && guard.editingEl && guard.editingEl.isConnected)
      || isNativeUndoTarget(ev.target)
      || isNativeUndoTarget(document.activeElement)
    ) return;
    screenshotTap.at = 0;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    postEditMessage({ type: 'od-edit-undo-hotkey' });
  }, true);
  document.documentElement.addEventListener('keydown', function(ev){
    if (!enabled) return;
    if (ev.key !== 'Meta') {
      screenshotTap.at = 0;
      return;
    }
    if (ev.code === 'MetaLeft') screenshotTap.left = true;
    if (ev.code === 'MetaRight') screenshotTap.right = true;
    if (ev.repeat) return;
    if (screenshotTap.left && screenshotTap.right) {
      screenshotTap.at = 0;
      return;
    }
    var now = Date.now();
    if (screenshotTap.at && now - screenshotTap.at <= 600) {
      screenshotTap.at = 0;
      postEditMessage({ type: 'od-edit-screenshot-hotkey' });
    } else {
      screenshotTap.at = now;
    }
  }, true);
  document.documentElement.addEventListener('keyup', function(ev){
    if (ev.code === 'MetaLeft') screenshotTap.left = false;
    if (ev.code === 'MetaRight') screenshotTap.right = false;
  }, true);
  window.addEventListener('blur', function(){
    finishResizeGesture(null, true);
    screenshotTap.at = 0;
    screenshotTap.left = false;
    screenshotTap.right = false;
  });
  function bootEditBridge(){
    annotateBrandKitRuntimeTargets();
    postTargets();
    var brandRoot = document.getElementById('root') || document.body;
    if (window.MutationObserver && brandRoot && document.getElementById('od-brand-payload')) {
      new MutationObserver(function(){ annotateBrandKitRuntimeTargets(); postTargets(); })
        .observe(brandRoot, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootEditBridge);
  else setTimeout(bootEditBridge, 0);
  document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
  document.documentElement.setAttribute('data-od-edit-viewport', editViewport);
})();</script>`;
}

export function buildManualEditBridgeStyle(): string {
  return `<style data-od-edit-bridge-style>
html[data-od-edit-mode][data-od-edit-expand-document],
html[data-od-edit-mode][data-od-edit-expand-document] body {
  overflow: hidden !important;
  overscroll-behavior: none !important;
}
html[data-od-edit-mode] body * { cursor: pointer !important; }
html[data-od-edit-mode] [data-od-edit-selected] {
  outline: none !important;
}
html[data-od-edit-mode] [data-od-editing="true"] {
  outline: none !important;
  cursor: text !important;
}
html[data-od-edit-mode] [data-od-edit-dragging="true"],
html[data-od-edit-mode] [data-od-edit-dragging="true"] * {
  cursor: grabbing !important;
}
[data-od-edit-guides-layer] {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  font: 11px/1.2 Inter, system-ui, sans-serif;
}
[data-od-edit-guides-layer] .od-edit-guide-box {
  position: fixed;
  border: 1px solid var(--selected, var(--accent, CanvasText));
  box-sizing: border-box;
}
[data-od-edit-guides-layer] .od-edit-guide-box-hover {
  border-style: dashed;
}
[data-od-edit-guides-layer] .od-edit-guide-box-selected {
  border-style: solid;
}
[data-od-edit-guides-layer] .od-edit-guide-box-drop {
  border-style: dashed;
  background: color-mix(in srgb, var(--selected, var(--accent, CanvasText)) 5%, transparent);
}
[data-od-edit-guides-layer] .od-edit-guide-handle {
  position: fixed;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  margin-top: -5px;
  border: 2px solid var(--selected, var(--accent, CanvasText));
  border-radius: 999px;
  background: Canvas;
  box-sizing: border-box;
}
[data-od-edit-guides-layer] .od-edit-guide-handle[data-od-edit-resize-handle] {
  pointer-events: auto;
  touch-action: none;
}
[data-od-edit-guides-layer] .od-edit-guide-handle[data-od-edit-resize-handle="nw"],
[data-od-edit-guides-layer] .od-edit-guide-handle[data-od-edit-resize-handle="se"] {
  cursor: nwse-resize !important;
}
[data-od-edit-guides-layer] .od-edit-guide-handle[data-od-edit-resize-handle="ne"],
[data-od-edit-guides-layer] .od-edit-guide-handle[data-od-edit-resize-handle="sw"] {
  cursor: nesw-resize !important;
}
html[data-od-edit-mode] [data-od-edit-resizing="nw"],
html[data-od-edit-mode] [data-od-edit-resizing="nw"] *,
html[data-od-edit-mode] [data-od-edit-resizing="se"],
html[data-od-edit-mode] [data-od-edit-resizing="se"] * {
  cursor: nwse-resize !important;
}
html[data-od-edit-mode] [data-od-edit-resizing="ne"],
html[data-od-edit-mode] [data-od-edit-resizing="ne"] *,
html[data-od-edit-mode] [data-od-edit-resizing="sw"],
html[data-od-edit-mode] [data-od-edit-resizing="sw"] * {
  cursor: nesw-resize !important;
}
[data-od-edit-guides-layer] .od-edit-guide-line {
  position: fixed;
  background: color-mix(in srgb, var(--amber, var(--selected, var(--accent, CanvasText))) 70%, transparent);
}
[data-od-edit-guides-layer] .od-edit-guide-line-v {
  width: 1px;
}
[data-od-edit-guides-layer] .od-edit-guide-line-h {
  height: 1px;
}
[data-od-edit-guides-layer] .od-edit-guide-line-distance {
  background: var(--amber, var(--selected, var(--accent, CanvasText)));
}
[data-od-edit-guides-layer] .od-edit-guide-line-reference {
  background: color-mix(in srgb, var(--amber, var(--selected, var(--accent, CanvasText))) 36%, transparent);
}
[data-od-edit-guides-layer] .od-edit-guide-measure {
  position: fixed;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--amber, var(--selected, var(--accent, CanvasText)));
  color: var(--accent-contrast, Canvas);
  box-shadow: 0 5px 16px color-mix(in srgb, var(--selected, var(--accent, CanvasText)) 18%, transparent);
}
[data-od-edit-guides-layer] .od-edit-guide-drop-line {
  position: fixed;
  border-radius: 999px;
  background: var(--selected, var(--accent, CanvasText));
  box-shadow: 0 0 0 2px color-mix(in srgb, Canvas 72%, transparent);
}
[data-od-edit-guides-layer] .od-edit-guide-drop-line-v {
  width: 2px;
  margin-left: -1px;
}
[data-od-edit-guides-layer] .od-edit-guide-drop-line-h {
  height: 2px;
  margin-top: -1px;
}
html[data-od-hide-edit-chrome] [data-od-edit-guides-layer],
html[data-od-hide-edit-chrome] [data-od-edit-selected],
html[data-od-hide-edit-chrome] [data-od-editing="true"] {
  opacity: 0 !important;
  box-shadow: none !important;
  outline-color: transparent !important;
}
</style>`;
}
