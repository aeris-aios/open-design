export const OD_NEXT_EXACT_INPUT_MAP_VERSION =
  'open-design.od-next-exact-input-map/v1' as const;

export type OdNextExactInputClassification =
  | 'initial_bundle'
  | 'stage_turn'
  | 'transport_reference'
  | 'out_of_band'
  | 'excluded';

export type OdNextExactInputStage =
  | 'request'
  | 'clarification'
  | 'contract_repair'
  | 'production';

export type OdNextExactInputEntry = Readonly<{
  id: string;
  classification: OdNextExactInputClassification;
  source: string;
  owner: string;
  textTarget?: 'system_prompt' | 'user_prompt' | 'task_config' | 'context';
  stage?: 'clarification' | 'contract_repair' | 'production';
  note: string;
}>;

export type OdNextSemanticRequestFactEntry = Readonly<{
  id: string;
  classification: 'initial_bundle' | 'transport_reference' | 'out_of_band' | 'excluded';
  source: string;
  owner: string;
  textTarget?: 'system_prompt' | 'user_prompt' | 'task_config' | 'context';
  note: string;
}>;

/**
 * Every leaf text input consumed by the current production Markdown composer.
 *
 * Task 02 will replace that composer for OD Next. Keeping this list separate
 * from the ownership map makes an unregistered addition fail at the production
 * seam instead of silently escaping the future XML root.
 */
export const OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1 = [
  'form_override',
  'daemon_system_prompt',
  'runtime_tool_prompt',
  'research_command_contract',
  'run_context_prompt',
  'connected_external_mcp_reference',
  'browser_unavailable_guard',
  'title_generation_directive',
  'client_system_prompt',
  'cwd_reference',
  'linked_directory_references',
  'echo_guard',
  'request_text',
  'project_attachment_references',
  'comment_attachment_references',
  'image_references',
] as const;

export type OdNextLegacyTextContributorId =
  (typeof OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1)[number];

/**
 * Final text-segment and transport ownership map. Aggregate entries such as
 * `daemon_system_prompt` deliberately remain aggregates here; their semantic
 * leaves are enumerated in OD_NEXT_SEMANTIC_REQUEST_FACT_MAP_V1 below.
 * `source` names a real production symbol/seam, not a product-spec alias.
 */
