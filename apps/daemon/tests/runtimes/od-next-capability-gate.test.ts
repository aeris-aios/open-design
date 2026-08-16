import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  OD_NEXT_RUNTIME_CAPABILITY_EVIDENCE_V1_SCHEMA,
  RuntimeCapabilityFixtureManifestV1Schema,
  type RuntimeCapabilityFixtureManifestV1,
  type RuntimeCapabilityRegistryEntryV1,
} from '@open-design/contracts';
import {
  OD_NEXT_RUNTIME_CAPABILITY_REGISTRY,
  OD_NEXT_RUNTIME_CAPABILITY_FIXTURE_MANIFESTS,
  OPENCODE_1_18_18_BEST_EFFORT_MANIFEST,
  OD_NEXT_RUNTIME_PATH_DESCRIPTORS,
  evaluateOdNextExecutionEligibility,
  hashRuntimeCapabilityFixtureManifestV1,
  resolveOdNextRuntimeCapability,
} from '../../src/runtimes/od-next-capability-gate.js';
import { getAgentDef } from '../../src/runtimes/registry.js';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'od-next-runtime-capabilities',
);

const fixtureFiles = [
  'codex.contract.json',
  'claude-code.contract.json',
  'native-opencode.contract.json',
  'vela-opencode.contract.json',
] as const;

function readFixture(name: typeof fixtureFiles[number]): RuntimeCapabilityFixtureManifestV1 {
  return RuntimeCapabilityFixtureManifestV1Schema.parse(
    JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')),
  );
}

function collectObjectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.push(key);
      collectObjectKeys(nested, keys);
    }
  }
  return keys;
}

function resolutionInput(manifest: RuntimeCapabilityFixtureManifestV1) {
  return {
    agentId: manifest.agentId,
    agentCliVersion: 'test-cli/1.2.3',
    fixtureVersion: manifest.fixtureVersion,
    fixtureManifest: manifest,
    capturedAt: 1,
    ...(manifest.runtimeCompanionName
      ? {
          runtimeCompanionName: manifest.runtimeCompanionName,
          runtimeCompanionVersion: 'test-companion/4.5.6',
        }
      : {}),
  };
}

function syntheticManifest(
  manifest: RuntimeCapabilityFixtureManifestV1,
): RuntimeCapabilityFixtureManifestV1 {
  return RuntimeCapabilityFixtureManifestV1Schema.parse({
    ...manifest,
    agentCliVersion: 'test-cli/1.2.3',
    ...(manifest.runtimeCompanionName
      ? { runtimeCompanionVersion: 'test-companion/4.5.6' }
      : {}),
    provenance: {
      kind: 'test_synthetic',
      reason: 'deterministic exact tuple gate test',
    },
  });
}

function syntheticEntry(
  manifest: RuntimeCapabilityFixtureManifestV1,
): RuntimeCapabilityRegistryEntryV1 {
  return {
    runtimePath: manifest.runtimePath,
    agentId: manifest.agentId,
    agentCliVersion: manifest.agentCliVersion ?? 'test-cli/1.2.3',
    runtimeAdapterVersion: manifest.runtimeAdapterVersion,
    ...(manifest.runtimeCompanionName
      ? {
          runtimeCompanionName: manifest.runtimeCompanionName,
          runtimeCompanionVersion: manifest.runtimeCompanionVersion,
        }
      : {}),
    fixtureVersion: manifest.fixtureVersion,
    fixtureHash: hashRuntimeCapabilityFixtureManifestV1(manifest),
    evidence: {
      schema: OD_NEXT_RUNTIME_CAPABILITY_EVIDENCE_V1_SCHEMA,
      source: 'test_synthetic',
      nativeSessionContinuation: { support: 'advertised', evidenceLevel: 'L0' },
      nativeSubagents: { support: 'advertised', evidenceLevel: 'L1' },
      caseResults: manifest.cases.map(({ id }) => ({ id, outcome: 'passed' })),
    },
  };
}

