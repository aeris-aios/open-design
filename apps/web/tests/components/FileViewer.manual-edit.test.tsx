// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileViewer,
  cancelManualEditPendingStyleSnapshot,
} from '../../src/components/FileViewer';
import { emptyManualEditStyles, type ManualEditTarget } from '../../src/edit-mode/types';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileViewer manual edit regressions', () => {
  function clickManualTool(testId: string) {
    fireEvent.click(screen.getByTestId(testId));
  }

  async function previewFrame() {
    return waitFor(() => {
      const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      if (!node.contentWindow) throw new Error('Preview frame not ready');
      return node;
    });
  }

  async function enterManualEditMode() {
    const initialFrame = await previewFrame();
    const postMessageSpy = vi.spyOn(initialFrame.contentWindow!, 'postMessage');

    clickManualTool('manual-edit-mode-toggle');

    const captureRequest = postMessageSpy.mock.calls
      .map(([value]) => value)
      .find((value) => (
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: unknown }).type === 'od:preview-runtime-state-capture'
      )) as { type: string; id: string } | undefined;
    if (captureRequest) {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'od:preview-runtime-state-captured',
            id: captureRequest.id,
            state: {
              version: 1,
              hash: '',
              htmlAttrs: {},
              bodyAttrs: {},
              entries: [],
            },
          },
          source: initialFrame.contentWindow,
        }));
      });
    }

    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-mode-toggle').getAttribute('aria-pressed')).toBe('true');
      const activeFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(activeFrame.getAttribute('data-od-active')).toBe('true');
      expect(activeFrame.getAttribute('data-od-render-mode')).toBe('srcdoc');
    });
  }

  async function hoverManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-hover', target },
        source: frame.contentWindow,
      }));
    });
    // Hover only surfaces the affordance; it must not open any panel.
    await waitFor(() => {
      expect(screen.getByTestId('manual-edit-hover-open')).toBeTruthy();
    });
  }

  // Clicking the empty canvas is the gesture that opens the compact page card.
  async function clickManualEditBackground() {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-background' },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
  }

  // Hover only surfaces the "edit params" affordance; pinning the inspector to
  // a target now requires an explicit click (mirrors clicking that affordance
  // or a container/image body in the bridge).
  async function selectManualEditTarget(target = heroTarget()) {
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-select', target },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).not.toBeNull();
    });
  }

  // Parameter rows are addressed by their localized `.cc-label`, matching the
  // rewritten panel's single "Parameters" list (the old hardcoded TYPOGRAPHY /
  // SIZE / LAYOUT / BOX group headers are gone).
  async function findStyleInput(label: string) {
    return waitFor(() => {
      const input = Array.from(document.querySelectorAll('.cc-row'))
        .find((row) => row.querySelector('.cc-label')?.textContent === label)
        ?.querySelector('input') as HTMLInputElement | null;
      if (!input) throw new Error(`${label} input not found`);
      return input;
    });
  }

  const FONT_SIZE_ROW = 'Font size';

  // The bridge posts this once a structural drag resolves a valid component
  // slot. The host persists a parent/sibling reorder immediately.
  async function dropManualEditDrag(
    id: string,
    parentId: string,
    beforeId: string | null = null,
    generation?: string,
    requestId = `test-move-${id}`,
  ) {
    const frame = await previewFrame();
    const resolvedGeneration = generation
      ?? frame.srcdoc.match(/var generation = "([^"]+)"/)?.[1]
      ?? '';
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-drag-commit',
          id,
          parentId,
          beforeId,
          generation: resolvedGeneration,
          requestId,
        },
        source: frame.contentWindow,
      }));
    });
  }

  it('removes invalid fields from pending manual edit style saves without dropping unrelated fields', () => {
    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px', color: '#111111' },
    }, 'hero', ['fontSize'])).toEqual({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { color: '#111111' },
    });

    expect(cancelManualEditPendingStyleSnapshot({
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    }, 'hero', ['fontSize'])).toBeNull();

    const otherTargetPending = {
      id: 'hero',
      label: 'Style: Hero',
      version: 1,
      styles: { fontSize: '4px' },
    };
    expect(cancelManualEditPendingStyleSnapshot(otherTargetPending, 'cta', ['fontSize'])).toBe(otherTargetPending);
  });

  it('opens edit mode with page properties docked beside a clean canvas', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    // Page properties occupy the existing rail instead of floating over the
    // artboard, matching the Edit tab's default state.
    await waitFor(() => {
      expect(document.querySelector('.viewer-structure-rail .manual-edit-page-card')).not.toBeNull();
    });
    expect(screen.getByText('PAGE')).toBeTruthy();

    // Hovering surfaces the click affordance without replacing page properties.
    await hoverManualEditTarget();
    expect(document.querySelector('.viewer-structure-rail .manual-edit-page-card')).not.toBeNull();
    expect(screen.getByText('PAGE')).toBeTruthy();
    expect(screen.getByTestId('manual-edit-hover-open')).toBeTruthy();
  });

  it('splits a structure rail off the right edge while edit mode is on', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files')) {
        return new Response(JSON.stringify({
          files: [
            { name: 'index.html', path: 'index.html', kind: 'html', mime: 'text/html', size: 10, mtime: 1 },
            { name: 'cart.html', path: 'cart.html', kind: 'html', mime: 'text/html', size: 10, mtime: 1 },
          ],
        }));
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    // The rail belongs to edit mode: it is what you reach for between edits,
    // and it has no business taking canvas width the rest of the time.
    expect(screen.queryByTestId('viewer-structure-rail')).toBeNull();

    await enterManualEditMode();

    const rail = await screen.findByTestId('viewer-structure-rail');
    fireEvent.click(screen.getByTestId('design-structure-tab-structure'));
    await waitFor(() => expect(rail.textContent).toContain('cart'));
    expect(rail.textContent).toContain('index');
  });

  it('opens the compact page-styles card when the empty canvas is clicked', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await clickManualEditBackground();

    expect(screen.getByText('PAGE')).toBeTruthy();
    expect(document.querySelector('.manual-edit-page-card')).not.toBeNull();
  });

  it('replaces page properties with a target inspector after clicking the hover affordance', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await hoverManualEditTarget();
    // Hover alone keeps the page card in place.
    expect(document.querySelector('.viewer-structure-rail .manual-edit-page-card')).not.toBeNull();

    fireEvent.click(screen.getByTestId('manual-edit-hover-open'));

    // Selected target inspector exposes the localized font-size control.
    await findStyleInput(FONT_SIZE_ROW);
    expect(screen.queryByText('PAGE')).toBeNull();
    // Affordance hides once its element is the pinned selection.
    expect(screen.queryByTestId('manual-edit-hover-open')).toBeNull();
  });

  it('docks the inspector in the structure rail instead of floating it over the artboard', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    // Arming Edit opens the page-styles card straight away, so the rail lands
    // on its Edit tab with that card docked — not on Structure.
    await waitFor(() => {
      expect(screen.getByTestId('design-structure-tab-edit').getAttribute('aria-selected')).toBe('true');
    });
    expect(document.querySelector('.viewer-structure-rail .manual-edit-page-card')).not.toBeNull();

    await selectManualEditTarget();

    // Clicking an element is a request to see its properties, so the rail
    // brings Edit forward and the inspector renders inside it.
    await waitFor(() => {
      expect(screen.getByTestId('design-structure-tab-edit').getAttribute('aria-selected')).toBe('true');
    });
    expect(document.querySelector('.viewer-structure-rail .manual-edit-right')).not.toBeNull();
    expect(screen.getByTestId('design-structure-edit-slot')).toBeTruthy();

    // …and nothing floats over the artboard any more: a card anchored beside
    // the selection covered the neighbours you style an element against.
    expect(document.querySelector('.manual-edit-workspace .manual-edit-right')).toBeNull();
    expect(document.querySelector('.manual-edit-floating')).toBeNull();
    expect(document.querySelector('.manual-edit-drag-handle')).toBeNull();
  });

  it('does not let a pending manual edit style save survive a file switch', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('<!doctype html><html><body></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = htmlPreviewFile();
    const second = { ...htmlPreviewFile(), name: 'second.html', path: 'second.html' };
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={first}
        liveHtml='<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>'
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);
    fireEvent.change(baseSizeInput, { target: { value: '18' } });

    rerender(
      <FileViewer projectId="project-1" projectKind="prototype" file={second}
        liveHtml='<!doctype html><html><body><main data-od-id="second">Second</main></body></html>'
      />,
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('clears loaded source immediately on file switch without liveHtml before manual edit can save', async () => {
    let secondResolve!: (value: Response) => void;
    const secondFetch = new Promise<Response>((resolve) => {
      secondResolve = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/second.html')) return secondFetch;
      return new Response('<!doctype html><html><body><main data-od-id="hero">First</main></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const first = htmlPreviewFile();
      const second = { ...htmlPreviewFile(), name: 'second.html', path: 'second.html' };
      const { rerender } = render(<FileViewer projectId="project-1" projectKind="prototype" file={first} />);

      // The raw fetch is cache-busted on every mtime / reload / files-refresh
      // bump so srcDoc-mode previews see fresh HTML after agent edits.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/projects\/project-1\/raw\/preview\.html(\?|$)/),
        { cache: 'no-store' },
      ));
      await enterManualEditMode();
      await selectManualEditTarget();
      const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);
      fireEvent.change(baseSizeInput, { target: { value: '18' } });

      rerender(<FileViewer projectId="project-1" projectKind="prototype" file={second} />);
      fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      });

      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      secondResolve(new Response('<!doctype html><html><body><main data-od-id="second">Second</main></body></html>', { status: 200 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a prior manual edit save error after a later successful save', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    let saveAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return new Response(JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Request failed (403).' },
          }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/raw/preview.html')) {
        return new Response(source, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText(/Could not save the edited file/)).toBeTruthy();
    });

    fireEvent.change(baseSizeInput, { target: { value: '19' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.queryByText(/Could not save the edited file/)).toBeNull();
    });
  });

  it('closes the inspector without saving on cancel, staying in edit mode', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async () =>
      new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(document.querySelector('.manual-edit-right')).toBeNull();
    });
    expect(document.querySelector('.manual-edit-workspace')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('closes the inspector after save succeeds, staying in edit mode', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const baseSizeInput = await findStyleInput(FONT_SIZE_ROW);

    fireEvent.change(baseSizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(document.querySelector('.manual-edit-right')).toBeNull();
    });
    expect(document.querySelector('.manual-edit-workspace')).not.toBeNull();
  });

  it('replies to the reloaded preview with the pre-save scroll position after a panel save (#92)', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();

    // The host cannot read a sandboxed iframe's scroll directly; the bridge
    // reports it via od:preview-scroll while the user works. Dispatch from
    // every mounted preview frame — only the active one passes the host's
    // source filter, mirroring production.
    const previewFrames = ['artifact-preview-frame', 'artifact-preview-frame-srcdoc']
      .map((testId) => screen.queryByTestId(testId) as HTMLIFrameElement | null)
      .filter((frame): frame is HTMLIFrameElement => Boolean(frame?.contentWindow));
    expect(previewFrames.length).toBeGreaterThan(0);
    act(() => {
      for (const frame of previewFrames) {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'od:preview-scroll', frameLeft: 0, frameTop: 1234, canvasLeft: 0, canvasTop: 1234 },
          source: frame.contentWindow,
        }));
      }
    });

    // A TEXT change is a content patch: saving it rewrites the frozen source,
    // which rebuilds the srcDoc and reloads the iframe from the top (a style
    // change streams live and never reloads, so it would not cover this bug).
    const textarea = document.querySelector('.manual-edit-right textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'Hero edited' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/files',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(document.querySelector('.manual-edit-right')).toBeNull();
    });

    // The reloaded document's bridge asks where to scroll back to. The reply
    // must carry the pre-save position — not the long-stale edit-entry
    // snapshot and not a zeroed fallback (#92: preview jumped to the top).
    const restoreMessages: Array<{ frameTop?: number; canvasTop?: number }> = [];
    const spies = previewFrames.map((frame) =>
      vi.spyOn(frame.contentWindow as Window, 'postMessage').mockImplementation(((message: unknown) => {
        const data = message as { type?: string; frameTop?: number; canvasTop?: number } | null;
        if (data && data.type === 'od:preview-scroll-restore') restoreMessages.push(data);
      }) as never),
    );
    try {
      act(() => {
        for (const frame of previewFrames) {
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'od:preview-scroll-request' },
            source: frame.contentWindow,
          }));
        }
      });
      await waitFor(() => {
        expect(restoreMessages.length).toBeGreaterThan(0);
      });
      expect(restoreMessages.some((data) => data.frameTop === 1234 && data.canvasTop === 1234)).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('persists a snapped drag as an HTML component reorder without a transform', async () => {
    const source = '<!doctype html><html><body><main data-od-id="page"><section data-od-id="source"><article data-od-id="card-a">A</article></section><section data-od-id="target"><article data-od-id="card-b">B</article></section></main></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onFileSaved = vi.fn(async () => {
      throw new Error('File list refresh failed after the write');
    });

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
        onFileSaved={onFileSaved}
      />,
    );

    await enterManualEditMode();
    const frame = await previewFrame();
    const initialSrcDoc = frame.srcdoc;
    const hostReplySpy = vi.spyOn(frame.contentWindow!, 'postMessage');
    await dropManualEditDrag('card-a', 'target', 'card-b');

    await waitFor(() => {
      expect(savedBodies.length).toBe(1);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-drag-result',
          requestId: 'test-move-card-a',
          accepted: true,
        }),
        '*',
      );
    });
    const payload = JSON.parse(savedBodies[0]!) as { content: string };
    expect(payload.content).toContain(
      '<section data-od-id="target"><article data-od-id="card-a">A</article><article data-od-id="card-b">B</article></section>',
    );
    expect(payload.content).not.toContain('translate(');
    expect(onFileSaved).toHaveBeenCalledTimes(1);
    // Structural saves rebuild from the authoritative source so generated
    // paths are recalculated before another drag starts.
    expect(await previewFrame()).toBe(frame);
    expect(frame.srcdoc).not.toBe(initialSrcDoc);
    expect(frame.srcdoc).toContain(
      '<section data-od-id="target" data-od-source-path="path-0-1"><article data-od-id="card-a" data-od-source-path="path-0-1-0">A</article>',
    );
  });

  it('persists a responsive corner resize without rebuilding the active iframe and resets that viewport rule', async () => {
    const initialSource = '<!doctype html><html><body><main><section class="card" data-od-id="card">Card copy</section></main></body></html>';
    let persistedSource = initialSource;
    const savedBodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const body = String(init.body);
        savedBodies.push(body);
        persistedSource = (JSON.parse(body) as { content: string }).content;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/versions')) {
        return new Response(JSON.stringify({ versions: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(persistedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={initialSource}
      />,
    );

    await enterManualEditMode();
    const frame = await previewFrame();
    const initialSrcDoc = frame.srcdoc;
    const hostReplySpy = vi.spyOn(frame.contentWindow!, 'postMessage');
    await selectManualEditTarget({
      ...heroTarget(),
      id: 'card',
      kind: 'container',
      label: 'Card',
      tagName: 'section',
      text: 'Card copy',
      fields: { text: 'Card copy' },
      attributes: { class: 'card', 'data-od-id': 'card' },
      isLayoutContainer: true,
      sizing: {
        resizable: true,
        boxSizing: 'border-box',
        position: 'static',
        containingBlockWidth: 800,
        paddingBorderX: 0,
        paddingBorderY: 0,
        hasUnsupportedTransform: false,
      },
      outerHtml: '<section class="card" data-od-id="card">Card copy</section>',
    });

    const resizeGeneration = frame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'od-edit-resize-commit',
          id: 'card',
          requestId: 'test-stale-resize-card',
          generation: 'stale-generation',
          viewport: 'desktop',
          size: { widthPercent: 90, minHeight: 240 },
        },
      }));
    });
    await waitFor(() => {
      expect(savedBodies).toHaveLength(0);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-resize-result',
          requestId: 'test-stale-resize-card',
          accepted: false,
        }),
        '*',
      );
    });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'od-edit-resize-commit',
          id: 'card',
          requestId: 'test-resize-card',
          generation: resizeGeneration,
          viewport: 'desktop',
          size: { widthPercent: 62.5, minHeight: 180 },
        },
      }));
    });

    await waitFor(() => {
      expect(savedBodies).toHaveLength(1);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'od-edit-resize-result',
          requestId: 'test-resize-card',
          accepted: true,
        }),
        '*',
      );
    });
    const resizedSource = (JSON.parse(savedBodies[0]!) as { content: string }).content;
    expect(resizedSource).toContain('style data-od-responsive-size');
    expect(resizedSource).toContain('@media (min-width: 1024px)');
    expect(resizedSource).toContain('width: 62.50% !important');
    expect(resizedSource).toContain('min-height: 180px !important');
    expect(resizedSource).toContain('class="card"');
    expect(await previewFrame()).toBe(frame);
    expect(frame.srcdoc).toBe(initialSrcDoc);
    expect((await findStyleInput('Width')).value).toBe('62.50%');
    expect((await findStyleInput('Height')).value).toBe('180');

    fireEvent.click(screen.getByText('Reset'));
    await waitFor(() => expect(savedBodies).toHaveLength(2));
    const resetSource = (JSON.parse(savedBodies[1]!) as { content: string }).content;
    expect(resetSource).not.toContain('data-od-responsive-size');
    expect(resetSource).toContain('<section class="card" data-od-id="card">Card copy</section>');
  });

  it('refreshes generated paths between consecutive structural drags', async () => {
    const source = '<!doctype html><html><body><main><article>A</article><article>B</article><article>C</article></main></body></html>';
    const savedBodies: string[] = [];
    let persistedSource = source;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        persistedSource = (JSON.parse(String(init.body)) as { content: string }).content;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(persistedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    const frame = await previewFrame();
    const hostReplySpy = vi.spyOn(frame.contentWindow!, 'postMessage');
    const generationFromFrame = () => (
      frame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? ''
    );
    const firstGeneration = generationFromFrame();
    expect(firstGeneration).not.toBe('');

    act(() => {
      for (const generation of ['stale-generation', '']) {
        window.dispatchEvent(new MessageEvent('message', {
          source: frame.contentWindow,
          data: {
            type: 'od-edit-drag-commit',
            id: 'path-0-0',
            transform: 'translate(120px, 40px)',
            generation,
          },
        }));
      }
    });

    await dropManualEditDrag('path-0-0', 'path-0', null, '', 'test-empty-generation');
    await waitFor(() => {
      expect(savedBodies).toHaveLength(0);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'test-empty-generation', accepted: false }),
        '*',
      );
    });

    await dropManualEditDrag('path-0-0', 'path-0', null, firstGeneration);
    await waitFor(() => {
      expect(savedBodies).toHaveLength(1);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'test-move-path-0-0', accepted: true }),
        '*',
      );
      expect(frame.srcdoc).toMatch(
        /<article[^>]*data-od-source-path="path-0-0"[^>]*>B<\/article>/,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // A second message from the old document must be rejected even if its
    // stale paths still happen to resolve to valid (but wrong) source nodes.
    await dropManualEditDrag('path-0-2', 'path-0', 'path-0-1', firstGeneration, 'test-stale-move');
    await waitFor(() => {
      expect(savedBodies).toHaveLength(1);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'test-stale-move', accepted: false }),
        '*',
      );
    });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'od-edit-text-commit',
          id: 'path-0-0',
          value: 'Wrong stale edit',
          generation: firstGeneration,
        },
      }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(savedBodies).toHaveLength(1);

    // The first save rebuilt the document, so C and B now use their current
    // paths rather than the aliases from before A moved.
    const secondGeneration = generationFromFrame();
    expect(secondGeneration).not.toBe(firstGeneration);
    await dropManualEditDrag('path-0-1', 'path-0', 'path-0-0', secondGeneration);
    await waitFor(() => {
      expect(savedBodies).toHaveLength(2);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'test-move-path-0-1', accepted: true }),
        '*',
      );
    });

    const payload = JSON.parse(savedBodies[1]!) as { content: string };
    expect(payload.content).toContain('<main><article>C</article><article>B</article><article>A</article></main>');
    expect(payload.content).not.toContain('data-od-id="path-');
    expect(document.querySelector('.od-toast.tone-error')).toBeNull();
  });

  it('keeps an unselected structural drag out of the open panel draft', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main><aside data-od-id="side">Side</aside></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    await findStyleInput(FONT_SIZE_ROW);

    // A structural commit for a different element saves the reorder but does
    // not dirty the panel that is still showing `hero`.
    await dropManualEditDrag('side', '__body__', 'hero');

    expect(screen.queryByText('Reset')).toBeNull();
    await waitFor(() => expect(savedBodies).toHaveLength(1));
    const payload = JSON.parse(savedBodies[0]!) as { content: string };
    expect(payload.content.indexOf('data-od-id="side"')).toBeLessThan(
      payload.content.indexOf('data-od-id="hero"'),
    );
  });

  it('saves a dirty inspector draft before allowing a structural drag', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main><aside data-od-id="side">Side</aside></body></html>';
    const savedBodies: string[] = [];
    let persistedSource = source;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        persistedSource = (JSON.parse(String(init.body)) as { content: string }).content;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(persistedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Edited before drag' } });
    const frame = await previewFrame();
    const hostReplySpy = vi.spyOn(frame.contentWindow!, 'postMessage');
    const generation = frame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';

    await dropManualEditDrag('side', '__body__', 'hero', generation, 'dirty-draft-move');
    await waitFor(() => {
      expect(savedBodies).toHaveLength(1);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'dirty-draft-move', accepted: false }),
        '*',
      );
    });
    const contentPayload = JSON.parse(savedBodies[0]!) as { content: string };
    expect(contentPayload.content).toContain('<main data-od-id="hero">Edited before drag</main><aside data-od-id="side">Side</aside>');
    expect(screen.getByLabelText('Text')).toHaveValue('Edited before drag');

    const retryGeneration = frame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';
    expect(retryGeneration).not.toBe(generation);
    await dropManualEditDrag('side', '__body__', 'hero', retryGeneration, 'retry-dirty-draft-move');
    await waitFor(() => {
      expect(savedBodies).toHaveLength(2);
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'retry-dirty-draft-move', accepted: true }),
        '*',
      );
    });
    const movePayload = JSON.parse(savedBodies[1]!) as { content: string };
    expect(movePayload.content).toContain('<aside data-od-id="side">Side</aside><main data-od-id="hero">Edited before drag</main>');
  });

  it('rebuilds from an externally changed file before another structural drag', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main><aside data-od-id="side">Side</aside></body></html>';
    const externalSource = '<!doctype html><html><body><aside data-od-id="side">Side external</aside><main data-od-id="hero">Hero external</main></body></html>';
    let persistedSource = source;
    const savedBodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(persistedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const oldFrame = await previewFrame();
    const oldGeneration = oldFrame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';
    const hostReplySpy = vi.spyOn(oldFrame.contentWindow!, 'postMessage');
    persistedSource = externalSource;

    await dropManualEditDrag('side', '__body__', 'hero', oldGeneration, 'external-conflict-move');
    await waitFor(() => {
      expect(hostReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'external-conflict-move', accepted: false }),
        '*',
      );
      expect(savedBodies).toHaveLength(0);
    });
    const refreshedFrame = await previewFrame();
    await waitFor(() => {
      expect(refreshedFrame.srcdoc).toContain('Side external');
      expect(refreshedFrame.srcdoc).toContain('Hero external');
    });
    const refreshedGeneration = refreshedFrame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';
    expect(refreshedGeneration).not.toBe(oldGeneration);
    expect(document.querySelector('.manual-edit-target-card')).toBeNull();
  });

  it('mints a usable generation when an external conflict restores the frozen document', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main><aside data-od-id="side">Side</aside></body></html>';
    let persistedSource = source;
    const savedBodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        persistedSource = (JSON.parse(String(init.body)) as { content: string }).content;
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(persistedSource, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const originalFrame = await previewFrame();
    const originalGeneration = originalFrame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';
    const sizeInput = await findStyleInput(FONT_SIZE_ROW);
    fireEvent.change(sizeInput, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(savedBodies).toHaveLength(1));

    // A style save updates sourceRef without replacing the frozen document.
    // Simulate an external writer restoring exactly that frozen source.
    persistedSource = source;
    const oldReplySpy = vi.spyOn(originalFrame.contentWindow!, 'postMessage');
    await dropManualEditDrag('side', '__body__', 'hero', originalGeneration, 'same-frozen-conflict');
    await waitFor(() => {
      expect(savedBodies).toHaveLength(1);
      expect(oldReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'same-frozen-conflict', accepted: false }),
        '*',
      );
    });

    const refreshedFrame = await previewFrame();
    const refreshedGeneration = refreshedFrame.srcdoc.match(/var generation = "([^"]+)"/)?.[1] ?? '';
    expect(refreshedGeneration).not.toBe(originalGeneration);

    const refreshedReplySpy = vi.spyOn(refreshedFrame.contentWindow!, 'postMessage');
    await dropManualEditDrag('side', '__body__', 'hero', refreshedGeneration, 'post-conflict-move');
    await waitFor(() => {
      expect(savedBodies).toHaveLength(2);
      expect(refreshedReplySpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'post-conflict-move', accepted: true }),
        '*',
      );
    });
  });

  it('saves text typed in the inspector while an inline text session is active', async () => {
    const source = '<!doctype html><html><body><main data-od-id="hero">Hero</main></body></html>';
    const savedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        savedBodies.push(String(init.body));
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget();
    const frame = await previewFrame();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'od-edit-text-session', id: 'hero', active: true },
        source: frame.contentWindow,
      }));
    });

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Edited from panel' } });
    fireEvent.click(screen.getByText('Save'));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'od-edit-text-session',
          id: 'hero',
          active: false,
          changed: false,
          committed: false,
        },
        source: frame.contentWindow,
      }));
    });

    await waitFor(() => {
      expect(savedBodies.length).toBe(1);
    });
    const payload = JSON.parse(savedBodies[0]!) as { content: string };
    expect(payload.content).toContain('<main data-od-id="hero">Edited from panel</main>');
    expect(payload.content).not.toContain('<main data-od-id="hero">Hero</main>');
  });

  it('keeps the preview mounted and does not save when deleting the only rendered root', async () => {
    const source = '<!doctype html><html><body><main data-od-id="app-root">App</main><script>window.bootApp && window.bootApp();</script></body></html>';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ file: htmlPreviewFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(source, { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlPreviewFile()}
        liveHtml={source}
      />,
    );

    await enterManualEditMode();
    await selectManualEditTarget({
      ...heroTarget(),
      id: 'app-root',
      label: 'App root',
      text: 'App',
      outerHtml: '<main data-od-id="app-root">App</main>',
    });

    fireEvent.click(screen.getByLabelText('Delete element'));

    await waitFor(() => {
      expect(screen.getByText('Cannot remove the last rendered element in the document.')).toBeTruthy();
    });
    const errorToast = screen.getByRole('alert');
    expect(errorToast.classList.contains('manual-edit-error-toast')).toBe(true);
    expect(errorToast.classList.contains('placement-top')).toBe(true);
    expect(errorToast.classList.contains('tone-error')).toBe(true);
    expect(document.querySelector('.manual-edit-panel .manual-edit-error')).toBeNull();
    expect((screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).srcdoc).toContain('data-od-id="app-root"');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/projects/project-1/files',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'main',
    className: '',
    text: 'Hero',
    rect: { x: 24, y: 24, width: 160, height: 48 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<main data-od-id="hero">Hero</main>',
  };
}

function htmlPreviewFile(): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    mime: 'text/html',
    kind: 'html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}