export const OD_NEXT_EXACT_INPUT_MAP_V1 = [
  {
    id: 'form_override',
    classification: 'initial_bundle',
    source: 'startChatRun.formOverride',
    owner: 'bundle serializer',
    textTarget: 'system_prompt',
    note: 'First-run form-answer control text; later generic user turns are outside this strategy state machine.',
  },
  {
    id: 'daemon_system_prompt',
    classification: 'initial_bundle',
    source: 'composeDaemonSystemPrompt().prompt',
    owner: 'bundle serializer',
    textTarget: 'system_prompt',
    note: 'Final text aggregate. Its recipe, Skill and stable-context leaves are separately owned by the semantic-fact map.',
  },
  {
    id: 'runtime_tool_prompt',
    classification: 'initial_bundle',
    source: 'createAgentRuntimeToolPrompt()',
    owner: 'bundle serializer',
    textTarget: 'system_prompt',
    note: 'Textual tool contract only; the executable capability and credentials remain transport facts.',
  },
  {
    id: 'research_command_contract',
    classification: 'initial_bundle',
    source: 'resolveResearchCommandContract()',
    owner: 'bundle serializer',
    textTarget: 'context',
    note: 'Stable request-scoped research instructions.',
  },
  {
    id: 'run_context_prompt',
    classification: 'initial_bundle',
    source: 'renderRunContextPrompt()',
    owner: 'bundle serializer',
    textTarget: 'context',
    note: 'User-selected stable run context.',
  },
  {
    id: 'connected_external_mcp_reference',
    classification: 'transport_reference',
    source: 'renderConnectedExternalMcpDirective()',
    owner: 'bundle context reference',
    textTarget: 'context',
    note: 'Safe connection-state reference; never embeds OAuth tokens or substitutes for MCP registration.',
  },
  {
    id: 'browser_unavailable_guard',
    classification: 'initial_bundle',
    source: 'renderBrowserUseUnavailablePrompt()',
    owner: 'bundle serializer',
    textTarget: 'context',
    note: 'Request-scoped browser capability limitation.',
  },
  {
    id: 'title_generation_directive',
    classification: 'initial_bundle',
    source: 'startChatRun.titleGenerationPrompt',
    owner: 'bundle serializer',
    textTarget: 'task_config',
    note: 'First physical Run only; disabled for native-session continuation.',
  },
  {
    id: 'client_system_prompt',
    classification: 'initial_bundle',
    source: 'ChatRequest.systemPrompt',
    owner: 'bundle serializer',
    textTarget: 'system_prompt',
    note: 'Client-provided system instructions admitted by the current chat contract.',
  },
  {
    id: 'cwd_reference',
    classification: 'transport_reference',
    source: 'formatDesignFilesWorkspaceHint()',
    owner: 'bundle context reference',
    textTarget: 'context',
    note: 'Text projection of the effective workspace; the process cwd is a separate capability.',
  },
  {
    id: 'linked_directory_references',
    classification: 'transport_reference',
    source: 'startChatRun.linkedDirsHint',
    owner: 'bundle context reference',
    textTarget: 'context',
    note: 'Stable references only; directory access is delivered out of band through runtime allowlists.',
  },
  {
    id: 'echo_guard',
    classification: 'initial_bundle',
    source: 'startChatRun.ECHO_GUARD',
    owner: 'bundle serializer',
    textTarget: 'system_prompt',
    note: 'Response-shape instruction that must be inside the single root for OD Next.',
  },
  {
    id: 'request_text',
    classification: 'initial_bundle',
    source: 'composeChatUserRequestForAgent(message, currentPrompt, { skipTranscript })',
    owner: 'stage-aware bundle/turn selector',
    textTarget: 'user_prompt',
    note: 'Final text aggregate: create-session uses ChatRequest.message (Web full scoped transcript); native resume uses currentPrompt, falling back to message for headless callers.',
  },
  {
    id: 'clarification_turn',
    classification: 'stage_turn',
    source: 'composeOdNextStrategyContinuationV2(stage=clarification)',
    owner: 'turn serializer',
    stage: 'clarification',
    note: 'Existing strategy state-machine continuation; never re-seeds the first Bundle.',
  },
  {
    id: 'contract_repair_turn',
    classification: 'stage_turn',
    source: 'composeOdNextStrategyContinuationV2(stage=contract_repair)',
    owner: 'turn serializer',
    stage: 'contract_repair',
    note: 'Existing strategy state-machine continuation; never re-seeds the first Bundle.',
  },
  {
    id: 'production_turn',
    classification: 'stage_turn',
    source: 'composeOdNextStrategyContinuationV2(stage=production)',
    owner: 'turn serializer',
    stage: 'production',
    note: 'Existing strategy state-machine continuation; never re-seeds the first Bundle.',
  },
  {
    id: 'project_attachment_references',
    classification: 'transport_reference',
    source: 'formatProjectAttachmentHint()',
    owner: 'bundle context reference',
    textTarget: 'context',
    note: 'References only; immutable task-scoped bytes and digests belong to Task 04.',
  },
  {
    id: 'comment_attachment_references',
    classification: 'transport_reference',
    source: 'renderCommentAttachmentHint()',
    owner: 'bundle context reference',
    textTarget: 'context',
    note: 'Sanitized preview/comment facts; screenshot bytes use their own transport.',
  },
  {
    id: 'image_references',
    classification: 'transport_reference',
    source: 'selectPromptImagePaths()',
    owner: 'bundle context reference',
    textTarget: 'context',
    note: 'Runtime-neutral image identities; binary/image blocks are delivered out of band.',
  },
  {
    id: 'effective_cwd_capability',
    classification: 'out_of_band',
    source: 'startChatRun.effectiveCwd',
    owner: 'runtime transport',
    note: 'Spawn cwd / ACP session cwd; not prompt text.',
  },
  {
    id: 'linked_directory_allowlist',
    classification: 'out_of_band',
    source: 'resolveChatExtraAllowedDirs()',
    owner: 'runtime transport',
    note: 'Filesystem capability passed via adapter arguments; not prompt text.',
  },
  {
    id: 'image_binary_input',
    classification: 'out_of_band',
    source: 'buildArgs imagePaths / attachPiRpcSession.imagePaths / attachAcpSession.imagePaths',
    owner: 'runtime transport',
    note: 'Binary or runtime-native image input; references are represented separately.',
  },
  {
    id: 'mcp_server_registrations',
    classification: 'out_of_band',
    source: 'buildLiveArtifactsMcpServersForAgent(); Claude/Codebuddy .mcp.json; OpenCode/MiMo env-content; attachAcpSession.mcpServers',
    owner: 'runtime transport',
    note: 'External, run-scoped and live-artifact MCP registrations never become Bundle text.',
  },
  {
    id: 'mcp_oauth_credentials',
    classification: 'out_of_band',
    source: 'buildClaudeMcpJson() / buildOpenCodeMcpConfigContent()',
    owner: 'runtime transport',
    note: 'Bearer OAuth injection into .mcp.json or OpenCode/MiMo env-content; ACP currently admits stdio registrations only.',
  },
  {
    id: 'runtime_tool_environment',
    classification: 'out_of_band',
    source: 'createOpenDesignToolEnv() / spawnEnvForAgent() including OD_TOOL_TOKEN',
    owner: 'runtime transport',
    note: 'Executable paths, daemon/data coordinates and the scoped tool credential are child environment facts, not Bundle text.',
  },
  {
    id: 'runtime_model_options',
    classification: 'out_of_band',
    source: 'RuntimeAgentDef.buildArgs agentOptions / ACP model',
    owner: 'runtime transport',
    note: 'Model, reasoning, service tier and execution profile are launch/session configuration.',
  },
  {
    id: 'native_session_resume_identity',
    classification: 'out_of_band',
    source: 'resolveAgentResumeContext()',
    owner: 'runtime transport',
    note: 'Resume handle and stable-prefix cache diagnostics are not task Bundle content.',
  },
  {
    id: 'skill_side_files',
    classification: 'out_of_band',
    source: 'stageActiveSkill() / RuntimeAgentDef extraAllowedDirs',
    owner: 'Task 03 immutable Skill package',
    note: 'Filesystem package capability; the selected Skill body itself belongs inside Bundle context.',
  },
  {
    id: 'project_attachment_bytes',
    classification: 'out_of_band',
    source: 'project workspace filesystem',
    owner: 'Task 04 immutable attachment snapshot',
    note: 'Agent-readable bytes; only immutable identity/reference belongs in Bundle text.',
  },
  {
    id: 'transport_wrapper_syntax',
    classification: 'excluded',
    source: 'prompt file / argv / stdin / stream-json / Pi RPC / ACP wrappers',
    owner: 'runtime transport',
    note: 'A wrapper may encode the exact text but must not change or be counted as canonical inner text.',
  },
  {
    id: 'available_skills_index',
    classification: 'excluded',
    source: 'not produced',
    owner: 'explicit product exclusion',
    note: 'The all-Skills catalogue is intentionally absent from Bundle, Turn, telemetry and tests.',
  },
  {
    id: 'stable_prompt_hash',
    classification: 'excluded',
    source: 'hashStableInstructions()',
    owner: 'conversation+agent cache diagnostics',
    note: 'Not task Bundle identity and must never trigger Bundle reconstruction or re-seeding.',
  },
] as const satisfies readonly OdNextExactInputEntry[];

