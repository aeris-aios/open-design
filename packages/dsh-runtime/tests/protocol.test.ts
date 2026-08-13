import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';
import { identityFrame, modelsFrame, parseHostCommand } from '../src/protocol.js';
import { internals } from '../src/index.js';

describe('@open-design/dsh-runtime protocol', () => {
  test('declares a dsh profile bundle patch', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } };
    };
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
    assert.match(readFileSync(resolve('cordis.patch.yml'), 'utf8'), /@open-design\/dsh-runtime/);
  });

  test('emits the strict probe identity', () => {
    assert.deepEqual(identityFrame('probe', 'test'), {
      v: 1,
      type: 'probe',
      runtime: 'open-design',
      protocol_version: 1,
      plugin_version: 'test',
      capabilities: {
        session_resume: true,
        session_cancel: true,
        structured_events: true,
      },
    });
  });

  test('parses execute and cancel without retaining unknown fields', () => {
    assert.deepEqual(parseHostCommand({
      v: 1,
      type: 'execute',
      request_id: 'run-1',
      cwd: '/project',
      prompt: 'create',
      mcp_servers: [],
      ignored: 'value',
    }), {
      v: 1,
      type: 'execute',
      request_id: 'run-1',
      cwd: '/project',
      prompt: 'create',
      mcp_servers: [],
    });
    assert.deepEqual(parseHostCommand({ v: 1, type: 'cancel', request_id: 'run-1' }), {
      v: 1,
      type: 'cancel',
      request_id: 'run-1',
    });
  });

  test('emits a namespaced Harness model catalog', () => {
    assert.deepEqual(modelsFrame([{
      provider: 'deepseek-official',
      provider_name: 'DeepSeek',
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
    }]), {
      v: 1,
      type: 'models',
      runtime: 'open-design',
      models: [{
        provider: 'deepseek-official',
        provider_name: 'DeepSeek',
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
      }],
    });
  });

  test('maps terminal reasons and nested tool output', () => {
    assert.equal(internals.resultStatus({ kind: 'completed' }), 'completed');
    assert.equal(internals.resultStatus({ kind: 'aborted', reason: { kind: 'user' } }), 'cancelled');
    assert.equal(internals.resultStatus({ kind: 'blocked' }), 'failed');
    assert.equal(internals.contentText([
      { type: 'text', text: 'one' },
      {
        type: 'tool-result',
        toolCallId: 'call-1' as never,
        content: [{ type: 'text', text: 'two' }],
      },
    ]), 'onetwo');
  });
});
