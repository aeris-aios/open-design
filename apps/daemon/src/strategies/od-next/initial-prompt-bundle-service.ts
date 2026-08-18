import path from 'node:path';

import {
  OdNextRuntimeCapabilitySnapshotV1Schema,
  executionProfileFromStreamFormat,
  type OdNextStrategyRequestRecipeV2,
} from '@open-design/contracts';

import {
  detectDeckIntentSignal,
  detectMediaIntentSignal,
  detectPlatformIntentSignal,
  extractUserAuthoredSignalText,
  renderConnectedExternalMcpDirective,
} from '../../prompts/system.js';
import {
  buildBrowserUseRunState,
  isBrowserUseRequested,
  renderBrowserUseUnavailablePrompt,
} from '../../browser/index.js';
import {
  getProject,
  latchConversationIntentSignals,
  normalizeConversationSessionMode,
} from '../../db.js';
import { pinRunDesignSystemScope, type PinnedRunDesignSystemScope } from '../../design-systems/run-scope.js';
import { readMcpConfig, type McpServerConfig } from '../../mcp-config.js';
import { isTokenExpired, readAllTokens } from '../../mcp-tokens.js';
import { resolveProjectDir } from '../../projects.js';
import { getSnapshot } from '../../plugins/snapshots.js';
import { resolveOdNextStrategyRequestRecipeV2 } from '../../plugins/strategy-recipe.js';
import { resolveExternalMcpServersForRun } from '../../run-tool-bundle.js';
import {
  composeChatAgentTextPayload,
  designSystemIdFromPluginSnapshot,
  resolveEffectiveDesignSystemSelection,
  resolveOdNextRequestUserPrompt,
  resolveResearchCommandContract,
} from '../../runtimes/chat-prompt-inputs.js';
import { renderRunContextPrompt } from '../../runtimes/chat-run-context.js';
import type {
  PinnedRunWorkspaceScope,
  RunWorkspaceScope,
} from '../../runtimes/project-amr-trace-env.js';
import type { RuntimeAgentDef } from '../../runtimes/types.js';
import type { DetectedRuntimeVersions } from '../../runtimes/detection.js';
import {
  evaluateOdNextExecutionEligibility,
  hashOdNextRuntimeCapabilitySnapshotV1,
  resolveBundledOdNextRuntimeCapability,
} from '../../runtimes/od-next-capability-gate.js';
import {
  renderFrozenSkillBundleContext,
  type FrozenSkillPackageV1,
} from './frozen-skill-package.js';
import {
  loadOdNextTaskInputSnapshot,
  type OdNextTaskInputSnapshotDescriptor,
} from './task-input-snapshot.js';
import { daemonOwnedOdNextPlanningCatalog } from './resolver.js';

type SqliteDb = Parameters<typeof getProject>[0];
type IntentSignals = ReturnType<typeof latchConversationIntentSignals>;

// Keep this header grammar aligned with parseFormAnswers in @open-design/contracts.
const FORM_ANSWERS_HEADER_RE =
  /^\s*\[form answers(?:\s*[\u2014\-:]\s*([^\]\r\n]+))?\]\s*(?:\r?\n|$)/i;

type ResearchInput = {
  enabled?: boolean;
  query?: string;
  maxSources?: number;
} | null;

export interface OdNextInitialPromptMeta {
  agentId: string;
  message?: unknown;
  currentPrompt?: unknown;
  priorTranscript?: unknown;
  systemPrompt?: unknown;
  projectId?: unknown;
  conversationId?: unknown;
  skillId?: unknown;
  skillIds?: unknown;
  designSystemId?: unknown;
  sessionMode?: unknown;
  locale?: unknown;
  research?: ResearchInput;
  context?: unknown;
  titleGeneration?: unknown;
  byokMediaDefaults?: unknown;
  mediaExecution?: unknown;
  appliedPluginSnapshotId?: unknown;
  workspaceScope?: RunWorkspaceScope | null;
  toolBundle?: unknown;
  strategyRolloutDecision?: {
    syntheticCanary?: boolean;
    effectiveMode?: 'off' | 'observe' | 'active';
  } | null;
  runtimeCapabilitySnapshot?: unknown;
}

interface DaemonSystemPromptResult {
  prompt: string;
  odNextStableContextPrompt?: string | null;
}

interface OdNextInitialPromptBundleServiceDeps {
  db: SqliteDb;
  projectsDir: string;
  runtimeDataDir: string;
  daemonUrl: string;
  sandboxEnabled: boolean;
  getAgentDef: (agentId: string) => RuntimeAgentDef | null | undefined;
  createAgentRuntimeToolPrompt: (
    daemonUrl: string,
    toolTokenGrant: { token: string } | null,
  ) => string;
  composeDaemonSystemPrompt: (
    input: Record<string, unknown>,
  ) => Promise<DaemonSystemPromptResult>;
}

