import {
  BundledStrategyDeclarationV2Schema,
  type BundledStrategyDeclarationV2,
  type InstalledPluginRecord,
} from '@open-design/contracts';

type StrategyProvenanceInput = Pick<InstalledPluginRecord, 'sourceKind' | 'manifest'>;

export type BundledStrategyProvenanceV2 =
  | { kind: 'none' }
  | { kind: 'invalid'; errors: string[] }
  | { kind: 'inactive'; declaration: BundledStrategyDeclarationV2 };

function strategyCandidate(manifest: InstalledPluginRecord['manifest']): unknown {
  const od = manifest.od as (Record<string, unknown> | undefined);
  return od?.['strategy'];
}

/**
 * Interpret the V2 strategy sidecar only after installed provenance proves
 * that the bytes came from the daemon's bundled tree. `PluginManifestSchema`
 * deliberately keeps this field as unknown passthrough data so community and
 * older manifests cannot be forced through an internal contract.
 *
 * Task 04 ships content and contracts only. Until the later activation task
 * supplies hash-gated binding, every valid bundled declaration is internal
 * and every invalid bundled declaration fails closed as internal too.
 */
export function inspectBundledStrategyProvenanceV2(
  plugin: StrategyProvenanceInput,
): BundledStrategyProvenanceV2 {
  if (plugin.sourceKind !== 'bundled') return { kind: 'none' };
  const candidate = strategyCandidate(plugin.manifest);
  if (candidate === undefined) return { kind: 'none' };

  const parsed = BundledStrategyDeclarationV2Schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '<strategy>'}: ${issue.message}`,
      ),
    };
  }
  return { kind: 'inactive', declaration: parsed.data };
}

export function isInternalBundledStrategyV2(
  plugin: StrategyProvenanceInput,
): boolean {
  return inspectBundledStrategyProvenanceV2(plugin).kind !== 'none';
}
