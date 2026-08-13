// @vitest-environment jsdom

// Regression suite for the 0.18.0 client meltdown: a 7442-file web-clone
// project rendered EVERY nested HTML file as a thumbnail card at the project
// root, and every card fetched its content on mount. 4000+ concurrent
// fetches exhausted local sockets (net::ERR_INSUFFICIENT_RESOURCES) and
// 502'd the web<->daemon proxy. The contract under test:
// A project with pages now navigates through the structure rail, whose rows
// carry no thumbnail and issue no per-row fetch — which removes the fetch
// storm at the source. The contract under test:
//   1. a page-bearing project issues NO content fetch on mount;
//   2. the rail renders a bounded batch per group and reveals the rest on
//      demand, so 500 pages never land in one commit;
//   3. the image masonry (still the surface for page-free projects) renders
//      incrementally behind an invisible end-of-grid sentinel;
//   4. the root directory still lists every nested file (semantics guard).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { DesignFilesPanel } from "../src/components/DesignFilesPanel";
import { resetHtmlThumbnailSourceCache } from "../src/components/html-thumbnail-source-cache";
import type { ProjectFile } from "../src/types";

// Stub localStorage with an in-memory store so no test bleeds view state into
// the next (same convention as tests/components/DesignFilesPanel.test.tsx).
const lsStore = new Map<string, string>();

// Manually triggerable IntersectionObserver stand-in. jsdom ships no
// IntersectionObserver, and the component treats that as "everything is
// immediately visible" — so lazy behavior can only be asserted by installing
// a fake whose intersections the test fires explicitly.
type IntersectionCallback = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => void;

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }

  readonly observed = new Set<Element>();

  constructor(
    readonly callback: IntersectionCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function fireIntersection(target: Element): void {
  for (const instance of [...FakeIntersectionObserver.instances]) {
    if (!instance.observed.has(target)) continue;
    instance.callback(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      instance as unknown as IntersectionObserver,
    );
  }
}

/** Fire intersection for every element currently matching `selector`. */
function intersectAll(selector: string): void {
  act(() => {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      fireIntersection(el);
    }
  });
}

/** Reveal grid batches until the sentinel disappears (list fully rendered). */
function drainGridSentinel(maxRounds = 30): void {
  for (let round = 0; round < maxRounds; round += 1) {
    const sentinel = screen.queryByTestId("design-files-grid-sentinel");
    if (!sentinel) return;
    act(() => fireIntersection(sentinel));
  }
  throw new Error("grid sentinel never drained");
}

const BASE_MTIME = 1700000000000;

function htmlFile(name: string, index: number): ProjectFile {
  return {
    name,
    path: name,
    type: "file",
    size: 4096,
    mtime: BASE_MTIME - index * 1000,
    kind: "html",
    mime: "text/html",
  };
}

/**
 * Nested pages shaped like the web-clone incident project: every file lives
 * several directories deep (`ja/plugins/p1/index.html`), none at the root.
 */
function nestedHtmlFiles(count: number, localeRoot = "ja"): ProjectFile[] {
  return Array.from({ length: count }, (_, i) =>
    htmlFile(`${localeRoot}/plugins/p${i + 1}/index.html`, i),
  );
}

function imageFile(name: string, index: number): ProjectFile {
  return {
    name,
    path: name,
    type: "file",
    size: 2048,
    mtime: BASE_MTIME - index * 1000,
    kind: "image",
    mime: "image/png",
  };
}

function renderPanel(
  files: ProjectFile[],
  overrides: Partial<ComponentProps<typeof DesignFilesPanel>> = {},
) {
  return render(
    <DesignFilesPanel
      projectId="lazy-render-project"
      files={files}
      liveArtifacts={[]}
      onRefreshFiles={vi.fn()}
      onOpenFile={vi.fn()}
      onOpenLiveArtifact={vi.fn()}
      onRenameFile={vi.fn()}
      onDeleteFile={vi.fn()}
      onDeleteFiles={vi.fn()}
      onUpload={vi.fn()}
      onUploadFiles={vi.fn()}
      onPaste={vi.fn()}
      onNewSketch={vi.fn()}
      {...overrides}
    />,
  );
}

/**
 * fetch stub whose responses stay pending until the test releases them.
 * Every release is also registered module-wide so afterEach can settle
 * whatever a test left pending: an in-flight request holds its pool slot
 * until it settles (slots are NOT freed by unmount), so an unsettled mock
 * fetch would leak its slot into the next test. Firing a release twice is
 * harmless — resolving an already-resolved promise is a no-op.
 */
const outstandingReleases: Array<() => void> = [];

