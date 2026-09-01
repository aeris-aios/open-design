// Lovart-style centered hero for the entry Home view.
//
// The prompt textarea is the canonical creation surface: the user
// either types freely or selects a type below to reveal matching
// starters, then presses Run / Enter to spawn a project. The hero is
// kept dependency-free (no plugin list / project list) so it can be
// composed with the recent-projects strip and plugins section
// without owning their data lifecycles.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { VisuallyHidden } from '@open-design/components';
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  ReactNode,
  RefObject,
} from 'react';
import type {
  ChatSessionMode,
  ConnectorDetail,
  DesignSystemSummary,
  InputFieldSpec,
  InstalledPluginRecord,
  McpServerConfig,
  WorkspaceCollabContext,
  WorkspaceContextItem,
} from '@open-design/contracts';
import { DesignSystemPicker } from './DesignSystemPicker';
import type { SkillSummary } from '../types';
import { Icon, type IconName } from './Icon';
import { useAnalytics } from '../analytics/provider';
import {
  trackComposerSessionModeClick,
  trackContextLinkResult,
  trackFigmaHelpModalSurfaceView,
  trackHomeChatComposerClick,
  trackProjectReferenceModalSurfaceView,
} from '../analytics/events';
import { sessionModeToTracking } from '@open-design/contracts/analytics';
import {
  chipsForGroup,
  HOME_APPLY_TEMPLATE_EVENT,
  orderedCreateChips,
  type ChipGroup,
  type HomeHeroChip,
} from './home-hero/chips';
import { homeHeroChipLabel } from './home-hero/chip-labels';
import { PixelScanLogo } from './home-hero/PixelScanLogo';
import { ScenarioArt } from './home-hero/ScenarioArt';
import { useEdgeAutoScroll, EdgeScrollZones } from './home-hero/EdgeAutoScroll';
import {
  isSubChipParent,
  subChipsForChip,
  type HomeHeroSubChip,
} from './home-hero/sub-chips';
import {
  inlineMentionToken,
  type InlineMentionEntity,
} from '../utils/inlineMentions';
import { useI18n, useT } from '../i18n';
import { localizePluginDescription, localizePluginTitle } from './plugins-home/localization';
import {
  examplePresetSeedPrompt,
  pluginPresetQuery,
  renderPluginPresetQuery,
  promptLocaleKind,
  type PromptLocaleKind,
} from './plugins-home/presetSeedPrompt';
import type { Locale } from '../i18n/types';
import {
  localizeSkillDescription,
  localizeSkillName,
} from '../i18n/content';
import { PreviewSurface } from './plugins-home/cards/PreviewSurface';
import { pluginCategoryLabel } from './plugins-home/categoryLabel';
import { readHomeGuideStage, writeHomeGuideStage } from './home-hero/firstRunGuide';
import { curatedPluginPriorityForChip } from './plugins-home/curatedPriority';
import { GALLERY_HIDDEN_PLUGIN_IDS, isGalleryHidden } from './plugins-home/chamberCuration';
import { comparePluginGalleryOrder } from './plugins-home/pluginPopularity';
import { sortByVisualAppeal } from './plugins-home/visualScore';
import { applyFacetSelection } from './plugins-home/facets';
import { notifyCompletionFeedbackGesture } from '../utils/notifications';
import { inferPluginPreview } from './plugins-home/preview';
import { pluginSubfacetLabel } from './plugins-home/subfacetLabel';
import { useDeckPreviewScale } from '../lib/use-deck-preview-scale';
import { ComposerPlusMenu, PLUS_SUBMENU_RESOURCE_KIND } from './ComposerPlusMenu';
import { ContextChipHoverCard } from './ContextChipHoverCard';
import { workspaceContextDetailLine, workspaceContextKindLabel } from './workspace-context';
import { FigmaHelpModal } from './FigmaHelpModal';
import { TemplatePicker } from './home-hero/TemplatePicker';
import { TypePillRow } from './home-hero/TypePillRow';
import { LibraryPicker } from './LibraryPicker';
import { ComposerModePicker } from './ComposerModePicker';
import { assetTitle } from './LibraryAssetMeta';
import { libraryAssetRawUrl } from '../providers/registry';
import type { LibraryAsset } from '@open-design/contracts';
import { WorkingDirPicker } from './WorkingDirPicker';
import {
  ProjectReferenceModal,
  type ProjectReferenceSelection,
} from './ProjectReferenceModal';
import {
  LexicalComposerInput,
  type LexicalComposerInputHandle,
  type CaretRect,
} from './composer/LexicalComposerInput';
import { CaretFloatingLayer } from './composer/CaretFloatingLayer';
import { PlaceholderCarousel } from './home-hero/PlaceholderCarousel';
import {
  buildPlaceholderScenarios,
  PLACEHOLDER_BASE_HINT_KEY,
  type PlaceholderScenario,
} from './home-hero/placeholderScenarios';

export interface HomeHeroSubmitHandler {
  (): void;
}

// The homepage prompt input now shares the project composer's Lexical
// editor, so the forwarded handle is a small focus surface rather than a
// raw <textarea>. HomeView drives `focusEnd()` after seeding a prompt
// example / picking a plugin.
export interface HomeHeroHandle {
  focus(): void;
  focusEnd(): void;
  // Flash the send button twice — fired after a plugin Use action or an
  // example-prompt card seeds the composer, to pull the eye to the next step.
  pulseSend(): void;
}

export interface ExamplePromptInfo {
  title: string;
  artifactType: string;
  brief: Record<string, string>;
}

