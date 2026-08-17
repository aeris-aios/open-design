import { describe, expect, it } from 'vitest';
import {
  OD_NEXT_REQUEST_INPUT_FACTS_SCHEMA_V1,
  OD_NEXT_TASK_CONFIGURATION_SCHEMA_V1,
  serializeOdNextRequestInputFactsV1,
  serializeOdNextTaskConfigurationV1,
  type OdNextProductionTaskTypeV1,
} from '../src/index.js';

describe('OD Next task input facts', () => {
  it.each<OdNextProductionTaskTypeV1>([
    'prototype',
    'ppt',
    'marketing',
    'hyperframes',
  ])('canonically encodes the %s task configuration', (taskType) => {
    const serialized = serializeOdNextTaskConfigurationV1({
      schema: OD_NEXT_TASK_CONFIGURATION_SCHEMA_V1,
      taskType,
      locale: 'zh-CN',
      selectedAgentId: 'codex',
      route: 'full_plan',
      mode: 'unresolved',
      configuration: {
        sessionMode: 'design',
        mediaExecution: { mode: 'enabled', allowedSurfaces: ['image'] },
      },
    });
    expect(serialized).toBe(serializeOdNextTaskConfigurationV1(JSON.parse(serialized)));
    expect(serialized).toContain(`"taskType":"${taskType}"`);
    expect(serialized).not.toContain('/Users/');
  });

  it('keeps only logical transport references and immutable attachment facts', () => {
    const serialized = serializeOdNextRequestInputFactsV1({
      schema: OD_NEXT_REQUEST_INPUT_FACTS_SCHEMA_V1,
      attachmentTransport: {
        scheme: 'task-input',
        rootEnvironmentVariable: 'OD_TASK_INPUT_DIR',
        access: 'out_of_band',
      },
      attachments: [{
        id: 'attachment-001',
        order: 1,
        kind: 'image',
        reference: 'task-input:attachments/attachment-001.png',
        mediaType: 'image/png',
        bytes: 8,
        sha256: 'a'.repeat(64),
      }],
      comments: { count: 0 },
      workspace: {
        project: { reference: 'workspace:project', access: 'out_of_band' },
        linkedDirectories: [{ reference: 'linked-dir:1', access: 'out_of_band' }],
      },
      mcp: { serverCount: 1, registration: 'out_of_band' },
    });
    expect(serialized).toContain('task-input:attachments/attachment-001.png');
    expect(serialized).toContain('OD_TASK_INPUT_DIR');
    expect(serialized).toContain('linked-dir:1');
    expect(serialized).not.toContain('oauth');
    expect(serialized).not.toContain('/private/');
  });
});