function pendingFetchMock() {
  const releases: Array<() => void> = [];
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        const release = () =>
          resolve(
            new Response(
              "<!doctype html><html><body><main>page</main></body></html>",
              {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              },
            ),
          );
        releases.push(release);
        outstandingReleases.push(release);
      }),
  );
  return { fetchMock, releases };
}

beforeEach(() => {
  lsStore.clear();
  resetHtmlThumbnailSourceCache();
  FakeIntersectionObserver.reset();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => lsStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      lsStore.set(key, value);
    },
    removeItem: (key: string) => {
      lsStore.delete(key);
    },
    clear: () => {
      lsStore.clear();
    },
  });
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(async () => {
  cleanup();
  // Settle every request the test left pending so retained slots return to
  // the pool before the next test starts (see pendingFetchMock docblock).
  await act(async () => {
    for (const release of outstandingReleases.splice(0)) release();
  });
  vi.unstubAllGlobals();
});

describe("DesignFilesPanel page content fetches", () => {
  it("fetches no page content when listing a project's pages", () => {
    const { fetchMock } = pendingFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    renderPanel(nestedHtmlFiles(200));

    // The root view lists all 200 nested pages. The rail's rows are text, so
    // there is no per-row content fetch to storm the proxy with — the
    // condition that produced the 0.18.0 socket exhaustion cannot arise.
    expect(fetchMock).not.toHaveBeenCalled();
  });

});

describe("DesignFilesPanel incremental grid rendering", () => {
  it("renders a bounded batch of page rows for 500 files and grows on demand", () => {
    const { fetchMock } = pendingFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    renderPanel(nestedHtmlFiles(500));

    // Every page sits under the same top-level folder, so they share one
    // group. The group renders its first batch only.
    const rows = () =>
      document.querySelectorAll('[data-testid^="design-file-row-"]').length;
    expect(rows()).toBe(50);

    fireEvent.click(screen.getByTestId("design-structure-reveal-pages:ja"));
    expect(rows()).toBe(100);
  });

  it("renders the image masonry incrementally behind the same sentinel", () => {
    // Root-level names: with no folders and no pages, Images is the sole tab
    // and the masonry is the default view.
    const { container } = renderPanel(
      Array.from({ length: 120 }, (_, i) => imageFile(`img-${i + 1}.png`, i)),
    );

    expect(
      container.querySelectorAll(".df-image-masonry .df-card--image").length,
    ).toBe(48);

    const sentinel = screen.getByTestId("design-files-grid-sentinel");
    act(() => fireIntersection(sentinel));
    expect(
      container.querySelectorAll(".df-image-masonry .df-card--image").length,
    ).toBe(96);
  });

  it("adds no visible chrome to the image masonry: no load-more and no loading copy", () => {
    const { container } = renderPanel(
      Array.from({ length: 200 }, (_, i) => imageFile(`shot-${i + 1}.png`, i)),
    );

    const sentinel = screen.getByTestId("design-files-grid-sentinel");
    expect(sentinel.textContent).toBe("");
    // Every button inside the masonry belongs to a card, not to pagination.
    const grid = container.querySelector(".df-image-masonry")!;
    for (const button of Array.from(grid.querySelectorAll("button"))) {
      expect(button.closest(".df-card")).not.toBeNull();
    }
  });
});

// Semantics guard: the root view's recursive flat listing is intentional
// (#see dirsAtCurrentDir derivation) — the lazy-render fix must not silently
// turn it into an immediate-children-only listing. Green before AND after.
describe("DesignFilesPanel root recursive listing (guard)", () => {
  it("still lists every nested file at the root and can reveal them all", () => {
    const { fetchMock } = pendingFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    renderPanel(nestedHtmlFiles(200));

    // The group row counts every nested page, not just the rendered batch.
    // (It used to be read off the tab's head row, which is gone — the tab strip
    // already names the surface and the counts live on the rows.)
    // `aria-expanded` picks the collapsible group row apart from the folder row
    // of the same name.
    const groupRow = screen
      .getAllByRole("button", { name: /^ja/ })
      .find((button) => button.hasAttribute("aria-expanded"));
    expect(groupRow?.textContent).toContain("200");

    // Revealing until the button is gone eventually renders every row.
    for (let guard = 0; guard < 20; guard += 1) {
      const reveal = screen.queryByTestId("design-structure-reveal-pages:ja");
      if (!reveal) break;
      fireEvent.click(reveal);
    }
    expect(
      document.querySelectorAll('[data-testid^="design-file-row-"]').length,
    ).toBe(200);
    expect(
      screen.getByTestId("design-file-row-ja/plugins/p1/index.html"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("design-file-row-ja/plugins/p200/index.html"),
    ).toBeTruthy();
  });
});