/**
 * Semantic request facts below the final text aggregates. Task 02 decides their
 * canonical XML representation; Tasks 03/04 freeze the mutable Skill and
 * attachment/config facts. Keeping this layer executable prevents the final
 * `daemon_system_prompt`/`request_text` segments from hiding mutable inputs.
 */
export const OD_NEXT_SEMANTIC_REQUEST_FACT_MAP_V1 = [
  {
    id: 'web_scoped_conversation_transcript',
    classification: 'initial_bundle',
    source: 'buildDaemonTranscript(history, agentId) -> ChatRequest.message',
    owner: 'Task 02 transcript/context serializer',
    textTarget: 'context',
    note: 'Contains the agent-scoped full history, including the latest user turn; it is not the canonical latest-turn identity.',
  },
  {
    id: 'current_user_turn',
    classification: 'initial_bundle',
    source: 'latestUserPromptFromHistory(history) -> ChatRequest.currentPrompt',
    owner: 'Task 02 user_prompt serializer',
    textTarget: 'user_prompt',
    note: 'Canonical latest user-authored turn. Task 02 must avoid duplicating it when deriving prior-history context from message.',
  },
  {
    id: 'headless_message_fallback',
    classification: 'initial_bundle',
    source: 'od run start --message -> ChatRequest.message when currentPrompt is absent',
    owner: 'Task 02 user_prompt serializer',
    textTarget: 'user_prompt',
    note: 'Compatibility fallback for headless callers; not evidence that message is always a Web transcript.',
  },
  {
    id: 'user_selected_skills',
    classification: 'initial_bundle',
    source: 'ChatRequest.skillId + skillIds -> composeDaemonSystemPrompt()',
    owner: 'Task 03 immutable user Skill package',
    textTarget: 'context',
    note: 'Resolved Skill body and explicit side-file roster; available_skills remains excluded.',
  },
  {
    id: 'strategy_task_skill',
    classification: 'initial_bundle',
    source: 'resolveOdNextStrategyRequestRecipeV2().taskSkill',
    owner: 'Task 02 system_prompt serializer',
    textTarget: 'system_prompt',
    note: 'Pinned Task Skill from the verified strategy package, distinct from user-selected @Skills.',
  },
  {
    id: 'strategy_task_type',
    classification: 'initial_bundle',
    source: 'AppliedStrategyBindingV2.selectedTaskProfile / resolvedRecipe.taskType',
    owner: 'Task 04 canonical task configuration',
    textTarget: 'task_config',
    note: 'One of the production-enabled OD Next artifact task types; never inferred from final prompt prose.',
  },
  {
    id: 'strategy_runtime_capability_facts',
    classification: 'initial_bundle',
    source: 'odNextStrategyRecipe.planningFacts and capabilitySnapshotHash',
    owner: 'Task 04 canonical task configuration',
    textTarget: 'task_config',
    note: 'Verified planning routes/output kinds and runtime capability identity.',
  },
  {
    id: 'request_execution_configuration',
    classification: 'initial_bundle',
    source: 'sessionMode, locale, research, mediaExecution, titleGeneration and selected runtime profile',
    owner: 'Task 04 canonical task configuration',
    textTarget: 'task_config',
    note: 'Only the versioned minimal OD Next subset is serialized; model launch credentials remain out of band.',
  },
  {
    id: 'project_and_design_context',
    classification: 'initial_bundle',
    source: 'metadata, template, design-system fields, craftBody/craftSections and memoryBody',
    owner: 'Task 02 context serializer',
    textTarget: 'context',
    note: 'Stable project/design facts currently nested in composeDaemonSystemPrompt().',
  },
  {
    id: 'user_and_project_instructions',
    classification: 'initial_bundle',
    source: 'userInstructions + projectInstructions',
    owner: 'Task 02 context serializer',
    textTarget: 'context',
    note: 'Stable instruction facts currently nested in the daemon system aggregate.',
  },
  {
    id: 'run_context_selection',
    classification: 'initial_bundle',
    source: 'ChatRequest.context -> renderRunContextPrompt()',
    owner: 'Task 02 context serializer',
    textTarget: 'context',
    note: 'Explicit user-selected context facts, separate from transcript history.',
  },
  {
    id: 'project_attachment_selection',
    classification: 'transport_reference',
    source: 'ChatRequest.attachments -> resolveSafeProjectAttachments()',
    owner: 'Task 04 immutable attachment snapshot',
    textTarget: 'context',
    note: 'Selection order and frozen identity/reference; live project paths alone are insufficient.',
  },
  {
    id: 'comment_attachment_selection',
    classification: 'transport_reference',
    source: 'ChatRequest.commentAttachments -> normalizeCommentAttachments()',
    owner: 'Task 04 immutable attachment snapshot',
    textTarget: 'context',
    note: 'Sanitized comments, element facts and referenced screenshots.',
  },
  {
    id: 'image_attachment_selection',
    classification: 'transport_reference',
    source: 'ChatRequest.imagePaths -> resolveSafePromptImagePaths()',
    owner: 'Task 04 immutable attachment snapshot',
    textTarget: 'context',
    note: 'Frozen image identity/reference; runtime-native image bytes remain out of band.',
  },
  {
    id: 'available_skills_catalogue',
    classification: 'excluded',
    source: 'not produced',
    owner: 'explicit product exclusion',
    note: 'No all-Skills catalogue is serialized or observed.',
  },
] as const satisfies readonly OdNextSemanticRequestFactEntry[];

