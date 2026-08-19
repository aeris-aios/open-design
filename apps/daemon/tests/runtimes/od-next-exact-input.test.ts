import { describe, expect, it } from 'vitest';
import {
  composeChatAgentTextPayload,
  resolveOdNextRequestUserPrompt,
} from '../../src/runtimes/chat-prompt-inputs.js';
import {
  OD_NEXT_EXACT_INPUT_MAP_V1,
  OD_NEXT_EXACT_INPUT_MAP_VERSION,
  OD_NEXT_EXACT_TEXT_DELIVERY_PATHS_V1,
  OD_NEXT_BUNDLE_TEXT_CONTRIBUTOR_IDS_V1,
  OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1,
  OD_NEXT_SEMANTIC_REQUEST_FACT_MAP_V1,
  type OdNextExactInputEntry,
  type OdNextSemanticRequestFactEntry,
  assertOdNextBundleTextContributorCoverage,
  assertOdNextExactInputMapV1,
  assertOdNextLegacyTextContributorCoverage,
  assertOdNextSemanticRequestFactProducerCoverage,
  assertSingleOdNextPromptBundleRoot,
} from '../../src/runtimes/od-next-exact-input.js';

describe('OD Next exact Agent input map v1', () => {
  it('classifies every production contributor exactly once', () => {
    expect(OD_NEXT_EXACT_INPUT_MAP_VERSION).toBe('open-design.od-next-exact-input-map/v1');
    expect(() => assertOdNextExactInputMapV1()).not.toThrow();
    expect(() => assertOdNextLegacyTextContributorCoverage(
      OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1,
    )).not.toThrow();
    expect(() => assertOdNextBundleTextContributorCoverage(
      OD_NEXT_BUNDLE_TEXT_CONTRIBUTOR_IDS_V1,
    )).not.toThrow();

    const entriesById = new Map<string, OdNextExactInputEntry>(
      OD_NEXT_EXACT_INPUT_MAP_V1.map((entry) => [entry.id, entry]),
    );
    expect(entriesById.get('request_text')?.classification).toBe('initial_bundle');
    expect(entriesById.get('contract_repair_turn')).toMatchObject({
      classification: 'stage_turn',
      stage: 'contract_repair',
    });
    expect(entriesById.get('cwd_reference')?.classification).toBe('excluded');
    expect(entriesById.get('request_text')?.source).toContain('resolveOdNextRequestUserPrompt');
    expect(entriesById.get('stable_context_prompt')?.textTarget).toBe('context');
    expect(entriesById.get('prior_transcript')?.textTarget).toBe('context');
    expect(entriesById.get('task_config_pending_fact')?.textTarget).toBe('task_config');
    expect(entriesById.get('request_input_pending_fact')?.textTarget).toBe('context');
    expect(entriesById.get('image_binary_input')?.classification).toBe('out_of_band');
    expect(entriesById.get('mcp_server_registrations')?.classification).toBe('out_of_band');
    expect(entriesById.get('mcp_oauth_credentials')?.classification).toBe('out_of_band');
    expect(entriesById.get('available_skills_index')?.classification).toBe('excluded');
    expect(entriesById.get('stable_prompt_hash')?.classification).toBe('excluded');

    const semanticById = new Map<string, OdNextSemanticRequestFactEntry>(
      OD_NEXT_SEMANTIC_REQUEST_FACT_MAP_V1.map((entry) => [entry.id, entry]),
    );
    expect(semanticById.get('prior_transcript')?.source).toContain('buildDaemonPriorTranscript');
    expect(semanticById.get('current_user_turn')?.textTarget).toBe('user_prompt');
    expect(semanticById.has('user_selected_skills')).toBe(false);
    expect(semanticById.get('strategy_task_type')?.owner).toContain('Task 04');
    expect(semanticById.get('project_attachment_selection')?.owner).toContain('Task 04');
    expect(semanticById.get('available_skills_catalogue')?.classification).toBe('excluded');
  });

  it('fails when a production text contributor is unregistered, duplicated, or omitted', () => {
    expect(() => assertOdNextLegacyTextContributorCoverage([
      ...OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1,
      'new_unregistered_prompt_suffix',
    ])).toThrow(/not registered: new_unregistered_prompt_suffix/);
    expect(() => assertOdNextLegacyTextContributorCoverage([
      ...OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1,
      'form_override',
    ])).toThrow(/duplicated: form_override/);
    expect(() => assertOdNextLegacyTextContributorCoverage(
      OD_NEXT_LEGACY_TEXT_CONTRIBUTOR_IDS_V1.filter((id) => id !== 'image_references'),
    )).toThrow(/missing: image_references/);
    expect(() => assertOdNextLegacyTextContributorCoverage(
      ['production_turn'],
      'production',
    )).not.toThrow();
    expect(() => assertOdNextBundleTextContributorCoverage([
      ...OD_NEXT_BUNDLE_TEXT_CONTRIBUTOR_IDS_V1,
      'invented_bundle_suffix',
    ])).toThrow(/not registered: invented_bundle_suffix/);
    expect(() => assertOdNextBundleTextContributorCoverage([
      ...OD_NEXT_BUNDLE_TEXT_CONTRIBUTOR_IDS_V1,
      'prior_transcript',
    ])).toThrow(/duplicated: prior_transcript/);
    expect(() => assertOdNextBundleTextContributorCoverage(
      OD_NEXT_BUNDLE_TEXT_CONTRIBUTOR_IDS_V1.filter(
        (id) => id !== 'request_input_pending_fact',
      ),
    )).toThrow(/missing: request_input_pending_fact/);
  });

  it('keeps wrapper syntax outside canonical text across every production delivery family', () => {
    expect(OD_NEXT_EXACT_TEXT_DELIVERY_PATHS_V1.map((path) => path.id)).toEqual([
      'prompt_file',
      'runtime_args',
      'plain_stdin',
      'stream_json_stdin',
      'pi_rpc',
      'dsh_profile_jsonl',
      'acp_json_rpc',
    ]);
    for (const path of OD_NEXT_EXACT_TEXT_DELIVERY_PATHS_V1) {
      expect(path.invariant).toContain('exactText');
    }
  });

  it('fails when a production semantic producer omits or invents a fact', () => {
    const requestFacts = {
      prior_transcript: 'history',
      current_user_turn: 'latest',
      headless_message_fallback: null,
      stable_context_prompt: 'stable context',
      task_config_pending_fact: '{"state":"pending"}',
      request_input_pending_fact: '{"state":"pending"}',
      request_execution_configuration: {},
      run_context_selection: null,
      project_attachment_selection: [],
      comment_attachment_selection: [],
      image_attachment_selection: [],
    };
    expect(() => assertOdNextSemanticRequestFactProducerCoverage(
      'request',
      requestFacts,
    )).not.toThrow();
    const { image_attachment_selection: _omitted, ...missing } = requestFacts;
    expect(() => assertOdNextSemanticRequestFactProducerCoverage(
      'request',
      missing,
    )).toThrow(/missing from request: image_attachment_selection/);
    expect(() => assertOdNextSemanticRequestFactProducerCoverage(
      'request',
      { ...requestFacts, invented_fact: true },
    )).toThrow(/not registered for request: invented_fact/);
  });
});

