import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectAgent } from '../../src/runtimes/detection.js';
import { resolveAgentLaunch } from '../../src/runtimes/launch.js';
import type { RuntimeAgentDef } from '../../src/runtimes/types.js';

// A minimal agent def: no compatibility probe, so these cases isolate the
// binary-resolution stage from the profile handshake that `deepseek-harness`
// layers on top of it.
const def: RuntimeAgentDef = {
  id: 'deepseek-harness',
  name: 'DeepSeek Harness',
  bin: 'dsh',
  versionArgs: ['--version'],
  fallbackModels: [{ id: 'default', label: 'Default' }],
  buildArgs: () => [],
  streamFormat: 'dsh-profile-jsonl',
};

/**
 * A shim that resolves on PATH but cannot be executed: the interpreter its
 * shebang names does not exist, so the spawn fails with ENOENT. This is the
 * shape a half-finished `npm i -g` leaves behind — the wrapper survives, the
 * package it points at does not.
 */
function writeBrokenShim(dir: string): string {
  const bin = path.join(dir, 'dsh');
  writeFileSync(bin, '#!/nonexistent/interpreter\n');
  chmodSync(bin, 0o755);
  return bin;
}

function writeWorkingShim(dir: string, version = '0.1.0-rc.6'): string {
  const bin = path.join(dir, 'dsh');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('agent executable resolution falls back past unusable candidates', () => {
  const dirs: string[] = [];
  let savedPath: string | undefined;
  let savedAgentHome: string | undefined;
  let savedDshBin: string | undefined;

  beforeEach(() => {
    savedPath = process.env.PATH;
    savedAgentHome = process.env.OD_AGENT_HOME;
    savedDshBin = process.env.DSH_BIN;
    delete process.env.DSH_BIN;
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedAgentHome === undefined) delete process.env.OD_AGENT_HOME;
    else process.env.OD_AGENT_HOME = savedAgentHome;
    if (savedDshBin === undefined) delete process.env.DSH_BIN;
    else process.env.DSH_BIN = savedDshBin;
    while (dirs.length > 0) {
      rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
  });

  function tempDir(label: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), `od-exec-fallback-${label}-`));
    dirs.push(dir);
    return dir;
  }

  // The production report behind this suite: a stale `npm i -g` wrapper sat in
  // a directory that OpenDesign searches *before* the one the official
  // installer writes to, so the working CLI was never reached and the agent
  // vanished from the picker entirely.
  it('reaches a working binary that sits behind a broken one on PATH', async () => {
    if (process.platform === 'win32') return;
    const brokenDir = tempDir('broken');
    const goodDir = tempDir('good');
    writeBrokenShim(brokenDir);
    const goodBin = writeWorkingShim(goodDir);

    process.env.OD_AGENT_HOME = goodDir;
    process.env.PATH = [brokenDir, goodDir].join(path.delimiter);

    const detected = await detectAgent(def);

    expect(detected.available).toBe(true);
    expect(detected.path).toBe(goodBin);
    expect(detected.version).toBe('0.1.0-rc.6');
  });

  // Detection deciding an agent is usable is worthless if the spawn sites go
  // back to the binary detection just rejected: Settings would advertise the
  // agent as installed while every chat turn execs the broken shim. Detection
  // and launch have to agree on which executable this agent runs.
  it('makes every later launch resolve to the binary detection settled on', async () => {
    if (process.platform === 'win32') return;
    const brokenDir = tempDir('broken-launch');
    const goodDir = tempDir('good-launch');
    const brokenBin = writeBrokenShim(brokenDir);
    const goodBin = writeWorkingShim(goodDir);

    process.env.OD_AGENT_HOME = goodDir;
    process.env.PATH = [brokenDir, goodDir].join(path.delimiter);

    const detected = await detectAgent(def);
    expect(detected.available).toBe(true);
    expect(detected.path).toBe(goodBin);

    // What chat, the connection test, memory-llm, and companion setup all call.
    const launch = resolveAgentLaunch(def);
    expect(launch.selectedPath).toBe(goodBin);
    expect(launch.selectedPath).not.toBe(brokenBin);
    expect(launch.launchPath).toBe(goodBin);
  });

  // Remembering detection's winner must reorder candidates, never introduce
  // one. Resolution stays a pure function of the current environment: an
  // emptied PATH, a sandboxed OD_AGENT_HOME, or an uninstalled CLI all still
  // mean "not found". Without this, a winner learned in a richer environment
  // resurrects a binary the caller can no longer see — which is how a route
  // that must report the runtime as unavailable starts reporting it as ready.
  it('does not resurrect a remembered binary once the environment stops offering it', async () => {
    if (process.platform === 'win32') return;
    const goodDir = tempDir('remembered');
    const goodBin = writeWorkingShim(goodDir);

    process.env.OD_AGENT_HOME = goodDir;
    process.env.PATH = goodDir;

    const detected = await detectAgent(def);
    expect(detected.available).toBe(true);
    expect(detected.path).toBe(goodBin);
    expect(resolveAgentLaunch(def).selectedPath).toBe(goodBin);

    // The binary is still on disk — only the search environment changed.
    process.env.PATH = '';

    expect(resolveAgentLaunch(def).selectedPath).toBeNull();
  });

  // Even when every candidate is unusable, detection must surface the path it
  // actually tried. The picker hides an agent that reports no path at all, so
  // dropping it leaves the user with an invisible agent and no way to act.
  it('keeps the attempted path when no candidate can be executed', async () => {
    if (process.platform === 'win32') return;
    const brokenDir = tempDir('only-broken');
    const brokenBin = writeBrokenShim(brokenDir);

    process.env.OD_AGENT_HOME = brokenDir;
    process.env.PATH = brokenDir;

    const detected = await detectAgent(def);

    expect(detected.available).toBe(false);
    expect(detected.path).toBe(brokenBin);
    expect(detected.diagnostics?.[0]?.reason).toBe('shim-broken');
  });
});
