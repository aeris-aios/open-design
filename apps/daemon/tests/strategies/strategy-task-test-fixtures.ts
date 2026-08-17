import {
  serializeOdNextRequestTurnV1,
  serializeOdNextPromptBundleV1,
  type StrategyInputStageV2,
} from '@open-design/contracts';

import { createEmptyFrozenSkillPackage } from '../../src/strategies/od-next/frozen-skill-package.js';

export const TEST_TASK_INPUT_MANIFEST_SHA256 = 'd'.repeat(64);

export const TEST_PROMPT_BUNDLE = serializeOdNextPromptBundleV1({
  systemPrompt: 'Frozen test system prompt.',
  userPrompt: '冻结的用户请求。',
  taskConfig: 'Frozen test task configuration.',
  context: 'Frozen test context.',
});

export function strategyTaskCreateIdentityFixture() {
  return {
    frozenSkillPackage: createEmptyFrozenSkillPackage(),
    promptBundleText: TEST_PROMPT_BUNDLE,
    taskInputManifestSha256: TEST_TASK_INPUT_MANIFEST_SHA256,
  };
}

export function strategyTaskTurnText(input: {
  taskExecutionId: string;
  inputStage: Exclude<StrategyInputStageV2, 'request'>;
  taskRunIndex: number;
  payload?: string;
}): string {
  return serializeOdNextRequestTurnV1({
    taskExecutionId: input.taskExecutionId,
    stage: input.inputStage,
    taskRunIndex: input.taskRunIndex,
    payload: input.payload ?? 'Continue the frozen test task.',
  });
}