export const OD_NEXT_AGENT_INPUT_OWNERSHIP_V1 = {
  version: OD_NEXT_EXACT_INPUT_MAP_VERSION,
  finalTextAndTransport: OD_NEXT_EXACT_INPUT_MAP_V1,
  semanticRequestFacts: OD_NEXT_SEMANTIC_REQUEST_FACT_MAP_V1,
} as const;

export const OD_NEXT_EXACT_TEXT_DELIVERY_PATHS_V1 = [
  {
    id: 'prompt_file',
    source: 'preparePromptFileForAgent(def, exactText, run.id)',
    invariant: 'file UTF-8 content equals exactText',
  },
  {
    id: 'runtime_args',
    source: 'RuntimeAgentDef.buildArgs(exactText, ...)',
    invariant: 'adapter receives exactText; argv/file choice is transport-only',
  },
  {
    id: 'plain_stdin',
    source: 'writePromptAndEndStdin(child.stdin, exactText)',
    invariant: 'stdin bytes are exactText UTF-8',
  },
  {
    id: 'stream_json_stdin',
    source: 'JSONL user.content[0].text = exactText',
    invariant: 'JSON encoding changes the wire wrapper only; decoded text equals exactText',
  },
  {
    id: 'pi_rpc',
    source: 'attachPiRpcSession({ prompt: exactText })',
    invariant: 'prompt field equals exactText',
  },
  {
    id: 'acp_json_rpc',
    source: 'attachAcpSession({ prompt: exactText })',
    invariant: 'prompt field equals exactText',
  },
] as const;

