// Composer footer toolbar alignment.
//
// The composer's bottom row mixes four controls authored across separate
// components — Add context, design system, agent/model, and Send. The composer
// mounts under `.chat-composer-fixed-layer` (a body-level portal), so an
// app-scoped normalization can miss it. Even though the row centers its
// children, differing control heights then look visibly misaligned.
//
// This spec is the regression boundary: the utility controls share the compact
// 28px geometry, Send keeps its deliberate 36px emphasis, and every control
// shares one vertical center so the toolbar reads as a single row.

import { randomUUID } from 'node:crypto';
import { expect, test } from '@/playwright/suite';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'open-design:config';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'mock',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        privacyDecisionAt: 1,
        agentModels: {},
      }),
    );
  }, STORAGE_KEY);

  await page.route('**/api/app-config', async (route) => {
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          privacyDecisionAt: 1,
          agentId: 'mock',
          skillId: null,
          designSystemId: null,
          agentModels: {},
          agentCliEnv: {},
        },
      },
    });
  });

  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      json: {
        agents: [
          {
            id: 'mock',
            name: 'Mock Agent',
            bin: 'mock-agent',
            available: true,
            version: 'test',
            models: [{ id: 'default', label: 'Default' }],
          },
        ],
      },
    });
  });
});

test('[P1] composer footer controls keep their size hierarchy on one baseline', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Composer toolbar alignment');
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-send')).toBeVisible();

  const toolbarControls = [
    ['plus', page.getByTestId('chat-plus-trigger')],
    ['design-system', page.getByTestId('composer-design-system-trigger')],
    ['agent', page.getByTestId('avatar-agent-trigger')],
    ['send', page.getByTestId('chat-send')],
  ] as const;
  const controls: Array<{ id: string; height: number; center: number }> = [];
  for (const [id, control] of toolbarControls) {
    await expect(control).toBeVisible();
    controls.push(await control.evaluate((element, controlId) => {
      const rect = element.getBoundingClientRect();
      return {
        id: controlId,
        height: rect.height,
        center: rect.top + rect.height / 2,
      };
    }, id));
  }

  const centers = controls.map((c) => c.center);
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

  const send = controls.find((control) => control.id === 'send');
  const utilityControls = controls.filter((control) => control.id !== 'send');
  expect(send?.height, `control heights: ${JSON.stringify(controls)}`).toBe(36);
  for (const control of utilityControls) {
    expect(control.height, `control heights: ${JSON.stringify(controls)}`).toBe(28);
  }

  // All controls share a vertical center so nothing rides high or low in the row.
  expect(spread(centers), `control centers: ${JSON.stringify(controls)}`).toBeLessThanOrEqual(1);
});

async function createProject(page: Page, projectName: string): Promise<void> {
  const response = await page.request.post('/api/projects', {
    data: {
      id: randomUUID(),
      name: projectName,
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'prototype', nameSource: 'user' },
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    project: { id: string };
    conversationId: string;
  };
  await page.goto(`/projects/${body.project.id}/conversations/${body.conversationId}`);
}