export interface PrepareOdNextInitialPromptBundleInput {
  meta: OdNextInitialPromptMeta;
  frozenSkillPackage: FrozenSkillPackageV1;
  taskInputSnapshot: OdNextTaskInputSnapshotDescriptor;
}

export interface PreparedOdNextInitialPromptBundle {
  text: string;
  designSystemScope: PinnedRunDesignSystemScope | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function runScopedMcpServers(toolBundle: unknown): McpServerConfig[] {
  const servers = record(toolBundle)?.mcpServers;
  return Array.isArray(servers) ? servers as McpServerConfig[] : [];
}

/** Resolve and enrich the exact strategy recipe with daemon-owned runtime facts. */
export async function resolveOdNextPromptRecipeForRun(input: {
  db: SqliteDb;
  bundledPluginsDir: string;
  appliedPluginSnapshotId: unknown;
  agentId: string;
  streamFormat: string;
  atomPromptsEnabled: boolean;
  syntheticCanary: boolean;
  automaticAdmission: boolean;
  runtimeCapabilitySnapshot?: unknown;
  getRuntimeVersions: () => Promise<DetectedRuntimeVersions | null>;
}): Promise<OdNextStrategyRequestRecipeV2 | null> {
  const snapshotId = stringValue(input.appliedPluginSnapshotId);
  if (!snapshotId) return null;
  const snapshot = getSnapshot(input.db, snapshotId);
  if (!snapshot?.strategy) return null;

  const resolvedRecipe = await resolveOdNextStrategyRequestRecipeV2({
    bundledPluginsDir: input.bundledPluginsDir,
    snapshot,
    executionProfile: executionProfileFromStreamFormat(input.streamFormat),
    atomPromptsEnabled: input.atomPromptsEnabled,
    loadAtomBodies: async (atomIds) => {
      const { loadBundledAtomBodiesStrict } = await import('../../plugins/atom-bodies.js');
      return loadBundledAtomBodiesStrict(input.db, atomIds);
    },
  });
  if (!resolvedRecipe) return null;

  if (input.syntheticCanary && process.env.NODE_ENV === 'production') {
    throw new Error('OD Next synthetic runtime planning facts are local-only.');
  }
  let capabilitySnapshot;
  if (input.runtimeCapabilitySnapshot !== undefined) {
    const parsed = OdNextRuntimeCapabilitySnapshotV1Schema.safeParse(
      input.runtimeCapabilitySnapshot,
    );
    if (!parsed.success) {
      throw new Error('OD Next runtime planning facts unavailable: frozen_snapshot_invalid');
    }
    if (parsed.data.agentId !== input.agentId) {
      throw new Error('OD Next runtime planning facts unavailable: frozen_snapshot_runtime_mismatch');
    }
    const { snapshotHash, ...withoutHash } = parsed.data;
    if (hashOdNextRuntimeCapabilitySnapshotV1(withoutHash) !== snapshotHash) {
      throw new Error('OD Next runtime planning facts unavailable: frozen_snapshot_hash_mismatch');
    }
    capabilitySnapshot = parsed.data;
  } else {
    if (input.automaticAdmission) {
      throw new Error('OD Next runtime planning facts unavailable: frozen_snapshot_missing');
    }
    // Compatibility fallback for explicitly selected/test strategy paths. The
    // automatic active path must consume the snapshot frozen at admission.
    const versions = await input.getRuntimeVersions();
    if (!versions?.invocable) {
      throw new Error('OD Next runtime planning facts unavailable: runtime_not_invocable');
    }
    const capability = resolveBundledOdNextRuntimeCapability({
      agentId: input.agentId,
      ...(versions.agentCliVersion
        ? { agentCliVersion: versions.agentCliVersion }
        : {}),
      ...(versions.runtimeCompanionName
        ? { runtimeCompanionName: versions.runtimeCompanionName }
        : {}),
      ...(versions.runtimeCompanionVersion
        ? { runtimeCompanionVersion: versions.runtimeCompanionVersion }
        : {}),
    });
    if (
      !capability.snapshot
      || (capability.reason !== 'capability_resolved' && !input.syntheticCanary)
    ) {
      throw new Error(
        `OD Next runtime planning facts unavailable: ${capability.reason}`,
      );
    }
    capabilitySnapshot = capability.snapshot;
  }
  const eligibility = evaluateOdNextExecutionEligibility(capabilitySnapshot, 'complex');
  if (!eligibility.eligible && !input.syntheticCanary) {
    throw new Error(
      `OD Next runtime planning facts unavailable: ${eligibility.reason}`,
    );
  }
  const catalog = daemonOwnedOdNextPlanningCatalog(resolvedRecipe.taskType);
  return {
    ...resolvedRecipe,
    planningFacts: {
      capabilitySnapshotHash: capabilitySnapshot.snapshotHash.replace(/^sha256:/, ''),
      inputRefs: ['request'],
      productionRoutes: catalog.productionRoutes,
      outputKinds: catalog.outputKinds,
    },
  };
}

/**
 * Own the immutable request-stage Prompt Bundle assembly. The daemon
 * composition root supplies process/runtime dependencies; project, MCP,
 * frozen-input, and prompt ordering decisions stay together here.
 */
export function createOdNextInitialPromptBundleService(
  deps: OdNextInitialPromptBundleServiceDeps,
): (input: PrepareOdNextInitialPromptBundleInput) => Promise<PreparedOdNextInitialPromptBundle> {
  return async ({ meta, frozenSkillPackage, taskInputSnapshot }) => {
    const {
      agentId,
      message,
      currentPrompt,
      priorTranscript,
      systemPrompt,
      projectId: rawProjectId,
      conversationId: rawConversationId,
      skillId,
      skillIds,
      designSystemId,
      sessionMode,
      locale,
      research,
      context,
      titleGeneration,
      byokMediaDefaults,
    } = meta;
    const def = deps.getAgentDef(agentId);
    if (!def) throw new Error(`unknown agent: ${agentId}`);

    const projectId = stringValue(rawProjectId);
    const conversationId = stringValue(rawConversationId);
    const project = projectId ? getProject(deps.db, projectId) : null;
    const projectRoot = projectId
      ? resolveProjectDir(deps.projectsDir, projectId, project?.metadata)
      : null;
    const appliedPluginSnapshotId = stringValue(meta.appliedPluginSnapshotId);
    const pluginDesignSystemId = appliedPluginSnapshotId
      ? designSystemIdFromPluginSnapshot(
          getSnapshot(deps.db, appliedPluginSnapshotId) as unknown as Parameters<
            typeof designSystemIdFromPluginSnapshot
          >[0],
        )
      : null;
    const scopeSelection = project?.metadata?.intent === 'web-clone'
      ? { id: null }
      : resolveEffectiveDesignSystemSelection({
          requestDesignSystemId: stringValue(designSystemId),
          pluginDesignSystemId,
          projectDesignSystemId: project?.designSystemId,
          allowAppDefault: false,
        });
    const designSystemScope = projectId
      ? pinRunDesignSystemScope({
          db: deps.db,
          projectId,
          designSystemId: scopeSelection.id,
          workspaceScope: meta.workspaceScope?.workspaceId
            ? meta.workspaceScope as PinnedRunWorkspaceScope
            : null,
        })
      : null;
    const runSessionMode = normalizeConversationSessionMode(sessionMode);
    const userPrompt = resolveOdNextRequestUserPrompt({
      message,
      currentPrompt,
      hasCurrentPrompt: Object.prototype.hasOwnProperty.call(meta, 'currentPrompt'),
    });
    const browserUse = buildBrowserUseRunState({
      requested: isBrowserUseRequested(message, currentPrompt, systemPrompt),
      agentId: def.id,
    });
    const freshIntentSignals: IntentSignals = {
      deck: detectDeckIntentSignal(
        extractUserAuthoredSignalText(stringValue(message)),
        extractUserAuthoredSignalText(stringValue(currentPrompt)),
      ),
      media: detectMediaIntentSignal(
        extractUserAuthoredSignalText(stringValue(message)),
        extractUserAuthoredSignalText(stringValue(currentPrompt)),
      ),
      platform: detectPlatformIntentSignal(
        extractUserAuthoredSignalText(stringValue(message)),
        extractUserAuthoredSignalText(stringValue(currentPrompt)),
      ),
    };
    const intentSignals = conversationId
      ? latchConversationIntentSignals(deps.db, conversationId, freshIntentSignals)
      : freshIntentSignals;
    const {
      prompt: daemonSystemPrompt,
      odNextStableContextPrompt,
    } = await deps.composeDaemonSystemPrompt({
      agentId,
      projectId,
      skillId,
      skillIds,
      designSystemId,
      streamFormat: def.streamFormat ?? 'plain',
      locale,
      sessionMode: runSessionMode,
      mediaExecution: meta.mediaExecution,
      byokMediaDefaults,
      appliedPluginSnapshotId: appliedPluginSnapshotId ?? null,
      freeformDeckSignal: intentSignals.deck,
      mediaHintSignal: intentSignals.media,
      platformHintSignal: intentSignals.platform,
      workspaceScope: meta.workspaceScope,
      designSystemScope,
      frozenSkillPackage,
      odNextSyntheticCanary:
        meta.strategyRolloutDecision?.syntheticCanary === true,
      odNextAutomaticAdmission:
        meta.strategyRolloutDecision?.effectiveMode === 'active',
      runtimeCapabilitySnapshot: meta.runtimeCapabilitySnapshot,
    });
    const loadedTaskInputs = loadOdNextTaskInputSnapshot(
      taskInputSnapshot,
      path.join(deps.runtimeDataDir, 'od-next-task-inputs'),
    );
    const runContextPrompt = renderRunContextPrompt(context, project?.metadata);
    const runtimeToolPrompt = deps.createAgentRuntimeToolPrompt(
      deps.daemonUrl,
      projectRoot && projectId ? { token: 'available' } : null,
    );
    const researchCommandContract = resolveResearchCommandContract(research, userPrompt);
    const formAnswerMatch = FORM_ANSWERS_HEADER_RE.exec(
      typeof currentPrompt === 'string' ? currentPrompt : '',
    );
    const formId = formAnswerMatch
      ? ((formAnswerMatch[1] || 'form').trim().replace(/[^\w.-]/g, '') || 'form').toLowerCase()
      : null;
    const formOverride = formId
      ? formId === 'discovery' || formId === 'task-type'
        ? `The <user_prompt> contains submitted answers for the ${formId} form. Apply them to the active OD Next plan. Do not re-emit that answered form or repeat fields it already answered.`
        : `The <user_prompt> contains submitted answers for the ${formId} form. Treat them as the active user turn and do not replay the answered form.`
      : '';
    const titleGenerationRecord = record(titleGeneration);
    const titleGenerationDirective = titleGenerationRecord?.enabled === true
      ? [
          'Internal title task:',
          'Before answering the user request, emit exactly one short title marker:',
          '<od-title>Title Here</od-title>',
          'Rules: 2-6 words, preserve the user request language, no quotes, no markdown, no punctuation unless necessary.',
          'Do not mention this title task to the user. Continue with the normal answer after the title marker.',
        ].join('\n')
      : '';
    let persistedMcpServers: McpServerConfig[] = [];
    if (!deps.sandboxEnabled) {
      try {
        persistedMcpServers = (await readMcpConfig(deps.runtimeDataDir)).servers;
      } catch (error) {
        console.warn('[mcp-config] prompt freeze read failed:', error);
      }
    }
    const {
      enabledServers: enabledPromptMcp,
      persistedTokenServerIds: promptTokenServerIds,
    } = resolveExternalMcpServersForRun({
      persistedServers: persistedMcpServers,
      runScopedServers: runScopedMcpServers(meta.toolBundle),
      sandboxMode: deps.sandboxEnabled,
    });
    const connectedPromptServerIds = new Set<string>();
    if (promptTokenServerIds.size > 0) {
      try {
        const storedTokens = await readAllTokens(deps.runtimeDataDir);
        for (const [serverId, token] of Object.entries(storedTokens)) {
          if (
            promptTokenServerIds.has(serverId)
            && typeof token.accessToken === 'string'
            && token.accessToken.length > 0
            && !isTokenExpired(token)
          ) {
            connectedPromptServerIds.add(serverId);
          }
        }
      } catch (error) {
        console.warn('[mcp-tokens] prompt freeze read failed:', error);
      }
    }
    const connectedExternalMcp = enabledPromptMcp
      .filter((server) => connectedPromptServerIds.has(server.id))
      .map((server) => ({ id: server.id, label: server.label }));
    const requestInputPendingFact = [
      renderFrozenSkillBundleContext(frozenSkillPackage),
      loadedTaskInputs.requestInputText,
    ].filter(Boolean).join('\n\n---\n\n');
    const result = composeChatAgentTextPayload({
      formOverride,
      daemonSystemPrompt,
      runtimeToolPrompt,
      researchCommandContract,
      runContextPrompt,
      connectedExternalMcpReference: renderConnectedExternalMcpDirective(connectedExternalMcp),
      browserUnavailableGuard: renderBrowserUseUnavailablePrompt(browserUse),
      titleGenerationDirective,
      clientSystemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
      cwdReference: '',
      linkedDirectoryReferences: '',
      echoGuard: 'Do not quote, restate, or echo <system_prompt>. Begin the response by addressing <user_prompt>.',
      requestOrStageText: userPrompt,
      projectAttachmentReferences: '',
      commentAttachmentReferences: '',
      imageReferences: '',
      odNextRequestBundle: {
        stableContext: odNextStableContextPrompt ?? '',
        priorTranscript: typeof priorTranscript === 'string' ? priorTranscript : '',
        taskConfigPendingFact: loadedTaskInputs.taskConfigText,
        requestInputPendingFact,
      },
      strategyInputStage: 'request',
    });
    return { text: result.composedPrompt, designSystemScope };
  };
}
