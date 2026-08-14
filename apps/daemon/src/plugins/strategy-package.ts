import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import {
  AppliedStrategyBindingV2Schema,
  OD_NEXT_STRATEGY_ID,
  type AppliedStrategyBindingV2,
  type InstalledPluginRecord,
  type StrategyTaskTypeV2,
} from '@open-design/contracts';
import {
  buildStrategyPackageIdentity,
  normalizeStrategyAssetPath,
} from '@open-design/plugin-runtime';
import { inspectBundledStrategyProvenanceV2 } from './strategy-provenance.js';

export type SelectableStrategyTaskTypeV2 = Exclude<StrategyTaskTypeV2, 'generic'>;

export class StrategyPackageIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyPackageIdentityError';
  }
}

export class StrategyPackageAssetPathError extends StrategyPackageIdentityError {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyPackageAssetPathError';
  }
}

/**
 * Daemon-owned I/O edge for the internal OD Next strategy. The manifest
 * supplies declared assets and this owner explicitly adds the mandatory package
 * manifest and SKILL.md; the function never scans directories.
 */
export function createBundledStrategyBindingV2(input: {
  plugin: InstalledPluginRecord;
  taskType: SelectableStrategyTaskTypeV2;
}): AppliedStrategyBindingV2 {
  const provenance = inspectBundledStrategyProvenanceV2(input.plugin);
  if (provenance.kind === 'none') {
    throw new StrategyPackageIdentityError('Plugin is not an internal bundled strategy.');
  }
  if (provenance.kind === 'invalid') {
    const message = provenance.errors.join('; ');
    if (/path|relative|traverse/i.test(message)) {
      throw new StrategyPackageAssetPathError(message);
    }
    throw new StrategyPackageIdentityError(message);
  }
  if (input.plugin.id !== OD_NEXT_STRATEGY_ID) {
    throw new StrategyPackageIdentityError('Bundled strategy id does not match its installed identity.');
  }

  const declaration = provenance.declaration;
  const selectedProfile = declaration.assets.taskProfiles.find(
    (profile) => profile.taskType === input.taskType,
  );
  if (!selectedProfile) {
    throw new StrategyPackageIdentityError(
      `Bundled strategy does not declare task profile ${input.taskType}.`,
    );
  }

  let root: string;
  try {
    root = realpathSync(input.plugin.fsPath);
  } catch {
    throw new StrategyPackageIdentityError('Bundled strategy root is unavailable.');
  }
  const declaredPaths = [
    './open-design.json',
    './SKILL.md',
    declaration.assets.core.path,
    declaration.assets.orchestration.path,
    selectedProfile.path,
    declaration.assets.taskProfileMapping.path,
  ];
  let identity;
  let selectedPath: string;
  try {
    identity = buildStrategyPackageIdentity({
      assets: declaredPaths.map((assetPath) => ({
        path: assetPath,
        bytes: readControlledStrategyAsset(root, assetPath),
      })),
    });
    selectedPath = normalizeStrategyAssetPath(selectedProfile.path);
  } catch (error) {
    if (error instanceof StrategyPackageIdentityError) throw error;
    throw new StrategyPackageIdentityError(
      error instanceof Error ? error.message : 'Strategy package identity could not be computed.',
    );
  }
  const selectedDigest = identity.assetDigests.find(
    (asset) => asset.path === selectedPath,
  );
  if (!selectedDigest) {
    throw new StrategyPackageIdentityError('Selected task profile is missing from strategy identity.');
  }

  const parsed = AppliedStrategyBindingV2Schema.safeParse({
    schema: 'open-design.applied-strategy/v2',
    id: declaration.id,
    version: input.plugin.version,
    packageHash: identity.packageHash,
    assetDigests: identity.assetDigests,
    selectedTaskProfile: {
      taskType: selectedProfile.taskType,
      version: selectedProfile.version,
      path: selectedDigest.path,
      sha256: selectedDigest.sha256,
    },
    taskProfileVersions: [selectedProfile.version],
    promptRecipe: declaration.promptRecipe,
  });
  if (!parsed.success) {
    throw new StrategyPackageIdentityError('Computed strategy binding failed schema validation.');
  }
  return parsed.data;
}

function readControlledStrategyAsset(pluginRoot: string, assetPath: string): Uint8Array {
  let normalized: string;
  try {
    normalized = normalizeStrategyAssetPath(assetPath);
  } catch (error) {
    throw new StrategyPackageAssetPathError(
      error instanceof Error ? error.message : 'Invalid strategy asset path.',
    );
  }

  try {
    const relativePath = normalized.slice(2);
    const candidate = path.resolve(pluginRoot, relativePath);
    assertInsideRoot(pluginRoot, candidate);

    let current = pluginRoot;
    for (const segment of relativePath.split('/')) {
      current = path.join(current, segment);
      const link = lstatSync(current);
      if (link.isSymbolicLink()) {
        throw new StrategyPackageAssetPathError(
          `Declared strategy asset may not cross a symbolic link: ${normalized}`,
        );
      }
    }

    const realCandidate = realpathSync(candidate);
    assertInsideRoot(pluginRoot, realCandidate);
    if (!statSync(realCandidate).isFile()) {
      throw new StrategyPackageAssetPathError(
        `Declared strategy asset is not a regular file: ${normalized}`,
      );
    }
    const descriptor = openSync(
      realCandidate,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const beforeRead = fstatSync(descriptor);
      if (!beforeRead.isFile()) {
        throw new StrategyPackageAssetPathError(
          `Declared strategy asset changed before it could be read: ${normalized}`,
        );
      }
      const bytes = readFileSync(descriptor);
      const afterRead = fstatSync(descriptor);
      const verifiedCandidate = realpathSync(candidate);
      assertInsideRoot(pluginRoot, verifiedCandidate);
      const verifiedPath = statSync(verifiedCandidate);
      if (
        !sameFileIdentity(beforeRead, afterRead)
        || !sameFileIdentity(afterRead, verifiedPath)
      ) {
        throw new StrategyPackageAssetPathError(
          `Declared strategy asset changed while it was being read: ${normalized}`,
        );
      }
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error instanceof StrategyPackageIdentityError) throw error;
    throw new StrategyPackageIdentityError(
      `Declared strategy asset is unavailable: ${normalized}`,
    );
  }
}

function assertInsideRoot(pluginRoot: string, candidate: string): void {
  const relative = path.relative(pluginRoot, candidate);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new StrategyPackageAssetPathError('Declared strategy asset escapes the plugin root.');
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}