interface Props {
  workspaceContext?: WorkspaceCollabContext | null;
  active?: boolean;
  // Arms the first-run guidance trail (prototype chip → first preset
  // card sheen). Tri-state: true = brand-new user (no projects), false =
  // existing user, undefined = projects still loading — the guide neither
  // arms nor completes until the answer is known.
  firstRunGuide?: boolean;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: HomeHeroSubmitHandler;
  // Send pressed on an EMPTY composer while the placeholder carousel is
  // showing: the host seeds the prompt with `scenario.text`, binds the
  // scenario's template, and creates the project -- one-click "just start".
  onSubmitScenario?: (scenario: PlaceholderScenario) => void;
  sessionMode?: ChatSessionMode;
  onSessionModeChange?: (mode: ChatSessionMode) => void;
  activePluginTitle: string | null;
  // True when the active plugin chip shows a user-picked plugin (Community card
  // or example-prompt preset) rather than a task-type chip's default plugin —
  // an explicit pick owns its own clear (×) button even when a task chip is set.
  activePluginIsExplicit?: boolean;
  activePluginRecord?: InstalledPluginRecord | null;
  activeChipId: string | null;
  // Prototype's selected second-level scene is owned by HomeView so action
  // metadata and persistence stay aligned with the visible filter selection.
  activePrototypeSubtypeId?: string | null;
  onClearActivePlugin: () => void;
  onClearActiveChip?: () => void;
  activeSkillId?: string | null;
  activeSkillTitle?: string | null;
  activeSkillRecord?: SkillSummary | null;
  onClearActiveSkill?: () => void;
  selectedPluginContexts?: InstalledPluginRecord[];
  selectedMcpContexts?: McpServerConfig[];
  selectedConnectorContexts?: ConnectorDetail[];
  // Context-only selections (staged through the plain `Use` action, no inline
  // @mention pill). These have no in-prompt representation, so the active row
  // renders a removable chip for each — otherwise a kept-in-payload context
  // would be invisible and unremovable (silent context drift).
  contextOnlyPlugins?: InstalledPluginRecord[];
  contextOnlyMcpServers?: McpServerConfig[];
  contextOnlyConnectors?: ConnectorDetail[];
  contextWorkspaceItems?: WorkspaceContextItem[];
  onRemovePluginContext?: (pluginId: string) => void;
  onRemoveMcpContext?: (serverId: string) => void;
  onRemoveConnectorContext?: (connectorId: string) => void;
  onAddWorkspaceContext?: (item: WorkspaceContextItem) => void;
  onRemoveWorkspaceContext?: (id: string) => void;
  onAddPlugin?: () => void;
  onAddConnector?: () => void;
  onAddMcp?: () => void;
  onOpenPluginDetails?: (record: InstalledPluginRecord) => void;
  onOpenSkillDetails?: (skill: SkillSummary) => void;
  pluginInputFields?: InputFieldSpec[];
  pluginInputValues?: Record<string, unknown>;
  pluginInputTemplate?: string | null;
  onPluginInputValuesChange?: (values: Record<string, unknown>) => void;
  inlineEditableInputNames?: string[];
  footerInputNames?: string[];
  designSystems?: DesignSystemSummary[];
  // Persistent design-system selection, surfaced as a borderless picker in the
  // row below the composer (next to the working-directory picker) so it is
  // available for every product kind. `null` = "No design system".
  selectedDesignSystemId?: string | null;
  onDesignSystemChange?: (id: string | null) => void;
  stagedFiles?: File[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
  /** Opens the "Import from Figma" dialog; omit to hide the menu entry. */
  onImportFigma?: () => void;
  pluginOptions: InstalledPluginRecord[];
  pluginsLoading: boolean;
  skillOptions?: SkillSummary[];
  skillsLoading?: boolean;
  mcpOptions?: McpServerConfig[];
  mcpLoading?: boolean;
  connectorOptions?: ConnectorDetail[];
  pendingPluginId: string | null;
  pendingChipId: string | null;
  submitDisabled?: boolean;
  // True while the submitted run is still creating its project/conversation
  // (#4082). Distinct from `submitDisabled`: it swaps the send button into a
  // visible Sending… state instead of leaving it silently idle.
  submitting?: boolean;
  onPickPlugin: (record: InstalledPluginRecord, nextPrompt: string | null) => void;
  onPickExamplePlugin?: (record: InstalledPluginRecord, chipId: string, promptText: string) => void;
  onPickSkill?: (skill: SkillSummary, nextPrompt: string | null) => void;
  onPickMcp?: (server: McpServerConfig, nextPrompt: string) => void;
  onPickConnector?: (connector: ConnectorDetail, nextPrompt: string) => void;
  onPickChip: (chip: HomeHeroChip) => void;
  onPickPrototypeSubtype?: (sub: HomeHeroSubChip | null) => void;
  contextItemCount: number;
  error: string | null;
  showActivePluginChip?: boolean;
  workingDir?: string | null;
  recentDirs?: string[];
  onPickWorkingDir?: () => Promise<string | null> | string | null | void;
  onPickLocalCodeDir?: () => Promise<string | null> | string | null | void;
  onSelectRecentWorkingDir?: (dir: string) => void;
  onClearWorkingDir?: () => void;
  onExamplePromptStatusChange?: (info: ExamplePromptInfo | null) => void;
  // "…or start a blank project" — creates an empty project directly (no dialog,
  // no design system / template / prompt) and enters it. Omit to hide the link.
  onStartBlankProject?: () => void;
  executionSwitcher?: ReactNode;
  // Personalized first-run starting point (spec §7). Rendered directly under
  // the composer card — before the template section — so a brand-new user sees
  // their recommended entry without scrolling.
  recommendationSlot?: ReactNode;
}

type HomeMentionTab = 'all' | 'files' | 'plugins' | 'skills' | 'mcp' | 'connectors';

// In the combined "All" overview, every surface is capped to a handful of top
// matches so no single section floods the picker. The dedicated "Design files"
// tab is exempt: staged files are the user's own finite content, so that tab
// lists every match (the results panel scrolls) and its count reflects the true
// total rather than the truncated preview.
const HOME_MENTION_ALL_TAB_PREVIEW = 6;

interface HomeMentionOption {
  id: string;
  icon: IconName;
  title: string;
  description: string;
  meta: string;
  pluginRecord?: InstalledPluginRecord;
  disabled?: boolean;
  onPick: () => void;
}

interface HomeMentionSection {
  id: Exclude<HomeMentionTab, 'all'>;
  label: string;
  options: HomeMentionOption[];
}

interface SelectedPromptExample {
  label: string;
  promptText: string;
}

const EMPTY_PLUGIN_CONTEXTS: InstalledPluginRecord[] = [];
const EMPTY_MCP_CONTEXTS: McpServerConfig[] = [];
const EMPTY_CONNECTOR_CONTEXTS: ConnectorDetail[] = [];
const EMPTY_INPUT_FIELDS: InputFieldSpec[] = [];
const EMPTY_PLUGIN_INPUT_VALUES: Record<string, unknown> = {};
const EMPTY_INPUT_NAMES: string[] = [];
const EMPTY_DESIGN_SYSTEMS: DesignSystemSummary[] = [];
const EMPTY_STAGED_FILES: File[] = [];
const EMPTY_SKILLS: SkillSummary[] = [];
const EMPTY_MCP_OPTIONS: McpServerConfig[] = [];
const EMPTY_CONNECTOR_OPTIONS: ConnectorDetail[] = [];
const EMPTY_WORKSPACE_ITEMS: WorkspaceContextItem[] = [];

export const HomeHero = forwardRef<HomeHeroHandle, Props>(function HomeHero(
  {
    workspaceContext = null,
    active = true,
    prompt,
    onPromptChange,
    onSubmit,
    onSubmitScenario = () => undefined,
    sessionMode = 'design',
    onSessionModeChange,
    firstRunGuide,
    activePluginTitle,
    activePluginIsExplicit = false,
    activePluginRecord = null,
    activeSkillId = null,
    activeSkillTitle = null,
    activeSkillRecord = null,
    activeChipId,
    onClearActivePlugin,
    onClearActiveChip = onClearActivePlugin,
    onClearActiveSkill = () => undefined,
    selectedPluginContexts = EMPTY_PLUGIN_CONTEXTS,
    contextOnlyPlugins = EMPTY_PLUGIN_CONTEXTS,
    contextOnlyMcpServers = EMPTY_MCP_OPTIONS,
    contextOnlyConnectors = EMPTY_CONNECTOR_OPTIONS,
    contextWorkspaceItems = EMPTY_WORKSPACE_ITEMS,
    onRemovePluginContext = () => undefined,
    onRemoveMcpContext = () => undefined,
    onRemoveConnectorContext = () => undefined,
    onAddWorkspaceContext = () => undefined,
    onRemoveWorkspaceContext = () => undefined,
    onAddPlugin = () => undefined,
    onAddConnector = () => undefined,
    onAddMcp = () => undefined,
    onOpenPluginDetails = () => undefined,
    onOpenSkillDetails = () => undefined,
    pluginInputFields = EMPTY_INPUT_FIELDS,
    pluginInputValues = EMPTY_PLUGIN_INPUT_VALUES,
    onPluginInputValuesChange = () => undefined,
    footerInputNames = EMPTY_INPUT_NAMES,
    designSystems = EMPTY_DESIGN_SYSTEMS,
    selectedDesignSystemId = null,
    onDesignSystemChange,
    stagedFiles = EMPTY_STAGED_FILES,
    onAddFiles = () => undefined,
    onImportFigma,
    onRemoveFile = () => undefined,
    pluginOptions,
    pluginsLoading,
    skillOptions = EMPTY_SKILLS,
    skillsLoading = false,
    mcpOptions = EMPTY_MCP_OPTIONS,
    mcpLoading = false,
    connectorOptions = EMPTY_CONNECTOR_OPTIONS,
    pendingPluginId,
    pendingChipId,
    submitDisabled = false,
    submitting = false,
    onPickPlugin,
    onPickExamplePlugin = () => undefined,
    onPickSkill = () => undefined,
    onPickMcp = () => undefined,
    onPickConnector = () => undefined,
    onPickChip,
    activePrototypeSubtypeId,
    onPickPrototypeSubtype,
    contextItemCount,
    error,
    showActivePluginChip = true,
    workingDir = null,
    recentDirs = [],
    onPickWorkingDir,
    onPickLocalCodeDir,
    onSelectRecentWorkingDir,
    onClearWorkingDir,
    onExamplePromptStatusChange,
    onStartBlankProject,
    executionSwitcher,
    recommendationSlot,
  },
  ref,
) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionTab, setMentionTab] = useState<HomeMentionTab>('all');
  const [hoveredPlugin, setHoveredPlugin] = useState<InstalledPluginRecord | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [projectReferenceOpen, setProjectReferenceOpen] = useState(false);
  const [figmaHelpOpen, setFigmaHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const homeHeroRef = useRef<HTMLElement | null>(null);
  // Two-flash attention pulse on the send button; armed via the
  // imperative `pulseSend()` handle, cleared when the animation ends.
  const [sendAttention, setSendAttention] = useState(false);
  // First-run guidance trail (see home-hero/firstRunGuide.ts): which rail
  // chip is pulsing, and whether the first example-prompt card is pulsing.
  const [guidePulseChipId, setGuidePulseChipId] = useState<string | null>(null);
  const [guidePulseFirstPreset, setGuidePulseFirstPreset] = useState(false);
  // Selected second-level sub-category slug (Prototype / Slide deck rail).
  // Deck remains a local example filter. Prototype is controlled by HomeView:
  // every scene binds the Prototype action, while Mobile/Wireframe additionally
  // retain the project metadata from their former top-level actions.
  const [localSelectedSubcategory, setLocalSelectedSubcategory] = useState<string | null>(null);
  const selectedSubcategory =
    activeChipId === 'prototype' && activePrototypeSubtypeId !== undefined
      ? activePrototypeSubtypeId
      : localSelectedSubcategory;
  // Footer Template pill preview: the create-rail card the pointer is over,
  // so hovering a card below previews it in the pill (cleared on rail-leave).
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  // A committed pick or Clear must win over a lingering hover-preview. The rail
  // that sets previewTemplateId unmounts the instant a template becomes active,
  // so its onMouseLeave never fires; without this reset the stale preview keeps
  // the pill showing the old template even after Clear nulls the value.
  useEffect(() => {
    setPreviewTemplateId(null);
  }, [activeChipId]);
  const [selectedPromptExample, setSelectedPromptExample] = useState<SelectedPromptExample | null>(null);
  const [previewHomeFileKey, setPreviewHomeFileKey] = useState<string | null>(null);
  const [stagedFilePreviewUrls, setStagedFilePreviewUrls] = useState<Map<string, string>>(() => new Map());
  // Lexical-driven @-trigger state (replaces the old end-anchored
  // getContextMention regex) + the caret box the popover anchors to.
  const [mentionTrigger, setMentionTrigger] = useState<{ query: string } | null>(null);
  const [caretRect, setCaretRect] = useState<CaretRect | null>(null);
  // The scenario the placeholder carousel is currently showing. A Send on an
  // empty composer submits THIS scenario's text + template (see handleSend).
  const [carouselScenario, setCarouselScenario] = useState<PlaceholderScenario | null>(null);
  const editorRef = useRef<LexicalComposerInputHandle | null>(null);
  const promptEditorRef = useRef<HTMLDivElement | null>(null);
  const mentionPickerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutsMenuRef = useRef<HTMLDivElement>(null);
  const canSubmit =
    (prompt.trim().length > 0 || stagedFiles.length > 0) && !submitDisabled && !submitting;
  const previewHomeFile = useMemo(() => {
    if (!previewHomeFileKey) return null;
    return stagedFiles.find((file, index) => homeFileKey(file, index) === previewHomeFileKey) ?? null;
  }, [previewHomeFileKey, stagedFiles]);
  const previewHomeFileUrl = previewHomeFileKey ? stagedFilePreviewUrls.get(previewHomeFileKey) ?? null : null;
  const placeholder = activePluginTitle || activeSkillTitle
    ? t('homeHero.placeholderActive')
    : t('homeHero.placeholder');
  const mentionActive = Boolean(mentionTrigger);
  const mentionQuery = mentionTrigger?.query ?? '';
  // Scenarios the carousel cycles, with copy resolved through `t()` so the
  // typed placeholder AND the submitted query follow the locale. With a
  // create-template chip selected we narrow to that template's scenarios (so
  // the suggestions match the picked output and a submit keeps that template);
  // with nothing bound we cycle the full set. Memoised by chip + locale so the
  // reference only changes on a real switch, which restarts the carousel.
  const carouselScenarios = useMemo<PlaceholderScenario[]>(() => buildPlaceholderScenarios({
    activeChipId,
    // The scene narrows the parent's lines; it is not a template of its own, so
    // prompt-example and label fallbacks still key off the parent task type.
    activePrototypeSubtypeId: activeChipId === 'prototype' ? activePrototypeSubtypeId ?? null : null,
    resolveTextKey: (key) => t(key),
    examplesForChip: (chipId) => homeHeroChipPromptExamples(chipId, locale),
    fallbackForChip: (chipId) => fallbackPlaceholderScenarioText(chipId, locale, t),
  }), [activeChipId, activePrototypeSubtypeId, locale, t]);
  // The placeholder carousel runs while the composer is empty and nothing
  // OTHER than a create-template chip is bound. A selected template keeps it
  // alive (showing that template's scenarios); only an explicit plugin/skill
  // pick — which owns its own placeholder — or a non-empty composer stops it.
  // Template types without curated carousel lines fall back to their localized
  // prompt examples, then to a localized chip-label prompt. That keeps every
  // create template submittable from an empty composer instead of silently
  // disabling Send.
  // #118: once the caret is in the editor, the animating placeholder reads as a
  // second cursor. Tracked with native focusin/focusout on the wrapper rather
  // than an editor prop, so this works for the Lexical editor without widening
  // its API. `carouselActive` deliberately stays true — Send must still submit
  // the current scenario from an empty composer.
  const [promptFocused, setPromptFocused] = useState(false);
  useEffect(() => {
    const node = promptEditorRef.current;
    if (!node) return;
    const onIn = () => setPromptFocused(true);
    const onOut = (ev: FocusEvent) => {
      // focusout fires for moves *within* the editor too; only a target outside
      // the wrapper is a real blur.
      if (node.contains(ev.relatedTarget as Node | null)) return;
      setPromptFocused(false);
    };
    node.addEventListener('focusin', onIn);
    node.addEventListener('focusout', onOut);
    return () => {
      node.removeEventListener('focusin', onIn);
      node.removeEventListener('focusout', onOut);
    };
  }, []);

  const carouselActive =
    active &&
    !submitting &&
    !submitDisabled &&
    prompt.trim().length === 0 &&
    stagedFiles.length === 0 &&
    !activeSkillTitle &&
    !activePluginIsExplicit &&
    !mentionActive &&
    carouselScenarios.length > 0;
  // Empty composer, but the carousel is offering a runnable scenario from the
  // CURRENT pool: Send stays highlighted and submits that scenario instead of
  // sitting disabled. The membership check guards the brief window after a
  // template switch before the carousel reports the new pool's first scenario.
  const carouselSubmittable =
    carouselActive &&
    !pluginsLoading &&
    carouselScenario !== null &&
    carouselScenarios.some((scenario) => scenario.id === carouselScenario.id);
  const sendEnabled = canSubmit || carouselSubmittable;
  function handleSend() {
    if (submitting || submitDisabled) return;
    if (canSubmit) {
      notifyCompletionFeedbackGesture();
      onSubmit();
      return;
    }
    if (carouselSubmittable && carouselScenario) {
      notifyCompletionFeedbackGesture();
      onSubmitScenario(carouselScenario);
    }
  }
  const fileMatches = useMemo(
    () =>
      mentionActive
        ? stagedFiles
            .map((file, index) => ({ file, index }))
            .filter(({ file }) => fileMatchesQuery(file, mentionQuery))
        : [],
    [mentionActive, mentionQuery, stagedFiles],
  );
  const pluginMatches = useMemo(
    () =>
      mentionActive
        ? pluginOptions.filter((plugin) => pluginMatchesQuery(plugin, mentionQuery, locale))
        : [],
    [locale, mentionActive, mentionQuery, pluginOptions],
  );
  const skillMatches = useMemo(
    () =>
      mentionActive
        ? skillOptions.filter((skill) => skillMatchesQuery(skill, mentionQuery, locale))
        : [],
    [locale, mentionActive, mentionQuery, skillOptions],
  );
  const mcpMatches = useMemo(
    () =>
      mentionActive
        ? mcpOptions.filter((server) => mcpServerMatchesQuery(server, mentionQuery)).slice(0, 6)
        : [],
    [mcpOptions, mentionActive, mentionQuery],
  );
  const connectorMatches = useMemo(
    () =>
      mentionActive
        ? connectorOptions.filter((connector) => connectorMatchesQuery(connector, mentionQuery)).slice(0, 6)
        : [],
    [connectorOptions, mentionActive, mentionQuery],
  );
  const pickerOpen = active && mentionActive;
  const tabs: Array<{ id: HomeMentionTab; label: string; count: number }> = [
    // The All overview previews at most HOME_MENTION_ALL_TAB_PREVIEW files, so
    // its badge counts the previewed slice — not the full staged total — to keep
    // the count aligned with what that tab actually renders. The dedicated files
    // tab below lists every match and reports the true total.
    { id: 'all', label: t('common.all'), count: Math.min(fileMatches.length, HOME_MENTION_ALL_TAB_PREVIEW) + pluginMatches.length + skillMatches.length + mcpMatches.length + connectorMatches.length },
    { id: 'files', label: t('chat.mentionTabFiles'), count: fileMatches.length },
    { id: 'plugins', label: t('entry.navPlugins'), count: pluginMatches.length },
    { id: 'skills', label: t('homeHero.skills'), count: skillMatches.length },
    { id: 'mcp', label: 'MCP', count: mcpMatches.length },
    { id: 'connectors', label: 'Connectors', count: connectorMatches.length },
  ];
  const showFiles = mentionTab === 'all' || mentionTab === 'files';
  const showPlugins = mentionTab === 'all' || mentionTab === 'plugins';
  const showSkills = mentionTab === 'all' || mentionTab === 'skills';
  const showMcp = mentionTab === 'all' || mentionTab === 'mcp';
  const showConnectors = mentionTab === 'all' || mentionTab === 'connectors';
  const visibleSections: HomeMentionSection[] = [
    showFiles
      ? {
          id: 'files',
          label: t('chat.mentionSectionFiles'),
          options: (mentionTab === 'files' ? fileMatches : fileMatches.slice(0, HOME_MENTION_ALL_TAB_PREVIEW)).map(({ file, index }) => ({
            id: `file-${index}-${file.name}`,
            icon: isImageFile(file) ? 'image' : 'file',
            title: file.name,
            description: file.type || t('chat.mentionTabFiles'),
            meta: formatFileSize(file.size),
            onPick: () => pickFile(file),
          })),
        }
      : null,
    showPlugins
      ? {
          id: 'plugins',
          label: t('entry.navPlugins'),
          options: pluginMatches.map((plugin) => ({
            id: `plugin-${plugin.id}`,
            icon: 'sparkles',
            title: localizePluginTitle(locale, plugin),
            description: localizePluginDescription(locale, plugin) || plugin.id,
            meta: pendingPluginId === plugin.id ? t('homeHero.applying') : getPluginSourceLabel(plugin),
            pluginRecord: plugin,
            disabled: pendingPluginId !== null,
            onPick: () => pickPlugin(plugin),
          })),
        }
      : null,
    showSkills
      ? {
          id: 'skills',
          label: t('homeHero.skills'),
          options: skillMatches.map((skill) => ({
            id: `skill-${skill.id}`,
            icon: skill.id === activeSkillId ? 'check' : 'file',
            title: localizeSkillName(locale, skill),
            description: localizeSkillDescription(locale, skill) || skill.id,
            meta: skill.id === activeSkillId ? t('common.active') : skill.mode,
            onPick: () => pickSkill(skill),
          })),
        }
      : null,
    showMcp
      ? {
          id: 'mcp',
          label: 'MCP',
          options: mcpMatches.map((server) => ({
            id: `mcp-${server.id}`,
            icon: 'link',
            title: server.label || server.id,
            description: server.url || server.command || server.id,
            meta: server.transport,
            onPick: () => pickMcp(server),
          })),
        }
      : null,
    showConnectors
      ? {
          id: 'connectors',
          label: 'Connectors',
          options: connectorMatches.map((connector) => ({
            id: `connector-${connector.id}`,
            icon: 'link',
            title: connector.name,
            description: connector.description || connector.provider || connector.id,
            meta: connector.accountLabel ?? connector.provider,
            onPick: () => pickConnector(connector),
          })),
        }
      : null,
  ].filter((section): section is HomeMentionSection => Boolean(section?.options.length));
  const visiblePickerOptions = visibleSections.flatMap((section) => section.options);
  const visibleLoading =
    (mentionTab === 'all' && (pluginsLoading || skillsLoading || mcpLoading)) ||
    (mentionTab === 'plugins' && pluginsLoading) ||
    (mentionTab === 'skills' && skillsLoading) ||
    (mentionTab === 'mcp' && mcpLoading);
  const promptMentionEntities = useMemo(
    () =>
      buildHomeMentionEntities({
        activePluginRecord,
        activeSkillId,
        activeSkillTitle,
        mcpOptions,
        pluginOptions,
        connectorOptions,
        contextWorkspaceItems,
        selectedPluginContexts,
        stagedFiles,
        skillOptions,
      }),
    [
      activePluginRecord,
      activeSkillId,
      activeSkillTitle,
      mcpOptions,
      pluginOptions,
      connectorOptions,
      contextWorkspaceItems,
      selectedPluginContexts,
      stagedFiles,
      skillOptions,
    ],
  );
  const fieldByName = useMemo(
    () => new Map(pluginInputFields.map((field) => [field.name, field])),
    [pluginInputFields],
  );
  const footerInputNameSet = useMemo(
    () => new Set(footerInputNames),
    [footerInputNames],
  );
  const footerInputFields = useMemo(
    () => footerInputNames
      .map((name) => fieldByName.get(name))
      .filter((field): field is InputFieldSpec => Boolean(field)),
    [fieldByName, footerInputNames],
  );
  const activeCreateChip = useMemo(
    () => activeChipId
      ? chipsForGroup('create').find((chip) => chip.id === activeChipId) ?? null
      : null,
    [activeChipId],
  );
  // Footer Template picker options: the ordered create-scenario chips (pure
  // project-type templates — Slides / Prototype / Wireframe / Document / …).
  // Excludes action chips (Brand Kit / Figma) that navigate away instead of
  // seeding a template, so the dropdown matches the rail's template set.
  const templateChips = useMemo(
    () => orderedCreateChips().filter((chip) => chip.action.kind === 'apply-scenario'),
    [],
  );
  // A surface outside the hero (e.g. the workspace tabs-bar) can hand off a
  // template pick through this window event; apply the chip exactly as if it
  // was clicked here. Deliberately depless (re-subscribes each render) so the
  // listener always sees the current handlers without threading them through
  // refs.
  useEffect(() => {
    function onApplyTemplate(event: Event) {
      const chipId = (event as CustomEvent<{ chipId?: string }>).detail?.chipId;
      if (!chipId) return;
      const chip = templateChips.find((item) => item.id === chipId);
      if (chip) handlePickTaskChip(chip);
    }
    window.addEventListener(HOME_APPLY_TEMPLATE_EVENT, onApplyTemplate);
    return () => window.removeEventListener(HOME_APPLY_TEMPLATE_EVENT, onApplyTemplate);
  });
  const activeExamplePlugins = useMemo(
    () =>
      activeChipId
        ? homeHeroExamplePluginsForChip(activeChipId, pluginOptions, locale)
        : [],
    [activeChipId, locale, pluginOptions],
  );
  // Derive sub-category pills from the FULL install set so the rail mirrors the
  // Community section exactly — same sub-category set and same order. (Earlier
  // this read only `activeExamplePlugins` to guarantee non-empty slices, but
  // that left the rail showing fewer types than Community; the empty case is
  // now handled by the full-catalog fallback in `filteredExamplePlugins`.)
  // Gallery curation applies to every path that can put a card on this rail,
  // not just the curated showcase: the sub-category pills and the pill-filtered
  // list below both derive from the install set, and reading it raw let upstream
  // templates (SaaS landings, pitch-deck prompts, invoices) reappear the moment
  // a staffer picked a sub-category. See plugins-home/chamberCuration.ts.
  const galleryPluginOptions = useMemo(
    () => pluginOptions.filter((plugin) => !isGalleryHidden(plugin.id)),
    [pluginOptions],
  );
  const activeSubChips = useMemo(
    () => subChipsForChip(activeChipId, galleryPluginOptions),
    [activeChipId, galleryPluginOptions],
  );
  // When a sub-category pill is active, show the SAME set the Community section
  // shows for that sub-category — every matching plugin from the full install
  // set, in the same visual-appeal order — rather than the small curated
  // example showcase. This keeps the example-prompt count consistent with the
  // Community count badge (e.g. Brand / design shows all 16, not just 1).
  // Atoms are excluded to match Community's `visiblePlugins` derivation, and
  // `applyFacetSelection` is the exact filter Community uses — it requires the
  // plugin's primary category to be this chip AND match the sub-category, so a
  // deck/image plugin that merely carries a "brand" tag is not pulled in.
  const filteredExamplePlugins = useMemo(() => {
    if (!selectedSubcategory || !isSubChipParent(activeChipId)) return activeExamplePlugins;
    // Mobile shares the existing Apps facet. Wireframe is a generation
    // constraint rather than a plugin taxonomy, so keep the Prototype starter
    // pool visible while the selected action carries its lo-fi metadata.
    const facetSubcategory =
      activeChipId === 'prototype' && selectedSubcategory === 'mobile'
        ? 'app-prototypes'
        : activeChipId === 'prototype' && selectedSubcategory === 'wireframe'
          ? null
          : selectedSubcategory;
    if (!facetSubcategory) return activeExamplePlugins;
    const pool = galleryPluginOptions.filter((plugin) => plugin.manifest?.od?.kind !== 'atom');
    return sortByVisualAppeal(
      applyFacetSelection(pool, { category: activeChipId, subcategory: facetSubcategory }),
    );
  }, [activeExamplePlugins, activeChipId, selectedSubcategory, galleryPluginOptions]);

  // First-run guide, beat 1: pulse the Prototype chip for brand-new users only
  // when Home could not bind a default type. A successfully seeded default has
  // already completed that choice, so skip the redundant pulse and let beat 2
  // guide the user to its first example card.
  // The settle delay lets the hero finish its entrance before the sheen.
  useEffect(() => {
    if (firstRunGuide !== true) return;
    if (readHomeGuideStage() !== 'chip') return;
    if (activeChipId) {
      writeHomeGuideStage('card');
      setGuidePulseChipId(null);
      return;
    }
    const arm = window.setTimeout(() => setGuidePulseChipId('prototype'), 900);
    const disarm = window.setTimeout(() => setGuidePulseChipId(null), 3600);
    return () => {
      window.clearTimeout(arm);
      window.clearTimeout(disarm);
    };
  }, [firstRunGuide, activeChipId]);

  // Users with existing projects never see the trail — complete ANY
  // unfinished stage silently. A chip pick during the loading window can
  // move the stage to 'card' before we know the user is not new, so 'chip'
  // alone is not enough to close off.
  useEffect(() => {
    if (firstRunGuide !== false) return;
    if (readHomeGuideStage() !== 'done') writeHomeGuideStage('done');
  }, [firstRunGuide]);

  const activePromptExamples = useMemo(
    () => activeChipId && activeExamplePlugins.length === 0
      ? homeHeroChipPromptExamples(activeChipId, locale)
      : [],
    [activeChipId, activeExamplePlugins.length, locale],
  );

  // Beat 2: once the picked chip's example cards render, pulse the first
  // card exactly once, then the trail is done (the send pulse takes over
  // after a card pick).
  useEffect(() => {
    if (firstRunGuide !== true) return;
    if (readHomeGuideStage() !== 'card') return;
    // Either card surface counts: plugin preset tiles, or the static
    // prompt-example fallback a presetless chip renders instead.
    const hasExampleCards =
      filteredExamplePlugins.length > 0 || activePromptExamples.length > 0;
    if (!activeChipId || !hasExampleCards) return;
    const arm = window.setTimeout(() => {
      setGuidePulseFirstPreset(true);
      writeHomeGuideStage('done');
    }, 500);
    const disarm = window.setTimeout(() => setGuidePulseFirstPreset(false), 3200);
    return () => {
      window.clearTimeout(arm);
      window.clearTimeout(disarm);
    };
  }, [firstRunGuide, activeChipId, filteredExamplePlugins.length, activePromptExamples.length]);
  const authoringLayoutActive =
    activeChipId === 'create-plugin' || pendingChipId === 'create-plugin';
  const promptMaxHeight = authoringLayoutActive
    ? HOME_HERO_AUTHORING_PROMPT_MAX_HEIGHT
    : HOME_HERO_PROMPT_MAX_HEIGHT;
  const inputCardStyle = {
    '--home-hero-prompt-max-height': `${promptMaxHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    if (selectedIndex >= visiblePickerOptions.length) setSelectedIndex(0);
  }, [selectedIndex, visiblePickerOptions.length]);

  useEffect(() => {
    if (!pickerOpen) setHoveredPlugin(null);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const isInsideMentionSurface = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return (
        promptEditorRef.current?.contains(target) ||
        mentionPickerRef.current?.contains(target)
      );
    };
    const closePicker = () => {
      setMentionTrigger(null);
      setMentionTab('all');
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!isInsideMentionSurface(event.target)) closePicker();
    };
    const closeOnOutsideMouse = (event: MouseEvent) => {
      if (!isInsideMentionSurface(event.target)) closePicker();
    };
    const closeOnOutsideFocus = (event: FocusEvent) => {
      if (!isInsideMentionSurface(event.target)) closePicker();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('mousedown', closeOnOutsideMouse, true);
    document.addEventListener('focusin', closeOnOutsideFocus);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('mousedown', closeOnOutsideMouse, true);
      document.removeEventListener('focusin', closeOnOutsideFocus);
    };
  }, [pickerOpen]);

  useEffect(() => {
    setSelectedPromptExample(null);
    setLocalSelectedSubcategory(null);
  }, [activeChipId]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && shortcutsMenuRef.current?.contains(target)) return;
      // The dropdown is portaled to <body>, so it's outside shortcutsMenuRef;
      // recognize it explicitly or a click on a menu item would close the menu
      // before the item's handler runs.
      if (target instanceof Element && target.closest('[data-shortcuts-panel]')) return;
      setShortcutsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShortcutsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [shortcutsOpen]);

  useEffect(() => {
    const urls = new Map<string, string>();
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      stagedFiles.forEach((file, index) => {
        if (isImageFile(file)) urls.set(homeFileKey(file, index), URL.createObjectURL(file));
      });
    }
    setStagedFilePreviewUrls(urls);
    return () => {
      if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [stagedFiles]);

  useEffect(() => {
    if (previewHomeFileKey && !previewHomeFile) setPreviewHomeFileKey(null);
  }, [previewHomeFileKey, previewHomeFile]);

  useEffect(() => {
    if (!previewHomeFileKey) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewHomeFileKey(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewHomeFileKey]);

  // Shared by the imperative pulseSend() handle (plugin Use / preset picks
  // routed through HomeView) and the component-internal static
  // prompt-example path — every "composer just got seeded" flow shows the
  // same Send cue.
  function triggerSendAttention() {
    // Drop the class for a frame so a pulse requested mid-animation
    // restarts instead of being swallowed.
    setSendAttention(false);
    requestAnimationFrame(() => setSendAttention(true));
  }

  useImperativeHandle(
    ref,
    (): HomeHeroHandle => ({
      focus() {
        editorRef.current?.focus();
      },
      focusEnd() {
        editorRef.current?.focus();
      },
      pulseSend() {
        triggerSendAttention();
      },
    }),
    [],
  );

  // Insert an atomic @mention pill at the active trigger and return the
  // editor's new serialized text. The pill replaces the in-flight `@query`
  // (Lexical's insertMention handles the range), so callers can forward the
  // resulting text to the host pick handler without computing offsets.
  function insertHomeMention(token: string, entity: InlineMentionEntity): string {
    editorRef.current?.insertMention({ token, entity });
    return editorRef.current?.getText() ?? prompt;
  }

  function pickPlugin(record: InstalledPluginRecord) {
    const token = pluginMentionText(record);
    const next = insertHomeMention(token, {
      id: record.id,
      kind: 'plugin',
      label: record.title,
      token,
    });
    onPickPlugin(record, next);
  }

  function pickFile(file: File) {
    const token = inlineMentionToken(file.name);
    insertHomeMention(token, { id: file.name, kind: 'file', label: file.name, token });
    setSelectedIndex(0);
    // The file is already staged; the editor's onChange has updated the
    // prompt text, so there is nothing else to forward to the host.
  }

  function pickSkill(skill: SkillSummary) {
    const token = inlineMentionToken(skill.name);
    const next = insertHomeMention(token, {
      id: skill.id,
      kind: 'skill',
      label: skill.name,
      token,
    });
    onPickSkill(skill, next);
  }

  function pickMcp(server: McpServerConfig) {
    const label = server.label || server.id;
    const token = inlineMentionToken(label);
    const next = insertHomeMention(token, { id: server.id, kind: 'mcp', label, token });
    onPickMcp(server, next);
  }

  function pickConnector(connector: ConnectorDetail) {
    const token = inlineMentionToken(connector.name);
    const next = insertHomeMention(token, {
      id: connector.id,
      kind: 'connector',
      label: connector.name,
      token,
    });
    onPickConnector(connector, next);
  }

  function insertInlineMentionSeparator() {
    const current = editorRef.current?.getText() ?? prompt;
    if (current.trim() && !/\s$/.test(current)) {
      editorRef.current?.insertText(' ');
    }
  }

  function appendWorkspacePrompt(item: WorkspaceContextItem) {
    onAddWorkspaceContext(item);
    insertInlineMentionSeparator();
    editorRef.current?.insertMention({
      token: inlineMentionToken(item.label),
      entity: { id: item.id, kind: 'workspace', label: item.label },
    });
    onPromptChange(editorRef.current?.getText() ?? prompt);
    dismissMentionPicker();
    requestAnimationFrame(() => editorRef.current?.focus());
  }

  function handleReferenceProjects(selections: ProjectReferenceSelection[]) {
    for (const selection of selections) {
      const path = selection.resolvedDir.trim();
      const label = selection.project.name || selection.project.id;
      appendWorkspacePrompt(
        {
          id: `project:${selection.project.id}`,
          kind: 'project',
          label,
          title: label,
          path: selection.project.id,
          ...(path ? { absolutePath: path } : {}),
        }
      );
    }
    setProjectReferenceOpen(false);
    trackContextLinkResult(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      context_kind: 'project',
      result: 'success',
      count: selections.length,
    });
  }

  async function handleLinkLocalCodeContext() {
    const selected = await onPickLocalCodeDir?.();
    if (!selected) {
      trackContextLinkResult(analytics.track, {
        page_name: 'home',
        area: 'chat_composer',
        context_kind: 'local_code',
        result: 'cancelled',
      });
      return;
    }
    const label = selected.split(/[/\\]/).filter(Boolean).pop() || selected;
    appendWorkspacePrompt(
      {
        id: `local-code:${selected}`,
        kind: 'local-code',
        label,
        title: label,
        path: selected,
        absolutePath: selected,
      }
    );
    trackContextLinkResult(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      context_kind: 'local_code',
      result: 'success',
      count: 1,
    });
  }

  function openDesignSystemPicker() {
    const trigger = homeHeroRef.current?.querySelector<HTMLButtonElement>(
      '[data-testid="home-hero-design-system-trigger"]',
    );
    if (!trigger || trigger.disabled) return;
    window.requestAnimationFrame(() => {
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      trigger.focus({ preventScroll: true });
    });
  }

  // Lexical reports the active @-trigger derived from the caret. HomeHero
  // has no slash surface, so only the mention branch is wired.
  function handleTrigger({
    mention: nextMention,
    anchorRect,
  }: {
    mention: { q: string } | null;
    slash: { q: string } | null;
    anchorRect: CaretRect | null;
  }) {
    if (!active) {
      setCaretRect(null);
      setMentionTrigger(null);
      setMentionTab('all');
      return;
    }
    setCaretRect(anchorRect);
    if (nextMention) {
      setMentionTrigger((prev) => {
        if (!prev || prev.query !== nextMention.q) setSelectedIndex(0);
        return { query: nextMention.q };
      });
    } else {
      setMentionTrigger(null);
      setMentionTab('all');
    }
  }

  function dismissMentionPicker() {
    setMentionTrigger(null);
    setMentionTab('all');
    setHoveredPlugin(null);
    setSelectedIndex(0);
  }

  useEffect(() => {
    if (!active) dismissMentionPicker();
  }, [active]);

  // Routes popover navigation keys from the Lexical editor over the visible
  // picker option union. Returns true when consumed so the editor can
  // preventDefault.
  function handlePopoverKey(
    key: 'ArrowDown' | 'ArrowUp' | 'Tab' | 'Enter' | 'Escape',
  ): boolean {
    if (!mentionActive) return false;
    if (key === 'Escape') {
      setMentionTrigger(null);
      return true;
    }
    if (visiblePickerOptions.length === 0) return false;
    if (key === 'ArrowDown') {
      setSelectedIndex((idx) => (idx + 1) % visiblePickerOptions.length);
      return true;
    }
    if (key === 'ArrowUp') {
      setSelectedIndex(
        (idx) => (idx - 1 + visiblePickerOptions.length) % visiblePickerOptions.length,
      );
      return true;
    }
    if (key === 'Tab' || key === 'Enter') {
      const selected = visiblePickerOptions[selectedIndex] ?? visiblePickerOptions[0];
      if (selected && !selected.disabled) selected.onPick();
      return true;
    }
    return false;
  }

  function handleFiles(files: File[]) {
    if (files.length === 0) return;
    onAddFiles(files);
  }

  // "Import from library": the home composer has no project yet, so we fetch
  // each picked asset's bytes and stage them as regular files. They ride the
  // existing upload-on-submit path into the new project's design files.
  async function importLibraryAssets(assets: LibraryAsset[]) {
    const files: File[] = [];
    for (const asset of assets) {
      const file = await fileFromLibraryAsset(asset);
      if (file) files.push(file);
    }
    handleFiles(files);
  }

  function removeFileChip(index: number, file: File) {
    const nextPrompt = stripHomeMentionToken(prompt, file.name);
    if (nextPrompt !== prompt) onPromptChange(nextPrompt);
    onRemoveFile(index);
  }

  function usePromptExample(example: string) {
    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'example_prompt',
      chip_id: activeChipId ?? 'prototype',
    });
    setSelectedPromptExample({
      label: promptExampleChipLabel(example),
      promptText: example,
    });
    onExamplePromptStatusChange?.({
      title: promptExampleChipLabel(example),
      artifactType: activeChipId ?? 'prototype',
      brief: briefForChipId(activeChipId ?? 'prototype'),
    });
    onPromptChange(example);
    editorRef.current?.setText(example);
    setSelectedIndex(0);
    requestAnimationFrame(() => editorRef.current?.focus());
    triggerSendAttention();
  }

  function pickExamplePluginPreset(record: InstalledPluginRecord, chipId: string, promptText: string) {
    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'example_prompt',
      chip_id: chipId,
      plugin_id: record.sourceMarketplaceEntryName ?? record.id,
      plugin_type: record.marketplaceTrust ?? 'official',
    });
    setSelectedPromptExample({
      label: record.title,
      promptText,
    });
    onExamplePromptStatusChange?.({
      title: record.title,
      artifactType: chipId,
      brief: briefForPluginPreset(record, chipId),
    });
    onPickExamplePlugin(record, chipId, promptText);
  }

  // The task-type rail (原型 / 幻灯片 / HyperFrames / 视频 / …). Records which
  // task type the user picked before delegating to the host's chip handler.
  function handlePickTaskChip(chip: HomeHeroChip) {
    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'task_chip',
      chip_id: chip.id,
    });
    // First chip pick completes the guide's first beat; the preset-card
    // pulse arms once the example cards for this chip render.
    if (readHomeGuideStage() === 'chip') {
      writeHomeGuideStage('card');
      setGuidePulseChipId(null);
    }
    onPickChip(chip);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    setDragActive(false);
    handleFiles(files);
  }

  function openActivePluginDetails() {
    if (activePluginRecord) onOpenPluginDetails(activePluginRecord);
  }

  function openActiveSkillDetails() {
    if (activeSkillRecord) onOpenSkillDetails(activeSkillRecord);
  }

  // Inline-backed plugin/MCP/connector contexts already render as @mention pills
  // in the editor. This row should mount only for content that has a visible chip
  // here; the aggregate context count is just an aria label when the row exists.
  const showActivePluginRow = Boolean(showActivePluginChip && activePluginTitle);
  const showActiveContextRow =
    stagedFiles.length > 0 ||
    showActivePluginRow ||
    Boolean(activeSkillTitle) ||
    contextOnlyPlugins.length > 0 ||
    contextOnlyMcpServers.length > 0 ||
    contextOnlyConnectors.length > 0 ||
    contextWorkspaceItems.length > 0;
  let optionRenderIndex = 0;

  return (
    <section ref={homeHeroRef} className="home-hero" data-testid="home-hero">
      {/* #5517 hero header: the OpenDesign logotype replaces the small
          brand-mark + name pair, and the tagline subtitle is dropped. The
          static wordmark is now a WebGL pixel-scan effect (round 7) — the
          title heading below it is dropped too, since the animated wordmark
          alone carries the brand moment. */}
      <span className="home-hero__logo-wrap">
        <PixelScanLogo className="home-hero__logo home-hero__logo--tiles" />
      </span>

      {/* Capsule type row: the 10 top-level create-scenario types as pill chips above
          the composer (per product — replaces the fanned card carousel); the
          selected pill carries the accent tint, click switches. */}
      <TypePillRow
        chips={templateChips}
        activeChipId={activeChipId}
        disabled={pluginsLoading || pendingChipId !== null || pendingPluginId !== null}
        labelFor={(id) => homeHeroChipLabel(id, t)}
        onPick={handlePickTaskChip}
      />

      {/* #5517 wraps the input card + workdir row into one visible composer
          card so they read as a single surface. */}
      <div className="home-hero__composer-card">
      <div
        className={`home-hero__input-card${
          authoringLayoutActive ? ' home-hero__input-card--compact-authoring' : ''
        }${dragActive ? ' is-drag-active' : ''}`}
        style={inputCardStyle}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        {showActiveContextRow ? (
          <div
            className="home-hero__active"
            aria-label={
              contextItemCount > 0
                ? t('homeHero.contextItemsResolved', { n: contextItemCount })
                : undefined
            }
          >
            {stagedFiles.length > 0 ? (
              <span className="home-hero__active-file-group" data-testid="home-hero-staged-files">
                {stagedFiles.map((file, index) => {
                  const key = homeFileKey(file, index);
                  const previewUrl = stagedFilePreviewUrls.get(key) ?? null;
                  const fileBody = (
                    <>
                      {previewUrl ? (
                        <img
                          className="home-hero__active-thumb"
                          src={previewUrl}
                          alt=""
                          aria-hidden
                          draggable={false}
                        />
                      ) : (
                        <span className="home-hero__active-icon" aria-hidden>
                          <Icon name={isImageFile(file) ? 'image' : 'file'} size={12} />
                        </span>
                      )}
                      <span className="home-hero__active-label">{file.name}</span>
                      <span className="home-hero__active-meta">{formatFileSize(file.size)}</span>
                    </>
                  );
                  return (
                    <span
                      key={key}
                      className="home-hero__active-chip home-hero__active-chip--context home-hero__active-chip--file"
                      title={`${file.name} · ${formatFileSize(file.size)}`}
                    >
                      <span className="home-hero__active-order" aria-label={`Attachment ${index + 1}`}>
                        {index + 1}
                      </span>
                      {previewUrl ? (
                        <button
                          type="button"
                          className="home-hero__active-chip-body home-hero__active-file-body"
                          onClick={() => setPreviewHomeFileKey(key)}
                          aria-label={`Preview ${file.name}`}
                        >
                          {fileBody}
                        </button>
                      ) : (
                        <span className="home-hero__active-file-body">
                          {fileBody}
                        </span>
                      )}
                      <button
                        type="button"
                        className="home-hero__active-clear od-tooltip"
                        onClick={() => removeFileChip(index, file)}
                        aria-label={t('chat.removeAria', { name: file.name })}
                        title={t('homeHero.removeFile')}
                        data-tooltip={t('homeHero.removeFile')}
                      >
                        <Icon name="close" size={9} />
                      </button>
                    </span>
                  );
                })}
              </span>
            ) : null}
            {showActivePluginRow ? (
              <span className="home-hero__active-chip" data-testid="home-hero-active-plugin">
                <button
                  type="button"
                  className="home-hero__active-chip-body"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    openActivePluginDetails();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    openActivePluginDetails();
                  }}
                  onClick={openActivePluginDetails}
                  disabled={!activePluginRecord}
                  title={activePluginRecord ? t('homeHero.pluginTitle', { title: activePluginRecord.title }) : undefined}
                >
                  <span className="home-hero__active-icon" aria-hidden>
                    <Icon name="sliders" size={12} />
                  </span>
                  <span className="home-hero__active-label">{activePluginTitle}</span>
                </button>
                {activeCreateChip && !activePluginIsExplicit ? null : (
                  <button
                    type="button"
                    className="home-hero__active-clear od-tooltip"
                    onClick={() => {
                      trackHomeChatComposerClick(analytics.track, {
                        page_name: 'home',
                        area: 'chat_composer',
                        element: 'plugin_chip_clear',
                        chip_id: activePluginRecord?.id,
                      });
                      onClearActivePlugin();
                    }}
                    aria-label={t('homeHero.clearActivePlugin')}
                    title={t('homeHero.clearActivePlugin')}
                    data-tooltip={t('homeHero.clearActivePlugin')}
                  >
                    <Icon name="close" size={9} />
                  </button>
                )}
              </span>
            ) : null}
            {activeSkillTitle ? (
              <span
                className="home-hero__active-chip home-hero__active-chip--skill"
                data-testid="home-hero-active-skill"
              >
                <button
                  type="button"
                  className="home-hero__active-chip-body"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    openActiveSkillDetails();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    openActiveSkillDetails();
                  }}
                  onClick={openActiveSkillDetails}
                  disabled={!activeSkillRecord}
                  title={activeSkillRecord ? activeSkillRecord.description || activeSkillTitle : undefined}
                >
                  <span className="home-hero__active-icon" aria-hidden>
                    <Icon name="sparkles" size={12} />
                  </span>
                  <span className="home-hero__active-label">{t('homeHero.skillPrefix', { title: activeSkillTitle })}</span>
                </button>
                <button
                  type="button"
                  className="home-hero__active-clear od-tooltip"
                  onClick={onClearActiveSkill}
                  aria-label={t('homeHero.clearActiveSkill')}
                  title={t('homeHero.clearActiveSkill')}
                  data-tooltip={t('homeHero.clearActiveSkill')}
                >
                  <Icon name="close" size={9} />
                </button>
              </span>
            ) : null}
            {contextOnlyPlugins.map((plugin) => (
              <ContextChipHoverCard
                key={`ctx-plugin-${plugin.id}`}
                className="home-hero__active-chip home-hero__active-chip--context"
                data-testid={`home-hero-context-plugin-${plugin.id}`}
                typeLabel="Plugin"
                detail={plugin.id}
              >
                <span className="home-hero__active-icon" aria-hidden>
                  <Icon name="sliders" size={12} />
                </span>
                <span className="home-hero__active-label">{plugin.title}</span>
                <button
                  type="button"
                  className="home-hero__active-clear od-tooltip"
                  onClick={() => {
                    trackHomeChatComposerClick(analytics.track, {
                      page_name: 'home',
                      area: 'chat_composer',
                      element: 'context_remove',
                      resource_kind: 'plugin',
                      resource_id: plugin.id,
                    });
                    onRemovePluginContext(plugin.id);
                  }}
                  aria-label={t('chat.removeAria', { name: plugin.title })}
                  title={t('common.close')}
                  data-tooltip={t('common.close')}
                  data-testid={`home-hero-context-clear-${plugin.id}`}
                >
                  <Icon name="close" size={9} />
                </button>
              </ContextChipHoverCard>
            ))}
            {contextOnlyMcpServers.map((server) => {
              const label = server.label || server.id;
              return (
                <ContextChipHoverCard
                  key={`ctx-mcp-${server.id}`}
                  className="home-hero__active-chip home-hero__active-chip--context"
                  data-testid={`home-hero-context-mcp-${server.id}`}
                  typeLabel="MCP server"
                  detail={server.url || server.id}
                >
                  <span className="home-hero__active-icon" aria-hidden>
                    <Icon name="sliders" size={12} />
                  </span>
                  <span className="home-hero__active-label">{label}</span>
                  <button
                    type="button"
                    className="home-hero__active-clear od-tooltip"
                    onClick={() => {
                      trackHomeChatComposerClick(analytics.track, {
                        page_name: 'home',
                        area: 'chat_composer',
                        element: 'context_remove',
                        resource_kind: 'mcp',
                        resource_id: server.id,
                      });
                      onRemoveMcpContext(server.id);
                    }}
                    aria-label={t('chat.removeAria', { name: label })}
                    title={t('common.close')}
                    data-tooltip={t('common.close')}
                    data-testid={`home-hero-context-clear-${server.id}`}
                  >
                    <Icon name="close" size={9} />
                  </button>
                </ContextChipHoverCard>
              );
            })}
            {contextOnlyConnectors.map((connector) => (
              <ContextChipHoverCard
                key={`ctx-connector-${connector.id}`}
                className="home-hero__active-chip home-hero__active-chip--context"
                data-testid={`home-hero-context-connector-${connector.id}`}
                typeLabel="Connector"
                detail={connector.provider || connector.id}
              >
                <span className="home-hero__active-icon" aria-hidden>
                  <Icon name="link" size={12} />
                </span>
                <span className="home-hero__active-label">{connector.name}</span>
                <button
                  type="button"
                  className="home-hero__active-clear od-tooltip"
                  onClick={() => {
                    trackHomeChatComposerClick(analytics.track, {
                      page_name: 'home',
                      area: 'chat_composer',
                      element: 'context_remove',
                      resource_kind: 'connector',
                      resource_id: connector.id,
                    });
                    onRemoveConnectorContext(connector.id);
                  }}
                  aria-label={t('chat.removeAria', { name: connector.name })}
                  title={t('common.close')}
                  data-tooltip={t('common.close')}
                  data-testid={`home-hero-context-clear-${connector.id}`}
                >
                  <Icon name="close" size={9} />
                </button>
              </ContextChipHoverCard>
            ))}
            {contextWorkspaceItems.map((item) => (
              <ContextChipHoverCard
                key={`ctx-workspace-${item.id}`}
                className="home-hero__active-chip home-hero__active-chip--context"
                data-testid={`home-hero-context-workspace-${item.id}`}
                typeLabel={workspaceContextKindLabel(item.kind)}
                detail={workspaceContextDetailLine(item)}
              >
                <span className="home-hero__active-icon" aria-hidden>
                  <Icon name={item.kind === 'local-code' ? 'terminal' : 'folder'} size={12} />
                </span>
                <span className="home-hero__active-label">{item.label}</span>
                <button
                  type="button"
                  className="home-hero__active-clear od-tooltip"
                  onClick={() => {
                    trackHomeChatComposerClick(analytics.track, {
                      page_name: 'home',
                      area: 'chat_composer',
                      element: 'context_remove',
                      resource_kind: 'workspace',
                      resource_id: item.id,
                    });
                    const nextPrompt = stripHomeMentionToken(prompt, item.label);
                    if (nextPrompt !== prompt) onPromptChange(nextPrompt);
                    onRemoveWorkspaceContext(item.id);
                  }}
                  aria-label={t('chat.removeAria', { name: item.label })}
                  title={t('common.close')}
                  data-tooltip={t('common.close')}
                  data-testid={`home-hero-context-clear-${item.id}`}
                >
                  <Icon name="close" size={9} />
                </button>
              </ContextChipHoverCard>
            ))}
          </div>
        ) : null}
        <div className="home-hero__prompt-surface">
          <div ref={promptEditorRef} className="home-hero__prompt-editor home-hero__lexical">
            <LexicalComposerInput
              ref={editorRef}
              testId="home-hero-input"
              draft={prompt}
              // While the carousel animates, blank the editor's own placeholder
              // so it doesn't double under the overlay; keep the base hint as
              // the accessible/tooltip label.
              placeholder={carouselActive ? '' : placeholder}
              title={carouselActive ? t(PLACEHOLDER_BASE_HINT_KEY) : placeholder}
              knownEntities={promptMentionEntities}
              onChange={(plainText) => {
                // A programmatic seed (host setPrompt → draft prop →
                // SeedingPlugin) echoes back through Lexical's onChange. The
                // old <textarea> never fired onChange for a controlled-value
                // change, so skip the echo here: otherwise seeding would run
                // the host's handlePromptChange — flipping promptEditedByUser
                // (spurious "replace prompt?" dialogs) and re-extracting plugin
                // inputs from the seeded text. Real user edits always differ
                // from the current prompt.
                if (plainText === prompt) return;
                onPromptChange(plainText);
                if (selectedPromptExample && plainText !== selectedPromptExample.promptText) {
                  setSelectedPromptExample(null);
                  onExamplePromptStatusChange?.(null);
                }
              }}
              onTrigger={handleTrigger}
              onEnterSend={handleSend}
              onPasteFiles={handleFiles}
              popoverOpen={pickerOpen && visiblePickerOptions.length > 0}
              onPopoverKey={handlePopoverKey}
              comboboxAria={{
                expanded: pickerOpen,
                activeId: pickerOpen ? `home-hero-option-${selectedIndex}` : null,
              }}
            />
            <PlaceholderCarousel
              active={carouselActive}
              paused={promptFocused}
              scenarios={carouselScenarios}
              onScenarioChange={setCarouselScenario}
            />
          </div>
        </div>
        <CaretFloatingLayer caret={caretRect} open={pickerOpen}>
          <div
            ref={mentionPickerRef}
            id="home-hero-context-picker"
            className="home-hero__plugin-picker home-hero__plugin-picker--floating"
            role="listbox"
            aria-label={t('homeHero.contextSearchResults')}
            data-testid="home-hero-plugin-picker"
          >
            <div className="home-hero__mention-tabs" role="tablist" aria-label={t('homeHero.contextSurfaces')}>
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mentionTab === item.id}
                  className={`home-hero__mention-tab${mentionTab === item.id ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setMentionTab(item.id);
                    setSelectedIndex(0);
                  }}
                >
                  <span>{item.label}</span>
                  {item.count > 0 ? <span>{item.count}</span> : null}
                </button>
              ))}
            </div>
            <div className="home-hero__plugin-picker-results">
              {visibleLoading && visiblePickerOptions.length === 0 ? (
                <div className="home-hero__plugin-picker-empty">{t('homeHero.loadingContext')}</div>
              ) : null}
              {!visibleLoading && visiblePickerOptions.length === 0 ? (
                <div className="home-hero__plugin-picker-empty">
                  {mentionQuery ? (
                    <>{t('homeHero.noResults', { query: mentionQuery })}</>
                  ) : (
                    <>{t('homeHero.searchPrompt')}</>
                  )}
                </div>
              ) : null}
              {visibleSections.map((section) => (
                <div key={section.id} className="home-hero__mention-section">
                  <div className="home-hero__mention-section-label">{section.label}</div>
                  {section.options.map((item) => {
                    const optionIndex = optionRenderIndex;
                    optionRenderIndex += 1;
                    return (
                      <button
                        key={item.id}
                        id={`home-hero-option-${optionIndex}`}
                        type="button"
                        role="option"
                        aria-selected={optionIndex === selectedIndex}
                        className={`home-hero__plugin-option${
                          optionIndex === selectedIndex ? ' is-active' : ''
                        }`}
                        onMouseEnter={() => {
                          setSelectedIndex(optionIndex);
                          setHoveredPlugin(item.pluginRecord ?? null);
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          if (!item.disabled) item.onPick();
                        }}
                        disabled={item.disabled}
                      >
                        <span className="home-hero__plugin-option-icon" aria-hidden>
                          <Icon name={item.icon} size={13} />
                        </span>
                        <span className="home-hero__plugin-option-main">
                          <span>{item.title}</span>
                          <span>{item.description}</span>
                        </span>
                        <span className="home-hero__plugin-option-meta">
                          {item.meta}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {hoveredPlugin ? (
                <div
                  className="home-hero__plugin-hover-card"
                  data-testid="home-hero-plugin-hover-card"
                >
                  <div>
                    <span className="home-hero__plugin-hover-kicker">
                      {getPluginSourceLabel(hoveredPlugin)}
                    </span>
                    <strong>{localizePluginTitle(locale, hoveredPlugin)}</strong>
                    <p>{localizePluginDescription(locale, hoveredPlugin) || hoveredPlugin.id}</p>
                  </div>
                  <div className="home-hero__plugin-hover-meta">
                    <span>{t('homeHero.parameters', { n: (hoveredPlugin.manifest?.od?.inputs ?? []).length })}</span>
                    {getPluginQueryPreview(hoveredPlugin) ? (
                      <span>{getPluginQueryPreview(hoveredPlugin)}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      dismissMentionPicker();
                      onOpenPluginDetails(hoveredPlugin);
                    }}
                  >
                    {t('homeHero.details')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </CaretFloatingLayer>
        <div className="home-hero__input-foot">
          <input
            ref={fileInputRef}
            data-testid="home-hero-file-input"
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              handleFiles(files);
              event.target.value = '';
            }}
          />
          <div className="home-hero__foot-left">
            <ComposerPlusMenu
              workspaceContext={workspaceContext}
              triggerTestId="home-hero-plus-trigger"
              placementPreference="down"
              onOpen={() =>
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_menu_open',
                })
              }
              onSubmenuOpen={(submenu) => {
                // Home never passes the working-dir submenu (it keeps its own
                // footer picker), so only the resource submenus reach here.
                if (submenu === 'toolbox' || submenu === 'workingDir') return;
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_submenu_open',
                  resource_kind: PLUS_SUBMENU_RESOURCE_KIND[submenu],
                });
              }}
              onSearchUsed={(submenu) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_search',
                  resource_kind: PLUS_SUBMENU_RESOURCE_KIND[submenu],
                });
              }}
              connectors={connectorOptions}
              onPickConnector={(connector) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'connector',
                  resource_id: connector.id,
                });
                pickConnector(connector);
              }}
              onAddConnector={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_add',
                  resource_kind: 'connector',
                });
                onAddConnector();
              }}
              plugins={pluginOptions}
              onPickPlugin={(record) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'plugin',
                  resource_id: record.id,
                });
                pickPlugin(record);
              }}
              onAddPlugin={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_add',
                  resource_kind: 'plugin',
                });
                onAddPlugin();
              }}
              skills={skillOptions}
              onPickSkill={(skill) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'skill',
                  resource_id: skill.id,
                });
                pickSkill(skill);
              }}
              mcpServers={mcpOptions}
              onPickMcp={(server) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'mcp',
                  resource_id: server.id,
                });
                pickMcp(server);
              }}
              onAddMcp={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_add',
                  resource_kind: 'mcp',
                });
                onAddMcp();
              }}
              onAttachFiles={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'attachment',
                });
                fileInputRef.current?.click();
              }}
              onReferenceProject={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'workspace',
                  resource_id: 'reference-project',
                });
                trackProjectReferenceModalSurfaceView(analytics.track, {
                  page_name: 'home',
                  area: 'project_reference_modal',
                });
                setProjectReferenceOpen(true);
              }}
              onLinkLocalCode={onPickLocalCodeDir ? () => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'plus_pick',
                  resource_kind: 'workspace',
                  resource_id: 'local-code',
                });
                void handleLinkLocalCodeContext();
              } : undefined}
              onSelectFromLibrary={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'library',
                });
                setLibraryPickerOpen(true);
              }}
              onImportFigma={onImportFigma ? () => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'figma_import',
                });
                onImportFigma();
              } : undefined}
              onShowFigmaHelp={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'figma_help',
                });
                trackFigmaHelpModalSurfaceView(analytics.track, {
                  page_name: 'home',
                  area: 'figma_help_modal',
                });
                setFigmaHelpOpen(true);
              }}
              onOpenDesignSystems={onDesignSystemChange ? () => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'design_system_open',
                });
                openDesignSystemPicker();
              } : undefined}
            />
            {libraryPickerOpen ? (
              <LibraryPicker
                onClose={() => setLibraryPickerOpen(false)}
                onConfirm={(assets) => importLibraryAssets(assets)}
              />
            ) : null}
            {projectReferenceOpen ? (
              <ProjectReferenceModal
                workspaceContext={workspaceContext}
                onClose={() => {
                  // Only the dismiss paths (X / backdrop / Escape / Cancel)
                  // land here — a confirmed pick closes via
                  // handleReferenceProjects, which reports 'success'.
                  trackContextLinkResult(analytics.track, {
                    page_name: 'home',
                    area: 'chat_composer',
                    context_kind: 'project',
                    result: 'cancelled',
                  });
                  setProjectReferenceOpen(false);
                }}
                onSelect={handleReferenceProjects}
              />
            ) : null}
            {figmaHelpOpen ? (
              <FigmaHelpModal onClose={() => setFigmaHelpOpen(false)} />
            ) : null}
            <TemplatePicker
              templates={templateChips}
              activeChipId={activeChipId}
              previewChipId={previewTemplateId}
              disabled={pluginsLoading}
              pickDisabled={pluginsLoading || pendingChipId !== null || pendingPluginId !== null}
              labelFor={(id) => homeHeroChipLabel(id, t)}
              onPick={handlePickTaskChip}
            />
            {footerInputFields.length > 0 ? (
              <div className="home-hero__footer-options" data-testid="home-hero-footer-options">
                {footerInputFields.map((field) => (
                  <FooterInputOption
                    key={field.name}
                    field={field}
                    value={pluginInputValues[field.name]}
                    designSystems={designSystems}
                    onChange={(value) => {
                      onPluginInputValuesChange({
                        ...pluginInputValues,
                        [field.name]: value,
                      });
                    }}
                    t={t}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="home-hero__foot-right">
            <ComposerModePicker
              mode={sessionMode}
              onModeChange={(next) => {
                if (next !== sessionMode) {
                  trackComposerSessionModeClick(analytics.track, {
                    page_name: 'home',
                    area: 'chat_composer',
                    element: 'session_mode_toggle',
                    mode_before: sessionModeToTracking(sessionMode),
                    mode_after: sessionModeToTracking(next),
                  });
                }
                onSessionModeChange?.(next);
              }}
            />
            {executionSwitcher ? (
              <div className="home-hero__execution-switcher">
                {executionSwitcher}
              </div>
            ) : null}
            <button
              type="button"
              className={`home-hero__submit od-tooltip${sendAttention ? ' home-hero__attention-sheen' : ''}${submitting ? ' is-sending' : ''}`}
              data-testid="home-hero-submit"
              onClick={handleSend}
              onAnimationEnd={() => setSendAttention(false)}
              disabled={!sendEnabled}
              title={submitting ? t('chat.comments.sending') : sendEnabled ? t('homeHero.run') : t('homeHero.typeSomethingToRun')}
              data-tooltip={submitting ? t('chat.comments.sending') : sendEnabled ? t('homeHero.run') : t('homeHero.typeSomethingToRun')}
              aria-label={submitting ? t('chat.comments.sending') : t('homeHero.run')}
              aria-busy={submitting}
            >
              <Icon name={submitting ? 'spinner' : 'arrow-up'} size={17} />
            </button>
          </div>
        </div>
      </div>

      {onDesignSystemChange || onPickWorkingDir ? (
        <div className="home-hero__workdir-row">
          {onDesignSystemChange ? (
            <DesignSystemPicker
              variant="home"
              designSystems={designSystems}
              selectedId={selectedDesignSystemId}
              onChange={onDesignSystemChange}
            />
          ) : null}
          {onDesignSystemChange && onPickWorkingDir ? (
            <span className="home-hero__workdir-divider" aria-hidden />
          ) : null}
          {onPickWorkingDir ? (
            <WorkingDirPicker
              className="home-hero__working-dir-picker"
              emptyLabel={t('homeWorkingDir.triggerShort')}
              workingDir={workingDir}
              recentDirs={recentDirs}
              onPickDirectory={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'working_dir',
                });
                void onPickWorkingDir();
              }}
              onSelectRecent={(dir) => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'working_dir_recent',
                });
                onSelectRecentWorkingDir?.(dir);
              }}
              onClear={() => {
                trackHomeChatComposerClick(analytics.track, {
                  page_name: 'home',
                  area: 'chat_composer',
                  element: 'working_dir_clear',
                });
                onClearWorkingDir?.();
              }}
            />
          ) : null}
        </div>
      ) : null}
      </div>

      {recommendationSlot}

      {activeSubChips.length > 0 && isSubChipParent(activeChipId) ? (
        <SubTypeRow
          subChips={activeSubChips}
          selectedSlug={selectedSubcategory}
          pluginsLoading={pluginsLoading}
          onPickSubChip={(sub) => {
            trackHomeChatComposerClick(analytics.track, {
              page_name: 'home',
              area: 'chat_composer',
              element: 'subcategory_chip',
              chip_id: activeChipId ?? undefined,
              subcategory: sub.slug,
            });
            const next = selectedSubcategory === sub.slug ? null : sub;
            setLocalSelectedSubcategory(next?.slug ?? null);
            if (activeChipId === 'prototype') onPickPrototypeSubtype?.(next);
          }}
          onSelectAll={() => {
            trackHomeChatComposerClick(analytics.track, {
              page_name: 'home',
              area: 'chat_composer',
              element: 'subcategory_chip',
              chip_id: activeChipId ?? undefined,
              subcategory: 'all',
            });
            setLocalSelectedSubcategory(null);
            if (activeChipId === 'prototype') onPickPrototypeSubtype?.(null);
          }}
        />
      ) : null}

      {pluginsLoading ? (
        <PluginPromptPresetsLoading />
      ) : filteredExamplePlugins.length > 0 && activeChipId ? (
        <PluginPromptPresets
          chipId={activeChipId}
          plugins={filteredExamplePlugins}
          activePluginId={activePluginRecord?.id ?? null}
          pendingPluginId={pendingPluginId}
          locale={locale}
          onPick={pickExamplePluginPreset}
          pulseFirstPreset={guidePulseFirstPreset}
          workspaceContext={workspaceContext}
        />
      ) : activePromptExamples.length > 0 ? (
        <div
          className="home-hero__prompt-examples"
          data-testid="home-hero-prompt-examples"
        >
          <div className="home-hero__prompt-examples-title">
            {t('homeHero.promptExamples')}
          </div>
          <div
            className={`home-hero__prompt-examples-grid${activeChipId === 'web-clone' ? ' home-hero__prompt-examples-grid--sites' : ''}`}
          >
            {activePromptExamples.map((example, index) =>
              webCloneExampleSite(example) ? (
                <WebClonePromptExampleCard
                  key={example}
                  example={example}
                  pulse={guidePulseFirstPreset && index === 0}
                  onPick={usePromptExample}
                />
              ) : (
                <button
                  key={example}
                  type="button"
                  className={`home-hero__prompt-example${guidePulseFirstPreset && index === 0 ? ' home-hero__attention-sheen' : ''}`}
                  data-testid="home-hero-prompt-example"
                  onClick={() => usePromptExample(example)}
                >
                  <span>{example}</span>
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="home-hero__error">
          {error}
        </div>
      ) : null}
      {previewHomeFile && previewHomeFileUrl ? createPortal(
        <div
          className="staged-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={previewHomeFile.name}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewHomeFileKey(null);
          }}
        >
          <div className="staged-preview-card">
            <div className="staged-preview-head">
              <span title={previewHomeFile.name}>{previewHomeFile.name}</span>
              <button
                type="button"
                className="icon-only od-tooltip"
                onClick={() => setPreviewHomeFileKey(null)}
                aria-label={t('common.close')}
                title={t('common.close')}
                data-tooltip={t('common.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <img src={previewHomeFileUrl} alt={previewHomeFile.name} />
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
});

function PluginPromptPresetsLoading() {
  const { t } = useI18n();
  return (
    <div
      className="home-hero__prompt-examples home-hero__plugin-presets-wrap"
      data-testid="home-hero-examples-loading"
      aria-busy="true"
    >
      <div className="home-hero__prompt-examples-title">
        {t('homeHero.promptExamples')}
      </div>
      <div className="home-hero__rail-scroller">
        <div className="home-hero__plugin-presets-loading" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span className="home-hero__plugin-preset-loading" key={index}>
              <span className="home-hero__plugin-preset-loading-preview" />
              <span className="home-hero__plugin-preset-loading-title" />
            </span>
          ))}
        </div>
      </div>
      <VisuallyHidden>{t('common.loading')}</VisuallyHidden>
    </div>
  );
}

