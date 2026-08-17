// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/suite';

type ProjectResponse = {
  project: { id: string; skillId?: string | null };
};

type SkillResponse = {
  body?: string;
  id: string;
};

type BrowserSessionResponse = {
  browserSession: { id: string; websocketUrl: string };
};

// This spec deliberately uses a tiny fake executable instead of CI's browser.
// It exercises the real tools-dev daemon, project authorization, process
// lifecycle, and API contract hermetically. Adapter/CDP behavior is covered by
// the daemon unit suite, while local packaged acceptance runs real system Chrome.
describe('Website Clone main path', () => {
  test('[P0] brokers a browser for UI and headless od CLI runs without Electron or a Playwright install', async () => {
    const suite = await createSmokeSuite('web-clone-main');
    const fakeBrowser = await writeFakeBrowserExecutable(suite.scratchDir);

    await suite.with.toolsDev(async ({ webUrl }) => {
      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { intent: 'web-clone', kind: 'prototype' },
          name: 'Website Clone main-path smoke project',
          pendingPrompt: '复刻 https://example.com',
          skillId: 'web-clone',
        },
      });
      expect(project.project.skillId).toBe('web-clone');

      const skill = await requestJson<SkillResponse>(webUrl, '/api/skills/web-clone');
      expect(skill.id).toBe('web-clone');
      expect(skill.body).toContain('基于 Chrome DevTools Protocol 的零依赖控制层');
      expect(skill.body).toContain('无需启动 Electron 客户端');
      expect(skill.body).not.toContain('npm install -D playwright');

      const created = await requestJson<BrowserSessionResponse>(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/browser-sessions`,
        { body: {} },
      );
      expect(created.browserSession.id).toEqual(expect.any(String));
      expect(created.browserSession.websocketUrl).toBe(
        'ws://127.0.0.1:65534/devtools/browser/web-clone-e2e',
      );

      const closed = await requestJson<{ closed: boolean }>(
        webUrl,
        `/api/projects/${encodeURIComponent(project.project.id)}/browser-sessions/${encodeURIComponent(created.browserSession.id)}`,
        { method: 'DELETE' },
      );
      expect(closed.closed).toBe(true);

      await suite.report.json('summary.json', {
        browserBroker: created.browserSession,
        electronRequired: false,
        playwrightInstalledInProject: false,
        projectId: project.project.id,
        skillId: skill.id,
      });
    }, {
      env: { OD_BROWSER_EXECUTABLE_PATH: fakeBrowser },
    });
  }, 180_000);
});

async function writeFakeBrowserExecutable(root: string): Promise<string> {
  const binDir = join(root, 'fake-browser');
  const executable = join(binDir, 'chrome');
  await mkdir(binDir, { recursive: true });
  await writeFile(
    executable,
    [
      '#!/usr/bin/env node',
      "process.stderr.write('DevTools listening on ws://127.0.0.1:65534/devtools/browser/web-clone-e2e\\n');",
      "process.on('SIGTERM', () => process.exit(0));",
      "process.on('SIGINT', () => process.exit(0));",
      'setInterval(() => {}, 60_000);',
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(executable, 0o755);
  return executable;
}