describe('OD Next runtime capability gate', () => {
  it('binds initial path descriptors to existing runtime definitions without changing detection', () => {
    for (const descriptor of OD_NEXT_RUNTIME_PATH_DESCRIPTORS) {
      expect(getAgentDef(descriptor.agentId)?.id).toBe(descriptor.agentId);
    }
  });

  it('keeps contract-only fixture groups unknown while registering only the reviewed OpenCode exact tuple', () => {
    expect(OD_NEXT_RUNTIME_CAPABILITY_REGISTRY).toHaveLength(1);
    expect(OD_NEXT_RUNTIME_CAPABILITY_FIXTURE_MANIFESTS).toEqual([
      OPENCODE_1_18_18_BEST_EFFORT_MANIFEST,
    ]);
    const manifests = fixtureFiles.map(readFixture);
    expect(manifests.map((manifest) => manifest.runtimePath)).toEqual(
      OD_NEXT_RUNTIME_PATH_DESCRIPTORS.map((descriptor) => descriptor.runtimePath),
    );

    for (const manifest of manifests) {
      expect(collectObjectKeys(manifest)).not.toEqual(expect.arrayContaining([
        'prompt',
        'path',
        'cwd',
        'secret',
        'token',
        'userInput',
      ]));
      expect(JSON.stringify(manifest)).not.toMatch(
        /\/Users\/|\/home\/|BEGIN [A-Z ]+PRIVATE KEY|sk-[A-Za-z0-9]/u,
      );
      const resolved = resolveOdNextRuntimeCapability(resolutionInput(manifest));
      expect(resolved).toMatchObject({
        includedInInitialRollout: true,
        tupleMatched: false,
        reason: 'x1_runtime_fixture_missing',
        snapshot: {
          runtimePath: manifest.runtimePath,
          nativeSessionContinuation: { support: 'unknown', source: 'unverified' },
          nativeSubagents: { support: 'unknown', source: 'unverified' },
        },
      });
      expect(evaluateOdNextExecutionEligibility(resolved.snapshot!, 'simple')).toEqual({
        eligible: false,
        reason: 'native_continuation_not_verified',
      });
    }
  });

  it('resolves OpenCode 1.18.18 from Open Design best-effort replay and rejects version drift', () => {
    const seed = JSON.parse(readFileSync(
      join(fixtureDir, 'opencode-1.18.18.sanitized-real-seed.json'),
      'utf8',
    )) as { recordingDigest: string };
    expect(OPENCODE_1_18_18_BEST_EFFORT_MANIFEST.provenance).toMatchObject({
      kind: 'sanitized_real',
      evidenceReview: 'open_design_best_effort',
      recordingDigest: seed.recordingDigest,
    });
    const exact = resolveOdNextRuntimeCapability({
      agentId: 'opencode',
      agentCliVersion: '1.18.18',
      fixtureVersion: OPENCODE_1_18_18_BEST_EFFORT_MANIFEST.fixtureVersion,
      fixtureManifest: OPENCODE_1_18_18_BEST_EFFORT_MANIFEST,
      capturedAt: 1,
    });
    expect(exact).toMatchObject({
      tupleMatched: true,
      reason: 'capability_resolved',
      snapshot: {
        agentCliVersion: '1.18.18',
        nativeSessionContinuation: { support: 'verified', source: 'sanitized_fixture_replay' },
        nativeSubagents: {
          support: 'verified',
          evidenceLevel: 'L2',
          source: 'sanitized_fixture_replay',
        },
      },
    });
    expect(resolveOdNextRuntimeCapability({
      agentId: 'opencode',
      agentCliVersion: '1.18.19',
      fixtureVersion: OPENCODE_1_18_18_BEST_EFFORT_MANIFEST.fixtureVersion,
      fixtureManifest: OPENCODE_1_18_18_BEST_EFFORT_MANIFEST,
      capturedAt: 1,
    }).reason).not.toBe('capability_resolved');
  });

  it('matches only an exact tuple while refusing synthetic fixtures as verification', () => {
    const manifest = syntheticManifest(readFixture('codex.contract.json'));
    const entry = syntheticEntry(manifest);
    const exact = resolveOdNextRuntimeCapability({
      ...resolutionInput(manifest),
      fixtureManifest: manifest,
      registry: [entry],
    });
    expect(exact).toMatchObject({
      tupleMatched: true,
      reason: 'synthetic_fixture_not_accepted',
      snapshot: {
        nativeSessionContinuation: {
          support: 'unknown',
          evidenceLevel: 'L0',
          source: 'test_synthetic',
        },
        nativeSubagents: {
          support: 'unknown',
          evidenceLevel: 'L1',
          source: 'test_synthetic',
        },
      },
    });

    for (const changed of [
      { agentCliVersion: 'test-cli/1.2.4' },
      { fixtureVersion: 'od-next-runtime-contract/v2' },
      {
        fixtureManifest: {
          ...manifest,
          runtimeAdapterVersion: 'od-codex-json-events/v2',
        },
      },
    ]) {
      const drifted = resolveOdNextRuntimeCapability({
        ...resolutionInput(manifest),
        fixtureManifest: manifest,
        registry: [entry],
        ...changed,
      });
      expect(drifted.snapshot?.nativeSessionContinuation.support).toBe('unknown');
      expect(drifted.reason).not.toBe('capability_resolved');
    }
  });

  it('fails closed when any required version identity is absent', () => {
    const manifest = syntheticManifest(readFixture('vela-opencode.contract.json'));
    expect(resolveOdNextRuntimeCapability({
      ...resolutionInput(manifest),
      fixtureManifest: manifest,
      agentCliVersion: null,
    }).reason).toBe('agent_cli_version_missing');
    expect(resolveOdNextRuntimeCapability({
      ...resolutionInput(manifest),
      fixtureManifest: manifest,
      runtimeCompanionVersion: null,
    }).reason).toBe('runtime_companion_version_missing');
    expect(resolveOdNextRuntimeCapability({
      ...resolutionInput(manifest),
      fixtureManifest: undefined,
    }).reason).toBe('fixture_manifest_missing');
  });

  it('keeps snapshot hashes stable across capture time and object key order', () => {
    const raw = JSON.parse(readFileSync(
      join(fixtureDir, 'codex.contract.json'),
      'utf8',
    )) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(raw).reverse());
    expect(hashRuntimeCapabilityFixtureManifestV1(raw)).toBe(
      hashRuntimeCapabilityFixtureManifestV1(reordered),
    );
    expect(hashRuntimeCapabilityFixtureManifestV1(raw)).toBe(
      hashRuntimeCapabilityFixtureManifestV1({
        ...raw,
        cases: [...(raw.cases as unknown[])].reverse(),
      }),
    );

    const manifest = readFixture('codex.contract.json');
    const first = resolveOdNextRuntimeCapability({
      ...resolutionInput(manifest),
      capturedAt: 1,
    });
    const later = resolveOdNextRuntimeCapability({
      ...resolutionInput(manifest),
      capturedAt: 9_999,
    });
    expect(first.snapshot?.capturedAt).not.toBe(later.snapshot?.capturedAt);
    expect(first.snapshot?.snapshotHash).toBe(later.snapshot?.snapshotHash);
  });

  it('excludes first-release external Agents instead of lending them an unknown path', () => {
    const excluded = resolveOdNextRuntimeCapability({
      agentId: 'kimi',
      agentCliVersion: 'kimi 9.9.9',
      fixtureVersion: 'od-next-runtime-contract/v1',
    });
    expect(excluded).toEqual({
      includedInInitialRollout: false,
      tupleMatched: false,
      reason: 'runtime_out_of_scope',
      snapshot: null,
    });
  });

  it('applies support and L0-L3 policy independently for simple and complex', () => {
    for (const support of ['unsupported', 'unknown', 'advertised'] as const) {
      expect(evaluateOdNextExecutionEligibility({
        nativeSessionContinuation: { support },
        nativeSubagents: { support: 'verified', evidenceLevel: 'L3' },
      }, 'simple')).toEqual({
        eligible: false,
        reason: 'native_continuation_not_verified',
      });
    }

    for (const support of ['unsupported', 'unknown', 'advertised'] as const) {
      const capabilities = {
        nativeSessionContinuation: { support: 'verified' as const },
        nativeSubagents: { support, evidenceLevel: 'L1' as const },
      };
      expect(evaluateOdNextExecutionEligibility(capabilities, 'simple')).toEqual({
        eligible: true,
        reason: 'eligible',
      });
      expect(evaluateOdNextExecutionEligibility(capabilities, 'complex')).toEqual({
        eligible: false,
        reason: 'native_subagents_not_verified',
      });
    }

    for (const evidenceLevel of ['L0', 'L1'] as const) {
      expect(evaluateOdNextExecutionEligibility({
        nativeSessionContinuation: { support: 'verified' },
        nativeSubagents: { support: 'verified', evidenceLevel },
      }, 'complex')).toEqual({
        eligible: false,
        reason: 'structured_child_lifecycle_not_verified',
      });
    }
    for (const evidenceLevel of ['L2', 'L3'] as const) {
      expect(evaluateOdNextExecutionEligibility({
        nativeSessionContinuation: { support: 'verified' },
        nativeSubagents: { support: 'verified', evidenceLevel },
      }, 'complex')).toEqual({ eligible: true, reason: 'eligible' });
    }
  });
});
