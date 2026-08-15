import { createHash } from 'node:crypto';

import {
  OD_NEXT_RUNTIME_CAPABILITY_SNAPSHOT_V1_SCHEMA,
  OdNextRuntimeCapabilitySnapshotV1Schema,
  RuntimeCapabilityFixtureManifestV1Schema,
  RuntimeCapabilityRegistryEntryV1Schema,
  type CapabilitySupportV2,
  type OdNextRuntimeCapabilitySnapshotV1,
  type RuntimeCapabilityFixtureManifestV1,
  type RuntimeCapabilityRegistryEntryV1,
  type RuntimeCapabilitySnapshotSourceV1,
  type RuntimeObservationEvidenceLevelV1,
} from '@open-design/contracts';

export interface OdNextRuntimePathDescriptor {
  runtimePath: string;
  agentId: string;
  runtimeAdapterVersion: string;
  requiredRuntimeCompanionName?: string;
}

/**
 * Initial rollout descriptors only. Capability support remains registry-driven:
 * describing a path here does not make any CLI version eligible.
 */
export const OD_NEXT_RUNTIME_PATH_DESCRIPTORS = [
  {
    runtimePath: 'codex',
    agentId: 'codex',
    runtimeAdapterVersion: 'od-codex-json-events/v1',
  },
  {
    runtimePath: 'claude-code',
    agentId: 'claude',
    runtimeAdapterVersion: 'od-claude-stream-json/v1',
  },
  {
    runtimePath: 'native-opencode',
    agentId: 'opencode',
    runtimeAdapterVersion: 'od-opencode-json-events/v1',
  },
  {
    runtimePath: 'vela-opencode',
    agentId: 'amr',
    runtimeAdapterVersion: 'od-vela-opencode-acp/v1',
    requiredRuntimeCompanionName: 'opencode',
  },
] as const satisfies readonly OdNextRuntimePathDescriptor[];

/**
 * X1 has not supplied a trusted version tuple or sanitized real fixture yet.
 * Keep production empty: ordinary runtime availability is not OD Next proof.
 */
export const OD_NEXT_RUNTIME_CAPABILITY_REGISTRY: readonly RuntimeCapabilityRegistryEntryV1[] = [];

/**
 * Trusted production fixture manifests. X1 intentionally leaves this empty;
 * a future evidence update must add a sanitized-real manifest and its exact
 * registry tuple together in this owner module.
 */
export const OD_NEXT_RUNTIME_CAPABILITY_FIXTURE_MANIFESTS:
  readonly RuntimeCapabilityFixtureManifestV1[] = [];

export type OdNextCapabilityResolutionReason =
  | 'runtime_out_of_scope'
  | 'agent_cli_version_missing'
  | 'runtime_companion_version_missing'
  | 'fixture_manifest_missing'
  | 'fixture_manifest_invalid'
  | 'fixture_tuple_mismatch'
  | 'x1_runtime_fixture_missing'
  | 'synthetic_fixture_not_accepted'
  | 'capability_tuple_unverified'
  | 'fixture_hash_mismatch'
  | 'capability_resolved';

export interface ResolveOdNextRuntimeCapabilityInput {
  agentId: string;
  agentCliVersion?: string | null;
  runtimeCompanionName?: string | null;
  runtimeCompanionVersion?: string | null;
  fixtureVersion: string;
  fixtureManifest?: unknown;
  registry?: readonly RuntimeCapabilityRegistryEntryV1[];
  capturedAt?: number;
}

