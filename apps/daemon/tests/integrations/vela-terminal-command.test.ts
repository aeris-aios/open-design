import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runVelaCommand,
  velaCommandStdout,
} from '../../src/integrations/vela-command.js';

const fakeVela = path.resolve('tests/fixtures/fake-vela.mjs');
let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('canonical Vela terminal command integration', () => {
  it('uses the resolved fake binary, exact args/source, and preserves a failure envelope', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-vela-terminal-command-'));
    const logPath = path.join(tempDir, 'terminal.jsonl');
    const args = [
      'run', 'terminal', '--run-id', 'integration-run', '--outcome', 'failed',
      '--terminal-at', '2026-08-05T01:02:03.456Z', '--json',
    ];
    const common = {
      env: {
        ...process.env,
        OD_DATA_DIR: '',
        FAKE_VELA_TERMINAL_LOG: logPath,
      },
      configuredEnv: {
        VELA_BIN: fakeVela,
        VELA_INVOCATION_SOURCE: 'open-design',
      },
      maxBuffer: 64 * 1024,
    };

    await expect(runVelaCommand(args, common)).resolves.toBe(
      '{"runId":"integration-run","outcome":"failed","terminalAt":"2026-08-05T01:02:03.456Z","replay":false}\n',
    );
    const successLog = JSON.parse(fs.readFileSync(logPath, 'utf8').trim()) as {
      args: string[];
      invocationSource: string;
    };
    expect(successLog).toEqual({ args, invocationSource: 'open-design' });

    let failure: unknown;
    try {
      await runVelaCommand(args, {
        ...common,
        env: { ...common.env, FAKE_VELA_TERMINAL_MODE: 'unsupported' },
      });
    } catch (error) {
      failure = error;
    }
    expect(JSON.parse(velaCommandStdout(failure))).toEqual({
      error: 'unsupported',
      retryable: false,
    });
  });
});
