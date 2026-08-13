import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deepseekHarnessAgentDef, DEEPSEEK_HARNESS_SUPPORTED_VERSIONS } from '../../src/runtimes/defs/deepseek-harness.js';
import { detectAgent } from '../../src/runtimes/detection.js';
import { buildVersionDiagnostic } from '../../src/runtimes/diagnostics.js';
import { agentBinEnvKey } from '../../src/runtimes/executables.js';
import { installMetaForAgent } from '../../src/runtimes/metadata.js';
import { getAgentDef } from '../../src/runtimes/registry.js';

describe('DeepSeek Harness runtime contract', () => {
  it('registers a distinct official dsh adapter', () => {
    expect(getAgentDef('deepseek-harness')).toBe(deepseekHarnessAgentDef);
    expect(deepseekHarnessAgentDef.bin).toBe('dsh');
    expect(agentBinEnvKey('deepseek-harness')).toBe('DSH_BIN');
    expect(agentBinEnvKey('deepseek')).toBe('DEEPSEEK_BIN');
  });

  it('uses the official headless profile and terminates both option parsers', () => {
    expect(deepseekHarnessAgentDef.buildArgs('--help')).toEqual([
      '--profile',
      'headless',
      '--',
      '--',
      '--help',
    ]);
  });

  it('declares only the tested prerelease versions', () => {
    expect(DEEPSEEK_HARNESS_SUPPORTED_VERSIONS).toEqual([
      '0.1.0-rc.5',
      '0.1.0-rc.6',
    ]);
    expect(deepseekHarnessAgentDef.versionPolicy).toEqual({
      requireVersion: true,
      supportedVersions: DEEPSEEK_HARNESS_SUPPORTED_VERSIONS,
    });
  });

  it('fails closed with actionable version diagnostics', () => {
    expect(buildVersionDiagnostic(deepseekHarnessAgentDef, null)).toMatchObject({
      reason: 'version-probe-failed',
      severity: 'error',
    });
    expect(buildVersionDiagnostic(deepseekHarnessAgentDef, '0.1.0-rc.7')).toMatchObject({
      reason: 'unsupported-version',
      severity: 'error',
    });
  });

  it('links only to official package and repository surfaces', () => {
    expect(installMetaForAgent('deepseek-harness')).toEqual({
      installUrl: 'https://www.npmjs.com/package/@deepseek-ai/dsh',
      docsUrl: 'https://github.com/deepseek-ai/deepseek-harness',
    });
  });

  it.each([
    ['0.1.0-rc.6', true, undefined],
    ['0.1.0-rc.7', false, 'unsupported-version'],
  ] as const)(
    'strictly detects version %s (available=%s)',
    async (version, available, reason) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'od-dsh-contract-'));
      try {
        const bin = path.join(dir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
        if (process.platform === 'win32') {
          writeFileSync(bin, `@echo off\r\necho ${version}\r\n`);
        } else {
          writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
          chmodSync(bin, 0o755);
        }
        const detected = await detectAgent(deepseekHarnessAgentDef, { DSH_BIN: bin });
        expect(detected.available).toBe(available);
        expect(detected.version).toBe(available ? version : undefined);
        expect(detected.diagnostics?.[0]?.reason).toBe(reason);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('fails closed when the version probe exits nonzero', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-dsh-contract-'));
    try {
      const bin = path.join(dir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
      if (process.platform === 'win32') {
        writeFileSync(bin, '@echo off\r\nexit /b 1\r\n');
      } else {
        writeFileSync(bin, '#!/bin/sh\nexit 1\n');
        chmodSync(bin, 0o755);
      }
      const detected = await detectAgent(deepseekHarnessAgentDef, { DSH_BIN: bin });
      expect(detected.available).toBe(false);
      expect(detected.diagnostics?.[0]?.reason).toBe('version-probe-failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
