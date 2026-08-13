import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectCollabContext } from '../../collab/collab-context';
import { appendResourceQuery } from '../../collab/workspace-identity';
import type { Dict } from '../../i18n/types';
import { projectFileUrl } from '../../providers/registry';
import type { LiveArtifactWorkspaceEntry, ProjectFile } from '../../types';
import { Icon } from '../Icon';
import { LiveArtifactBadges } from '../LiveArtifactBadges';
import { RemixIcon } from '../RemixIcon';
import { type FileCategory, fileCategory, SECTION_ORDER } from './fileCategories';
import { type HtmlOutlineNode, parseHtmlOutline } from './htmlOutline';
import styles from './DesignStructurePanel.module.css';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

type StructureTab = 'structure' | 'layers' | 'edit' | 'assets';
type AssetsSubTab = 'brand' | 'mine';

const TAB_ORDER: readonly StructureTab[] = ['structure', 'layers', 'edit', 'assets'];

const TAB_LABEL_KEYS: Record<StructureTab, keyof Dict> = {
  structure: 'designStructure.tabStructure',
  layers: 'designStructure.tabLayers',
  edit: 'designStructure.tabEdit',
  assets: 'designStructure.tabAssets',
};

/**
 * Rows rendered per group before the reader has to ask for more.
 *
 * The tree replaced a thumbnail grid whose unbounded render melted a
 * 7442-file project (see tests/design-files-lazy-render.test.tsx). Tree rows
 * carry no thumbnail and issue no per-row fetch, so the network side of that
 * incident is gone — but an unbounded DOM is still an unbounded DOM.
 */
const GROUP_RENDER_BATCH = 50;

/**
 * Files that make a project's design system legible on disk. The Brand section
 * lists what the project ACTUALLY carries rather than a catalog of installable
 * kits, so a project with no system reads as empty instead of borrowed.
 */
const DESIGN_SYSTEM_BASENAMES = new Set([
  'design.md',
  'design_system.md',
  'design-system.md',
  'tokens.json',
  'tokens.css',
  'brand.md',
]);
const DESIGN_SYSTEM_DIR_PATTERN = /(^|\/)(design[-_]?system|design[-_]?tokens|brand)\//iu;

interface StructureGroup {
  key: string;
  label: string;
  /** True for a group of pages — only these count toward the page total. */
  pages: boolean;
  entries: ProjectFile[];
}

export interface DesignStructurePanelProps {
  projectId: string;
  /** Directory the panel is browsing; '' is the project root. */
  currentDir: string;
  /** Immediate subdirectory names of `currentDir`. */
  dirs: string[];
  /** Files at `currentDir` — the same set the card grid used to render. */
  files: ProjectFile[];
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  /** Basename of the working directory, used as the root page group's label. */
  rootDirName?: string;
  /** Read-only viewer of a shared project: no batch selection. */
  viewerOnly?: boolean;
  selected: ReadonlySet<string>;
  onToggleSelect: (name: string) => void;
  onEnterDir: (dir: string) => void;
  onOpenFile: (name: string) => void;
  onOpenLiveArtifact: (tabId: LiveArtifactWorkspaceEntry['tabId']) => void;
  /** Opens the row's context menu at a viewport position (rename / delete / …). */
  onOpenRowMenu?: (name: string, position: { top: number; left: number }) => void;
  /**
   * The parent's inline rename editor for `name`, or null when that file is not
   * being renamed. Rename state lives in the parent (the context menu starts it
   * and the commit hits the parent's API), so the rail only hosts the input.
   */
  renderRenameInput?: (name: string) => ReactNode | null;
  /**
   * A live property inspector to host in the Edit tab, supplied by a caller
   * that has a canvas next to the rail. Without it the tab falls back to
   * pointing at the real editor — see `EditView`.
   */
  editSlot?: ReactNode;
  /**
   * True while `editSlot` has something selected to describe. The rail switches
   * to Edit on the rising edge: clicking an element on the canvas is a request
   * to see its properties, and leaving the reader on Structure would answer it
   * off-screen.
   */
  editSlotActive?: boolean;
  /**
   * Which tabs this mount offers, in order. Defaults to all four. The viewer's
   * edit rail passes a reduced set: it stands beside a live canvas that already
   * answers "what is this page made of" by hover and selection, so a Layers
   * tree there is a second, colder copy of the thing under the cursor.
   */
  tabs?: readonly StructureTab[];
  /**
   * Structure tab lists pages only — no image/other category groups. The
   * viewer's edit rail sets this: its Structure answers "which pages does this
   * prototype have", and the project's image library lives one tab over in
   * Assets. Listed under the page tree it is 22 rows of noise whose every row,
   * when clicked, swaps the page being edited for a picture. The Design Files
   * surface keeps the full inventory — there the rail IS the file browser.
   */
  structurePagesOnly?: boolean;
  /** Plural section header for a category, owned by the parent panel's dictionary. */
  categoryLabel: (category: FileCategory) => string;
  t: TranslateFn;
}