function PluginPromptPresets({
  activePluginId,
  chipId,
  locale,
  onPick,
  pendingPluginId,
  plugins,
  pulseFirstPreset = false,
  workspaceContext = null,
}: {
  activePluginId: string | null;
  chipId: string;
  locale: Locale;
  onPick: (record: InstalledPluginRecord, chipId: string, promptText: string) => void;
  pendingPluginId: string | null;
  plugins: InstalledPluginRecord[];
  workspaceContext?: WorkspaceCollabContext | null;
  // First-run guide: the first card carries the attention sheen.
  pulseFirstPreset?: boolean;
}) {
  const { t } = useI18n();
  // Same edge hover/click auto-scroll as the scenario rail, so this row is
  // reachable without a trackpad when it overflows.
  const edgeScroll = useEdgeAutoScroll(plugins.length);
  return (
    <div
      className="home-hero__prompt-examples home-hero__plugin-presets-wrap"
      data-testid="home-hero-plugin-presets"
    >
      <div className="home-hero__prompt-examples-title">
        {t('homeHero.promptExamples')}
      </div>
      <div className="home-hero__rail-scroller">
        <div
          ref={edgeScroll.scrollRef}
          className="home-hero__plugin-presets"
          role="list"
        >
          {plugins.map((record, index) => (
            <PluginPromptPresetCard
              key={record.id}
              chipId={chipId}
              locale={locale}
              record={record}
              active={activePluginId === record.id}
              pending={pendingPluginId === record.id}
              disabled={pendingPluginId !== null}
              pulse={pulseFirstPreset && index === 0}
              onPick={onPick}
              workspaceContext={workspaceContext}
            />
          ))}
        </div>
        <EdgeScrollZones {...edgeScroll} />
      </div>
    </div>
  );
}

