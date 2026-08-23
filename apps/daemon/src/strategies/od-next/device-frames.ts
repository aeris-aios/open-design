import { createHash } from 'node:crypto';
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
 * Ownership record the materializer keeps beside the shells it wrote.
 *
 * `.od-frames/` is a name this feature introduces inside a directory the user
 * owns, so an imported or older project can already hold a folder of that name
 * with arbitrary files in it. The manifest is the only thing that makes a file
 * ours: staging replaces or removes exactly the files it previously recorded
 * and never touches anything else — including a user's own `iphone.html` that
 * happens to share a managed name.
 */
export const OD_NEXT_DEVICE_FRAME_MANIFEST = '.od-next-device-frames.json' as const;
const OD_NEXT_DEVICE_FRAME_MANIFEST_SCHEMA = 'open-design.od-next-device-frames/v1' as const;

interface OdNextDeviceFrameManifestV1 {
  schema: typeof OD_NEXT_DEVICE_FRAME_MANIFEST_SCHEMA;
  files: Record<string, string>;
}

export interface OdNextDeviceFrameStagingResult {
  /** Project-relative paths of the shells now staged and daemon-owned. */
  staged: string[];
  /** Managed names left alone because an unmanaged file already holds them. */
  skipped: string[];
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

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function readManifest(root: string): Promise<OdNextDeviceFrameManifestV1> {
  const empty: OdNextDeviceFrameManifestV1 = { schema: OD_NEXT_DEVICE_FRAME_MANIFEST_SCHEMA, files: {} };
  let raw: string;
  try {
    raw = await readFile(path.join(root, OD_NEXT_DEVICE_FRAME_MANIFEST), 'utf8');
  } catch {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OdNextDeviceFrameManifestV1> | null;
    if (parsed?.schema !== OD_NEXT_DEVICE_FRAME_MANIFEST_SCHEMA || typeof parsed.files !== 'object' || !parsed.files) {
      return empty;
    }
    const files: Record<string, string> = {};
    for (const [name, sha] of Object.entries(parsed.files)) {
      if (typeof sha === 'string' && /^[a-f0-9]{64}$/.test(sha) && !name.includes('/') && !name.includes('\\')) {
        files[name] = sha;
      }
    }
    return { schema: OD_NEXT_DEVICE_FRAME_MANIFEST_SCHEMA, files };
  } catch {
    return empty;
  }
}

/**
 * Stage the device shells into `<cwd>/.od-frames/` so the rule card's
 * `.od-frames/<shell>.html` paths resolve for every prototype run, whether or
 * not a platform was resolved up front.
 *
 * Non-destructive by construction: only files recorded in the manifest from a
 * previous staging are replaced or (when the package no longer ships them)
 * removed. A pre-existing file under a managed name that the manifest does not
 * claim is left untouched and that shell is reported as skipped — the quoted
 * `device-frame-shell` fact still carries the source. Unrelated files in the
 * directory are never read, written, or deleted. The root itself is refused
 * when it is a symlink or a non-directory, mirroring the frozen Skill guard.
 */
export async function materializeOdNextDeviceFrames(input: {
  cwd: string;
  resources: ReadonlyArray<OdNextTaskResource>;
}): Promise<OdNextDeviceFrameStagingResult> {
  const shells = input.resources.filter((resource) => odNextDevicePlatformForResource(resource.path));
  if (shells.length === 0) return { staged: [], skipped: [] };
  const root = path.join(input.cwd, OD_NEXT_DEVICE_FRAME_ROOT);
  const rootStat = await lstat(root).catch(() => null);
  if (rootStat && (rootStat.isSymbolicLink() || !rootStat.isDirectory())) {
    throw new InvalidOdNextDeviceFrameRootError('Device shell staging root is unsafe.');
  }
  await mkdir(root, { recursive: true });
  const previous = await readManifest(root);
  const next: Record<string, string> = {};
  const staged: string[] = [];
  const skipped: string[] = [];

  for (const shell of shells) {
    const name = path.posix.basename(shell.path);
    const target = path.join(root, name);
    const owned = Object.prototype.hasOwnProperty.call(previous.files, name);
    const existing = await lstat(target).catch(() => null);
    if (existing && !owned) {
      // Someone else's file. Leave it exactly as it is.
      skipped.push(`${OD_NEXT_DEVICE_FRAME_ROOT}/${name}`);
      continue;
    }
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
      // Our manifest claims it, but it is no longer a plain file we wrote.
      skipped.push(`${OD_NEXT_DEVICE_FRAME_ROOT}/${name}`);
      continue;
    }
    await writeFile(target, shell.text, { encoding: 'utf8' });
    next[name] = digest(shell.text);
    staged.push(`${OD_NEXT_DEVICE_FRAME_ROOT}/${name}`);
  }

  // Retire shells we staged earlier that the current package no longer ships,
  // and only when the bytes are still ours.
  for (const [name, sha] of Object.entries(previous.files)) {
    if (name in next || skipped.includes(`${OD_NEXT_DEVICE_FRAME_ROOT}/${name}`)) continue;
    const target = path.join(root, name);
    const existing = await lstat(target).catch(() => null);
    if (!existing || existing.isSymbolicLink() || !existing.isFile()) continue;
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== null && digest(current) === sha) {
      await rm(target, { force: true });
    }
  }

  const manifest: OdNextDeviceFrameManifestV1 = {
    schema: OD_NEXT_DEVICE_FRAME_MANIFEST_SCHEMA,
    files: Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  await writeFile(
    path.join(root, OD_NEXT_DEVICE_FRAME_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8' },
  );
  return { staged: staged.sort(), skipped: skipped.sort() };
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