const ALLOWED_CLASSIFICATIONS = new Set<OdNextExactInputClassification>([
  'initial_bundle',
  'stage_turn',
  'transport_reference',
  'out_of_band',
  'excluded',
]);

export function assertOdNextExactInputMapV1(
  entries: readonly OdNextExactInputEntry[] = OD_NEXT_EXACT_INPUT_MAP_V1,
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) {
      throw new Error(`OD Next exact-input map has a missing or duplicate id: ${entry.id || '<empty>'}`);
    }
    ids.add(entry.id);
    if (!ALLOWED_CLASSIFICATIONS.has(entry.classification)) {
      throw new Error(`OD Next exact-input map has an invalid classification for ${entry.id}`);
    }
    if (entry.classification === 'stage_turn' && !entry.stage) {
      throw new Error(`OD Next stage-turn input ${entry.id} is missing its stage`);
    }
    if (
      (entry.classification === 'initial_bundle' || entry.classification === 'transport_reference')
      && !entry.textTarget
    ) {
      throw new Error(`OD Next textual input ${entry.id} is missing its Bundle target`);
    }
    if (
      (entry.classification === 'out_of_band' || entry.classification === 'excluded')
      && entry.textTarget
    ) {
      throw new Error(`OD Next non-text input ${entry.id} must not declare a Bundle target`);
    }
  }

  const semanticIds = new Set<string>();
  for (const entry of OD_NEXT_SEMANTIC_REQUEST_FACT_MAP_V1 as readonly OdNextSemanticRequestFactEntry[]) {
    if (!entry.id || semanticIds.has(entry.id)) {
      throw new Error(`OD Next semantic request-fact map has a missing or duplicate id: ${entry.id || '<empty>'}`);
    }
    semanticIds.add(entry.id);
    if (
      (entry.classification === 'initial_bundle' || entry.classification === 'transport_reference')
      && !entry.textTarget
    ) {
      throw new Error(`OD Next semantic text fact ${entry.id} is missing its Bundle target`);
    }
    if (
      (entry.classification === 'out_of_band' || entry.classification === 'excluded')
      && entry.textTarget
    ) {
      throw new Error(`OD Next semantic non-text fact ${entry.id} must not declare a Bundle target`);
    }
  }
}

