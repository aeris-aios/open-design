// @vitest-environment jsdom

// The structure rail replaced the Design Files category grid for projects that
// have pages. These cover the parts the parent panel's suite cannot see: the
// tab switch itself, the page-outline parser behind the Layers tab, and the
// asset views.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignStructurePanel } from '../../src/components/design-files/DesignStructurePanel';
import { parseHtmlOutline } from '../../src/components/design-files/htmlOutline';
import type { ProjectFile } from '../../src/types';

vi.mock('../../src/collab/collab-context', () => ({
  useProjectCollabContext: () => ({
    workspaceContext: null,
    workspaceContextLoading: false,
  }),
}));

function file(overrides: Partial<ProjectFile> & { name: string }): ProjectFile {
  return {
    size: 100,
    mtime: 1_700_000_000_000,
    kind: 'html',
    mime: 'text/html',
    ...overrides,
  };
}

// The rail takes `t` from its parent, so the tests read English labels through
// a passthrough that renders the key's interpolations.
const t = ((key: string, vars?: Record<string, string | number>) => {
  const labels: Record<string, string> = {
    'designStructure.tabStructure': 'Structure',
    'designStructure.tabLayers': 'Layers',
    'designStructure.tabEdit': 'Edit',
    'designStructure.tabAssets': 'Assets',
    'designStructure.allPages': 'All pages',
    'designStructure.groupPageCount': `${vars?.groups} groups · ${vars?.pages} pages`,
    'designStructure.layersTitle': `What ${vars?.page} is made of`,
    'designStructure.layerCount': `${vars?.n} layers`,
    'designStructure.layersEmpty': 'No structure to expand',
    'designStructure.layersNoPage': 'Pick a page first',
    'designStructure.editTitle': 'Pick an element on the canvas',
    'designStructure.editHint': 'Open the page and switch on Inspect',
    'designStructure.editOpen': `Open ${vars?.page}`,
    'designStructure.assetsBrand': 'Brand',
    'designStructure.assetsMine': 'My assets',
    'designStructure.assetsBrandEmpty': 'No design system files yet',
    'designStructure.assetsMineEmpty': 'No images yet',
    'designFiles.empty': 'No files yet',
    'designFiles.sectionImages': 'Images',
    'designFiles.sectionFolders': 'Folders',
    'designFiles.sectionLiveArtifacts': 'Live artifacts',
    'designFiles.showMore': `Show +${vars?.n} more`,
    'designFiles.openInTab': 'Open in tab',
    'workspace.allProjectFiles': 'All project files',
    'common.loading': 'Loading',
  };
  return labels[key] ?? key;
}) as never;

function renderRail(files: ProjectFile[], overrides: Record<string, unknown> = {}) {
  const onOpenFile = vi.fn();
  const result = render(
    <DesignStructurePanel
      projectId="p1"
      currentDir=""
      dirs={[]}
      files={files}
      liveArtifacts={[]}
      selected={new Set()}
      onToggleSelect={vi.fn()}
      onEnterDir={vi.fn()}
      onOpenFile={onOpenFile}
      onOpenLiveArtifact={vi.fn()}
      categoryLabel={(category) => `cat:${category}`}
      t={t}
      {...overrides}
    />,
  );
  return { ...result, onOpenFile };
}

afterEach(() => cleanup());

