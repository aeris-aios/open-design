import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const DEEPSEEK_HARNESS_SUPPORTED_VERSIONS = [
  '0.1.0-rc.5',
  '0.1.0-rc.6',
];

export const deepseekHarnessAgentDef = {
  id: 'deepseek-harness',
  name: 'DeepSeek Harness',
  bin: 'dsh',
  versionArgs: ['--version'],
  versionPolicy: {
    requireVersion: true,
    supportedVersions: DEEPSEEK_HARNESS_SUPPORTED_VERSIONS,
  },
  fallbackModels: [DEFAULT_MODEL_OPTION],
  supportsCustomModel: false,
  buildArgs: (prompt) => [
    '--profile',
    'headless',
    // The launcher consumes the first terminator. The headless app needs the
    // second one so an option-shaped prompt remains data, not control flow.
    '--',
    '--',
    prompt,
  ],
  maxPromptArgBytes: 30_000,
  streamFormat: 'plain',
} satisfies RuntimeAgentDef;