export interface OdNextRuntimeCapabilityResolution {
  includedInInitialRollout: boolean;
  tupleMatched: boolean;
  reason: OdNextCapabilityResolutionReason;
  snapshot: OdNextRuntimeCapabilitySnapshotV1 | null;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function sha256Canonical(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex')}`;
}

/** Hash only the replay contract and recording identity, not review timestamps. */
export function hashRuntimeCapabilityFixtureManifestV1(
  input: unknown,
): string {
  const manifest = RuntimeCapabilityFixtureManifestV1Schema.parse(input);
  return sha256Canonical({
    schema: manifest.schema,
    fixtureVersion: manifest.fixtureVersion,
    runtimePath: manifest.runtimePath,
    agentId: manifest.agentId,
    agentCliVersion: manifest.agentCliVersion ?? null,
    runtimeAdapterVersion: manifest.runtimeAdapterVersion,
    runtimeCompanionName: manifest.runtimeCompanionName ?? null,
    runtimeCompanionVersion: manifest.runtimeCompanionVersion ?? null,
    provenance: manifest.provenance.kind === 'sanitized_real'
      ? {
          kind: manifest.provenance.kind,
          recordingDigest: manifest.provenance.recordingDigest,
          anonymizationVersion: manifest.provenance.anonymizationVersion,
        }
      : { kind: manifest.provenance.kind },
    containsSensitiveContent: manifest.containsSensitiveContent,
    cases: [...manifest.cases].sort(({ id: left }, { id: right }) => (
      left < right ? -1 : left > right ? 1 : 0
    )),
  });
}

function snapshotHashInput(
  snapshot: Omit<OdNextRuntimeCapabilitySnapshotV1, 'snapshotHash'>,
): unknown {
  return {
    schema: snapshot.schema,
    runtimePath: snapshot.runtimePath,
    agentId: snapshot.agentId,
    agentCliVersion: snapshot.agentCliVersion ?? null,
    runtimeAdapterVersion: snapshot.runtimeAdapterVersion,
    runtimeCompanionName: snapshot.runtimeCompanionName ?? null,
    runtimeCompanionVersion: snapshot.runtimeCompanionVersion ?? null,
    fixtureVersion: snapshot.fixtureVersion,
    fixtureHash: snapshot.fixtureHash ?? null,
    nativeSessionContinuation: snapshot.nativeSessionContinuation,
    nativeSubagents: snapshot.nativeSubagents,
  };
}

/** capturedAt is deliberately excluded so identical evidence has one hash. */
export function hashOdNextRuntimeCapabilitySnapshotV1(
  snapshot: Omit<OdNextRuntimeCapabilitySnapshotV1, 'snapshotHash'>,
): string {
  return sha256Canonical(snapshotHashInput(snapshot));
}

function descriptorForAgent(agentId: string): OdNextRuntimePathDescriptor | null {
  return OD_NEXT_RUNTIME_PATH_DESCRIPTORS.find((descriptor) => (
    descriptor.agentId === agentId
  )) ?? null;
}

function buildSnapshot(input: {
  descriptor: OdNextRuntimePathDescriptor;
  agentCliVersion?: string | undefined;
  runtimeCompanionName?: string | undefined;
  runtimeCompanionVersion?: string | undefined;
  fixtureVersion: string;
  fixtureHash?: string | undefined;
  continuationSupport: CapabilitySupportV2;
  continuationEvidenceLevel: RuntimeObservationEvidenceLevelV1;
  subagentSupport: CapabilitySupportV2;
  subagentEvidenceLevel: RuntimeObservationEvidenceLevelV1;
  source: RuntimeCapabilitySnapshotSourceV1;
  capturedAt: number;
}): OdNextRuntimeCapabilitySnapshotV1 {
  const withoutHash: Omit<OdNextRuntimeCapabilitySnapshotV1, 'snapshotHash'> = {
    schema: OD_NEXT_RUNTIME_CAPABILITY_SNAPSHOT_V1_SCHEMA,
    runtimePath: input.descriptor.runtimePath,
    agentId: input.descriptor.agentId,
    ...(input.agentCliVersion ? { agentCliVersion: input.agentCliVersion } : {}),
    runtimeAdapterVersion: input.descriptor.runtimeAdapterVersion,
    ...(input.runtimeCompanionName
      ? { runtimeCompanionName: input.runtimeCompanionName }
      : {}),
    ...(input.runtimeCompanionVersion
      ? { runtimeCompanionVersion: input.runtimeCompanionVersion }
      : {}),
    fixtureVersion: input.fixtureVersion,
    ...(input.fixtureHash ? { fixtureHash: input.fixtureHash } : {}),
    nativeSessionContinuation: {
      support: input.continuationSupport,
      evidenceLevel: input.continuationEvidenceLevel,
      source: input.source,
    },
    nativeSubagents: {
      support: input.subagentSupport,
      evidenceLevel: input.subagentEvidenceLevel,
      source: input.source,
    },
    capturedAt: input.capturedAt,
  };
  return OdNextRuntimeCapabilitySnapshotV1Schema.parse({
    ...withoutHash,
    snapshotHash: hashOdNextRuntimeCapabilitySnapshotV1(withoutHash),
  });
}

function unknownResolution(input: {
  descriptor: OdNextRuntimePathDescriptor;
  agentCliVersion?: string | undefined;
  runtimeCompanionName?: string | undefined;
  runtimeCompanionVersion?: string | undefined;
  fixtureVersion: string;
  fixtureHash?: string | undefined;
  capturedAt: number;
  reason: Exclude<OdNextCapabilityResolutionReason, 'runtime_out_of_scope' | 'capability_resolved'>;
  tupleMatched?: boolean;
  source?: RuntimeCapabilitySnapshotSourceV1 | undefined;
  continuationEvidenceLevel?: RuntimeObservationEvidenceLevelV1 | undefined;
  subagentEvidenceLevel?: RuntimeObservationEvidenceLevelV1 | undefined;
}): OdNextRuntimeCapabilityResolution {
  return {
    includedInInitialRollout: true,
    tupleMatched: input.tupleMatched ?? false,
    reason: input.reason,
    snapshot: buildSnapshot({
      descriptor: input.descriptor,
      agentCliVersion: input.agentCliVersion,
      runtimeCompanionName: input.runtimeCompanionName,
      runtimeCompanionVersion: input.runtimeCompanionVersion,
      fixtureVersion: input.fixtureVersion,
      fixtureHash: input.fixtureHash,
      continuationSupport: 'unknown',
      continuationEvidenceLevel: input.continuationEvidenceLevel ?? 'L0',
      subagentSupport: 'unknown',
      subagentEvidenceLevel: input.subagentEvidenceLevel ?? 'L0',
      source: input.source ?? 'unverified',
      capturedAt: input.capturedAt,
    }),
  };
}

function manifestMatchesTuple(
  manifest: RuntimeCapabilityFixtureManifestV1,
  input: {
    descriptor: OdNextRuntimePathDescriptor;
    agentCliVersion: string;
    runtimeCompanionName?: string | undefined;
    runtimeCompanionVersion?: string | undefined;
    fixtureVersion: string;
  },
): boolean {
  return manifest.runtimePath === input.descriptor.runtimePath &&
    manifest.agentId === input.descriptor.agentId &&
    manifest.agentCliVersion === input.agentCliVersion &&
    manifest.runtimeAdapterVersion === input.descriptor.runtimeAdapterVersion &&
    manifest.fixtureVersion === input.fixtureVersion &&
    (manifest.runtimeCompanionName ?? undefined) === input.runtimeCompanionName &&
    (manifest.runtimeCompanionVersion ?? undefined) === input.runtimeCompanionVersion;
}

function entryMatchesTuple(
  entry: RuntimeCapabilityRegistryEntryV1,
  input: {
    descriptor: OdNextRuntimePathDescriptor;
    agentCliVersion: string;
    runtimeCompanionName?: string | undefined;
    runtimeCompanionVersion?: string | undefined;
    fixtureVersion: string;
  },
): boolean {
  return entry.runtimePath === input.descriptor.runtimePath &&
    entry.agentId === input.descriptor.agentId &&
    entry.agentCliVersion === input.agentCliVersion &&
    entry.runtimeAdapterVersion === input.descriptor.runtimeAdapterVersion &&
    entry.fixtureVersion === input.fixtureVersion &&
    (entry.runtimeCompanionName ?? undefined) === input.runtimeCompanionName &&
    (entry.runtimeCompanionVersion ?? undefined) === input.runtimeCompanionVersion;
}

export function resolveOdNextRuntimeCapability(
  input: ResolveOdNextRuntimeCapabilityInput,
): OdNextRuntimeCapabilityResolution {
  const descriptor = descriptorForAgent(input.agentId);
  if (!descriptor) {
    return {
      includedInInitialRollout: false,
      tupleMatched: false,
      reason: 'runtime_out_of_scope',
      snapshot: null,
    };
  }

  const capturedAt = input.capturedAt ?? Date.now();
  const agentCliVersion = input.agentCliVersion?.trim() || undefined;
  const runtimeCompanionName = input.runtimeCompanionName?.trim() || undefined;
  const runtimeCompanionVersion = input.runtimeCompanionVersion?.trim() || undefined;
  const base = {
    descriptor,
    agentCliVersion,
    runtimeCompanionName,
    runtimeCompanionVersion,
    fixtureVersion: input.fixtureVersion,
    capturedAt,
  };
  if (!agentCliVersion) {
    return unknownResolution({ ...base, reason: 'agent_cli_version_missing' });
  }
  if (
    descriptor.requiredRuntimeCompanionName &&
    (
      runtimeCompanionName !== descriptor.requiredRuntimeCompanionName ||
      !runtimeCompanionVersion
    )
  ) {
    return unknownResolution({ ...base, reason: 'runtime_companion_version_missing' });
  }
  if (input.fixtureManifest === undefined) {
    return unknownResolution({ ...base, reason: 'fixture_manifest_missing' });
  }
  const parsedManifest = RuntimeCapabilityFixtureManifestV1Schema.safeParse(
    input.fixtureManifest,
  );
  if (!parsedManifest.success) {
    return unknownResolution({ ...base, reason: 'fixture_manifest_invalid' });
  }
  const manifest = parsedManifest.data;
  const fixtureHash = hashRuntimeCapabilityFixtureManifestV1(manifest);
  if (manifest.provenance.kind === 'contract_only') {
    return unknownResolution({
      ...base,
      fixtureHash,
      reason: 'x1_runtime_fixture_missing',
    });
  }
  const tupleInput = {
    descriptor,
    agentCliVersion,
    runtimeCompanionName,
    runtimeCompanionVersion,
    fixtureVersion: input.fixtureVersion,
  };
  if (!manifestMatchesTuple(manifest, tupleInput)) {
    return unknownResolution({ ...base, fixtureHash, reason: 'fixture_tuple_mismatch' });
  }

  const registry = (input.registry ?? OD_NEXT_RUNTIME_CAPABILITY_REGISTRY)
    .flatMap((candidate) => {
      const parsed = RuntimeCapabilityRegistryEntryV1Schema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });
  const entry = registry.find((candidate) => entryMatchesTuple(candidate, tupleInput));
  if (!entry) {
    return unknownResolution({
      ...base,
      fixtureHash,
      tupleMatched: true,
      reason: manifest.provenance.kind === 'test_synthetic'
        ? 'synthetic_fixture_not_accepted'
        : 'capability_tuple_unverified',
      source: manifest.provenance.kind === 'test_synthetic'
        ? 'test_synthetic'
        : 'unverified',
    });
  }
  if (entry.fixtureHash !== fixtureHash) {
    return unknownResolution({
      ...base,
      fixtureHash,
      tupleMatched: true,
      reason: 'fixture_hash_mismatch',
    });
  }
  if (entry.evidence.source !== 'fixture_replay') {
    return unknownResolution({
      ...base,
      fixtureHash,
      tupleMatched: true,
      reason: entry.evidence.source === 'test_synthetic'
        ? 'synthetic_fixture_not_accepted'
        : 'capability_tuple_unverified',
      source: entry.evidence.source === 'test_synthetic'
        ? 'test_synthetic'
        : 'unverified',
      continuationEvidenceLevel: entry.evidence.nativeSessionContinuation.evidenceLevel,
      subagentEvidenceLevel: entry.evidence.nativeSubagents.evidenceLevel,
    });
  }
  if (
    manifest.provenance.kind === 'test_synthetic'
  ) {
    return unknownResolution({
      ...base,
      fixtureHash,
      tupleMatched: true,
      reason: 'synthetic_fixture_not_accepted',
      source: 'test_synthetic',
      continuationEvidenceLevel: entry.evidence.nativeSessionContinuation.evidenceLevel,
      subagentEvidenceLevel: entry.evidence.nativeSubagents.evidenceLevel,
    });
  }

  const snapshotSource: RuntimeCapabilitySnapshotSourceV1 =
    'sanitized_fixture_replay';
  return {
    includedInInitialRollout: true,
    tupleMatched: true,
    reason: 'capability_resolved',
    snapshot: buildSnapshot({
      ...base,
      fixtureHash,
      continuationSupport: entry.evidence.nativeSessionContinuation.support,
      continuationEvidenceLevel:
        entry.evidence.nativeSessionContinuation.evidenceLevel,
      subagentSupport: entry.evidence.nativeSubagents.support,
      subagentEvidenceLevel: entry.evidence.nativeSubagents.evidenceLevel,
      source: snapshotSource,
    }),
  };
}

export function resolveBundledOdNextRuntimeCapability(input: {
  agentId: string;
  agentCliVersion?: string | null;
  runtimeCompanionName?: string | null;
  runtimeCompanionVersion?: string | null;
  capturedAt?: number;
}): OdNextRuntimeCapabilityResolution {
  const fixture = OD_NEXT_RUNTIME_CAPABILITY_FIXTURE_MANIFESTS.find((candidate) => (
    candidate.agentId === input.agentId
    && candidate.agentCliVersion === (input.agentCliVersion?.trim() || undefined)
    && (candidate.runtimeCompanionName ?? undefined)
      === (input.runtimeCompanionName?.trim() || undefined)
    && (candidate.runtimeCompanionVersion ?? undefined)
      === (input.runtimeCompanionVersion?.trim() || undefined)
  ));
  return resolveOdNextRuntimeCapability({
    ...input,
    fixtureVersion: fixture?.fixtureVersion ?? 'od-next-runtime-contract/v1',
    ...(fixture ? { fixtureManifest: fixture } : {}),
    registry: OD_NEXT_RUNTIME_CAPABILITY_REGISTRY,
  });
}

export type OdNextExecutionMode = 'simple' | 'complex';

export type OdNextExecutionEligibilityReason =
  | 'eligible'
  | 'native_continuation_not_verified'
  | 'native_subagents_not_verified'
  | 'structured_child_lifecycle_not_verified';

/**
 * Pure policy boundary used after a runtime has passed initial-path selection.
 * Fixture provenance is enforced by the resolver; this function only applies
 * the simple/complex capability rules to the resolved snapshot.
 */
export function evaluateOdNextExecutionEligibility(
  capabilities: {
    nativeSessionContinuation: { support: CapabilitySupportV2 };
    nativeSubagents: {
      support: CapabilitySupportV2;
      evidenceLevel: RuntimeObservationEvidenceLevelV1;
    };
  },
  executionMode: OdNextExecutionMode,
): { eligible: boolean; reason: OdNextExecutionEligibilityReason } {
  if (capabilities.nativeSessionContinuation.support !== 'verified') {
    return { eligible: false, reason: 'native_continuation_not_verified' };
  }
  if (executionMode === 'simple') {
    return { eligible: true, reason: 'eligible' };
  }
  if (capabilities.nativeSubagents.support !== 'verified') {
    return { eligible: false, reason: 'native_subagents_not_verified' };
  }
  if (
    capabilities.nativeSubagents.evidenceLevel !== 'L2' &&
    capabilities.nativeSubagents.evidenceLevel !== 'L3'
  ) {
    return { eligible: false, reason: 'structured_child_lifecycle_not_verified' };
  }
  return { eligible: true, reason: 'eligible' };
}