describe('DesignStructurePanel structure tab', () => {
  it('keeps tree controls out of the global bordered 36px button treatment', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/design-files/DesignStructurePanel.module.css'),
      'utf8',
    );
    const treeHeadRule = css.match(/\.treeHead\s*\{[^}]+\}/)?.[0] ?? '';
    const nodeRule = css.match(/\.node\s*\{[^}]+\}/)?.[0] ?? '';
    const nodeOpenRule = css.match(/\.nodeOpen\s*\{[^}]+\}/)?.[0] ?? '';

    for (const rule of [treeHeadRule, nodeRule, nodeOpenRule]) {
      expect(rule).toContain('height: auto;');
      expect(rule).toContain('border: 0;');
      expect(rule).toContain('background: transparent;');
      expect(rule).toContain('box-shadow: none;');
    }
    expect(nodeOpenRule).toContain('padding: 0;');
    expect(css).toContain('.treeHead:hover:not(:disabled)');
    expect(css).toContain('.nodeOpen:hover:not(:disabled)');
  });

  it('lists pages only in Structure when structurePagesOnly is set, keeping Assets whole', () => {
    renderRail(
      [
        file({ name: 'index.html' }),
        file({ name: 'asset-01.png', kind: 'image', mime: 'image/png' }),
      ],
      { structurePagesOnly: true },
    );

    // No image category group under the page tree…
    expect(screen.queryByText('cat:image')).toBeNull();
    expect(screen.queryByText('asset-01.png')).toBeNull();

    // …but the Assets tab still sees the full inventory.
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));
    fireEvent.click(screen.getByTestId('design-structure-assets-images'));
    expect(screen.getByTestId('design-structure-asset-asset-01.png')).toBeTruthy();
  });

  it('marks the page already open in the viewer instead of the first page in the list', () => {
    renderRail(
      [file({ name: 'ops-portal-hifi.html' }), file({ name: 'ops-portal-wireframe.html' })],
      {
        structurePagesOnly: true,
        viewerOnly: true,
        activePageName: 'ops-portal-wireframe.html',
      },
    );

    expect(
      screen.getByTestId('design-file-row-ops-portal-hifi.html').getAttribute('aria-current'),
    ).toBeNull();
    expect(
      screen.getByTestId('design-file-row-ops-portal-wireframe.html').getAttribute('aria-current'),
    ).toBe('page');
  });

  it('shows root pages directly and previews the hovered or focused row', async () => {
    const onPreviewPageChange = vi.fn();
    const { onOpenFile } = renderRail(
      [file({ name: 'index.html' }), file({ name: 'cart.html' })],
      { structurePagesOnly: true, viewerOnly: true, onPreviewPageChange },
    );

    expect(screen.queryByRole('button', { name: /All pages/ })).toBeNull();
    const rail = screen.getByTestId('design-structure-rail');
    const rootPageGroup = rail.querySelector<HTMLElement>(
      "[data-role='structure-page-group'][data-root-pages='true']",
    );
    expect(rail.getAttribute('data-structure-pages-only')).toBe('true');
    expect(rootPageGroup?.getAttribute('data-flat')).toBe('true');
    expect(rootPageGroup?.querySelector("[data-role='structure-group-head']")).toBeNull();
    const indexRow = screen.getByTestId('design-file-row-index.html');
    const cartRow = screen.getByTestId('design-file-row-cart.html');
    expect(indexRow).toBeTruthy();
    expect(cartRow).toBeTruthy();
    expect(indexRow.getAttribute('data-role')).toBe('structure-page-row');
    expect(indexRow.getAttribute('aria-current')).toBe('page');
    expect(indexRow.querySelector('[data-testid^="design-structure-check-"]')).toBeNull();

    const indexButton = indexRow.querySelector<HTMLButtonElement>(
      "[data-role='structure-page-open']",
    )!;
    expect(indexButton).toBeTruthy();
    fireEvent.focus(indexButton);
    await waitFor(() => {
      expect(onPreviewPageChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'index.html' }));
    });

    fireEvent.mouseEnter(cartRow);
    await waitFor(() => {
      expect(onPreviewPageChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'cart.html' }));
    });
    fireEvent.mouseLeave(cartRow);
    await waitFor(() => {
      expect(onPreviewPageChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'index.html' }));
    });

    fireEvent.blur(indexButton, { relatedTarget: null });
    await waitFor(() => expect(onPreviewPageChange).toHaveBeenLastCalledWith(null));

    fireEvent.click(cartRow.querySelector('button')!);
    expect(onOpenFile).toHaveBeenCalledWith('cart.html');
  });

  it('keeps the viewer page tree compact through semantic CSS when its module chunk is absent', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/viewer/canvas.css'), 'utf8');
    const rootHeadRule = css.match(
      /\[data-role='structure-page-group'\]\[data-root-pages='true'\]\s*>\s*\[data-role='structure-group-head'\]\s*\{[^}]+\}/,
    )?.[0] ?? '';
    const pageRowRule = css.match(
      /\[data-role='structure-page-row'\]\s*\{[^}]+\}/,
    )?.[0] ?? '';
    const activePageRowRule = css.match(
      /\[data-role='structure-page-row'\]\[aria-current='page'\]\s*\{[^}]+\}/,
    )?.[0] ?? '';
    const pageOpenRule = css.match(
      /\[data-role='structure-page-open'\]\s*\{[^}]+\}/,
    )?.[0] ?? '';

    expect(css).toMatch(
      /\.viewer-structure-rail\s*>\s*\[data-testid='design-structure-rail'\]\[data-structure-pages-only='true'\]\s+\[data-role='structure-page-row'\]\s*\{/,
    );
    expect(rootHeadRule).toContain('display: none;');
    expect(pageRowRule).toContain('all: unset;');
    expect(pageRowRule).toContain('height: auto;');
    expect(pageRowRule).toContain('border: 0;');
    expect(pageRowRule).toContain('background: transparent;');
    expect(pageRowRule).toContain('box-shadow: none;');
    expect(pageOpenRule).toContain('all: unset;');
    expect(pageOpenRule).toContain('height: auto;');
    expect(pageOpenRule).toContain('padding: 0;');
    expect(pageOpenRule).toContain('border: 0;');
    expect(pageOpenRule).toContain('background: transparent;');
    expect(pageOpenRule).toContain('box-shadow: none;');
    expect(activePageRowRule).toContain('background: var(--brand-soft);');
    expect(activePageRowRule).toContain(
      'box-shadow: inset 0 0 0 var(--stroke-thin) var(--brand-text);',
    );
  });


  // The structure tab carries no head row: the tab strip above it already says
  // Structure, and the tally it used to print is restated per group on the rows
  // themselves. Those per-group counts are the contract now.
  it('counts each page group on its own row, with no head row above the tree', () => {
    renderRail([
      file({ name: 'index.html' }),
      file({ name: 'cart.html' }),
      file({ name: 'shop/orders.html' }),
    ]);

    expect(
      screen.getByTestId('design-structure-rail').textContent,
    ).not.toContain('groups ·');
    expect(screen.getByRole('button', { name: /All pages/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: /shop/ }).textContent).toContain('1');
  });

  it('collapses a group without losing its count', () => {
    renderRail([file({ name: 'index.html' }), file({ name: 'cart.html' })]);

    expect(screen.getByTestId('design-file-row-index.html')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /All pages/ }));
    expect(screen.queryByTestId('design-file-row-index.html')).toBeNull();
    expect(screen.getByRole('button', { name: /All pages/ }).textContent).toContain('2');
  });

  it('marks the page opened from the tree as the active page', () => {
    const { onOpenFile } = renderRail([
      file({ name: 'index.html' }),
      file({ name: 'cart.html' }),
    ]);

    const cart = screen.getByTestId('design-file-row-cart.html');
    fireEvent.click(cart.querySelector('button')!);
    expect(onOpenFile).toHaveBeenCalledWith('cart.html');
    // Layers describes whichever page the tree last put in focus.
    fireEvent.click(screen.getByTestId('design-structure-tab-layers'));
    expect(screen.getByTestId('design-structure-rail').textContent).toContain(
      'What cart is made of',
    );
  });
});

