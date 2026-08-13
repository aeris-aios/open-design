import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAgent } from '../../src/runtimes/detection.js';
import { buildVersionDiagnostic } from '../../src/runtimes/diagnostics.js';
import type { RuntimeAgentDef } from '../../src/runtimes/types.js';

const versionedDef: RuntimeAgentDef = {
  id: 'deepseek-harness',
  name: 'DeepSeek Harness',
  bin: 'dsh',
  versionArgs: ['--version'],
  versionPolicy: {
    requireVersion: true,
    supportedVersions: ['0.1.0-rc.5', '0.1.0-rc.6'],
  },
  fallbackModels: [{ id: 'default', label: 'Default' }],
  buildArgs: () => [],
  streamFormat: 'dsh-sdk-json-rpc',
};

function writeVersionBin(dir: string, version: string): string {
  const bin = path.join(dir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
  if (process.platform === 'win32') {
    writeFileSync(bin, `@echo off\r\necho ${version}\r\n`);
  } else {
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
    chmodSync(bin, 0o755);
  }
  return bin;
}

describe('runtime version policy', () => {
  it.each([
    ['0.1.0-rc.6', true, undefined],
    ['0.1.0-rc.7', true, 'untested-version'],
  ] as const)('detects %s with available=%s', async (version, available, reason) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-runtime-version-'));
    try {
      const detected = await detectAgent(versionedDef, {
        DSH_BIN: writeVersionBin(dir, version),
      });
      expect(detected.available).toBe(available);
      expect(detected.version).toBe(version);
      expect(detected.diagnostics?.[0]?.reason).toBe(reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an actionable failure when no version can be verified', () => {
    expect(buildVersionDiagnostic(versionedDef, null)).toMatchObject({
      reason: 'version-probe-failed',
      severity: 'error',
      detail: 'Expected 0.1.0-rc.5, 0.1.0-rc.6.',
    });
  });
});