describe('chat Agent exact-text production choke point', () => {
  it('keeps Web, legacy-client, and CLI/headless current-turn semantics explicit', () => {
    expect(resolveOdNextRequestUserPrompt({
      message: '## user\nprior\n\n## user\ncurrent',
      currentPrompt: 'current',
      hasCurrentPrompt: true,
    })).toBe('current');
    expect(resolveOdNextRequestUserPrompt({
      message: 'must not be used',
      currentPrompt: '',
      hasCurrentPrompt: true,
    })).toBe('');
    expect(resolveOdNextRequestUserPrompt({
      message: 'must not be used',
      currentPrompt: null,
      hasCurrentPrompt: true,
    })).toBe('');
    expect(resolveOdNextRequestUserPrompt({
      message: 'CLI headless prompt',
      currentPrompt: undefined,
      hasCurrentPrompt: false,
    })).toBe('CLI headless prompt');
  });
  it('preserves the ordinary Markdown prompt byte-for-byte while registering every leaf contributor', () => {
    const result = composeChatAgentTextPayload({
      formOverride: '[form override]\n',
      daemonSystemPrompt: '  daemon system  ',
      runtimeToolPrompt: 'runtime tools',
      researchCommandContract: 'research contract',
      runContextPrompt: 'run context',
      connectedExternalMcpReference: 'connected MCP: figma',
      browserUnavailableGuard: 'browser unavailable',
      titleGenerationDirective: 'emit title marker',
      clientSystemPrompt: 'client system',
      cwdReference: '\n\nworkspace: `/project`',
      linkedDirectoryReferences: '\n\nlinked: `/code`',
      echoGuard: '\n\ndo not echo',
      requestOrStageText: 'Build the dashboard.',
      projectAttachmentReferences: '\n\nattachment: `brief.md`',
      commentAttachmentReferences: '\n\ncomment: fix header',
      imageReferences: '@/uploads/a.png @/uploads/b.png',
    });

    const clientInstruction = [
      'research contract',
      'run context',
      'connected MCP: figma',
      'browser unavailable',
      'emit title marker',
      'client system',
    ].join('\n\n---\n\n');
    const instruction = [
      'daemon system',
      'runtime tools',
      clientInstruction,
    ].join('\n\n---\n\n');
    expect(result.clientInstructionPrompt).toBe(clientInstruction);
    expect(result.instructionPrompt).toBe(instruction);
    expect(result.composedPrompt).toBe(
      '# Instructions (read first)\n\n'
      + '[form override]\n'
      + instruction
      + '\n\nworkspace: `/project`'
      + '\n\nlinked: `/code`'
      + '\n\ndo not echo\n\n---\n'
      + '# User request\n\nBuild the dashboard.'
      + '\n\nattachment: `brief.md`'
      + '\n\ncomment: fix header'
      + '\n\n@/uploads/a.png @/uploads/b.png',
    );
  });

  it('makes the request-stage exact text the single canonical OD Next XML root', () => {
    const exactText = composeChatAgentTextPayload({
      formOverride: '',
      daemonSystemPrompt: '<open_design_prompt_bundle>legacy recipe only</open_design_prompt_bundle>',
      runtimeToolPrompt: '',
      researchCommandContract: '',
      runContextPrompt: '',
      connectedExternalMcpReference: '',
      browserUnavailableGuard: '',
      titleGenerationDirective: '',
      clientSystemPrompt: '',
      cwdReference: '\n\nworkspace: `/Users/private/customer-a`',
      linkedDirectoryReferences: '\n\nlinked: `/private/tmp/secret-assets`',
      echoGuard: '\n\ndo not echo',
      requestOrStageText: 'Make a prototype.',
      projectAttachmentReferences: '',
      commentAttachmentReferences: '',
      imageReferences: '',
      odNextRequestBundle: {
        stableContext: 'stable context',
        priorTranscript: '## user\nprior request',
        taskConfigPendingFact: '{"schema":"open-design.od-next-task-configuration/v1","taskType":"prototype"}',
        requestInputPendingFact: '{"schema":"open-design.od-next-request-input-facts/v1","attachments":[]}',
      },
      strategyInputStage: 'request',
    }).composedPrompt;

    expect(exactText).toMatch(/^<open_design_prompt_bundle/);
    expect(() => assertSingleOdNextPromptBundleRoot(exactText)).not.toThrow();
    expect(exactText).toContain('<system_prompt>');
    expect(exactText).toContain('<user_prompt>');
    expect(exactText).toContain('<task_config>');
    expect(exactText).toContain('<context>');
    expect(exactText).not.toContain('# User request');
    expect(exactText).not.toContain('# Instructions');
    expect(exactText).not.toContain('/Users/private/customer-a');
    expect(exactText).not.toContain('/private/tmp/secret-assets');
    expect(exactText).toContain('open-design.od-next-task-configuration/v1');
    expect(exactText).toContain('open-design.od-next-request-input-facts/v1');
    expect(() => assertSingleOdNextPromptBundleRoot(
      '<open_design_prompt_bundle version="1">\ncontent\n</open_design_prompt_bundle>',
    )).toThrow(/canonical open_design_prompt_bundle/);
    expect(() => assertSingleOdNextPromptBundleRoot(
      '<open_design_prompt_bundle>content</open_design_prompt_bundle>\n# appended markdown',
    )).toThrow(/canonical open_design_prompt_bundle root/);
    expect(() => assertSingleOdNextPromptBundleRoot(
      '<open_design_prompt_bundleevil>content</open_design_prompt_bundle>',
    )).toThrow(/canonical open_design_prompt_bundle root/);
  });

  it('sends existing OD Next continuation stages as exact Turn text without a legacy wrapper', () => {
    const continuation = '# OD Next native continuation — production\n\nContinue the frozen plan.';
    const result = composeChatAgentTextPayload({
      formOverride: 'must not escape',
      daemonSystemPrompt: 'must not be re-seeded',
      runtimeToolPrompt: 'must not be re-seeded',
      researchCommandContract: 'must not escape',
      runContextPrompt: 'must not escape',
      connectedExternalMcpReference: 'must not escape',
      browserUnavailableGuard: 'must not escape',
      titleGenerationDirective: 'must not escape',
      clientSystemPrompt: 'must not be re-seeded',
      cwdReference: 'must not escape',
      linkedDirectoryReferences: 'must not escape',
      echoGuard: 'must not escape',
      requestOrStageText: continuation,
      projectAttachmentReferences: 'must not escape',
      commentAttachmentReferences: 'must not escape',
      imageReferences: 'must not escape',
      strategyInputStage: 'production',
    });

    expect(result).toEqual({
      composedPrompt: continuation,
      clientInstructionPrompt: '',
      instructionPrompt: '',
    });
    expect(result.composedPrompt).not.toContain('# User request');
  });
});
