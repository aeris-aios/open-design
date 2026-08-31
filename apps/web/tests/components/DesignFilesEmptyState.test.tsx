// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { DesignFilesEmptyState } from '../../src/components/design-files/DesignFilesEmptyState';
import type { RunProgressStep } from '../../src/runtime/run-progress';

// The particle field paints on a canvas and animates on rAF; neither adds
// anything to the text assertions below.
vi.mock('../../src/components/workspace/SpaceBackground', () => ({
  SpaceBackground: () => null,
}));

function step(
  id: string,
  category: RunProgressStep['category'],
  target: string | null,
  toolName = 'Tool',
): RunProgressStep {
  return { id, category, toolName, target };
}

function renderState(props: Parameters<typeof DesignFilesEmptyState>[0]) {
  return render(
    <I18nProvider initial="zh-CN">
      <DesignFilesEmptyState {...props} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('DesignFilesEmptyState', () => {
  it('names the current step instead of a static "thinking"', () => {
    renderState({
      latestUserPrompt: '做个作品集',
      running: true,
      steps: [step('2', 'edit', 'index.html'), step('1', 'read', 'site.css')],
    });

    expect(screen.getByText('编辑 index.html')).toBeTruthy();
    expect(screen.queryByText('思考中')).toBeNull();
  });

  it('stacks the earlier steps under the current one, newest first', () => {
    renderState({
      running: true,
      steps: [
        step('3', 'run', 'pnpm build'),
        step('2', 'edit', 'index.html'),
        step('1', 'read', 'site.css'),
      ],
    });

    const trail = screen.getByTestId('design-files-empty-trail');
    expect([...trail.children].map((li) => li.textContent)).toEqual([
      '编辑 index.html',
      '读取 site.css',
    ]);
  });

  it('falls back to "thinking" while the turn has called nothing yet', () => {
    renderState({ latestUserPrompt: '做个作品集', running: true, steps: [] });

    expect(screen.getByText('思考中')).toBeTruthy();
    expect(screen.queryByTestId('design-files-empty-trail')).toBeNull();
  });

  it('drops the trail when the run is over, and keeps the idle copy', () => {
    renderState({
      running: false,
      steps: [step('2', 'edit', 'index.html'), step('1', 'read', 'site.css')],
    });

    expect(screen.queryByTestId('design-files-empty-trail')).toBeNull();
    expect(screen.getByText('生成的设计会出现在这里')).toBeTruthy();
  });

  it('names an unclassified tool by its own name', () => {
    renderState({ running: true, steps: [step('1', 'other', null, 'mcp__figma__export')] });

    expect(screen.getByText('调用 mcp__figma__export')).toBeTruthy();
  });
});