export function assertOdNextLegacyTextContributorCoverage(
  contributorIds: readonly string[],
  stage: OdNextExactInputStage | null = 'request',
): void {
  assertOdNextExactInputMapV1();
  const stageContributorId = stage === null || stage === 'request'
    ? 'request_text'
    : `${stage}_turn`;
  const expected = new Set<string>(
    stage === null || stage === 'request'
      ? OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1
      : [stageContributorId],
  );
  const mapped = new Set<string>(OD_NEXT_EXACT_INPUT_MAP_V1.map((entry) => entry.id));
  const unmappedExpected = [...expected].filter((id) => !mapped.has(id));
  if (unmappedExpected.length > 0) {
    throw new Error(`OD Next exact-text contributors are absent from the ownership map: ${unmappedExpected.join(', ')}`);
  }
  const actual = new Set<string>();
  for (const id of contributorIds) {
    if (actual.has(id)) {
      throw new Error(`OD Next exact-text contributor is duplicated: ${id}`);
    }
    actual.add(id);
    if (!expected.has(id)) {
      throw new Error(`OD Next exact-text contributor is not registered: ${id}`);
    }
  }
  const missing = [...expected].filter((id) => !actual.has(id));
  if (missing.length > 0) {
    throw new Error(`OD Next exact-text contributors are missing: ${missing.join(', ')}`);
  }
}

/**
 * Fail-closed boundary witness for the canonical first textual payload.
 * Task 02 owns the XML serializer; this task only establishes the byte boundary
 * it must satisfy. Leading/trailing whitespace and a second root are rejected.
 */
export function assertSingleOdNextPromptBundleRoot(exactText: string): void {
  const opening = '<open_design_prompt_bundle';
  const closing = '</open_design_prompt_bundle>';
  if (!exactText.startsWith(opening) || !exactText.endsWith(closing)) {
    throw new Error('OD Next initial exact text must be one open_design_prompt_bundle root with no outer bytes');
  }
  const openingEnd = exactText.indexOf('>');
  if (openingEnd < opening.length - 1) {
    throw new Error('OD Next initial exact text has an invalid open_design_prompt_bundle opening tag');
  }
  if (exactText.indexOf(opening, opening.length) !== -1) {
    throw new Error('OD Next initial exact text must not contain a second open_design_prompt_bundle root');
  }
  if (exactText.indexOf(closing) !== exactText.length - closing.length) {
    throw new Error('OD Next initial exact text must end at its only open_design_prompt_bundle closing tag');
  }
}
