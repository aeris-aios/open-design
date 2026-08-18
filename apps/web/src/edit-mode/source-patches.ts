import {
  emptyManualEditStyles,
  MANUAL_EDIT_SIDE_GROUP_STYLE,
  MANUAL_EDIT_STYLE_PROPS,
  type ManualEditFields,
  type ManualEditPatch,
  type ManualEditResponsiveSizePatch,
  type ManualEditResponsiveSizeValues,
  type ManualEditResponsiveViewport,
  type ManualEditStyles,
} from './types';

const MANUAL_EDIT_RUNTIME_OVERRIDES_ID = 'od-manual-edit-runtime-overrides';
const MANUAL_EDIT_RUNTIME_APPLY_ID = 'od-manual-edit-runtime-apply';
const MANUAL_EDIT_RESPONSIVE_SIZE_ATTRIBUTE = 'data-od-responsive-size';
const MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE = 'data-od-responsive-generated-id';
const RESPONSIVE_SIZE_VIEWPORTS: readonly ManualEditResponsiveViewport[] = ['mobile', 'tablet', 'desktop'];
const RESPONSIVE_SIZE_MEDIA_QUERY: Record<ManualEditResponsiveViewport, string> = {
  mobile: '(max-width: 599px)',
  tablet: '(min-width: 600px) and (max-width: 1023px)',
  desktop: '(min-width: 1024px)',
};
const RESPONSIVE_SIZE_KEYS = new Set(['widthPercent', 'minHeight', 'leftPercent', 'topPx']);
const RESPONSIVE_SIZE_RULE_PATTERN = /\/\*\s*od-responsive-size:(mobile|tablet|desktop):([^\s*]+)\s*\*\/\s*@media\s+[^\{]+\{\s*\[data-od-id="(?:\\.|[^"])*"\]\s*\{([^}]*)\}\s*\}/g;
const RESPONSIVE_SIZE_DECLARATION_PATTERN = /(width|min-height|left|top)\s*:\s*(-?\d+(?:\.\d+)?)\s*(%|px)(?:\s*!important)?\s*;?/gi;
type ResponsiveSizeStore = Partial<Record<ManualEditResponsiveViewport, Record<string, ManualEditResponsiveSizeValues>>>;
const RUNTIME_OVERRIDE_APPLIER_SOURCE = `
(function () {
  function readOverrides() {
    var node = document.getElementById('od-manual-edit-runtime-overrides');
    if (!node) return {};
    try {
      var parsed = JSON.parse(node.textContent || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\\\"');
  }
  function byId(id) {
    return document.querySelector('[data-od-id="' + cssEscape(id) + '"]');
  }
  function textValue(value) {
    return value == null ? '' : String(value);
  }
  function applyAll() {
    var data = readOverrides();
    Object.keys(data.text || {}).forEach(function (id) {
      var el = byId(id);
      var value = textValue(data.text[id]);
      if (el && el.textContent !== value) el.textContent = value;
    });
    Object.keys(data.links || {}).forEach(function (id) {
      var el = byId(id);
      var value = data.links[id] || {};
      if (!el) return;
      var text = textValue(value.text);
      var href = textValue(value.href);
      if (el.textContent !== text) el.textContent = text;
      if (href && el.getAttribute('href') !== href) el.setAttribute('href', href);
    });
    Object.keys(data.images || {}).forEach(function (id) {
      var el = byId(id);
      var value = data.images[id] || {};
      if (!el) return;
      var src = textValue(value.src);
      var alt = textValue(value.alt);
      if (src && el.getAttribute('src') !== src) el.setAttribute('src', src);
      if (el.getAttribute('alt') !== alt) el.setAttribute('alt', alt);
    });
    Object.keys(data.attrs || {}).forEach(function (id) {
      var el = byId(id);
      var attrs = data.attrs[id] || {};
      if (!el) return;
      Object.keys(attrs).forEach(function (name) {
        if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(name)) return;
        if (/^data-od-/.test(name)) return;
        var value = textValue(attrs[name]);
        if (value.trim() === '') {
          if (el.hasAttribute(name)) el.removeAttribute(name);
        } else if (el.getAttribute(name) !== value) {
          el.setAttribute(name, value);
        }
      });
    });
    Object.keys(data.html || {}).forEach(function (id) {
      var el = byId(id);
      if (!el) return;
      var template = document.createElement('template');
      template.innerHTML = textValue(data.html[id]);
      if (template.content.children.length !== 1) return;
      var next = template.content.children[0];
      if (!next.getAttribute('data-od-id')) next.setAttribute('data-od-id', id);
      if (el.outerHTML === next.outerHTML) return;
      el.replaceWith(next);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAll, { once: true });
  else applyAll();
  var root = document.getElementById('root') || document.body;
  if (window.MutationObserver && root) {
    var pending = 0;
    new MutationObserver(function () {
      if (pending) return;
      pending = window.setTimeout(function () {
        pending = 0;
        applyAll();
      }, 0);
    }).observe(root, { childList: true, subtree: true });
  }
})();`;
interface RuntimeContentOverrides {
  text?: Record<string, string>;
  links?: Record<string, { text: string; href: string }>;
  images?: Record<string, { src: string; alt: string }>;
  attrs?: Record<string, Record<string, string>>;
  html?: Record<string, string>;
}

type ManualEditElementPatch = Extract<ManualEditPatch, { id: string }>;

export interface ManualEditPatchResult {
  ok: boolean;
  source: string;
  error?: string;
}

export function applyManualEditPatch(source: string, patch: ManualEditPatch): ManualEditPatchResult {
  if (patch.kind === 'set-full-source') return { ok: true, source: patch.source };

  const doc = parseSource(source);
  if (!doc) return { ok: false, source, error: 'Could not parse source.' };

  if (patch.kind === 'set-token') {
    const changed = setCssToken(doc, patch.token, patch.value);
    return changed
      ? { ok: true, source: serializeSource(doc, source) }
      : { ok: false, source, error: `Token not found: ${patch.token}` };
  }

  const el = findEditableElement(doc, patch.id);
  if (!el) {
    const dynamic = applyDynamicBrandKitPatch(doc, patch);
    return dynamic.ok
      ? { ok: true, source: serializeSource(doc, source) }
      : { ok: false, source, error: `Target not found: ${patch.id}` };
  }

  if (patch.kind === 'set-text') {
    if (hasElementChildren(el)) {
      const soleText = findSoleMeaningfulTextNode(el);
      if (!soleText) {
        return { ok: false, source, error: 'This element contains nested markup. Use the HTML tab instead.' };
      }
      soleText.nodeValue = patch.value;
    } else {
      el.textContent = patch.value;
    }
  } else if (patch.kind === 'set-link') {
    const href = normalizeManualEditActionHref(patch.href);
    if (patch.href.trim() && href === null) {
      return { ok: false, source, error: 'Use a page, anchor, or an http(s), mailto, or tel URL.' };
    }
    if (hasElementChildren(el)) {
      const currentText = el.textContent?.trim() ?? '';
      if (patch.text.trim() !== currentText) {
        // The label changed on a link that has element children (e.g. an
        // icon `<span>` beside a label `<span>`). Route the edit to the one
        // text node that carries the visible label instead of refusing
        // outright — see findSoleMeaningfulTextNode for the safety bound.
        const soleText = findSoleMeaningfulTextNode(el);
        if (!soleText) {
          return { ok: false, source, error: 'This link contains nested markup. Use the HTML tab to change its label.' };
        }
        soleText.nodeValue = patch.text;
      }
    } else {
      el.textContent = patch.text;
    }
    if (href) el.setAttribute('href', href);
    else el.removeAttribute('href');
  } else if (patch.kind === 'set-action') {
    const href = normalizeManualEditActionHref(patch.href);
    if (patch.href.trim() && href === null) {
      return { ok: false, source, error: 'Use a page, anchor, or an http(s), mailto, or tel URL.' };
    }
    if (hasElementChildren(el)) {
      const labelText = findActionLabelTextNode(el);
      const currentText = labelText?.nodeValue?.trim() ?? el.textContent?.trim() ?? '';
      if (patch.text.trim() !== currentText) {
        if (!labelText) {
          return { ok: false, source, error: 'This button contains nested markup. Use the HTML tab to change its label.' };
        }
        labelText.nodeValue = patch.text;
      }
    } else {
      el.textContent = patch.text;
    }
    if (href) {
      el.setAttribute('data-od-action', 'navigate');
      el.setAttribute('data-od-href', href);
      el.setAttribute('data-od-target', patch.target === '_blank' ? '_blank' : '_self');
    } else {
      el.removeAttribute('data-od-action');
      el.removeAttribute('data-od-href');
      el.removeAttribute('data-od-target');
    }
  } else if (patch.kind === 'set-image') {
    el.setAttribute('src', patch.src);
    el.setAttribute('alt', patch.alt);
  } else if (patch.kind === 'set-style') {
    setInlineStyles(el as HTMLElement, patch.styles);
  } else if (patch.kind === 'set-responsive-size') {
    const error = setResponsiveSizeRule(doc, source, el, patch.id, patch.viewport, patch.size);
    if (error) return { ok: false, source, error };
  } else if (patch.kind === 'set-attributes') {
    setAttributes(el, patch.attributes);
  } else if (patch.kind === 'set-outer-html') {
    const replaced = replaceOuterHtml(doc, el, patch.html);
    if (!replaced.ok) {
      return {
        ok: false,
        source,
        error: 'error' in replaced ? replaced.error : 'Could not replace element HTML.',
      };
    }
  } else if (patch.kind === 'remove-element') {
    if (!el.parentElement) {
      return { ok: false, source, error: 'Cannot remove the root element.' };
    }
    if (el.parentElement === doc.body && isLastRenderableBodyChild(doc, el)) {
      return { ok: false, source, error: 'Cannot remove the last rendered element in the document.' };
    }
    el.remove();
  } else if (patch.kind === 'move-element') {
    const parent = findEditableElement(doc, patch.parentId);
    if (!parent) {
      return { ok: false, source, error: `Drop container not found: ${patch.parentId}` };
    }
    const placement = patch.placement === 'left' || patch.placement === 'right' ? patch.placement : null;
    if (placement) {
      // A side drop inside a vertical container wraps the anchor and the moved
      // element into one horizontal group instead of reordering the parent.
      const anchor = patch.anchorId ? findEditableElement(doc, patch.anchorId) : null;
      if (!anchor || anchor.parentElement !== parent) {
        return { ok: false, source, error: `Drop anchor not found in container: ${patch.anchorId ?? ''}` };
      }
      if (anchor === el) {
        return { ok: false, source, error: 'The element cannot be grouped with itself.' };
      }
      if (el === parent || el.contains(parent)) {
        return { ok: false, source, error: 'These elements cannot be placed side by side.' };
      }
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('style', MANUAL_EDIT_SIDE_GROUP_STYLE);
      if (!canManualEditParentAccept(parent, wrapper)) {
        return { ok: false, source, error: 'A side-by-side group cannot be created inside that HTML container.' };
      }
      if (!canManualEditParentAccept(wrapper, el) || !canManualEditParentAccept(wrapper, anchor)) {
        return { ok: false, source, error: 'These elements cannot be placed side by side.' };
      }
      wrapper.setAttribute('data-od-id', uniqueManualEditSideGroupId(doc, patch.groupId));
      // Preserve authored semantic ids, but never persist generated path
      // aliases: the preview is rebuilt after every structural move.
      promoteManualEditSourceId(doc, el, patch.id);
      promoteManualEditSourceId(doc, parent, patch.parentId);
      if (patch.anchorId) promoteManualEditSourceId(doc, anchor, patch.anchorId);
      normalizeReparentedTextElement(el, wrapper);
      parent.insertBefore(wrapper, anchor);
      wrapper.appendChild(anchor);
      if (placement === 'left') wrapper.insertBefore(el, anchor);
      else wrapper.appendChild(el);
    } else {
      if (!canManualEditParentAccept(parent, el)) {
        return { ok: false, source, error: 'This element cannot be placed inside that HTML container.' };
      }
      const before = patch.beforeId ? findEditableElement(doc, patch.beforeId) : null;
      if (patch.beforeId && (!before || before.parentElement !== parent)) {
        return { ok: false, source, error: `Drop sibling not found in container: ${patch.beforeId}` };
      }
      if (before === el) {
        return { ok: false, source, error: 'The element cannot be inserted before itself.' };
      }
      // Preserve authored semantic ids, but never persist generated path aliases:
      // the preview is rebuilt after a structural move and receives fresh paths.
      promoteManualEditSourceId(doc, el, patch.id);
      promoteManualEditSourceId(doc, parent, patch.parentId);
      if (before && patch.beforeId) promoteManualEditSourceId(doc, before, patch.beforeId);
      normalizeReparentedTextElement(el, parent);
      parent.insertBefore(el, before);
    }
  }

  return { ok: true, source: serializeSource(doc, source) };
}

function canManualEditParentAccept(parent: Element, child: Element): boolean {
  if (parent === child || child.contains(parent)) return false;
  if (parent.namespaceURI && parent.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
  const parentTag = parent.tagName.toLowerCase();
  const childTag = child.tagName.toLowerCase();
  if (parentTag === 'html' || VOID_HTML_TAGS.has(parentTag)) return false;

  const childParents = REQUIRED_HTML_PARENTS[childTag];
  if (childParents && !childParents.has(parentTag)) return false;
  const parentChildren = RESTRICTED_HTML_CHILDREN[parentTag];
  if (parentChildren && !parentChildren.has(childTag)) return false;
  if (PHRASING_ONLY_HTML_PARENTS.has(parentTag) && !PHRASING_HTML_CHILDREN.has(childTag)) return false;

  // The iframe only emits drops for visible boxes. Keep the source authority
  // focused on HTML validity so an empty but legitimate box is not rejected
  // merely because it has no children and was inferred as a text leaf.
  return true;
}

const REPARENTED_TEXT_STYLE_RESETS: ReadonlyArray<readonly [string, string]> = [
  ['position', 'static'], ['inset', 'auto'], ['top', 'auto'], ['right', 'auto'],
  ['bottom', 'auto'], ['left', 'auto'], ['transform', 'none'], ['translate', 'none'],
  ['width', 'auto'], ['height', 'auto'], ['min-width', '0'], ['min-height', '0'],
  ['max-width', '100%'], ['max-height', 'none'], ['margin', '0'], ['padding', '0'],
  ['grid-area', 'auto'], ['grid-column', 'auto'], ['grid-row', 'auto'],
  ['flex', '0 1 auto'], ['flex-basis', 'auto'], ['align-self', 'auto'],
  ['justify-self', 'auto'], ['white-space', 'normal'], ['word-spacing', 'normal'],
  ['text-indent', '0'], ['overflow-wrap', 'anywhere'],
];

const WHITESPACE_PRESERVING_TEXT_TAGS = new Set(['pre', 'code', 'textarea']);

function normalizeReparentedTextElement(el: Element, parent: Element): void {
  if (el.parentElement === parent || inferKind(el) !== 'text') return;
  const style = (el as HTMLElement).style;
  if (style) {
    for (const [property, value] of REPARENTED_TEXT_STYLE_RESETS) {
      style.setProperty(property, value);
    }
  }
  const tag = el.tagName.toLowerCase();
  if (!WHITESPACE_PRESERVING_TEXT_TAGS.has(tag) && el.children.length === 0) {
    el.textContent = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
}

/** The bridge mints group ids against the previewed document, which can drift
 * from the saved source. The saved wrapper id must stay unique in the source
 * document, so suffix until it is. */
function uniqueManualEditSideGroupId(doc: Document, requested: string | undefined): string {
  const base = requested && requested.trim() ? requested.trim() : 'od-side-group';
  let id = base;
  let suffix = 2;
  while (doc.querySelector(`[data-od-id="${cssEscape(id)}"]`)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function promoteManualEditSourceId(doc: Document, el: Element, id: string): void {
  if (
    !id
    || id === '__body__'
    || isGeneratedManualEditPathId(id)
    || id.startsWith(MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX)
    || el.hasAttribute('data-od-id')
  ) return;
  const existing = doc.querySelector(`[data-od-id="${cssEscape(id)}"]`);
  if (!existing || existing === el) el.setAttribute('data-od-id', id);
}

function isGeneratedManualEditPathId(id: string): boolean {
  return /^path-\d+(?:-\d+)*$/.test(id);
}

const MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX = 'source-path:';

const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const REQUIRED_HTML_PARENTS: Record<string, ReadonlySet<string>> = {
  li: new Set(['ul', 'ol', 'menu']),
  dt: new Set(['dl', 'div']),
  dd: new Set(['dl', 'div']),
  tr: new Set(['table', 'thead', 'tbody', 'tfoot']),
  td: new Set(['tr']),
  th: new Set(['tr']),
  caption: new Set(['table']),
  colgroup: new Set(['table']),
  thead: new Set(['table']),
  tbody: new Set(['table']),
  tfoot: new Set(['table']),
  option: new Set(['select', 'optgroup', 'datalist']),
  optgroup: new Set(['select']),
};

const RESTRICTED_HTML_CHILDREN: Record<string, ReadonlySet<string>> = {
  ul: new Set(['li']),
  ol: new Set(['li']),
  menu: new Set(['li']),
  dl: new Set(['dt', 'dd', 'div']),
  table: new Set(['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr']),
  thead: new Set(['tr']),
  tbody: new Set(['tr']),
  tfoot: new Set(['tr']),
  tr: new Set(['td', 'th']),
  select: new Set(['option', 'optgroup']),
  optgroup: new Set(['option']),
};

const PHRASING_ONLY_HTML_PARENTS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'strong', 'em', 'b', 'i',
  'small', 'mark', 'code', 'pre', 'label', 'legend', 'summary', 'a', 'button',
  'abbr', 'cite', 'dfn', 'kbd', 'q', 's', 'samp', 'sub', 'sup', 'time', 'u', 'var',
]);

const PHRASING_HTML_CHILDREN = new Set([
  'a', 'abbr', 'b', 'br', 'button', 'cite', 'code', 'dfn', 'em', 'i', 'img',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub',
  'sup', 'time', 'u', 'var', 'wbr',
]);

export function readManualEditFields(source: string, id: string): ManualEditFields {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const kind = inferKind(el);
  if (kind === 'link') {
    return {
      text: el.textContent?.trim() ?? '',
      href: el.getAttribute('href') ?? '',
    };
  }
  if (kind === 'action') {
    return {
      text: findActionLabelTextNode(el)?.nodeValue?.trim() ?? el.textContent?.trim() ?? '',
      href: el.getAttribute('data-od-href') ?? '',
      target: el.getAttribute('data-od-target') === '_blank' ? '_blank' : '_self',
    };
  }
  if (kind === 'image') {
    return {
      src: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    };
  }
  return { text: el.textContent?.trim() ?? '' };
}

export function readManualEditStyles(source: string, id: string): ManualEditStyles {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return emptyManualEditStyles();
  const style = (el as HTMLElement).style;
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = (style[key as unknown as keyof CSSStyleDeclaration] as string | undefined) ?? '';
    return acc;
  }, {} as ManualEditStyles);
}

/** Read the responsive override for one target without resolving class/inline styles. */
export function readManualEditResponsiveSize(
  source: string,
  id: string,
  viewport: ManualEditResponsiveViewport,
): ManualEditResponsiveSizeValues | null {
  const doc = parseSource(source);
  if (!doc || !isManualEditResponsiveViewport(viewport)) return null;
  const el = findEditableElement(doc, id);
  const stableId = el?.getAttribute('data-od-id')?.trim() || id;
  if (!stableId) return null;
  const store = readResponsiveSizeStore(doc);
  const values = store[viewport]?.[stableId];
  return values ? { ...values } : null;
}

export function readManualEditAttributes(source: string, id: string): Record<string, string> {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const hideResponsiveGeneratedId = isResponsiveGeneratedTarget(el);
  const attrs: Record<string, string> = {};
  Array.from(el.attributes).forEach((attr) => {
    if (attr.name === 'data-od-runtime-id') return;
    if (
      hideResponsiveGeneratedId &&
      (attr.name === 'data-od-id' || attr.name === MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE)
    ) return;
    attrs[attr.name] = attr.value;
  });
  return attrs;
}

export function readManualEditOuterHtml(source: string, id: string): string {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return '';
  if (!isResponsiveGeneratedTarget(el)) return el.outerHTML;
  const visibleClone = el.cloneNode(true) as Element;
  visibleClone.removeAttribute('data-od-id');
  visibleClone.removeAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE);
  return visibleClone.outerHTML;
}