/**
 * The Design Files surface's structure rail: a page tree plus the layer,
 * element-edit, and asset views that hang off whichever page is selected.
 *
 * This replaces the category tab bar and thumbnail grid. Directory navigation,
 * batch selection, and the row context menu are NOT part of that replacement —
 * they stay wired to the parent panel, which owns the upload target directory
 * and the batch action bar.
 */
export function DesignStructurePanel({
  projectId,
  currentDir,
  dirs,
  files,
  liveArtifacts,
  rootDirName,
  viewerOnly,
  selected,
  onToggleSelect,
  onEnterDir,
  onOpenFile,
  onOpenLiveArtifact,
  onOpenRowMenu,
  renderRenameInput,
  editSlot,
  editSlotActive = false,
  structurePagesOnly = false,
  tabs = TAB_ORDER,
  categoryLabel,
  t,
}: DesignStructurePanelProps) {
  const [tab, setTab] = useState<StructureTab>(() => tabs[0] ?? 'structure');
  const [assetsSubTab, setAssetsSubTab] = useState<AssetsSubTab>('mine');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [revealed, setRevealed] = useState<Readonly<Record<string, number>>>({});
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  const pages = useMemo(
    () => files.filter((file) => fileCategory(file) === 'html'),
    [files],
  );

  // The rail always has a page in focus so Layers has something to describe.
  // Deriving the fallback (instead of syncing it through an effect) keeps a
  // deleted selection from leaving one stale frame on screen.
  const activePage = useMemo(() => {
    if (selectedPage && pages.some((page) => page.name === selectedPage)) return selectedPage;
    return pages[0]?.name ?? null;
  }, [selectedPage, pages]);

  const groups = useMemo(
    () => buildGroups(
      structurePagesOnly ? files.filter((file) => fileCategory(file) === 'html') : files,
      currentDir,
      rootDirName,
      categoryLabel,
      t,
    ),
    [files, currentDir, rootDirName, categoryLabel, structurePagesOnly, t],
  );

  const dirCounts = useMemo(() => {
    const prefix = currentDir === '' ? '' : `${currentDir}/`;
    const counts: Record<string, number> = {};
    for (const dir of dirs) {
      const dirPrefix = `${prefix}${dir}/`;
      counts[dir] = files.filter((file) => file.name.startsWith(dirPrefix)).length;
    }
    return counts;
  }, [dirs, files, currentDir]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const revealMore = useCallback((key: string) => {
    setRevealed((current) => ({
      ...current,
      [key]: (current[key] ?? GROUP_RENDER_BATCH) + GROUP_RENDER_BATCH,
    }));
  }, []);

  const openPage = useCallback(
    (name: string) => {
      setSelectedPage(name);
      onOpenFile(name);
    },
    [onOpenFile],
  );

  // Rising edge only. Switching on every render while a selection is live would
  // pin the reader to Edit, so a deliberate move to Layers or Assets mid-edit
  // would not survive the next keystroke in the inspector.
  useEffect(() => {
    if (editSlotActive) setTab('edit');
  }, [editSlotActive]);

  // A mount that drops a tab must not be left showing it — `tab` survives a
  // change of `tabs`, and the body below would otherwise render a view whose
  // tab no longer exists to switch away from.
  useEffect(() => {
    setTab((current) => (tabs.includes(current) ? current : tabs[0] ?? 'structure'));
  }, [tabs]);

  return (
    <div className={styles.rail} data-testid="design-structure-rail">
      {/* A single-tab mount (the flow map's rail) has nothing to switch, so
          the chip and the rule under it would only name what the reader is
          already looking at — the header earns its row only with a choice. */}
      {tabs.length > 1 ? (
        <div className={styles.tabs} role="tablist" aria-label={t('designStructure.tabStructure')}>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
              data-testid={`design-structure-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {t(TAB_LABEL_KEYS[id])}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.body}>
        {tab === 'structure' ? (
          <StructureTree
            groups={groups}
            dirs={dirs}
            dirCounts={dirCounts}
            collapsed={collapsed}
            revealed={revealed}
            liveArtifacts={liveArtifacts}
            activePage={activePage}
            viewerOnly={viewerOnly}
            selected={selected}
            currentDir={currentDir}
            onToggleSelect={onToggleSelect}
            onToggleGroup={toggleGroup}
            onRevealMore={revealMore}
            onEnterDir={onEnterDir}
            onOpenPage={openPage}
            onOpenLiveArtifact={onOpenLiveArtifact}
            onOpenRowMenu={onOpenRowMenu}
            renderRenameInput={renderRenameInput}
            t={t}
          />
        ) : null}
        {tab === 'layers' ? (
          <LayersView projectId={projectId} pages={pages} activePage={activePage} t={t} />
        ) : null}
        {tab === 'edit' ? (
          <EditView
            activePage={activePage}
            onOpenFile={onOpenFile}
            editSlot={editSlot}
            t={t}
          />
        ) : null}
        {tab === 'assets' ? (
          <AssetsView
            projectId={projectId}
            files={files}
            subTab={assetsSubTab}
            onSubTabChange={setAssetsSubTab}
            onOpenFile={onOpenFile}
            t={t}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

function StructureTree({
  groups,
  dirs,
  dirCounts,
  collapsed,
  revealed,
  liveArtifacts,
  activePage,
  viewerOnly,
  selected,
  currentDir,
  onToggleSelect,
  onToggleGroup,
  onRevealMore,
  onEnterDir,
  onOpenPage,
  onOpenLiveArtifact,
  onOpenRowMenu,
  renderRenameInput,
  t,
}: {
  groups: StructureGroup[];
  dirs: string[];
  dirCounts: Readonly<Record<string, number>>;
  collapsed: ReadonlySet<string>;
  revealed: Readonly<Record<string, number>>;
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  activePage: string | null;
  viewerOnly?: boolean;
  selected: ReadonlySet<string>;
  currentDir: string;
  onToggleSelect: (name: string) => void;
  onToggleGroup: (key: string) => void;
  onRevealMore: (key: string) => void;
  onEnterDir: (dir: string) => void;
  onOpenPage: (name: string) => void;
  onOpenLiveArtifact: (tabId: LiveArtifactWorkspaceEntry['tabId']) => void;
  onOpenRowMenu?: (name: string, position: { top: number; left: number }) => void;
  renderRenameInput?: (name: string) => ReactNode | null;
  t: TranslateFn;
}) {
  return (
    <div className={styles.column}>
      <div className={styles.group}>
        {/* No head row here. The tab strip directly above already says 结构, so
            repeating it named the surface twice, and the group/page tally it
            carried is restated by the counts on the tree's own group rows
            ("全部页面 5", "图片 22"). Layers and Assets keep their heads —
            those name something the tab does not. */}
        {dirs.length > 0 ? (
          <div className={styles.tree}>
            <div className={styles.treeStaticHead}>{t('designFiles.sectionFolders')}</div>
            {dirs.map((dir) => (
              <div key={dir} className={styles.node} data-testid={`design-dir-row-${dir}`}>
                <RemixIcon name="arrow-down-s-line" size={12} className={styles.dirGlyph} />
                <button
                  type="button"
                  className={styles.nodeOpen}
                  onClick={() => onEnterDir(currentDir === '' ? dir : `${currentDir}/${dir}`)}
                >
                  <span className={styles.nodeName}>{dir}</span>
                </button>
                <span className={styles.nodeExt}>{dirCounts[dir] ?? 0}</span>
              </div>
            ))}
          </div>
        ) : null}
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          const limit = revealed[group.key] ?? GROUP_RENDER_BATCH;
          const visible = group.entries.slice(0, limit);
          const hidden = group.entries.length - visible.length;
          return (
            <div key={group.key} className={styles.tree}>
              <button
                type="button"
                className={styles.treeHead}
                aria-expanded={!isCollapsed}
                onClick={() => onToggleGroup(group.key)}
              >
                <span
                  className={`${styles.chevron} ${isCollapsed ? styles.chevronCollapsed : ''}`}
                  aria-hidden
                >
                  <RemixIcon name="arrow-down-s-line" size={12} />
                </span>
                <span className={styles.treeHeadLabel}>{group.label}</span>
                <span className={styles.treeHeadCount}>{group.entries.length}</span>
              </button>
              {isCollapsed ? null : (
                <>
                  {visible.map((file) => (
                    <div
                      key={file.name}
                      data-testid={`design-file-row-${file.name}`}
                      data-selected={selected.has(file.name) ? 'true' : undefined}
                      className={`${styles.node} ${
                        file.name === activePage ? styles.nodeActive : ''
                      } ${selected.has(file.name) ? styles.nodeSelected : ''}`}
                      onContextMenu={(event) => {
                        if (!onOpenRowMenu) return;
                        event.preventDefault();
                        onOpenRowMenu(file.name, { top: event.clientY, left: event.clientX });
                      }}
                    >
                      <span
                        className={styles.nodeCheck}
                        data-testid={`design-structure-check-${file.name}`}
                        role={viewerOnly ? undefined : 'checkbox'}
                        aria-checked={viewerOnly ? undefined : selected.has(file.name)}
                        aria-disabled={viewerOnly ? 'true' : undefined}
                        tabIndex={viewerOnly ? -1 : 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (viewerOnly) return;
                          onToggleSelect(file.name);
                        }}
                        onKeyDown={(event) => {
                          if (viewerOnly) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleSelect(file.name);
                          }
                        }}
                      >
                        {viewerOnly ? null : (
                          <RemixIcon
                            name={
                              selected.has(file.name) ? 'checkbox-line' : 'checkbox-blank-line'
                            }
                            size={13}
                          />
                        )}
                      </span>
                      {renderRenameInput?.(file.name) ?? (
                        <button
                          type="button"
                          className={styles.nodeOpen}
                          title={file.name}
                          onClick={() => onOpenPage(file.name)}
                        >
                          <span className={styles.nodeName}>{displayLabel(file.name)}</span>
                          {group.pages ? null : (
                            <span className={styles.nodeExt}>{extensionLabel(file.name)}</span>
                          )}
                        </button>
                      )}
                      {onOpenRowMenu && !viewerOnly ? (
                        <button
                          type="button"
                          className={styles.nodeMenu}
                          data-testid={`design-file-menu-${file.name}`}
                          aria-label={t('designFiles.openInTab')}
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            onOpenRowMenu(file.name, { top: rect.bottom, left: rect.left });
                          }}
                        >
                          ⋯
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      className={styles.revealMore}
                      data-testid={`design-structure-reveal-${group.key}`}
                      onClick={() => onRevealMore(group.key)}
                    >
                      {t('designFiles.showMore', { n: hidden })}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
      {liveArtifacts.length > 0 ? (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <span>{t('designFiles.sectionLiveArtifacts')}</span>
            <span className={styles.groupCount}>
              {liveArtifacts.length}
            </span>
          </div>
          {liveArtifacts.map((artifact) => (
            <button
              key={artifact.artifactId}
              type="button"
              data-testid={`design-file-row-${artifact.tabId}`}
              className={styles.node}
              onClick={() => onOpenLiveArtifact(artifact.tabId)}
            >
              <span className={styles.nodeName}>{artifact.title}</span>
              <LiveArtifactBadges
                compact
                status={artifact.status}
                refreshStatus={artifact.refreshStatus}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pages group by the directory they live in — that IS the project's structure.
 * Everything else groups by category so no file becomes unreachable from the
 * rail, which replaced the category grid as the only file surface.
 */
function buildGroups(
  files: ProjectFile[],
  currentDir: string,
  rootDirName: string | undefined,
  categoryLabel: (category: FileCategory) => string,
  t: TranslateFn,
): StructureGroup[] {
  const prefix = currentDir === '' ? '' : `${currentDir}/`;
  const pagesByDir = new Map<string, ProjectFile[]>();
  const others = new Map<FileCategory, ProjectFile[]>();
  for (const file of files) {
    const category = fileCategory(file);
    if (category === 'html') {
      const relative = file.name.startsWith(prefix) ? file.name.slice(prefix.length) : file.name;
      // Group by the FIRST path segment, not the full nested directory. The
      // root view lists every nested file, so grouping by full directory would
      // give a deep project one single-page group per directory — thousands of
      // groups for a web clone. One group per top-level folder matches the
      // folder rows above it.
      const dir = firstSegmentOf(relative);
      const bucket = pagesByDir.get(dir) ?? [];
      bucket.push(file);
      pagesByDir.set(dir, bucket);
      continue;
    }
    const bucket = others.get(category) ?? [];
    bucket.push(file);
    others.set(category, bucket);
  }

  const groups: StructureGroup[] = [];
  const dirs = [...pagesByDir.keys()].sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
  for (const dir of dirs) {
    const entries = pagesByDir.get(dir) ?? [];
    entries.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({
      key: `pages:${dir}`,
      label: dir === '' ? rootDirName ?? t('designStructure.allPages') : dir,
      pages: true,
      entries,
    });
  }
  for (const category of SECTION_ORDER) {
    const entries = others.get(category);
    if (!entries) continue;
    entries.sort((a, b) => b.mtime - a.mtime);
    groups.push({
      key: `cat:${category}`,
      label: categoryLabel(category),
      pages: false,
      entries,
    });
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

function LayersView({
  projectId,
  pages,
  activePage,
  t,
}: {
  projectId: string;
  pages: ProjectFile[];
  activePage: string | null;
  t: TranslateFn;
}) {
  const { workspaceContext, workspaceContextLoading } = useProjectCollabContext();
  const [outline, setOutline] = useState<HtmlOutlineNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const activeFile = pages.find((page) => page.name === activePage) ?? null;
  const mtime = activeFile?.mtime ?? 0;

  useEffect(() => {
    setOutline(null);
    if (!activePage || workspaceContextLoading) return;
    let cancelled = false;
    setLoading(true);
    const url = appendResourceQuery(
      projectFileUrl(projectId, activePage, workspaceContext),
      `v=${Math.round(mtime)}`,
    );
    void fetch(url)
      .then((response) => (response.ok ? response.text() : null))
      .then((source) => {
        if (cancelled) return;
        setOutline(source === null ? [] : parseHtmlOutline(source));
      })
      .catch(() => {
        if (!cancelled) setOutline([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, activePage, mtime, workspaceContext, workspaceContextLoading]);

  if (!activePage) {
    return <EmptyNote title={t('designStructure.layersNoPage')} />;
  }
  return (
    <div className={styles.column}>
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <span>{t('designStructure.layersTitle', { page: displayLabel(activePage) })}</span>
          {outline && outline.length > 0 ? (
            <span className={styles.groupCount}>
              {t('designStructure.layerCount', { n: outline.length })}
            </span>
          ) : null}
        </div>
        {loading || outline === null ? (
          <div className={styles.note}>{t('common.loading')}</div>
        ) : outline.length === 0 ? (
          <div className={styles.note}>{t('designStructure.layersEmpty')}</div>
        ) : (
          outline.map((node) => (
            <div
              key={node.key}
              className={styles.layer}
              style={{ paddingInlineStart: `${6 + node.depth * 14}px` }}
              data-testid="design-structure-layer"
            >
              <RemixIcon name="layout-line" size={12} />
              <span className={styles.layerName}>{node.label}</span>
              <span className={styles.layerMeta}>{node.meta}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

/**
 * The Edit tab is a property inspector driven by a canvas selection.
 *
 * A caller that HAS a canvas beside the rail — the file viewer in edit mode —
 * hands the live inspector down as `editSlot`, and it renders here instead of
 * over the artboard: the panel describes the element you just clicked, and
 * floating it above the page hid the very thing being edited.
 *
 * The Design Files surface has no canvas (opening a page swaps the whole
 * workspace tab), so it passes no slot and the tab points at the real editor
 * rather than showing one wired to nothing.
 */
function EditView({
  activePage,
  onOpenFile,
  editSlot,
  t,
}: {
  activePage: string | null;
  onOpenFile: (name: string) => void;
  editSlot?: ReactNode;
  t: TranslateFn;
}) {
  if (editSlot) {
    return <div className={styles.editSlot} data-testid="design-structure-edit-slot">{editSlot}</div>;
  }
  return (
    <div className={styles.column}>
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <span>{t('designStructure.editTitle')}</span>
        </div>
        <div className={styles.note}>{t('designStructure.editHint')}</div>
        {activePage ? (
          <button
            type="button"
            className={styles.linkButton}
            data-testid="design-structure-edit-open"
            onClick={() => onOpenFile(activePage)}
          >
            <Icon name="pencil" size={13} />
            <span>{t('designStructure.editOpen', { page: displayLabel(activePage) })}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

function AssetsView({
  projectId,
  files,
  subTab,
  onSubTabChange,
  onOpenFile,
  t,
}: {
  projectId: string;
  files: ProjectFile[];
  subTab: AssetsSubTab;
  onSubTabChange: (next: AssetsSubTab) => void;
  onOpenFile: (name: string) => void;
  t: TranslateFn;
}) {
  const { workspaceContext } = useProjectCollabContext();
  const [imageLimit, setImageLimit] = useState(GROUP_RENDER_BATCH);
  const images = useMemo(
    () =>
      files
        .filter((file) => fileCategory(file) === 'image')
        .sort((a, b) => b.mtime - a.mtime),
    [files],
  );
  const systemFiles = useMemo(
    () => files.filter(isDesignSystemFile).sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );
  const visibleImages = images.slice(0, imageLimit);
  const hiddenImages = images.length - visibleImages.length;

  return (
    <div className={styles.column}>
      <div className={styles.segment} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'brand'}
          className={subTab === 'brand' ? styles.segmentActive : undefined}
          data-testid="design-structure-assets-brand"
          onClick={() => onSubTabChange('brand')}
        >
          {t('designStructure.assetsBrand')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'mine'}
          className={subTab === 'mine' ? styles.segmentActive : undefined}
          data-testid="design-structure-assets-mine"
          onClick={() => onSubTabChange('mine')}
        >
          {t('designStructure.assetsMine')}
        </button>
      </div>
      {subTab === 'brand' ? (
        systemFiles.length === 0 ? (
          <EmptyNote title={t('designStructure.assetsBrandEmpty')} />
        ) : (
          <div className={styles.group}>
            <div className={styles.groupHead}>
              <span>{t('designStructure.assetsBrand')}</span>
              <span className={styles.groupCount}>
                {systemFiles.length}
              </span>
            </div>
            {systemFiles.map((file) => (
              <button
                key={file.name}
                type="button"
                className={styles.node}
                title={file.name}
                onClick={() => onOpenFile(file.name)}
              >
                <span className={styles.nodeName}>{file.name}</span>
                <span className={styles.nodeExt}>{extensionLabel(file.name)}</span>
              </button>
            ))}
          </div>
        )
      ) : images.length === 0 ? (
        <EmptyNote title={t('designStructure.assetsMineEmpty')} />
      ) : (
        <div className={styles.group}>
          <div className={styles.groupHead}>
            <span>{t('designStructure.assetsMine')}</span>
            <span className={styles.groupCount}>
              {images.length}
            </span>
          </div>
          <div className={styles.assetGrid} data-testid="design-structure-asset-grid">
            {visibleImages.map((file) => (
              /* Image-only tiles: the picture is the identity here, so no
                 caption and no hover tooltip repeating the filename — the
                 name survives as alt text for readers that need words. */
              <button
                key={file.name}
                type="button"
                className={styles.asset}
                data-testid={`design-structure-asset-${file.name}`}
                onClick={() => onOpenFile(file.name)}
              >
                <img
                  src={projectFileUrl(projectId, file.name, workspaceContext)}
                  alt={file.name}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
          {hiddenImages > 0 ? (
            <button
              type="button"
              className={styles.revealMore}
              data-testid="design-structure-reveal-assets"
              onClick={() => setImageLimit((current) => current + GROUP_RENDER_BATCH)}
            >
              {t('designFiles.showMore', { n: hiddenImages })}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function isDesignSystemFile(file: ProjectFile): boolean {
  if (DESIGN_SYSTEM_DIR_PATTERN.test(file.name)) return true;
  return DESIGN_SYSTEM_BASENAMES.has(baseName(file.name).toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function EmptyNote({ title }: { title: string }) {
  return (
    <div className={styles.column}>
      <div className={styles.note}>{title}</div>
    </div>
  );
}

function firstSegmentOf(name: string): string {
  const index = name.indexOf('/');
  return index >= 0 ? name.slice(0, index) : '';
}

function baseName(name: string): string {
  const index = name.lastIndexOf('/');
  return index >= 0 ? name.slice(index + 1) : name;
}

/** Page nodes read as names, not paths: "shop/orders.html" is "orders". */
function displayLabel(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function extensionLabel(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toUpperCase();
}