const FIRST_PARTY_WEB_CLONE_SITE_ICONS: Record<string, string> = {
  'open-design.ai': '/logo.svg',
};

function webCloneFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`;
}

// A Website-clone text example ("Website URL to clone: https://open-design.ai") —
// pull the site out so the card can show the site's own mark + bare domain
// instead of the raw prompt line. First-party bundled examples use local assets
// so the first screen is stable without waiting on a remote favicon service.
// Returns null for non-URL examples so the generic text card renders unchanged.
function webCloneExampleSite(example: string): { domain: string; iconUrl: string; fallbackIconUrl?: string } | null {
  const match = example.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  let hostname: string;
  try {
    hostname = new URL(match[0]).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!hostname || !hostname.includes('.')) return null;
  const firstPartyIcon = FIRST_PARTY_WEB_CLONE_SITE_ICONS[hostname];
  return {
    domain: hostname,
    iconUrl: firstPartyIcon ?? webCloneFaviconUrl(hostname),
    ...(firstPartyIcon ? { fallbackIconUrl: webCloneFaviconUrl(hostname) } : {}),
  };
}

function WebClonePromptExampleCard({
  example,
  pulse,
  onPick,
}: {
  example: string;
  pulse: boolean;
  onPick: (example: string) => void;
}) {
  const [iconStage, setIconStage] = useState<'primary' | 'fallback' | 'failed'>('primary');
  const site = webCloneExampleSite(example);
  const domain = site?.domain ?? example;
  const monogram = (domain.replace(/[^a-z0-9]/i, '')[0] ?? '?').toUpperCase();
  let iconUrl: string | null = null;
  if (site && iconStage === 'primary') {
    iconUrl = site.iconUrl;
  } else if (site && iconStage === 'fallback') {
    iconUrl = site.fallbackIconUrl ?? null;
  }
  return (
    <button
      type="button"
      className={`home-hero__prompt-example home-hero__prompt-example--site${pulse ? ' home-hero__attention-sheen' : ''}`}
      data-testid="home-hero-prompt-example"
      onClick={() => onPick(example)}
      title={domain}
    >
      <span className="home-hero__site-badge" aria-hidden>
        {site && iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            loading="eager"
            fetchPriority="high"
            onError={() => {
              setIconStage((stage) => (stage === 'primary' && site.fallbackIconUrl ? 'fallback' : 'failed'));
            }}
          />
        ) : (
          <span className="home-hero__site-monogram">{monogram}</span>
        )}
      </span>
      <span className="home-hero__site-domain">{domain}</span>
    </button>
  );
}

function PluginPromptPresetCard({
  active,
  chipId,
  disabled,
  locale,
  onPick,
  pending,
  pulse = false,
  record,
  workspaceContext = null,
}: {
  active: boolean;
  chipId: string;
  disabled: boolean;
  locale: Locale;
  onPick: (record: InstalledPluginRecord, chipId: string, promptText: string) => void;
  pending: boolean;
  pulse?: boolean;
  record: InstalledPluginRecord;
  workspaceContext?: WorkspaceCollabContext | null;
}) {
  const { t } = useI18n();
  // Example-prompt preset tiles are thumbnails too — prefer the cheap baked
  // hover-pan clip when one exists (same as the gallery cards).
  const preview = useMemo(
    () => inferPluginPreview(record, { preferBaked: true, workspaceContext }),
    [record, workspaceContext],
  );
  // Home cards keep their richer structured-preview path as the last-resort
  // fallback (the detail modal injects a simpler one).
  const seedPrompt = examplePresetSeedPrompt(record, locale, () =>
    pluginPresetPromptPreview(record, locale, chipId),
  ).text;
  // Deck preset thumbnails render the iframe at a fixed 1280 design width scaled
  // to fit the preview cell (see useDeckPreviewScale), so a template's first
  // slide previews proportionally instead of overflowing. The baked-clip path
  // (preferBaked) is already proportional; this fixes the live-HTML fallback.
  const odMode = (record.manifest?.od as { mode?: unknown } | undefined)?.mode;
  const presetPreviewRef = useRef<HTMLSpanElement>(null);
  useDeckPreviewScale(presetPreviewRef, odMode === 'deck' && preview.kind === 'html');
  const title = localizePluginTitle(locale, record);
  // Commercial category ("品类") chip — same signal the gallery tile and the
  // Create page picker show, so the example row reads like the reference
  // template galleries. Null for records without a known category.
  const categoryLabel = pluginCategoryLabel(record, t);
  return (
    <span className="home-hero__plugin-preset-cell" role="listitem">
      <button
        type="button"
        className={`home-hero__plugin-preset${active ? ' is-active' : ''}${pending ? ' is-pending' : ''}${pulse ? ' home-hero__attention-sheen' : ''}`}
        data-testid="home-hero-plugin-preset"
        data-plugin-id={record.id}
        {...(typeof odMode === 'string' ? { 'data-od-mode': odMode } : {})}
        disabled={disabled}
        onClick={() => onPick(record, chipId, seedPrompt)}
      >
        <span className="home-hero__plugin-preset-preview" aria-hidden ref={presetPreviewRef}>
          <PreviewSurface
            pluginId={record.id}
            pluginTitle={title}
            preview={preview}
            eager={odMode === 'deck'}
          />
          {active ? (
            <span className="home-hero__plugin-preset-check" aria-hidden>
              <Icon name="check" size={12} />
            </span>
          ) : null}
        </span>
        <span className="home-hero__plugin-preset-meta">
          {/* Category tag dropped (dogfood 2026-07-28): the filter chips above
              the rail already scope the row, so the per-card pill was noise. */}
          <span className="home-hero__plugin-preset-title">
            {title}
          </span>
        </span>
      </button>
    </span>
  );
}

function promptExampleChipLabel(example: string): string {
  const normalized = example.replace(/\s+/g, ' ').trim();
  const [beforeDash] = normalized.split(/\s[—-]\s/u, 1);
  const candidate = beforeDash?.trim() || normalized;
  return candidate.length > 64 ? `${candidate.slice(0, 61).trimEnd()}...` : candidate;
}

function homeFileKey(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

const LIBRARY_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'text/html': 'html',
  'text/css': 'css',
  'text/plain': 'txt',
  'application/json': 'json',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
};

/** Fetch a library asset's bytes and wrap them in a named File for staging. */
async function fileFromLibraryAsset(asset: LibraryAsset): Promise<File | null> {
  try {
    const resp = await fetch(libraryAssetRawUrl(asset.id));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    let name =
      asset.relPath?.split('/').pop() ||
      assetTitle(asset).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) ||
      `library-${asset.id.slice(0, 8)}`;
    if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
      const ext = LIBRARY_MIME_EXT[(blob.type || asset.mime || '').toLowerCase()];
      if (ext) name = `${name}.${ext}`;
    }
    return new File([blob], name, { type: blob.type || asset.mime || 'application/octet-stream' });
  } catch {
    return null;
  }
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name);
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

const HOME_HERO_PROMPT_MAX_HEIGHT = 180;
const HOME_HERO_AUTHORING_PROMPT_MAX_HEIGHT = 132;

function pluginMentionText(record: InstalledPluginRecord): string {
  return inlineMentionToken(record.title);
}

function buildHomeMentionEntities({
  activePluginRecord,
  activeSkillId,
  activeSkillTitle,
  connectorOptions,
  contextWorkspaceItems,
  mcpOptions,
  pluginOptions,
  selectedPluginContexts,
  stagedFiles,
  skillOptions,
}: {
  activePluginRecord: InstalledPluginRecord | null;
  activeSkillId: string | null;
  activeSkillTitle: string | null;
  connectorOptions: ConnectorDetail[];
  contextWorkspaceItems: WorkspaceContextItem[];
  mcpOptions: McpServerConfig[];
  pluginOptions: InstalledPluginRecord[];
  selectedPluginContexts: InstalledPluginRecord[];
  stagedFiles: File[];
  skillOptions: SkillSummary[];
}): InlineMentionEntity[] {
  const entities: InlineMentionEntity[] = [];
  for (const item of contextWorkspaceItems) {
    entities.push({
      id: item.id,
      kind: 'workspace',
      label: item.label,
      token: inlineMentionToken(item.label),
      title: `Workspace: ${item.label}`,
    });
  }
  const fileSeen = new Set<string>();
  for (const file of stagedFiles) {
    if (fileSeen.has(file.name)) continue;
    fileSeen.add(file.name);
    entities.push({
      id: file.name,
      kind: 'file',
      label: file.name,
      token: inlineMentionToken(file.name),
      title: `File: ${file.name}`,
    });
  }
  const pluginSeen = new Set<string>();
  for (const plugin of [...selectedPluginContexts, ...pluginOptions]) {
    if (pluginSeen.has(plugin.id)) continue;
    pluginSeen.add(plugin.id);
    entities.push({
      id: plugin.id,
      kind: 'plugin',
      label: plugin.title,
      token: pluginMentionText(plugin),
      title: `Plugin: ${plugin.title}`,
    });
  }
  if (activePluginRecord && !pluginSeen.has(activePluginRecord.id)) {
    entities.push({
      id: activePluginRecord.id,
      kind: 'plugin',
      label: activePluginRecord.title,
      token: pluginMentionText(activePluginRecord),
      title: `Plugin: ${activePluginRecord.title}`,
    });
  }
  const skillSeen = new Set<string>();
  for (const skill of skillOptions) {
    if (skillSeen.has(skill.id)) continue;
    skillSeen.add(skill.id);
    entities.push({
      id: skill.id,
      kind: 'skill',
      label: skill.name,
      token: inlineMentionToken(skill.name),
      title: `Skill: ${skill.name}`,
    });
    if (skill.id !== skill.name) {
      entities.push({
        id: skill.id,
        kind: 'skill',
        label: skill.id,
        token: inlineMentionToken(skill.id),
        title: `Skill: ${skill.name}`,
      });
    }
  }
  if (activeSkillId && activeSkillTitle && !skillSeen.has(activeSkillId)) {
    entities.push({
      id: activeSkillId,
      kind: 'skill',
      label: activeSkillTitle,
      token: inlineMentionToken(activeSkillTitle),
      title: `Skill: ${activeSkillTitle}`,
    });
  }
  for (const server of mcpOptions) {
    const label = server.label || server.id;
    entities.push({
      id: server.id,
      kind: 'mcp',
      label,
      token: inlineMentionToken(label),
      title: `MCP: ${label}`,
    });
    if (server.id !== label) {
      entities.push({
        id: server.id,
        kind: 'mcp',
        label: server.id,
        token: inlineMentionToken(server.id),
        title: `MCP: ${label}`,
      });
    }
  }
  for (const connector of connectorOptions) {
    entities.push({
      id: connector.id,
      kind: 'connector',
      label: connector.name,
      token: inlineMentionToken(connector.name),
      title: `Connector: ${connector.name}`,
    });
    if (connector.id !== connector.name) {
      entities.push({
        id: connector.id,
        kind: 'connector',
        label: connector.id,
        token: inlineMentionToken(connector.id),
        title: `Connector: ${connector.name}`,
      });
    }
  }
  return entities;
}

function FooterInputOption({
  field,
  value,
  designSystems,
  onChange,
  t,
}: {
  field: InputFieldSpec;
  value: unknown;
  designSystems: DesignSystemSummary[];
  onChange: (value: unknown) => void;
  t: ReturnType<typeof useT>;
}) {
  const label = footerInputLabel(field, t);
  if (field.name === 'speakerNotes') {
    const checked = footerSpeakerNotesEnabled(value);
    return (
      <button
        type="button"
        className={`home-hero__footer-switch${checked ? ' is-on' : ''}`}
        aria-label={label}
        aria-pressed={checked}
        data-testid="home-hero-footer-option-speakerNotes"
        onClick={() => onChange(checked ? 'no speaker notes' : 'include speaker notes')}
      >
        <span>{t('homeHero.footer.speakerNotes')}</span>
        <i aria-hidden />
      </button>
    );
  }
  if (field.name === 'designSystem') {
    // The composer binds its design-system choice as a TITLE string in the
    // plugin input (used by the apply query template). The shared picker is
    // id-based, so adapt: "不指定 / No design system" (or an unset value) maps
    // to a null id; otherwise resolve the title to its system id.
    const noneTitle = t('designSystemPicker.noneTitle');
    const currentTitle = value === undefined || value === null ? '' : String(value).trim();
    const selectedId =
      currentTitle && currentTitle !== noneTitle && currentTitle !== 'the active project design system'
        ? designSystems.find((system) => system.title === currentTitle)?.id ?? null
        : null;
    return (
      <DesignSystemPicker
        variant="footer"
        label={label}
        designSystems={designSystems}
        selectedId={selectedId}
        onChange={(id) =>
          onChange(id == null ? noneTitle : designSystems.find((system) => system.id === id)?.title ?? noneTitle)
        }
      />
    );
  }
  if (field.type === 'select' && Array.isArray(field.options)) {
    return (
      <FooterSelectOption
        fieldName={field.name}
        label={label}
        value={value === undefined || value === null ? '' : String(value)}
        options={[
          ...(field.placeholder ? [{ value: '', label: field.placeholder }] : []),
          ...field.options.map((option) => ({
            value: option,
            label: footerInputValueLabel(field, option, t),
            icon: footerInputValueIcon(field, option),
            modelIcon: field.name === 'model' ? modelOptionIcon(option, footerInputValueLabel(field, option, t)) : undefined,
            ratioIcon: field.name === 'ratio' ? ratioOptionIcon(option) : undefined,
          })),
        ]}
        onChange={onChange}
      />
    );
  }
  return (
    <label className="home-hero__footer-option home-hero__footer-option--text" data-field-name={field.name}>
      <span>{label}</span>
      <input
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? ''}
        aria-label={label}
        data-testid={`home-hero-footer-option-${field.name}`}
      />
    </label>
  );
}

function FooterSelectOption({
  fieldName,
  label,
  value,
  options,
  searchable = false,
  searchPlaceholder,
  onChange,
}: {
  fieldName: string;
  label: string;
  value: string;
  options: FooterSelectItemOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => (
      option.label.toLowerCase().includes(query) ||
      option.value.toLowerCase().includes(query) ||
      (option.description ?? '').toLowerCase().includes(query) ||
      (option.meta ?? '').toLowerCase().includes(query) ||
      (option.group ?? '').toLowerCase().includes(query)
    ));
  }, [options, search]);
  const groupedOptions = useMemo(() => {
    const groups: { label: string | null; options: FooterSelectItemOption[] }[] = [];
    for (const option of visibleOptions) {
      const groupLabel = option.group ?? null;
      const last = groups[groups.length - 1];
      if (last && last.label === groupLabel) {
        last.options.push(option);
      } else {
        groups.push({ label: groupLabel, options: [option] });
      }
    }
    return groups;
  }, [visibleOptions]);
  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  return (
    <div
      ref={ref}
      className={`home-hero__footer-option home-hero__footer-option--select${open ? ' is-open' : ''}`}
      data-field-name={fieldName}
    >
      <span>{label}</span>
      <button
        type="button"
        className="home-hero__footer-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`home-hero-footer-option-${fieldName}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected?.preview ? <DesignSystemOptionPreview option={selected.preview} compact /> : null}
        {selected?.icon ? <FooterOptionIcon name={selected.icon} compact /> : null}
        {selected?.modelIcon ? <ModelOptionIcon icon={selected.modelIcon} compact /> : null}
        {selected?.ratioIcon ? <RatioOptionIcon icon={selected.ratioIcon} compact /> : null}
        <span className="home-hero__footer-select-label">{selected?.label ?? value}</span>
        <Icon name="chevron-down" size={12} aria-hidden />
      </button>
      {open ? (
        <div
          className={`home-hero__footer-select-menu${searchable ? ' home-hero__footer-select-menu--searchable' : ''}`}
          role="listbox"
          data-testid={`home-hero-footer-option-${fieldName}-menu`}
        >
          {searchable ? (
            <div className="home-hero__footer-select-search">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder ?? label}
                autoFocus
                data-testid={`home-hero-footer-option-${fieldName}-search`}
              />
              <div className="home-hero__footer-select-count">
                {t('homeHero.footer.availableCount', { n: visibleOptions.length })}
              </div>
            </div>
          ) : null}
          {groupedOptions.length === 0 ? (
            <div className="home-hero__footer-select-empty">{t('homeHero.footer.noMatches')}</div>
          ) : (
            groupedOptions.map((group, index) => (
              <div
                className="home-hero__footer-select-group"
                key={`${group.label ?? 'ungrouped'}:${group.options[0]?.value ?? index}`}
              >
                {group.label ? (
                  <div className="home-hero__footer-select-group-label">{group.label}</div>
                ) : null}
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={`home-hero__footer-select-item${option.value === value ? ' is-selected' : ''}`}
                    onClick={() => {
                      onChange(option.submitValue ?? option.value);
                      setOpen(false);
                    }}
                  >
                    {option.preview ? <DesignSystemOptionPreview option={option.preview} /> : null}
                    {option.icon ? <FooterOptionIcon name={option.icon} /> : null}
                    {option.modelIcon ? <ModelOptionIcon icon={option.modelIcon} /> : null}
                    {option.ratioIcon ? <RatioOptionIcon icon={option.ratioIcon} /> : null}
                    <span className="home-hero__footer-select-copy">
                      <span className="home-hero__footer-select-label">{option.label}</span>
                      {option.description ? (
                        <span className="home-hero__footer-select-description">{option.description}</span>
                      ) : null}
                    </span>
                    {option.meta ? <span className="home-hero__footer-select-meta">{option.meta}</span> : null}
                    {option.value === value ? <Icon name="check" size={14} aria-hidden /> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

interface FooterSelectItemOption {
  value: string;
  submitValue?: string;
  label: string;
  group?: string;
  icon?: IconName;
  description?: string;
  meta?: string;
  modelIcon?: ModelOptionIconSpec;
  ratioIcon?: RatioOptionIconSpec;
  preview?: {
    title: string;
    swatches?: string[];
    logoUrl?: string;
  };
}

interface ModelOptionIconSpec {
  label: string;
  tone:
    | 'openai'
    | 'dalle'
    | 'seed'
    | 'sense'
    | 'grok'
    | 'google'
    | 'router'
    | 'flux'
    | 'elevenlabs'
    | 'fishaudio'
    | 'minimax'
    | 'suno'
    | 'audio'
    | 'custom';
  src?: string;
}

interface RatioOptionIconSpec {
  width: number;
  height: number;
  tone: 'square' | 'wide' | 'tall' | 'standard' | 'portrait' | 'custom';
}

function FooterOptionIcon({
  name,
  compact = false,
}: {
  name: IconName;
  compact?: boolean;
}) {
  return (
    <span
      className={`home-hero__footer-option-icon${compact ? ' home-hero__footer-option-icon--compact' : ''}`}
      aria-hidden
    >
      <Icon name={name} size={13} />
    </span>
  );
}

function ModelOptionIcon({
  icon,
  compact = false,
}: {
  icon: ModelOptionIconSpec;
  compact?: boolean;
}) {
  return (
    <span
      className={`home-hero__model-option-icon home-hero__model-option-icon--${icon.tone}${compact ? ' home-hero__model-option-icon--compact' : ''}`}
      aria-hidden
    >
      {icon.src ? <img src={icon.src} alt="" draggable={false} /> : icon.label}
    </span>
  );
}

function RatioOptionIcon({
  icon,
  compact = false,
}: {
  icon: RatioOptionIconSpec;
  compact?: boolean;
}) {
  return (
    <span
      className={`home-hero__ratio-option-icon home-hero__ratio-option-icon--${icon.tone}${compact ? ' home-hero__ratio-option-icon--compact' : ''}`}
      aria-hidden
    >
      <i style={{ width: icon.width, height: icon.height }} />
    </span>
  );
}

function DesignSystemOptionPreview({
  option,
  compact = false,
}: {
  option: { title: string; swatches?: string[]; logoUrl?: string };
  compact?: boolean;
}) {
  const swatches = (option.swatches ?? []).filter(Boolean).slice(0, compact ? 2 : 3);
  const initial = option.title.trim().charAt(0).toUpperCase() || 'D';
  return (
    <span
      className={`home-hero__ds-option-preview${compact ? ' home-hero__ds-option-preview--compact' : ''}`}
      aria-hidden
    >
      {option.logoUrl ? (
        <img src={option.logoUrl} alt="" loading="lazy" />
      ) : swatches.length > 0 ? (
        swatches.map((swatch, index) => (
          <i key={`${swatch}-${index}`} style={{ background: swatch }} />
        ))
      ) : (
        <b>{initial}</b>
      )}
    </span>
  );
}

function footerInputLabel(field: InputFieldSpec, t: ReturnType<typeof useT>): string {
  switch (field.name) {
    case 'designSystem':
      return t('homeHero.footer.designSystem');
    case 'fidelity':
      return t('newproj.fidelityLabel');
    case 'speakerNotes':
      return t('homeHero.footer.speakerNotes');
    case 'model':
      return t('newproj.modelLabel');
    case 'ratio':
      return t('homeHero.footer.ratio');
    case 'duration':
      return t('homeHero.footer.duration');
    case 'resolution':
      return t('homeHero.footer.resolution');
    default:
      return field.label ?? field.name;
  }
}

function footerInputValueLabel(field: InputFieldSpec, value: string, t: ReturnType<typeof useT>): string {
  if (field.name === 'fidelity') {
    if (value === 'wireframe') return t('newproj.fidelityWireframe');
    if (value === 'high-fidelity') return t('newproj.fidelityHigh');
  }
  if (field.name === 'speakerNotes') {
    return footerSpeakerNotesEnabled(value) ? t('homeHero.footer.speakerNotes') : t('homeHero.footer.noSpeakerNotes');
  }
  return optionLabelMap(field)[value] ?? value;
}

function footerSpeakerNotesEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return !(
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'none' ||
    normalized.includes('no speaker')
  );
}

function footerInputValueIcon(field: InputFieldSpec, value: string): IconName | undefined {
  if (field.name === 'fidelity') {
    if (value === 'wireframe') return 'grid';
    if (value === 'high-fidelity') return 'sparkles';
  }
  return undefined;
}

function modelOptionIcon(value: string, label: string): ModelOptionIconSpec {
  const normalized = `${value} ${label}`.toLowerCase();
  if (normalized.includes('dall-e')) return { label: 'OpenAI', tone: 'dalle', src: '/model-icons/openai.svg' };
  if (normalized.includes('gpt-image') || normalized.includes('openai') || normalized.includes('sora')) {
    return { label: 'OpenAI', tone: 'openai', src: '/model-icons/openai.svg' };
  }
  if (normalized.includes('seedream') || normalized.includes('seededit') || normalized.includes('seedance') || normalized.includes('doubao') || normalized.includes('bytedance')) {
    return { label: 'ByteDance', tone: 'seed', src: '/model-icons/bytedance.svg' };
  }
  if (normalized.includes('senseaudio')) return { label: 'SA', tone: 'sense' };
  if (normalized.includes('grok') || normalized.includes('xai') || normalized.includes('xai/')) {
    return { label: 'xAI', tone: 'grok', src: '/model-icons/x.svg' };
  }
  if (normalized.includes('gemini') || normalized.includes('imagen') || normalized.includes('veo') || normalized.includes('google') || normalized.includes('nano-banana')) {
    return { label: 'Google Gemini', tone: 'google', src: '/model-icons/google-gemini.svg' };
  }
  if (normalized.includes('flux') || normalized.includes('bfl') || normalized.includes('black-forest')) {
    return { label: 'FLUX', tone: 'flux', src: '/model-icons/flux.svg' };
  }
  if (normalized.includes('openrouter')) return { label: 'OpenRouter', tone: 'router', src: '/model-icons/openrouter.svg' };
  if (normalized.includes('imagerouter') || normalized.includes('/')) return { label: 'IR', tone: 'router' };
  if (normalized.includes('eleven')) {
    return { label: 'ElevenLabs', tone: 'elevenlabs', src: '/model-icons/elevenlabs.svg' };
  }
  if (normalized.includes('fish')) {
    return { label: 'Fish Audio', tone: 'fishaudio', src: '/model-icons/fishaudio.svg' };
  }
  if (normalized.includes('minimax')) {
    return { label: 'MiniMax', tone: 'minimax', src: '/model-icons/minimax.svg' };
  }
  if (normalized.includes('suno')) return { label: 'Suno', tone: 'suno', src: '/model-icons/suno.svg' };
  if (
    normalized.includes('udio') ||
    normalized.includes('audio') ||
    normalized.includes('voice')
  ) {
    return { label: modelInitials(label), tone: 'audio' };
  }
  return { label: modelInitials(label || value), tone: 'custom' };
}

function modelInitials(input: string): string {
  const cleaned = input
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/^(gpt|model)[-_ ]*/i, '')
    .trim();
  const parts = cleaned.split(/[^a-z0-9]+/i).filter(Boolean);
  const initials = parts.length >= 2
    ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`
    : (parts[0] ?? cleaned).slice(0, 2);
  return initials.toUpperCase() || 'M';
}

function ratioOptionIcon(value: string): RatioOptionIconSpec {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  const rawWidth = Number(match?.[1] ?? 1);
  const rawHeight = Number(match?.[2] ?? 1);
  const ratioWidth = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const ratioHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const maxEdge = 17;
  const scale = maxEdge / Math.max(ratioWidth, ratioHeight);
  const width = Math.max(8, Math.round(ratioWidth * scale));
  const height = Math.max(8, Math.round(ratioHeight * scale));
  const normalized = `${ratioWidth}:${ratioHeight}`;
  const tone = (() => {
    if (normalized === '1:1') return 'square';
    if (normalized === '16:9') return 'wide';
    if (normalized === '9:16') return 'tall';
    if (normalized === '4:3') return 'standard';
    if (normalized === '3:4') return 'portrait';
    return ratioWidth > ratioHeight ? 'wide' : ratioHeight > ratioWidth ? 'tall' : 'custom';
  })();
  return { width, height, tone };
}

function optionLabelMap(field: InputFieldSpec): Record<string, string> {
  const labels = (field as { optionLabels?: unknown }).optionLabels;
  return labels && typeof labels === 'object' && !Array.isArray(labels)
    ? labels as Record<string, string>
    : {};
}

function stripHomeMentionToken(value: string, label: string): string {
  const token = inlineMentionToken(label);
  return value.replace(
    new RegExp(`(^|[\\s([{"'])${escapeRegExp(token)}(?=$|\\s|[.,;:!?)}\\]"'])([^\\S\\r\\n])?`, 'g'),
    '$1',
  );
}

function fileMatchesQuery(file: File, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [file.name, file.type || '']
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function pluginMatchesQuery(plugin: InstalledPluginRecord, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    plugin.title,
    localizePluginTitle(locale, plugin),
    plugin.id,
    plugin.sourceKind,
    plugin.manifest?.description ?? '',
    localizePluginDescription(locale, plugin),
    ...(plugin.manifest?.tags ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function skillMatchesQuery(skill: SkillSummary, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    skill.id,
    skill.name,
    localizeSkillName(locale, skill),
    skill.description,
    localizeSkillDescription(locale, skill),
    skill.mode,
    skill.surface ?? '',
    ...skill.triggers,
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function mcpServerMatchesQuery(server: McpServerConfig, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    server.id,
    server.label ?? '',
    server.transport,
    server.url ?? '',
    server.command ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function connectorMatchesQuery(connector: ConnectorDetail, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    connector.id,
    connector.name,
    connector.provider,
    connector.category,
    connector.description ?? '',
    connector.accountLabel ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPluginSourceLabel(plugin: InstalledPluginRecord): string {
  return plugin.sourceKind === 'bundled' ? 'Official' : 'My plugin';
}

function getPluginQueryPreview(plugin: InstalledPluginRecord): string {
  const raw = plugin.manifest?.od?.useCase?.query;
  const value =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw.en ?? raw['zh-CN'] ?? Object.values(raw).find((entry): entry is string => (
            typeof entry === 'string' && entry.length > 0
          )) ?? ''
        : '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 96 ? `${trimmed.slice(0, 96)}…` : trimmed;
}

interface RailGroupProps {
  group: ChipGroup;
  activeChipId: string | null;
  pendingChipId: string | null;
  pendingPluginId: string | null;
  pluginsLoading: boolean;
  onPickChip: (chip: HomeHeroChip) => void;
  variant?: 'rail' | 'tabs';
  // First-run guide: this chip carries the attention sheen.
  pulseChipId?: string | null;
  // Hover-preview hook: the create rail reports which chip the pointer is over
  // (or null on leave) so the footer Template picker can preview it.
  onHoverChip?: (chipId: string | null) => void;
  children?: ReactNode;
}

function RailGroup({
  group,
  activeChipId,
  pendingChipId,
  pendingPluginId,
  pluginsLoading,
  onPickChip,
  variant = 'rail',
  pulseChipId = null,
  onHoverChip,
  children,
}: RailGroupProps) {
  const t = useT();
  // The inline create rail leads with the slide deck and runs through the core
  // build scenarios in a fixed order (see `orderedCreateChips`); every other
  // group renders in catalog order.
  const chips = useMemo(
    () => (group === 'create' ? orderedCreateChips() : chipsForGroup(group)),
    [group],
  );
  const isTabs = variant === 'tabs';

  // Edge auto-scroll so the overflowing scenario rail stays reachable without a
  // trackpad (see EdgeAutoScroll). Only the tabs variant scrolls; for the
  // legacy rail variant scrollRef stays unattached and the hook is inert.
  const edgeScroll = useEdgeAutoScroll(chips.length);

  const cards = chips.map((chip) => {
    const isActive = activeChipId === chip.id;
    const isPending = pendingChipId === chip.id;
    const disabled = pluginsLoading || isPending || pendingPluginId !== null;
    const nextStep = homeHeroChipTitle(chip, t);
    // Card variant (the default create rail): an illustrated scenario card —
    // an intent thumbnail (ScenarioArt) + title + one-line description. The
    // full "what happens next" sentence stays on the native `title` tooltip
    // instead of an inline line that resized the card on hover. The legacy
    // `rail`/pill markup is kept for any caller that still asks for `variant="rail"`.
    if (isTabs) {
      const description = homeHeroChipDescription(chip.id, t);
      const cardCls = ['home-hero__type-tab', `home-hero__type-tab--${group}`, 'home-hero__scenario-card'];
      if (isActive) cardCls.push('is-active');
      if (isPending) cardCls.push('is-pending');
      if (pulseChipId === chip.id) cardCls.push('home-hero__attention-sheen');
      return (
        <button
          key={chip.id}
          type="button"
          className={cardCls.join(' ')}
          data-chip-id={chip.id}
          data-testid={`home-hero-rail-${chip.id}`}
          onClick={() => onPickChip(chip)}
          onMouseEnter={() => onHoverChip?.(chip.id)}
          disabled={disabled}
          role="tab"
          aria-selected={isActive}
          title={nextStep}
        >
          <span className="home-hero__scenario-card-art" aria-hidden>
            <ScenarioArt chipId={chip.id} fallbackIcon={chip.icon} />
          </span>
          <span className="home-hero__scenario-card-body">
            <span className="home-hero__scenario-card-title home-hero__type-tab-label">
              {homeHeroChipLabel(chip.id, t)}
            </span>
            {description ? (
              <span className="home-hero__scenario-card-desc">{description}</span>
            ) : null}
          </span>
        </button>
      );
    }
    const cls = ['home-hero__rail-chip', `home-hero__rail-chip--${group}`];
    if (isActive) cls.push('is-active');
    if (isPending) cls.push('is-pending');
    if (pulseChipId === chip.id) cls.push('home-hero__attention-sheen');
    return (
      <button
        key={chip.id}
        type="button"
        className={cls.join(' ')}
        data-chip-id={chip.id}
        data-testid={`home-hero-rail-${chip.id}`}
        onClick={() => onPickChip(chip)}
        disabled={disabled}
        aria-pressed={isActive}
        title={nextStep}
      >
        <Icon
          name={chip.icon}
          size={14}
          className="home-hero__rail-chip-icon"
        />
        <span className="home-hero__rail-chip-label">
          {homeHeroChipLabel(chip.id, t)}
        </span>
      </button>
    );
  });

  if (isTabs) {
    return (
      <div
        className="home-hero__scenario-cards-wrap"
        onMouseLeave={() => onHoverChip?.(null)}
      >
        <div
          ref={edgeScroll.scrollRef}
          className={`home-hero__type-tabs home-hero__type-tabs--${group} home-hero__scenario-cards`}
          data-testid="home-hero-type-tabs"
          data-rail-group={group}
          role="tablist"
          aria-label={t('homeHero.railAria')}
        >
          {cards}
          {children}
        </div>
        <EdgeScrollZones {...edgeScroll} />
      </div>
    );
  }

  return (
    <div
      className={`home-hero__rail-group home-hero__rail-group--${group}`}
      data-rail-group={group}
    >
      {cards}
      {children}
    </div>
  );
}

function SubTypeChip({
  sub,
  isActive,
  pluginsLoading,
  onPick,
}: {
  sub: HomeHeroSubChip;
  isActive: boolean;
  pluginsLoading: boolean;
  onPick: (sub: HomeHeroSubChip) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={`home-hero__subtype-chip${isActive ? ' is-active' : ''}`}
      data-sub-chip-id={sub.slug}
      data-testid={`home-hero-subtype-${sub.slug}`}
      onClick={() => onPick(sub)}
      disabled={pluginsLoading}
      role="tab"
      aria-selected={isActive}
    >
      <Icon name={sub.icon} size={13} className="home-hero__subtype-chip-icon" />
      <span className="home-hero__subtype-chip-label">
        {homeHeroSubChipLabel(sub, t)}
      </span>
    </button>
  );
}

function SubTypeRow({
  subChips,
  selectedSlug,
  pluginsLoading,
  onPickSubChip,
  onSelectAll,
}: {
  subChips: HomeHeroSubChip[];
  selectedSlug: string | null;
  pluginsLoading: boolean;
  onPickSubChip: (sub: HomeHeroSubChip) => void;
  onSelectAll: () => void;
}) {
  const t = useT();
  const allActive = selectedSlug === null;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  // How many sub-chips fit on one line after the always-present "All" chip;
  // the rest collapse into a "More" dropdown so the row never wraps.
  const [visibleCount, setVisibleCount] = useState(subChips.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  // Measure against the always-full hidden ghost row so chip widths are stable
  // no matter what the visible row currently shows, then pick the largest
  // prefix that fits (reserving room for the More button when it's needed).
  const measure = useCallback(() => {
    const row = rowRef.current;
    const ghost = measureRef.current;
    if (!row || !ghost) return;
    const avail = row.clientWidth;
    if (avail <= 0) return;
    const gap = 5;
    const allWidth = ghost.querySelector<HTMLElement>('[data-measure="all"]')?.offsetWidth ?? 0;
    const moreWidth = ghost.querySelector<HTMLElement>('[data-measure="more"]')?.offsetWidth ?? 0;
    const chipEls = Array.from(ghost.querySelectorAll<HTMLElement>('[data-measure="chip"]'));
    // Everything (All + every chip) fits: no More button needed.
    let full = allWidth;
    for (const el of chipEls) full += gap + el.offsetWidth;
    if (full <= avail) {
      setVisibleCount(chipEls.length);
      return;
    }
    // Overflow: reserve the More button and count the fitting prefix.
    const budget = avail - gap - moreWidth;
    let used = allWidth;
    let count = 0;
    for (let i = 0; i < chipEls.length; i++) {
      const next = used + gap + chipEls[i]!.offsetWidth;
      if (next <= budget) {
        used = next;
        count = i + 1;
      } else {
        break;
      }
    }
    setVisibleCount(count);
  }, []);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure, subChips]);

  // Close the More menu on outside pointer / Escape.
  useEffect(() => {
    if (!moreOpen) return undefined;
    function onDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [moreOpen]);

  const visibleChips = subChips.slice(0, visibleCount);
  const overflowChips = subChips.slice(visibleCount);
  const overflowActive = overflowChips.some((sub) => sub.slug === selectedSlug);
  const allChip = (
    <button
      type="button"
      className={`home-hero__subtype-chip${allActive ? ' is-active' : ''}`}
      data-sub-chip-id="all"
      data-testid="home-hero-subtype-all"
      onClick={onSelectAll}
      disabled={pluginsLoading}
      role="tab"
      aria-selected={allActive}
    >
      <span className="home-hero__subtype-chip-label">{t('common.all')}</span>
    </button>
  );

  return (
    <div
      ref={rowRef}
      className="home-hero__subtype-row"
      data-testid="home-hero-subtype-row"
      role="tablist"
      aria-label={t('homeHero.subTypeAria')}
    >
      {allChip}
      {visibleChips.map((sub) => (
        <SubTypeChip
          key={sub.slug}
          sub={sub}
          isActive={sub.slug === selectedSlug}
          pluginsLoading={pluginsLoading}
          onPick={onPickSubChip}
        />
      ))}
      {overflowChips.length > 0 ? (
        <div className="home-hero__subtype-more" ref={moreRef}>
          <button
            type="button"
            className={`home-hero__subtype-chip home-hero__subtype-more-btn${overflowActive ? ' is-active' : ''}`}
            data-testid="home-hero-subtype-more"
            onClick={() => setMoreOpen((open) => !open)}
            disabled={pluginsLoading}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <span className="home-hero__subtype-chip-label">{t('homeHero.subTypeMore')}</span>
            <Icon name="chevron-down" size={12} className="home-hero__subtype-chip-icon" />
          </button>
          {moreOpen ? (
            <div className="home-hero__subtype-more-menu" role="menu" aria-label={t('homeHero.subTypeMore')}>
              {overflowChips.map((sub) => {
                const isActive = sub.slug === selectedSlug;
                return (
                  <button
                    key={sub.slug}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`home-hero__subtype-more-item${isActive ? ' is-active' : ''}`}
                    data-testid={`home-hero-subtype-more-${sub.slug}`}
                    disabled={pluginsLoading}
                    onClick={() => {
                      setMoreOpen(false);
                      onPickSubChip(sub);
                    }}
                  >
                    <Icon name={sub.icon} size={13} className="home-hero__subtype-chip-icon" />
                    <span className="home-hero__subtype-chip-label">
                      {homeHeroSubChipLabel(sub, t)}
                    </span>
                    {isActive ? <Icon name="check" size={13} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Hidden ghost row: always the full set, used only to measure chip
          widths so the visible row can compute how many fit. */}
      <div className="home-hero__subtype-measure" aria-hidden ref={measureRef}>
        <span className="home-hero__subtype-chip" data-measure="all">
          <span className="home-hero__subtype-chip-label">{t('common.all')}</span>
        </span>
        {subChips.map((sub) => (
          <span key={sub.slug} className="home-hero__subtype-chip" data-measure="chip">
            <Icon name={sub.icon} size={13} className="home-hero__subtype-chip-icon" />
            <span className="home-hero__subtype-chip-label">
              {homeHeroSubChipLabel(sub, t)}
            </span>
          </span>
        ))}
        <span className="home-hero__subtype-chip home-hero__subtype-more-btn" data-measure="more">
          <span className="home-hero__subtype-chip-label">{t('homeHero.subTypeMore')}</span>
          <Icon name="chevron-down" size={12} className="home-hero__subtype-chip-icon" />
        </span>
      </div>
    </div>
  );
}

function homeHeroSubChipLabel(
  sub: HomeHeroSubChip,
  t: ReturnType<typeof useT>,
): string {
  if (sub.slug === 'mobile') return t('homeHero.chip.mobile');
  if (sub.slug === 'wireframe') return t('homeHero.chip.wireframe');
  return pluginSubfacetLabel(sub.slug, sub.label, t);
}

interface ShortcutsMenuProps {
  activeChipId: string | null;
  pendingChipId: string | null;
  pendingPluginId: string | null;
  pluginsLoading: boolean;
  open: boolean;
  refNode: RefObject<HTMLDivElement>;
  onOpenChange: (open: boolean) => void;
  onPickChip: (chip: HomeHeroChip) => void;
}

function ShortcutsMenu({
  activeChipId,
  pendingChipId,
  pendingPluginId,
  pluginsLoading,
  open,
  refNode,
  onOpenChange,
  onPickChip,
}: ShortcutsMenuProps) {
  const t = useT();
  const shortcuts = useMemo(() => chipsForGroup('migrate'), []);
  const disabled = pluginsLoading || pendingPluginId !== null;
  const hasActiveShortcut = shortcuts.some((chip) => chip.id === activeChipId);
  const hasPendingShortcut = shortcuts.some((chip) => chip.id === pendingChipId);
  const triggerClass = [
    'home-hero__type-tab',
    'home-hero__type-tab--more',
    hasActiveShortcut ? 'is-active' : '',
    hasPendingShortcut ? 'is-pending' : '',
  ].filter(Boolean).join(' ');

  // The trigger lives inside the horizontally-scrolling rail, whose
  // `overflow-x: auto` also clips vertically — so an in-flow dropdown gets
  // truncated. Portal the panel to the body with fixed positioning anchored to
  // the trigger, and keep it aligned as the rail scrolls or the window resizes.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPanelPos({
        top: Math.round(rect.bottom + 6),
        right: Math.round(window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    // Capture phase: scroll events don't bubble, so this is how the panel
    // follows the trigger when the rail itself scrolls.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);
  return (
    <div
      ref={refNode}
      className="home-hero__shortcut-menu"
      data-testid="home-hero-shortcuts"
      data-rail-group="migrate"
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        data-testid="home-hero-shortcuts-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('homeHero.moreShortcuts')}
        title={t('homeHero.moreShortcuts')}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="more-horizontal" size={16} className="home-hero__type-tab-icon" />
      </button>
      {open && panelPos
        ? createPortal(
        <div
          className="home-hero__shortcut-menu-panel"
          role="menu"
          aria-label={t('homeHero.moreShortcuts')}
          data-testid="home-hero-shortcuts-menu"
          data-shortcuts-panel=""
          data-rail-group="migrate"
          style={{ position: 'fixed', top: panelPos.top, right: panelPos.right }}
        >
          {shortcuts.map((chip) => {
            const isActive = activeChipId === chip.id;
            const isPending = pendingChipId === chip.id;
            const cls = ['home-hero__shortcut-menu-item'];
            if (isActive) cls.push('is-active');
            if (isPending) cls.push('is-pending');
            return (
              <button
                key={chip.id}
                type="button"
                role="menuitem"
                className={cls.join(' ')}
                data-chip-id={chip.id}
                data-testid={`home-hero-rail-${chip.id}`}
                disabled={pluginsLoading || isPending || pendingPluginId !== null}
                title={homeHeroChipTitle(chip, t)}
                onClick={() => onPickChip(chip)}
              >
                <Icon name={chip.icon} size={14} className="home-hero__shortcut-menu-icon" />
                <span>{homeHeroChipLabel(chip.id, t)}</span>
              </button>
            );
          })}
        </div>,
          document.body,
        )
        : null}
    </div>
  );
}

// Scenario subtitle shown under the title on the illustrated card rail.
function homeHeroChipDescription(chipId: string, t: ReturnType<typeof useT>): string {
  switch (chipId) {
    case 'prototype': return t('homeHero.chip.prototypeDesc');
    case 'web-clone': return t('homeHero.chip.webCloneDesc');
    case 'wireframe': return t('homeHero.chip.wireframeDesc');
    case 'mobile': return t('homeHero.chip.mobileDesc');
    case 'deck': return t('homeHero.chip.deckDesc');
    case 'document': return t('homeHero.chip.documentDesc');
    case 'image': return t('homeHero.chip.imageDesc');
    case 'video': return t('homeHero.chip.videoDesc');
    case 'audio': return t('homeHero.chip.audioDesc');
    case 'hyperframes': return t('homeHero.chip.hyperframesDesc');
    case 'webgl': return t('homeHero.chip.webglDesc');
    case 'live-artifact': return t('homeHero.chip.liveArtifactDesc');
    case 'create-brand-kit': return t('homeHero.chip.createBrandKitDesc');
    default: return '';
  }
}

function fallbackPlaceholderScenarioText(
  chipId: string,
  locale: Locale,
  t: ReturnType<typeof useT>,
): string | null {
  const label = homeHeroChipLabel(chipId, t).trim();
  if (!label || label === chipId) return null;
  const description = homeHeroChipDescription(chipId, t).trim();
  const kind = promptLocaleKind(locale);
  if (kind === 'zh') {
    return description ? `创建一个${label}：${description}` : `创建一个${label}`;
  }
  if (kind === 'ja') {
    return description ? `${label}を作成する：${description}` : `${label}を作成する`;
  }
  return description
    ? `Create ${englishArticle(label)} ${label}: ${description}`
    : `Create ${englishArticle(label)} ${label}`;
}

// The hover "what happens next" line — describes how the scenario will be
// consumed once picked (e.g. "Open a chat that builds a clickable prototype").
function homeHeroChipTitle(chip: HomeHeroChip, t: ReturnType<typeof useT>): string {
  switch (chip.id) {
    case 'prototype': return t('homeHero.chip.prototypeNext');
    case 'web-clone': return t('homeHero.chip.webCloneNext');
    case 'wireframe': return t('homeHero.chip.wireframeNext');
    case 'mobile': return t('homeHero.chip.mobileNext');
    case 'deck': return t('homeHero.chip.deckNext');
    case 'document': return t('homeHero.chip.documentNext');
    case 'image': return t('homeHero.chip.imageNext');
    case 'video': return t('homeHero.chip.videoNext');
    case 'audio': return t('homeHero.chip.audioNext');
    case 'live-artifact': return t('homeHero.chip.liveArtifactHint');
    case 'hyperframes': return t('homeHero.chip.hyperframesHint');
    case 'create-brand-kit': return t('homeHero.chip.createBrandKitHint');
    case 'create-plugin': return t('homeHero.chip.createPluginHint');
    case 'figma': return t('homeHero.chip.figmaHint');
    case 'template': return t('homeHero.chip.templateHint');
    default: return homeHeroChipLabel(chip.id, t);
  }
}

// Generic catch-all scenario routers are not real "example" templates: they
// ship no concrete seed for the gallery and only exist as the silent default
// binding a media surface carries (see scenario-defaults.ts). Keep them out of
// the example-prompt presets so e.g. the "Media generation (default scenario)"
// card never appears under the audio/image/video chips — and, because the
// example card's selected state is keyed on the active plugin id, never shows
// up pre-selected when a media mode is entered.
//
// `example-web-clone` is the Website clone chip's own base scenario, not a
// concrete example. The per-site examples are plain text prompt cards (from
// HOME_PROMPT_EXAMPLES) rather than plugins, so hide the base plugin to keep the
// preset rail empty for web-clone and let those text cards show instead.
//
// `GALLERY_HIDDEN_PLUGIN_IDS` folds in the chamber curation list (see
// plugins-home/chamberCuration.ts): upstream templates that are not work this
// office does. The rail and the Community grid read the same set, so an id is
// hidden from both surfaces or from neither.
const EXAMPLE_PRESET_HIDDEN_PLUGIN_IDS = new Set<string>([
  'od-media-generation',
  'example-web-clone',
  ...GALLERY_HIDDEN_PLUGIN_IDS,
]);

export function homeHeroExamplePluginsForChip(
  chipId: string,
  plugins: InstalledPluginRecord[],
  locale: Locale,
): InstalledPluginRecord[] {
  // The top-level rail is a curated showcase capped at 18 for most chips. The
  // deck chip is the exception: surface the FULL slide-template library so every
  // bundled deck is reachable as an example prompt straight from "All" (without
  // first picking a sub-category), keeping the rail in parity with the Community
  // section's "Slides" count.
  const showcaseLimit = chipId === 'deck' ? Number.POSITIVE_INFINITY : 18;
  const presets = plugins
    // isGalleryHidden is an allow-list (chamberCuration.ts): only first-party
    // chamber templates reach this rail, so an upstream package added later
    // cannot leak into it.
    .filter((plugin) => !EXAMPLE_PRESET_HIDDEN_PLUGIN_IDS.has(plugin.id) && !isGalleryHidden(plugin.id))
    .filter((plugin) => (
      pluginMatchesExampleChip(plugin, chipId) ||
      curatedPluginPriorityForChip(plugin, chipId) !== null
    ))
    .filter((plugin) => (
      Boolean(pluginPresetQuery(plugin, locale)) ||
      curatedPluginPriorityForChip(plugin, chipId) !== null
    ))
    .sort((a, b) => comparePluginPresetOrder(a, b, chipId))
    .slice(0, showcaseLimit);
  return presets;
}

function comparePluginPresetOrder(
  a: InstalledPluginRecord,
  b: InstalledPluginRecord,
  chipId: string,
): number {
  // Gallery order (OPEND-449): pins first, default seeds + no-preview tiles sunk
  // to the bottom, then usage popularity for non-prototype chips. The prototype
  // chip stays curation-governed, so popularity is skipped and it keeps its
  // curated order.
  const curationGoverned = chipId === 'prototype';
  const gallery = comparePluginGalleryOrder(a.id, b.id, curationGoverned, curationGoverned);
  if (gallery !== 0) return gallery;
  const aCurated = curatedPluginPriorityForChip(a, chipId);
  const bCurated = curatedPluginPriorityForChip(b, chipId);
  if (aCurated !== null || bCurated !== null) {
    if (aCurated !== null && bCurated === null) return -1;
    if (aCurated === null && bCurated !== null) return 1;
    if (aCurated !== bCurated) return (aCurated ?? 0) - (bCurated ?? 0);
  }
  const rankDelta = pluginPresetRank(b, chipId) - pluginPresetRank(a, chipId);
  if (rankDelta !== 0) return rankDelta;
  return (a.title || a.id).localeCompare(b.title || b.id);
}

export function pluginMatchesExampleChip(record: InstalledPluginRecord, chipId: string): boolean {
  const slugs = pluginRecordSlugs(record);
  const has = (...values: string[]) => values.some((value) => slugs.has(value));
  const hasPart = (...values: string[]) => {
    const all = [...slugs];
    return values.some((value) =>
      all.some((slug) => slug === value || slug.includes(value) || slug.split('-').includes(value)),
    );
  };
  switch (chipId) {
    case 'prototype':
      return has('prototype') || hasPart('web-prototype');
    case 'web-clone':
      // Website reproduction flows (e.g. example-web-clone / site-clone kits).
      return has('web-clone', 'website-clone', 'site-clone') || hasPart('web-clone', 'website-clone');
    case 'wireframe':
      // Lo-fi / sketch / whiteboard explorations (e.g. wireframe-sketch).
      return (
        hasPart('wireframe') ||
        has('low-fidelity', 'lo-fi-mockup', 'sketch-wireframe', 'whiteboard-sketch', 'hand-drawn')
      );
    case 'mobile':
      // Native mobile app prototypes: iOS / Android phone screens.
      return (
        (hasPart('mobile') ||
          has('ios-app', 'android-app', 'phone-screen', 'app-mockup', 'app-ui')) &&
        !hasPart('video', 'audio', 'image', 'hyperframes')
      );
    case 'document':
      // Documents: resumes, reports, invoices, papers, briefs, PDFs.
      return (
        (has('resume', 'cv', 'invoice', 'document', 'docs', 'report', 'paper') ||
          hasPart(
            'resume',
            'documentation',
            'invoice',
            'report',
            'whitepaper',
            'academic-paper',
            'case-report',
            'meeting-notes',
            'runbook',
            'eguide',
            'letter',
            'dossier',
            'memo',
          )) &&
        !hasPart('video', 'audio', 'hyperframes', 'deck', 'slides')
      );
    case 'deck':
      return has('deck', 'slides', 'slide-deck') || hasPart('slide', 'deck');
    case 'hyperframes':
      return hasPart('hyperframes', 'hyperframe');
    case 'live-artifact':
      return has('live-artifact') || hasPart('live-artifact');
    case 'webgl':
      return (
        has('webgl', 'webgl2', 'shader', 'gpu') ||
        hasPart('webgl', 'shader', 'gpu')
      );
    case 'image':
      return (has('image') || hasPart('image-template')) && !hasPart('video', 'audio', 'live-artifact');
    case 'video':
      return (has('video') || hasPart('video-template')) && !hasPart('hyperframes', 'audio');
    case 'audio':
      // Exclude video / HyperFrames templates that merely carry an
      // `audio-reactive` tag (substring-matched by hasPart('audio')): their
      // home is the Video / HyperFrames chips, not the audio gallery.
      return (has('audio') || hasPart('audio')) && !hasPart('video', 'hyperframes');
    default:
      return false;
  }
}

function pluginPresetRank(record: InstalledPluginRecord, chipId: string): number {
  const slugs = pluginRecordSlugs(record);
  let score = 0;
  if (record.sourceKind === 'bundled') score += 20;
  if (record.id.startsWith('example-')) score += 12;
  if (record.id.includes('template')) score += 8;
  if (inferPluginPreview(record).kind !== 'text') score += 6;
  if (slugs.has(chipId)) score += 4;
  if (record.manifest?.od?.preview) score += 3;
  return score;
}

function pluginRecordSlugs(record: InstalledPluginRecord): Set<string> {
  const od = record.manifest?.od ?? {};
  const rawValues = [
    record.id,
    record.title,
    record.manifest?.name,
    record.manifest?.title,
    fieldString(od, 'mode'),
    fieldString(od, 'surface'),
    fieldString(od, 'scenario'),
    fieldString(od, 'taskKind'),
    ...(record.manifest?.tags ?? []),
  ];
  return new Set(rawValues.map((value) => slugifyHomeValue(value ?? '')).filter(Boolean));
}

function fieldString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function slugifyHomeValue(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function pluginPresetPromptPreview(
  record: InstalledPluginRecord,
  locale: Locale,
  chipId: string,
): string {
  const query = pluginPresetQuery(record, locale);
  const rendered = query
    ? renderPluginPresetQuery(record, query)
    : localizePluginDescription(locale, record);
  return textPromptForPluginPreset(record, rendered, chipId, locale);
}

function textPromptForPluginPreset(
  record: InstalledPluginRecord,
  prompt: string,
  chipId: string,
  locale: Locale,
): string {
  const cleaned = prompt.trim();
  const structured = parseStructuredPresetPrompt(cleaned);
  if (structured !== null) {
    return describeStructuredPresetPrompt(record, structured, chipId, locale);
  }
  if (cleaned.length > 0) return cleaned;
  return fallbackPluginPresetPrompt(record, chipId, locale);
}

function parseStructuredPresetPrompt(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function describeStructuredPresetPrompt(
  record: InstalledPluginRecord,
  structured: unknown,
  chipId: string,
  locale: Locale,
): string {
  const kind = promptLocaleKind(locale);
  const artifact = pluginPresetArtifactLabel(chipId, kind);
  const title = localizePluginTitle(locale, record).trim();
  const strings = collectStructuredPromptStrings(structured);
  const main =
    strings.find((item) => isMainPromptField(item.key) && item.value.length >= 8)?.value ??
    strings.find((item) => item.value.length >= 16)?.value ??
    (localizePluginDescription(locale, record) || title);
  const detailValues = uniquePromptStrings(
    strings
      .filter((item) => item.value !== main)
      .filter((item) => isUsefulPromptDetail(item.value))
      .map((item) => item.value),
  ).slice(0, 4);
  if (kind === 'zh') {
    const details = detailValues.length > 0
      ? `重点包含：${detailValues.join('；')}。`
      : '';
    return `使用「${title}」插件生成${artifact}。${main}${sentenceEnd(main)}${details}`;
  }
  if (kind === 'ja') {
    const details = detailValues.length > 0
      ? `重点として：${detailValues.join('、')}。`
      : '';
    return `「${title}」プラグインで${artifact}を生成します。${main}${sentenceEnd(main)}${details}`;
  }
  const details = detailValues.length > 0
    ? ` Include ${detailValues.join('; ')}.`
    : '';
  return `Create ${englishArticle(artifact)} ${artifact} with the "${title}" preset. ${main}${englishSentenceEnd(main)}${details}`;
}

function collectStructuredPromptStrings(
  value: unknown,
  path: string[] = [],
): Array<{ key: string; value: string }> {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    return [{ key: path[path.length - 1] ?? '', value: text }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStructuredPromptStrings(item, [...path, String(index)]));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      collectStructuredPromptStrings(child, [...path, key]),
    );
  }
  return [];
}

function isMainPromptField(key: string): boolean {
  return [
    'instruction',
    'prompt',
    'description',
    'subject',
    'brief',
    'goal',
  ].includes(key.toLowerCase());
}

function isUsefulPromptDetail(value: string): boolean {
  if (value.length < 8) return false;
  if (/^l\d+:/iu.test(value)) return false;
  return true;
}

function uniquePromptStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function sentenceEnd(value: string): string {
  return /[.!?。！？]$/u.test(value.trim()) ? '' : '。';
}

function englishSentenceEnd(value: string): string {
  return /[.!?。！？]$/u.test(value.trim()) ? '' : '.';
}

function pluginPresetArtifactLabel(chipId: string, kind: PromptLocaleKind): string {
  if (kind === 'zh') {
    switch (chipId) {
      case 'prototype': return '一个交互原型';
      case 'deck': return '一套 PPT slide';
      case 'image': return '一张图片';
      case 'video': return '一段视频';
      case 'hyperframes': return '一段 HyperFrames 动效视频';
      case 'audio': return '一段音频';
      default: return '一个设计产物';
    }
  }
  if (kind === 'ja') {
    switch (chipId) {
      case 'prototype': return 'インタラクティブなプロトタイプ';
      case 'deck': return 'PPT スライド';
      case 'image': return '画像';
      case 'video': return '動画';
      case 'hyperframes': return 'HyperFrames のモーション動画';
      case 'audio': return 'オーディオ';
      default: return 'デザイン成果物';
    }
  }
  switch (chipId) {
    case 'prototype': return 'interactive prototype';
    case 'deck': return 'PPT slide deck';
    case 'image': return 'image';
    case 'video': return 'video';
    case 'hyperframes': return 'HyperFrames motion video';
    case 'audio': return 'audio clip';
    default: return 'design artifact';
  }
}

function englishArticle(noun: string): 'a' | 'an' {
  return /^[aeiou]/iu.test(noun) ? 'an' : 'a';
}

function fallbackPluginPresetPrompt(
  record: InstalledPluginRecord,
  chipId: string,
  locale: Locale,
): string {
  const kind = promptLocaleKind(locale);
  const artifact = pluginPresetArtifactLabel(chipId, kind);
  const title = localizePluginTitle(locale, record);
  const description = localizePluginDescription(locale, record).trim();
  if (kind === 'zh') {
    return `使用「${title}」插件生成${artifact}${description ? `，方向是：${description}` : ''}。`;
  }
  if (kind === 'ja') {
    return `「${title}」プラグインで${artifact}を生成します${description ? `。方向性：${description}` : ''}。`;
  }
  return `Create ${englishArticle(artifact)} ${artifact} with the "${title}" preset${description ? `: ${description}` : '.'}`;
}

// CF self-hosted deployment ships English only (see i18n/types.ts LOCALES), so
// this table carries the `en` entry alone; the accessor below falls back to it.
const HOME_PROMPT_EXAMPLES: Partial<Record<Locale, Record<string, string[]>>> & {
  en: Record<string, string[]>;
} = {
  "en": {
    "web-clone": [
      "Website URL to clone: https://fhchamber.com",
    ],
    prototype: [
      "Design an event landing page for the Fountain Hills Oktoberfest with the date and venue up front, ticket tiers, a schedule, and a sponsor wall",
      "Build a membership join page that compares the four member tiers, shows what each includes, and ends with one clear Join the Chamber action",
      "Create a member directory page for chamber businesses with category filters, search, a featured member spotlight, and contact details",
      "Design a sponsor page for the annual golf tournament covering foursome packages, hole sponsorships, and a downloadable commitment form",
    ],
    wireframe: [
      "Wireframe a chamber event registration flow: event detail, attendee count, add-ons, payment, and a confirmation screen",
      "Sketch a lo-fi member dashboard with membership status, upcoming events, invoices due, and directory listing controls",
      "Lay out a ribbon cutting request form in greybox fidelity with business details, preferred dates, and a review step",
      "Wireframe the chamber staff view for an event guest list with search, check-in, ticket tier, and export actions",
    ],
    mobile: [
      "Design a mobile event companion for Oktoberfest with the schedule, vendor map, beer garden hours, and a favorites list",
      "Lay out a member app with a digital membership card, upcoming mixers, referral tracking, and a business directory",
      "Prototype a mobile check-in screen for chamber events covering search, ticket scan, walk-up registration, and a headcount view",
      "Design a Shop Fountain Hills mobile screen with local business categories, member deals, and a map view",
    ],
    document: [
      "Draft a member benefits one-pager listing the four tiers, what each includes, dues, and how to join",
      "Write a sponsorship packet for the State of the Town luncheon with audience numbers, package levels, and deadlines",
      "Create a membership renewal notice with the amount due, renewal date, benefits used this year, and payment options",
      "Build an advertising rate card for the chamber newsletter, website, and event programs with sizes, rates, and deadlines",
    ],
    deck: [
      "Create a board meeting deck covering membership growth, event revenue, budget variance, and the next quarter priorities",
      "Design the annual report deck with the year in review, member counts, program highlights, financials, and thank-you slides",
      "Build a sponsor pitch deck for the golf tournament with audience reach, package tiers, past sponsor results, and next steps",
      "Generate a State of the Town presentation covering local business trends, tourism numbers, new members, and the year ahead",
    ],
    image: [
      "Design an event flyer for the monthly Business After Hours mixer with the date, time, host business, and RSVP line",
      "Create a ribbon cutting announcement graphic welcoming a new member business, with the business name, address, and a photo slot",
      "Make a member spotlight social post celebrating a local business, with a portrait slot, one quote, and the chamber mark",
      "Design an Oktoberfest poster with the fountain silhouette, dates, entertainment lineup, and the ticket link",
    ],
    video: [
      "Make a 10-second event promo for the golf tournament that opens on the course, lists the date and format, and ends on the registration link",
      "Create a new member welcome clip that shows the business name, category, and a short greeting from the chamber",
      "Generate a vertical membership drive video that names three member benefits and ends with a join call to action",
      "Turn the Oktoberfest flyer into a 15-second social ad with the headline, dates, and one clear ticket prompt",
    ],
    hyperframes: [
      "Build a captioned event recap short with title cards, photo beats, and an ending invitation to the next mixer",
      "Create an animated year in review that counts up new members, events hosted, and ribbon cuttings held",
      "Make a 3-second chamber logo outro with the fountain motif, a soft accent sweep, and the tagline",
      "Generate an animated map of Fountain Hills that drops pins on member businesses by district",
    ],
    audio: [
      "Generate a warm 20-second intro bed for the chamber podcast that opens bright and hands off cleanly to a host",
      "Create a short event announcement sting for the mixer promo, upbeat and civic, ending on a soft resolve",
      "Make a seamless background loop for the chamber lobby video wall, calm and unobtrusive",
      "Generate a radio-ready 30-second bed for a membership drive spot with room for voiceover and a clear final beat",
    ],
  },
};

export const HOME_PROMPT_EXAMPLE_CHIP_IDS = [
  'prototype',
  'deck',
  'image',
  'video',
  'hyperframes',
  'audio',
] as const;

// English is the only shipped locale in this deployment, so every lookup
// resolves through the `en` fallback by design.
export function homeHeroChipPromptExamplesForLocale(chipId: string, locale: Locale): string[] {
  return HOME_PROMPT_EXAMPLES[locale]?.[chipId] ?? HOME_PROMPT_EXAMPLES.en[chipId] ?? [];
}

function homeHeroChipPromptExamples(chipId: string, locale: Locale): string[] {
  return homeHeroChipPromptExamplesForLocale(chipId, locale);
}


function briefForChipId(chipId: string): Record<string, string> {
  switch (chipId) {
    case 'prototype':
      return { artifact_type: 'web prototype', audience: 'product evaluators', fidelity: 'high-fidelity' };
    case 'web-clone':
      return { artifact_type: 'website clone', source: 'target URL', fidelity: 'source-first visual reproduction' };
    case 'wireframe':
      return { artifact_type: 'lo-fi wireframe', audience: 'product team', fidelity: 'wireframe' };
    case 'mobile':
      return { artifact_type: 'mobile app prototype', audience: 'product evaluators', platform: 'iOS & Android' };
    case 'document':
      return { artifact_type: 'document (resume / report / PDF)', audience: 'readers' };
    case 'deck':
      return { artifact_type: 'pitch deck / presentation', audience: 'decision makers', slide_count: '10-15 pages' };
    case 'image':
      return { artifact_type: 'image', style: 'cinematic, high-quality, on-brand' };
    case 'video':
      return { artifact_type: 'video', style: 'cinematic, high-quality, on-brand' };
    case 'hyperframes':
      return { artifact_type: 'motion graphic / animated sequence', style: 'cinematic, polished transitions' };
    case 'audio':
      return { artifact_type: 'audio', style: 'professional, polished, brand-appropriate' };
    default:
      return { artifact_type: chipId };
  }
}

function briefForPluginPreset(record: InstalledPluginRecord, chipId: string): Record<string, string> {
  const brief: Record<string, string> = { ...briefForChipId(chipId) };
  const fields = record.manifest?.od?.inputs ?? [];
  for (const field of fields) {
    const value = field.default ?? field.placeholder;
    if (value != null && typeof value === 'string' && value.trim()) {
      brief[field.name] = value;
    }
  }
  return brief;
}