function isResponsiveGeneratedTarget(el: Element): boolean {
  return (
    el.hasAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE) &&
    (el.getAttribute('data-od-id')?.startsWith('od-responsive-') ?? false)
  );
}

function setResponsiveSizeRule(
  doc: Document,
  originalSource: string,
  el: Element,
  requestedId: string,
  viewport: ManualEditResponsiveViewport,
  size: ManualEditResponsiveSizePatch,
): string | null {
  if (!isManualEditResponsiveViewport(viewport)) return `Unsupported responsive viewport: ${String(viewport)}`;
  const validationError = validateResponsiveSizePatch(size);
  if (validationError) return validationError;

  const stableId = ensureResponsiveSizeTargetId(doc, el, requestedId);
  if (!stableId) return 'Responsive size target must have an id.';

  const store = readResponsiveSizeStore(doc);
  const viewportValues = { ...(store[viewport] ?? {}) };
  const nextValues: ManualEditResponsiveSizeValues = { ...(viewportValues[stableId] ?? {}) };
  for (const [key, value] of Object.entries(size) as Array<[
    keyof ManualEditResponsiveSizePatch,
    number | null,
  ]>) {
    if (value === null) delete nextValues[key];
    else nextValues[key] = Object.is(value, -0) ? 0 : value;
  }
  if (Object.keys(nextValues).length > 0) viewportValues[stableId] = nextValues;
  else delete viewportValues[stableId];
  if (Object.keys(viewportValues).length > 0) store[viewport] = viewportValues;
  else delete store[viewport];

  if (
    !responsiveSizeStoreReferencesId(store, stableId) &&
    stableId.startsWith('od-responsive-') &&
    el.hasAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE)
  ) {
    el.removeAttribute('data-od-id');
    el.removeAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE);
  }
  writeResponsiveSizeStore(doc, originalSource, store);
  return null;
}

