// @vitest-environment jsdom

// The structure rail replaced the Design Files category grid for projects that
// have pages. These cover the parts the parent panel's suite cannot see: the
// tab switch itself, the page-outline parser behind the Layers tab, and the
// asset views.
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
    'designFiles.sectionFolders': 'Folders',
    'designFiles.sectionLiveArtifacts': 'Live artifacts',
    'designFiles.showMore': `Show +${vars?.n} more`,
    'designFiles.openInTab': 'Open in tab',
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
    fireEvent.click(screen.getByTestId('design-structure-assets-mine'));
    expect(screen.getByTestId('design-structure-asset-asset-01.png')).toBeTruthy();
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
  it('shows the project images and opens one on click', () => {
    const { onOpenFile } = renderRail([
      file({ name: 'index.html' }),
      file({ name: 'hero.png', kind: 'image', mime: 'image/png' }),
    ]);
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));

    fireEvent.click(screen.getByTestId('design-structure-asset-hero.png'));
    expect(onOpenFile).toHaveBeenCalledWith('hero.png');
  });

  it('reads as empty rather than borrowed when the project carries no design system', () => {
    renderRail([file({ name: 'index.html' })]);
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));
    fireEvent.click(screen.getByTestId('design-structure-assets-brand'));

    expect(screen.getByTestId('design-structure-rail').textContent).toContain(
      'No design system files yet',
    );
  });

  it('lists the design system files the project actually has', () => {
    renderRail([
      file({ name: 'index.html' }),
      file({ name: 'DESIGN.md', kind: 'text', mime: 'text/markdown' }),
      file({ name: 'design-system/tokens.css', kind: 'code', mime: 'text/css' }),
    ]);
    fireEvent.click(screen.getByTestId('design-structure-tab-assets'));
    fireEvent.click(screen.getByTestId('design-structure-assets-brand'));

    const text = screen.getByTestId('design-structure-rail').textContent ?? '';
    expect(text).toContain('DESIGN.md');
    expect(text).toContain('design-system/tokens.css');
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
