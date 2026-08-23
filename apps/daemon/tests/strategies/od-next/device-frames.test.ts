import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePluginFolder } from '../../../src/plugins/registry.js';
import { createBundledStrategyBindingV2 } from '../../../src/plugins/strategy-package.js';
import {
  InvalidOdNextDeviceFrameRootError,
  loadOdNextTaskResourcesForSnapshot,
  materializeOdNextDeviceFrames,
  observeOdNextDeviceShell,
} from '../../../src/strategies/od-next/device-frames.js';

const BUNDLED_PLUGINS_DIR = path.resolve(import.meta.dirname, '../../../../../plugins/_official');

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

async function projectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-device-frames-'));
  temporaryRoots.push(dir);
  return dir;
}

const SHELLS = [
  { path: './assets/task-profiles/prototype/device-frames/iphone.html', text: '<div data-phone-shell data-platform="iphone"><main class="phone-content">iphone</main></div>' },
  { path: './assets/task-profiles/prototype/device-frames/android.html', text: '<div data-phone-shell data-platform="android"><main class="phone-content">android</main></div>' },
  { path: './assets/task-profiles/prototype/device-frames/neutral.html', text: '<div data-phone-shell data-platform="neutral"><main class="phone-content">neutral</main></div>' },
  { path: './assets/task-profiles/prototype/notes.md', text: 'not a shell' },
];

describe('materializeOdNextDeviceFrames', () => {
  it('stages only the shells under .od-frames and replaces a stale copy on the next run', async () => {
    const cwd = await projectDir();
    await mkdir(path.join(cwd, '.od-frames'), { recursive: true });
    await writeFile(path.join(cwd, '.od-frames', 'iphone.html'), 'stale shell from an older package');
    await writeFile(path.join(cwd, '.od-frames', 'leftover.html'), 'should disappear');

    const staged = await materializeOdNextDeviceFrames({ cwd, resources: SHELLS });

    expect(staged).toEqual(['.od-frames/android.html', '.od-frames/iphone.html', '.od-frames/neutral.html']);
    expect((await readdir(path.join(cwd, '.od-frames'))).sort()).toEqual(['android.html', 'iphone.html', 'neutral.html']);
    expect(await readFile(path.join(cwd, '.od-frames', 'iphone.html'), 'utf8')).toContain('data-platform="iphone"');
  });

  it('is a no-op without shells and refuses a symlinked staging root', async () => {
    const cwd = await projectDir();
    expect(await materializeOdNextDeviceFrames({ cwd, resources: [SHELLS[3]!] })).toEqual([]);
    await expect(lstat(path.join(cwd, '.od-frames'))).rejects.toThrow();

    const outside = await projectDir();
    await symlink(outside, path.join(cwd, '.od-frames'));
    await expect(materializeOdNextDeviceFrames({ cwd, resources: SHELLS }))
      .rejects.toThrow(InvalidOdNextDeviceFrameRootError);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe('loadOdNextTaskResourcesForSnapshot', () => {
  it('re-reads the bundled prototype shells through the applied binding and stays empty elsewhere', async () => {
    const folder = path.join(BUNDLED_PLUGINS_DIR, 'scenarios', 'od-next-strategy');
    const resolved = await resolvePluginFolder({
      folder,
      folderId: 'od-next-strategy',
      sourceKind: 'bundled',
      source: folder,
      trust: 'bundled',
    });
    if (!resolved.ok) throw new Error(resolved.errors.join('; '));

    const prototype = await loadOdNextTaskResourcesForSnapshot({
      bundledPluginsDir: BUNDLED_PLUGINS_DIR,
      snapshot: {
        pluginId: 'od-next-strategy',
        strategy: createBundledStrategyBindingV2({ plugin: resolved.record, taskType: 'prototype' }),
      },
    });
    expect(prototype.map((resource) => path.posix.basename(resource.path))).toEqual([
      'iphone.html',
      'android.html',
      'neutral.html',
    ]);

    expect(await loadOdNextTaskResourcesForSnapshot({
      bundledPluginsDir: BUNDLED_PLUGINS_DIR,
      snapshot: {
        pluginId: 'od-next-strategy',
        strategy: createBundledStrategyBindingV2({ plugin: resolved.record, taskType: 'ppt' }),
      },
    })).toEqual([]);
    expect(await loadOdNextTaskResourcesForSnapshot({
      bundledPluginsDir: BUNDLED_PLUGINS_DIR,
      snapshot: { pluginId: 'example-mobile-app', strategy: undefined } as never,
    })).toEqual([]);
    expect(await loadOdNextTaskResourcesForSnapshot({ bundledPluginsDir: BUNDLED_PLUGINS_DIR, snapshot: null }))
      .toEqual([]);
  });
});

describe('observeOdNextDeviceShell', () => {
  it('reports whether the delivered entry kept the handset shell', async () => {
    const projectRoot = await projectDir();
    await writeFile(path.join(projectRoot, 'index.html'), SHELLS[0]!.text);
    await writeFile(path.join(projectRoot, 'bare.html'), '<div class="card" style="border-radius:24px"></div>');
    const resolution = { platform: 'ios' as const, resolvedFrom: 'request-text' as const };

    expect(await observeOdNextDeviceShell({ projectRoot, entryFile: 'index.html', resolution })).toEqual({
      platform: 'ios',
      resolvedFrom: 'request-text',
      entryFile: 'index.html',
      shellPresent: true,
    });
    expect(await observeOdNextDeviceShell({ projectRoot, entryFile: 'bare.html', resolution })).toEqual(
      expect.objectContaining({ shellPresent: false }),
    );
  });

  it('observes nothing without a resolution, without an entry, or for a path outside the project', async () => {
    const projectRoot = await projectDir();
    await writeFile(path.join(projectRoot, 'index.html'), SHELLS[0]!.text);
    const resolution = { platform: 'ios' as const, resolvedFrom: 'request-text' as const };
    expect(await observeOdNextDeviceShell({ projectRoot, entryFile: 'index.html', resolution: null })).toBeNull();
    expect(await observeOdNextDeviceShell({ projectRoot, entryFile: null, resolution })).toBeNull();
    expect(await observeOdNextDeviceShell({ projectRoot, entryFile: 'missing.html', resolution })).toBeNull();
    expect(await observeOdNextDeviceShell({ projectRoot, entryFile: '../outside.html', resolution })).toBeNull();
  });
});