function ensureResponsiveSizeTargetId(doc: Document, el: Element, requestedId: string): string | null {
  const existingId = el.getAttribute('data-od-id')?.trim();
  // Source-owned ids are durable even when they happen to look like one of
  // our path locators. Generated preview ids never reach this source DOM.
  if (existingId) return existingId;

  const requested = requestedId.trim();
  if (!requested) return null;
  let generatedPath = requested;
  while (generatedPath.startsWith(MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX)) {
    generatedPath = generatedPath.slice(MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX.length);
  }
  const base = isGeneratedManualEditPathId(generatedPath)
    ? `od-responsive-${generatedPath}`
    : requested;
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = doc.querySelector(`[data-od-id="${cssEscape(candidate)}"]`);
    if (!existing || existing === el) break;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  el.setAttribute('data-od-id', candidate);
  el.setAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE, '');
  return candidate;
}

function responsiveSizeStoreReferencesId(store: ResponsiveSizeStore, id: string): boolean {
  return RESPONSIVE_SIZE_VIEWPORTS.some((viewport) => Object.prototype.hasOwnProperty.call(store[viewport] ?? {}, id));
}

function validateResponsiveSizePatch(size: ManualEditResponsiveSizePatch): string | null {
  if (!size || typeof size !== 'object' || Array.isArray(size)) return 'Responsive size must be an object.';
  const entries = Object.entries(size) as Array<[string, unknown]>;
  if (entries.length === 0) return 'Responsive size must include at least one changed axis.';
  for (const [key, value] of entries) {
    if (!RESPONSIVE_SIZE_KEYS.has(key)) return `Unsupported responsive size field: ${key}`;
    if (value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a finite number or null.`;
    if (key === 'widthPercent') {
      if (value < 0 || value > 10_000 || !hasAtMostTwoDecimalPlaces(value)) {
        return `${key} must be a percentage from 0 to 10000 with at most two decimal places.`;
      }
      continue;
    }
    if (key === 'leftPercent') {
      if (value < -10_000 || value > 10_000 || !hasAtMostTwoDecimalPlaces(value)) {
        return `${key} must be a percentage from -10000 to 10000 with at most two decimal places.`;
      }
      continue;
    }
    if (key === 'topPx') {
      if (!Number.isInteger(value) || value < -250_000 || value > 250_000) {
        return `${key} must be an integer from -250000 to 250000.`;
      }
      continue;
    }
    if (!Number.isInteger(value) || value < 0) return `${key} must be a non-negative integer.`;
  }
  return null;
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const hundredths = value * 100;
  return Math.abs(hundredths - Math.round(hundredths)) < 1e-8;
}

function isManualEditResponsiveViewport(value: unknown): value is ManualEditResponsiveViewport {
  return value === 'mobile' || value === 'tablet' || value === 'desktop';
}

function readResponsiveSizeStore(doc: Document): ResponsiveSizeStore {
  const style = doc.querySelector<HTMLStyleElement>(`style[${MANUAL_EDIT_RESPONSIVE_SIZE_ATTRIBUTE}]`);
  const css = style?.textContent ?? '';
  const store: ResponsiveSizeStore = {};
  const rulePattern = new RegExp(RESPONSIVE_SIZE_RULE_PATTERN.source, 'g');
  for (const match of css.matchAll(rulePattern)) {
    const viewport = match[1];
    const encodedId = match[2];
    const declarations = match[3];
    if (!isManualEditResponsiveViewport(viewport) || !encodedId || declarations === undefined) continue;
    let id = '';
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      continue;
    }
    if (!id) continue;
    const values = parseResponsiveSizeDeclarations(declarations);
    if (Object.keys(values).length === 0) continue;
    const viewportValues = store[viewport] ?? {};
    viewportValues[id] = { ...(viewportValues[id] ?? {}), ...values };
    store[viewport] = viewportValues;
  }
  return store;
}

function parseResponsiveSizeDeclarations(declarations: string): ManualEditResponsiveSizeValues {
  const values: ManualEditResponsiveSizeValues = {};
  const declarationPattern = new RegExp(RESPONSIVE_SIZE_DECLARATION_PATTERN.source, 'gi');
  for (const match of declarations.matchAll(declarationPattern)) {
    const property = match[1];
    const rawValue = match[2];
    const unit = match[3];
    if (!property || rawValue === undefined || !unit) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    if (property === 'width' && unit === '%' && value >= 0 && value <= 10_000 && hasAtMostTwoDecimalPlaces(value)) {
      values.widthPercent = value;
    } else if (property === 'left' && unit === '%' && value >= -10_000 && value <= 10_000 && hasAtMostTwoDecimalPlaces(value)) {
      values.leftPercent = value;
    } else if (property === 'min-height' && unit === 'px' && Number.isInteger(value) && value >= 0) {
      values.minHeight = value;
    } else if (
      property === 'top' &&
      unit === 'px' &&
      Number.isInteger(value) &&
      value >= -250_000 &&
      value <= 250_000
    ) {
      values.topPx = value;
    }
  }
  return values;
}

function writeResponsiveSizeStore(doc: Document, originalSource: string, store: ResponsiveSizeStore): void {
  const css = serializeResponsiveSizeStore(store);
  let style = doc.querySelector<HTMLStyleElement>(`style[${MANUAL_EDIT_RESPONSIVE_SIZE_ATTRIBUTE}]`);
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement('style');
    style.setAttribute(MANUAL_EDIT_RESPONSIVE_SIZE_ATTRIBUTE, '');
  }
  const fullDocument = isManualEditFullHtmlDocument(originalSource);
  if (!style.isConnected || (!fullDocument && style.parentElement !== doc.body)) {
    (fullDocument ? (doc.head || doc.documentElement) : doc.body).appendChild(style);
  }
  style.textContent = `\n${css}\n`;
}

function serializeResponsiveSizeStore(store: ResponsiveSizeStore): string {
  const rules: string[] = [];
  for (const viewport of RESPONSIVE_SIZE_VIEWPORTS) {
    const viewportValues = store[viewport];
    if (!viewportValues) continue;
    for (const id of Object.keys(viewportValues).sort()) {
      const values = viewportValues[id];
      if (!values || Object.keys(values).length === 0) continue;
      const declarations: string[] = [];
      if (values.widthPercent !== undefined) declarations.push(`    width: ${values.widthPercent.toFixed(2)}% !important;`);
      if (values.minHeight !== undefined) declarations.push(`    min-height: ${values.minHeight}px !important;`);
      if (values.leftPercent !== undefined) {
        declarations.push(`    left: ${values.leftPercent.toFixed(2)}% !important;`);
        declarations.push('    right: auto !important;');
      }
      if (values.topPx !== undefined) {
        declarations.push(`    top: ${values.topPx}px !important;`);
        declarations.push('    bottom: auto !important;');
      }
      if (declarations.length === 0) continue;
      rules.push([
        `/* od-responsive-size:${viewport}:${responsiveSizeMarkerId(id)} */`,
        `@media ${RESPONSIVE_SIZE_MEDIA_QUERY[viewport]} {`,
        `  [data-od-id="${responsiveSizeCssStringEscape(id)}"] {`,
        ...declarations,
        '  }',
        '}',
      ].join('\n'));
    }
  }
  return rules.join('\n\n');
}

function responsiveSizeMarkerId(id: string): string {
  return encodeURIComponent(id).replace(/\*/g, '%2A');
}

function responsiveSizeCssStringEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
}

function parseSource(source: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(source, 'text/html');
  }
  if (typeof document !== 'undefined') {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = source;
    return doc;
  }
  return null;
}

function serializeSource(doc: Document, originalSource: string): string {
  if (!isManualEditFullHtmlDocument(originalSource)) return doc.body.innerHTML;
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function isManualEditFullHtmlDocument(source: string): boolean {
  const normalized = firstSourceToken(source).slice(0, 32).toLowerCase();
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html');
}

function firstSourceToken(source: string): string {
  let rest = source.trimStart();
  while (rest.startsWith('<!--') || rest.startsWith('<?')) {
    const close = rest.startsWith('<!--') ? '-->' : '?>';
    const end = rest.indexOf(close);
    if (end === -1) return rest;
    rest = rest.slice(end + close.length).trimStart();
  }
  return rest;
}

function inferKind(el: Element): 'text' | 'link' | 'action' | 'image' | 'container' {
  const explicit = el.getAttribute('data-od-edit');
  if (explicit === 'text' || explicit === 'link' || explicit === 'action' || explicit === 'image' || explicit === 'container') return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'action';
  if (tag === 'img') return 'image';
  if (['section', 'main', 'nav', 'div', 'article', 'header', 'footer'].includes(tag)) return 'container';
  if (el.children.length > 0) return 'container';
  return 'text';
}

export function normalizeManualEditActionHref(value: string): string | null {
  const href = value.trim();
  if (!href) return '';
  if (/[\u0000-\u001f\u007f]/.test(href)) return null;
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return null;
  if (/^(?:javascript|vbscript|data|file):/i.test(href)) return null;
  return href;
}

function findEditableElement(doc: Document, id: string): Element | null {
  if (id === '__body__') return doc.body;
  const authored = doc.querySelector(`[data-od-id="${cssEscape(id)}"]`);
  if (authored) return authored;
  if (id.startsWith(MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX)) {
    let path = id;
    while (path.startsWith(MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX)) {
      path = path.slice(MANUAL_EDIT_SOURCE_PATH_LOCATOR_PREFIX.length);
    }
    return isGeneratedManualEditPathId(path) ? findElementByExactPath(doc, path) : null;
  }
  // A raw generated path describes the document's current structure. Never
  // let stale preview annotations persisted by an older build override it.
  // Collision cases use the explicit source-path: namespace above.
  if (isGeneratedManualEditPathId(id)) return findElementByExactPath(doc, id);
  return (
    doc.querySelector(`[data-od-runtime-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-source-path="${cssEscape(id)}"]`)
  );
}

function applyDynamicBrandKitPatch(doc: Document, patch: ManualEditPatch): { ok: boolean } {
  if (!doc.getElementById('od-brand-payload')) return { ok: false };
  if (patch.kind === 'set-style') {
    setRuntimeStyleOverride(doc, patch.id, patch.styles);
    return { ok: true };
  }
  if (patch.kind === 'remove-element') {
    setRuntimeStyleOverride(doc, patch.id, { display: 'none' } as Partial<ManualEditStyles>);
    return { ok: true };
  }
  if (!manualEditPatchHasId(patch)) return { ok: false };
  return updateBrandKitPayload(doc, patch);
}

function updateBrandKitPayload(doc: Document, patch: ManualEditElementPatch): { ok: boolean } {
  const script = doc.getElementById('od-brand-payload');
  if (!script) return { ok: false };
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(script.textContent || '{}') as Record<string, unknown>;
  } catch {
    return { ok: false };
  }
  const brand = ensureRecord(payload, 'brand');
  let changed = false;
  if (patch.kind === 'set-text') {
    changed = setBrandKitTextValue(brand, patch.id, patch.value);
  } else if (patch.kind === 'set-link' && patch.id === 'brand-source') {
    brand.sourceUrl = patch.href;
    changed = true;
  } else if (patch.kind === 'set-image') {
    changed = setBrandKitImageValue(brand, patch.id, patch.src, patch.alt);
  }
  if (!changed) return setRuntimeContentOverride(doc, patch);
  clearRuntimeContentOverride(doc, patch.id);
  script.textContent = safeJsonForScript(payload);
  return { ok: true };
}

function manualEditPatchHasId(patch: ManualEditPatch): patch is ManualEditElementPatch {
  return 'id' in patch;
}

function setBrandKitTextValue(brand: Record<string, unknown>, id: string, value: string): boolean {
  if (id === 'brand-name') {
    brand.name = value;
    return true;
  }
  if (id === 'brand-tagline') {
    brand.tagline = value;
    return true;
  }
  if (id === 'brand-description') {
    brand.description = value;
    return true;
  }
  if (id === 'brand-source') {
    brand.sourceUrl = value;
    return true;
  }
  if (id === 'brand-logo-notes') {
    ensureRecord(brand, 'logo').notes = value;
    return true;
  }
  if (id === 'brand-voice-tone') {
    ensureRecord(brand, 'voice').tone = value;
    return true;
  }
  if (id === 'brand-imagery-style') {
    ensureRecord(brand, 'imagery').style = value;
    return true;
  }
  if (id === 'brand-imagery-treatment') {
    ensureRecord(brand, 'imagery').treatment = value;
    return true;
  }
  if (id === 'brand-imagery-subjects') {
    ensureRecord(brand, 'imagery').subjects = splitBrandListValue(value);
    return true;
  }
  if (id === 'brand-imagery-avoid') {
    ensureRecord(brand, 'imagery').avoid = splitBrandListValue(value);
    return true;
  }
  const adjectiveMatch = id.match(/^brand-voice-adjective-(\d+)$/);
  if (adjectiveMatch) {
    const voice = ensureRecord(brand, 'voice');
    const adjectives = ensureArray(voice, 'adjectives');
    adjectives[Number(adjectiveMatch[1])] = value;
    return true;
  }
  const pillarMatch = id.match(/^brand-voice-pillar-(\d+)$/);
  if (pillarMatch) {
    const voice = ensureRecord(brand, 'voice');
    const pillars = ensureArray(voice, 'messagingPillars');
    pillars[Number(pillarMatch[1])] = value;
    return true;
  }
  if (id === 'brand-voice-vocab-use' || id === 'brand-voice-vocab-avoid') {
    const vocabulary = ensureRecord(ensureRecord(brand, 'voice'), 'vocabulary');
    vocabulary[id === 'brand-voice-vocab-use' ? 'use' : 'avoid'] = splitBrandListValue(value);
    return true;
  }
  const colorMatch = id.match(/^brand-color-(hex|name|role|usage)-(\d+)$/);
  if (colorMatch) {
    const colors = ensureArray(brand, 'colors');
    const entry = ensureArrayRecord(colors, Number(colorMatch[2]));
    entry[colorMatch[1]!] = value;
    return true;
  }
  const imageMatch = id.match(/^brand-image-(caption|kind)-(\d+)$/);
  if (imageMatch) {
    const imagery = ensureRecord(brand, 'imagery');
    const samples = ensureArray(imagery, 'samples');
    const entry = ensureArrayRecord(samples, Number(imageMatch[2]));
    entry[imageMatch[1]!] = value;
    return true;
  }
  return false;
}

function setBrandKitImageValue(brand: Record<string, unknown>, id: string, src: string, alt: string): boolean {
  if (id === 'brand-logo-img') {
    const logo = ensureRecord(brand, 'logo');
    logo.primary = src;
    if (alt) logo.notes = alt;
    return true;
  }
  if (id === 'brand-hero-img') {
    const imagery = ensureRecord(brand, 'imagery');
    const samples = ensureArray(imagery, 'samples');
    const entry = ensureArrayRecord(samples, 0);
    entry.file = src;
    if (alt) entry.caption = alt;
    return true;
  }
  const logoThumbMatch = id.match(/^brand-logo-thumb-(\d+)$/);
  if (logoThumbMatch) {
    const logo = ensureRecord(brand, 'logo');
    const index = Number(logoThumbMatch[1]);
    if (index === 0) {
      logo.primary = src;
      if (alt) logo.notes = alt;
      return true;
    }
    const alternates = ensureArray(logo, 'alternates');
    alternates[index - 1] = src;
    return true;
  }
  const imageMatch = id.match(/^brand-image-img-(\d+)$/);
  if (!imageMatch) return false;
  const imagery = ensureRecord(brand, 'imagery');
  const samples = ensureArray(imagery, 'samples');
  const entry = ensureArrayRecord(samples, Number(imageMatch[1]));
  entry.file = src;
  if (alt) entry.caption = alt;
  return true;
}

function splitBrandListValue(value: string): string[] {
  return value
    .split(/\s*(?:·|,|，)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function setRuntimeContentOverride(doc: Document, patch: ManualEditPatch): { ok: boolean } {
  const overrides = readRuntimeContentOverrides(doc);
  if (patch.kind === 'set-text') {
    overrides.text = { ...(overrides.text ?? {}), [patch.id]: patch.value };
  } else if (patch.kind === 'set-link') {
    overrides.links = { ...(overrides.links ?? {}), [patch.id]: { text: patch.text, href: patch.href } };
  } else if (patch.kind === 'set-image') {
    overrides.images = { ...(overrides.images ?? {}), [patch.id]: { src: patch.src, alt: patch.alt } };
  } else if (patch.kind === 'set-attributes') {
    overrides.attrs = { ...(overrides.attrs ?? {}), [patch.id]: patch.attributes };
  } else if (patch.kind === 'set-outer-html') {
    overrides.html = { ...(overrides.html ?? {}), [patch.id]: patch.html };
  } else {
    return { ok: false };
  }
  writeRuntimeContentOverrides(doc, overrides);
  return { ok: true };
}

function clearRuntimeContentOverride(doc: Document, id: string): void {
  const existing = doc.getElementById(MANUAL_EDIT_RUNTIME_OVERRIDES_ID);
  if (!existing) return;
  const overrides = readRuntimeContentOverrides(doc);
  delete overrides.text?.[id];
  delete overrides.links?.[id];
  delete overrides.images?.[id];
  delete overrides.attrs?.[id];
  delete overrides.html?.[id];
  writeRuntimeContentOverrides(doc, overrides);
}

function readRuntimeContentOverrides(doc: Document): RuntimeContentOverrides {
  const script = doc.getElementById(MANUAL_EDIT_RUNTIME_OVERRIDES_ID);
  if (!script) return {};
  try {
    const parsed = JSON.parse(script.textContent || '{}') as RuntimeContentOverrides;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRuntimeContentOverrides(doc: Document, overrides: RuntimeContentOverrides): void {
  const script = runtimeOverridesElement(doc);
  script.textContent = safeJsonForScript(pruneRuntimeContentOverrides(overrides));
  ensureRuntimeOverrideApplier(doc);
}

function pruneRuntimeContentOverrides(overrides: RuntimeContentOverrides): RuntimeContentOverrides {
  const next: RuntimeContentOverrides = {};
  if (overrides.text && Object.keys(overrides.text).length > 0) next.text = overrides.text;
  if (overrides.links && Object.keys(overrides.links).length > 0) next.links = overrides.links;
  if (overrides.images && Object.keys(overrides.images).length > 0) next.images = overrides.images;
  if (overrides.attrs && Object.keys(overrides.attrs).length > 0) next.attrs = overrides.attrs;
  if (overrides.html && Object.keys(overrides.html).length > 0) next.html = overrides.html;
  return next;
}

function runtimeOverridesElement(doc: Document): HTMLScriptElement {
  const existing = doc.getElementById(MANUAL_EDIT_RUNTIME_OVERRIDES_ID);
  if (existing?.tagName.toLowerCase() === 'script') return existing as HTMLScriptElement;
  const script = doc.createElement('script');
  script.id = MANUAL_EDIT_RUNTIME_OVERRIDES_ID;
  script.type = 'application/json';
  const payload = doc.getElementById('od-brand-payload');
  if (payload?.parentNode) payload.parentNode.insertBefore(script, payload.nextSibling);
  else (doc.head || doc.documentElement).appendChild(script);
  return script;
}

function ensureRuntimeOverrideApplier(doc: Document): void {
  if (doc.getElementById(MANUAL_EDIT_RUNTIME_APPLY_ID)) return;
  const script = doc.createElement('script');
  script.id = MANUAL_EDIT_RUNTIME_APPLY_ID;
  script.textContent = RUNTIME_OVERRIDE_APPLIER_SOURCE;
  (doc.body || doc.documentElement).appendChild(script);
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === 'object' && !Array.isArray(current)) return current as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function ensureArray(parent: Record<string, unknown>, key: string): unknown[] {
  const current = parent[key];
  if (Array.isArray(current)) return current;
  const next: unknown[] = [];
  parent[key] = next;
  return next;
}

function ensureArrayRecord(array: unknown[], index: number): Record<string, unknown> {
  while (array.length <= index) array.push({});
  const current = array[index];
  if (current && typeof current === 'object' && !Array.isArray(current)) return current as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  array[index] = next;
  return next;
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function setRuntimeStyleOverride(doc: Document, id: string, styles: Partial<ManualEditStyles>): void {
  const style = runtimeStyleElement(doc);
  const selector = `[data-od-id="${cssStringEscape(id)}"]`;
  const cleaned = removeRuntimeStyleRule(style.textContent ?? '', selector);
  const body = Object.entries(styles)
    .map(([name, value]) => {
      if (typeof value !== 'string' || value.trim() === '') return '';
      return `  ${camelToKebab(name)}: ${value.trim()} !important;`;
    })
    .filter(Boolean)
    .join('\n');
  style.textContent = body ? `${cleaned}\n${selector} {\n${body}\n}\n`.trimStart() : cleaned.trim();
}

function runtimeStyleElement(doc: Document): HTMLStyleElement {
  const existing = doc.querySelector<HTMLStyleElement>('style[data-od-manual-edit-runtime-overrides]');
  if (existing) return existing;
  const style = doc.createElement('style');
  style.setAttribute('data-od-manual-edit-runtime-overrides', '');
  (doc.head || doc.documentElement).appendChild(style);
  return style;
}

function removeRuntimeStyleRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.replace(new RegExp(`\\n?${escaped}\\s*\\{[^}]*\\}\\s*`, 'g'), '\n').trim();
}

function findElementByExactPath(doc: Document, id: string): Element | null {
  if (!isGeneratedManualEditPathId(id)) return null;
  const indexes = id
    .slice('path-'.length)
    .split('-')
    .map((part) => Number(part));
  let current: Element | null = doc.body;
  for (const index of indexes) {
    current = current?.children.item(index) ?? null;
    if (!current) return null;
  }
  return current;
}

function hasElementChildren(el: Element): boolean {
  return Array.from(el.children).some((child) => child.nodeType === 1);
}

/**
 * The one text node in `el`'s subtree that carries visible (non-whitespace)
 * text, if — and only if — there is exactly one. An element with element
 * children can still be a safe target for a flat text edit when every
 * sibling/descendant besides that single node is decorative (an icon
 * `<span>`/`<svg>`, empty wrapper markup, or pure whitespace): the new value
 * has nowhere ambiguous to go, so the caller can overwrite that node in place
 * and leave the surrounding structure untouched.
 *
 * Returns null the moment a second meaningful text node shows up (genuine
 * mixed inline content like `<p><strong>Nested</strong> copy</p>`) — that
 * case has no unambiguous target, so the caller must keep refusing the patch
 * and point the user at the HTML tab instead of guessing which fragment they
 * meant to change.
 */
function findSoleMeaningfulTextNode(el: Element): Text | null {
  // Walk childNodes/nodeType directly (nodeType 3 = text, 1 = element)
  // instead of TreeWalker/NodeFilter — this code runs against a parsed
  // Document that may not come with a full global DOM realm attached.
  let found: Text | null = null;
  let ambiguous = false;
  const visit = (node: Node): void => {
    if (ambiguous) return;
    const children = node.childNodes;
    for (let i = 0; i < children.length && !ambiguous; i++) {
      const child = children[i]!;
      if (child.nodeType === 3) {
        const text = child as unknown as Text;
        const parentTag = (child.parentElement?.tagName ?? '').toLowerCase();
        const isInert = parentTag === 'script' || parentTag === 'style' || parentTag === 'template';
        if (!isInert && (text.nodeValue ?? '').trim() !== '') {
          if (found) {
            ambiguous = true;
            return;
          }
          found = text;
        }
      } else if (child.nodeType === 1) {
        visit(child);
      }
    }
  };
  visit(el);
  return ambiguous ? null : found;
}

/**
 * Buttons commonly keep a secondary count/badge inside a child element while
 * their editable label is the button's one direct text node:
 * `<button>All <span class="count">31</span></button>`. Prefer that direct
 * node so changing “All” preserves the count. Icon + nested-label buttons have
 * no direct text, so they retain the stricter single-meaningful-node fallback.
 */
function findActionLabelTextNode(el: Element): Text | null {
  const direct = Array.from(el.childNodes).filter((child): child is Text => (
    child.nodeType === 3 && (child.nodeValue ?? '').trim() !== ''
  ));
  if (direct.length === 1) return direct[0]!;
  if (direct.length > 1) return null;
  return findSoleMeaningfulTextNode(el);
}

function setInlineStyles(el: HTMLElement, styles: Partial<ManualEditStyles>): void {
  for (const [name, value] of Object.entries(styles)) {
    const cssName = camelToKebab(name);
    if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
    else el.style.setProperty(cssName, value.trim());
  }
}

function setAttributes(el: Element, attributes: Record<string, string>): void {
  const protectedAttrs = new Set(['data-od-id', 'data-od-edit', 'data-od-label', 'data-od-runtime-id']);
  for (const [name, value] of Object.entries(attributes)) {
    if (!isSafeAttributeName(name) || protectedAttrs.has(name)) continue;
    if (value.trim() === '') el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}

function replaceOuterHtml(doc: Document, el: Element, html: string): { ok: true } | { ok: false; error: string } {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const elements = Array.from(template.content.children);
  if (elements.length !== 1) return { ok: false, error: 'Replacement HTML must contain exactly one root element.' };
  const next = elements[0]!;
  if (el.getAttribute('data-od-id') && !next.getAttribute('data-od-id')) {
    next.setAttribute('data-od-id', el.getAttribute('data-od-id') ?? '');
  }
  if (
    el.hasAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE) &&
    !next.hasAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE)
  ) {
    next.setAttribute(MANUAL_EDIT_RESPONSIVE_GENERATED_ID_ATTRIBUTE, '');
  }
  if (el.getAttribute('data-od-edit') && !next.getAttribute('data-od-edit')) {
    next.setAttribute('data-od-edit', el.getAttribute('data-od-edit') ?? '');
  }
  el.replaceWith(next);
  return { ok: true };
}

function isLastRenderableBodyChild(doc: Document, el: Element): boolean {
  const renderableBodyChildren = Array.from(doc.body.children).filter((child) => {
    if (child === el) return true;
    return !isNonRenderableBodyChild(child);
  });
  return renderableBodyChildren.length === 1 && renderableBodyChildren[0] === el;
}

function isNonRenderableBodyChild(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript';
}

function setCssToken(doc: Document, token: string, value: string): boolean {
  const styles = Array.from(doc.querySelectorAll('style'));
  const pattern = new RegExp(`(${escapeRegExp(token)}\\s*:\\s*)([^;]+)(;)`);
  for (const style of styles) {
    const text = style.textContent ?? '';
    if (!pattern.test(text)) continue;
    style.textContent = text.replace(pattern, `$1${value}$3`);
    return true;
  }
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function isSafeAttributeName(value: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(value);
}