describe('DesignStructurePanel layers tab', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          '<html><body><div class="app"><header><h1>Orders</h1></header>'
          + '<main><section class="list"><h2>Pending</h2></section></main>'
          + '<footer>bye</footer></div></body></html>',
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the selected page structure parsed from its real source', async () => {
    renderRail([file({ name: 'orders.html' })]);
    fireEvent.click(screen.getByTestId('design-structure-tab-layers'));

    await waitFor(() => {
      expect(screen.getAllByTestId('design-structure-layer').length).toBeGreaterThan(0);
    });
    const text = screen.getByTestId('design-structure-rail').textContent ?? '';
    expect(text).toContain('Orders');
    expect(text).toContain('header');
    expect(text).toContain('footer');
  });

  it('says which page to pick when the project has none', () => {
    renderRail([file({ name: 'notes.txt', kind: 'text', mime: 'text/plain' })]);
    fireEvent.click(screen.getByTestId('design-structure-tab-layers'));

    expect(screen.getByTestId('design-structure-rail').textContent).toContain(
      'Pick a page first',
    );
  });
});

describe('DesignStructurePanel assets tab', () => {
  it('defaults to every project file and keeps images in their own view', () => {
    const { onOpenFile } = renderRail([
      file({ name: 'generated/index.html', mtime: 30 }),
      file({ name: 'notes.txt', kind: 'text', mime: 'text/plain', mtime: 20 }),
      file({ name: 'DESIGN.md', kind: 'text', mime: 'text/markdown', mtime: 10 }),
      file({ name: 'hero.png', kind: 'image', mime: 'image/png' }),
    ]);
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));

    expect(screen.getByTestId('design-structure-assets-view')).toBeTruthy();
    expect(screen.getByTestId('design-structure-assets-tabs').getAttribute('role')).toBe('tablist');
    expect(screen.getByTestId('design-structure-assets-group-head')).toBeTruthy();
    expect(screen.getByTestId('design-structure-assets-group-title').textContent).toBe('All project files');
    expect(screen.getByTestId('design-structure-assets-count').textContent).toBe('4');
    expect(screen.getByTestId('design-structure-assets-files').getAttribute('aria-selected')).toBe('true');
    const generatedHtml = screen.getByTestId('design-structure-asset-generated/index.html');
    expect(generatedHtml.querySelector('[data-role="asset-name"]')?.textContent).toBe('generated/index.html');
    expect(generatedHtml.querySelector('[data-role="asset-extension"]')?.textContent).toBe('HTML');
    expect(screen.getByTestId('design-structure-asset-notes.txt')).toBeTruthy();
    expect(screen.getByTestId('design-structure-asset-DESIGN.md')).toBeTruthy();
    expect(screen.getByTestId('design-structure-asset-hero.png')).toBeTruthy();

    fireEvent.click(screen.getByTestId('design-structure-asset-generated/index.html'));
    fireEvent.click(screen.getByTestId('design-structure-asset-notes.txt'));
    expect(onOpenFile).toHaveBeenNthCalledWith(1, 'generated/index.html');
    expect(onOpenFile).toHaveBeenNthCalledWith(2, 'notes.txt');

    fireEvent.click(screen.getByTestId('design-structure-assets-images'));
    fireEvent.click(screen.getByTestId('design-structure-asset-hero.png'));
    expect(onOpenFile).toHaveBeenNthCalledWith(3, 'hero.png');
  });

  it('uses the canvas-preview callback and marks the rendered asset', () => {
    const onPreviewAsset = vi.fn();
    renderRail(
      [file({ name: 'index.html' }), file({ name: 'notes.txt', kind: 'text', mime: 'text/plain' })],
      { onPreviewAsset, activeAssetName: 'notes.txt' },
    );
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));

    const notes = screen.getByTestId('design-structure-asset-notes.txt');
    expect(notes.getAttribute('aria-current')).toBe('true');
    fireEvent.click(notes);
    expect(onPreviewAsset).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt' }));
  });

  it('keeps long asset paths intact while exposing separate name and extension cells', () => {
    const longName = 'assets/generated/previews/operations-portal-desktop-final-preview.png';
    renderRail([
      file({ name: 'index.html' }),
      file({ name: longName, kind: 'image', mime: 'image/png' }),
    ]);
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));

    const head = screen.getByTestId('design-structure-assets-group-head');
    expect(head.contains(screen.getByTestId('design-structure-assets-group-title'))).toBe(true);
    expect(head.contains(screen.getByTestId('design-structure-assets-count'))).toBe(true);
    expect(screen.getByTestId('design-structure-assets-count').textContent).toBe('2');
    const row = screen.getByTestId(`design-structure-asset-${longName}`);
    expect(row.getAttribute('title')).toBe(longName);
    expect(row.querySelector('[data-role="asset-name"]')?.textContent).toBe(longName);
    expect(row.querySelector('[data-role="asset-extension"]')?.textContent).toBe('PNG');
  });

  it('reveals project files in bounded batches', () => {
    renderRail(Array.from({ length: 51 }, (_, index) => file({ name: `page-${index}.html` })));
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));

    expect(screen.getAllByTestId(/^design-structure-asset-page-/)).toHaveLength(50);
    fireEvent.click(screen.getByTestId('design-structure-reveal-asset-files'));
    expect(screen.getAllByTestId(/^design-structure-asset-page-/)).toHaveLength(51);
  });
});

