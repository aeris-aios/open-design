import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  OD_NEXT_DEVICE_FRAME_ROOT,
  OD_NEXT_STRATEGY_ID,
  hasOdNextDeviceShell,
  odNextDevicePlatformForResource,
  type AppliedPluginSnapshot,
  type OdNextDevicePlatformResolutionV1,
} from '@open-design/contracts';

import { resolvePluginFolder } from '../../plugins/registry.js';
import { loadBundledStrategyPromptAssetsV2 } from '../../plugins/strategy-package.js';

export interface OdNextTaskResource {
  path: string;
  text: string;
}

export class InvalidOdNextDeviceFrameRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOdNextDeviceFrameRootError';
  }
}

/**
 * Load the selected task profile's declared resources for an applied OD Next
 * snapshot, re-verified against the snapshot's package identity. Returns an
 * empty list for non-strategy snapshots and for profiles that ship nothing.
 */
export async function loadOdNextTaskResourcesForSnapshot(input: {
  bundledPluginsDir: string;
  snapshot: Pick<AppliedPluginSnapshot, 'pluginId' | 'strategy'> | null | undefined;
}): Promise<OdNextTaskResource[]> {
  const binding = input.snapshot?.strategy;
  if (!binding || input.snapshot?.pluginId !== OD_NEXT_STRATEGY_ID) return [];
  const folder = path.join(input.bundledPluginsDir, 'scenarios', OD_NEXT_STRATEGY_ID);
  const resolved = await resolvePluginFolder({
    folder,
    folderId: OD_NEXT_STRATEGY_ID,
    sourceKind: 'bundled',
    source: folder,
    trust: 'bundled',
  });
  if (!resolved.ok) {
    throw new Error(`Bundled OD Next strategy is unavailable: ${resolved.errors.join('; ')}`);
  }
  return loadBundledStrategyPromptAssetsV2({ plugin: resolved.record, binding })
    .taskResources
    .map((resource) => ({ path: resource.path, text: resource.text }));
}

/**
 * Stage the device shells into `<cwd>/.od-frames/` so the rule card's
 * `.od-frames/<shell>.html` paths resolve for every prototype run, whether or
 * not a platform was resolved up front.
 *
 * First-party content, so the directory is replaced wholesale on every run —
 * a shell edit in a newer package must win over whatever an earlier run left
 * behind. The root itself is refused when it is a symlink or a non-directory,
 * mirroring the frozen Skill materialization guard.
 */
export async function materializeOdNextDeviceFrames(input: {
  cwd: string;
  resources: ReadonlyArray<OdNextTaskResource>;
}): Promise<string[]> {
  const shells = input.resources.filter((resource) => odNextDevicePlatformForResource(resource.path));
  if (shells.length === 0) return [];
  const root = path.join(input.cwd, OD_NEXT_DEVICE_FRAME_ROOT);
  const stat = await lstat(root).catch(() => null);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw new InvalidOdNextDeviceFrameRootError('Device shell staging root is unsafe.');
  }
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const staged: string[] = [];
  for (const shell of shells) {
    const basename = path.posix.basename(shell.path);
    await writeFile(path.join(root, basename), shell.text, { encoding: 'utf8', flag: 'wx' });
    staged.push(`${OD_NEXT_DEVICE_FRAME_ROOT}/${basename}`);
  }
  return staged.sort();
}

export interface OdNextDeviceShellObservation {
  platform: OdNextDevicePlatformResolutionV1['platform'];
  resolvedFrom: OdNextDevicePlatformResolutionV1['resolvedFrom'];
  entryFile: string;
  shellPresent: boolean;
}

/**
 * After a prototype run delivered, record whether the canonical entry carries
 * a shipped handset shell. Observation only: this branch has no repair loop
 * to send the finding back to, so the value feeds run analytics and the
 * daemon log, where the rollout can measure how often a resolved platform
 * actually reached the artifact. Null when nothing was resolved or the entry
 * cannot be read.
 */
export async function observeOdNextDeviceShell(input: {
  projectRoot: string;
  entryFile: string | null | undefined;
  resolution: OdNextDevicePlatformResolutionV1 | null | undefined;
}): Promise<OdNextDeviceShellObservation | null> {
  if (!input.resolution || typeof input.entryFile !== 'string' || !input.entryFile) return null;
  const target = path.resolve(input.projectRoot, input.entryFile);
  const relative = path.relative(input.projectRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  let html: string;
  try {
    html = await readFile(target, 'utf8');
  } catch {
    return null;
  }
  return {
    platform: input.resolution.platform,
    resolvedFrom: input.resolution.resolvedFrom,
    entryFile: input.entryFile,
    shellPresent: hasOdNextDeviceShell(html),
  };
}