describe('parseHtmlOutline', () => {
  it('descends through single-child wrappers so the first real region is top level', () => {
    const outline = parseHtmlOutline(
      '<div class="app"><div class="page"><header><h1>Hi</h1></header></div></div>',
    );

    expect(outline[0]).toMatchObject({ label: 'Hi', meta: 'header', depth: 0 });
  });

  it('prefers an explicit label over the heading inside', () => {
    const outline = parseHtmlOutline(
      '<nav aria-label="Primary"><h2>Ignored</h2></nav>',
    );

    expect(outline[0]?.label).toBe('Primary');
  });

  it('falls back to id then class for anonymous boxes', () => {
    const outline = parseHtmlOutline(
      '<div id="hero"><span>a</span><span>b</span></div>'
      + '<div class="grid tight"><span>a</span><span>b</span></div>',
    );

    expect(outline.map((node) => node.label)).toEqual(['#hero', '.grid']);
  });

  it('skips scripts and styles', () => {
    const outline = parseHtmlOutline(
      '<script>var a = 1</script><style>a{}</style><main>x</main>',
    );

    expect(outline.map((node) => node.meta)).toEqual(['main']);
  });

  it('stops at the node limit instead of mirroring a huge page', () => {
    const source = `<body>${'<section>x</section>'.repeat(500)}</body>`;

    expect(parseHtmlOutline(source, 30)).toHaveLength(30);
  });

  it('returns nothing for markup with no structure', () => {
    expect(parseHtmlOutline('')).toEqual([]);
    expect(parseHtmlOutline('plain text')).toEqual([]);
  });
});
