// @vitest-environment jsdom
//
// Regression for 飞书 "personal workspace 展示了全部项目入口，提示没有团队项目".
// All-projects is fed by EntryShell.tsx's `teamProjects` — a TEAM-scoped
// catalog with no personal-workspace equivalent — but the nav item rendered
// for any workspace context, landing a personal-workspace user on a
// "还没有团队项目" empty state that names a concept their workspace cannot have.

import { cleanup, render, screen } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';
import { I18nProvider, type Locale } from '../../src/i18n';

function contextFor(workspaceType: 'team' | 'personal'): WorkspaceCollabContext {
  return {
    workspaceId: workspaceType === 'team' ? 'ws-team' : 'ws-personal',
    workspaceType,
    workspaceMemberId: 'wm-1',
    teamName: workspaceType === 'team' ? 'OD Feature Team' : undefined,
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
  } as unknown as WorkspaceCollabContext;
}

function renderRail(workspaceType: 'team' | 'personal', locale: Locale = 'en') {
  return render(
    <I18nProvider initial={locale}>
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={contextFor(workspaceType)}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('EntryNavRail all-projects visibility', () => {
  it('shows the all-projects nav item for a team workspace', () => {
    renderRail('team');
    expect(screen.queryByTestId('entry-nav-all-projects')).toBeTruthy();
  });

  it('hides the all-projects nav item for a personal workspace', () => {
    renderRail('personal');
    expect(screen.queryByTestId('entry-nav-all-projects')).toBeNull();
  });

  it('still shows drafts for a personal workspace', () => {
    renderRail('personal', 'zh-CN');
    const allProjects = screen.getByTestId('entry-nav-drafts');
    expect(allProjects.textContent).toContain('全部项目');
    expect(allProjects.querySelector('path')?.getAttribute('d')).toBe(
      'M3 10C3 10.5523 3.44772 11 4 11L12 11C12.5523 11 13 10.5523 13 10V4C13 3.44772 12.5523 3 12 3H4C3.44772 3 3 3.44772 3 4V10ZM11 20C11 20.5523 11.4477 21 12 21H20C20.5523 21 21 20.5523 21 20V14C21 13.4477 20.5523 13 20 13H12C11.4477 13 11 13.4477 11 14V20ZM13 15H19V19H13V15ZM3 20C3 20.5523 3.44772 21 4 21H8C8.55229 21 9 20.5523 9 20V14C9 13.4477 8.55229 13 8 13H4C3.44772 13 3 13.4477 3 14V20ZM5 19V15H7V19H5ZM5 9V5L11 5L11 9L5 9ZM20 11C20.5523 11 21 10.5523 21 10V4C21 3.44772 20.5523 3 20 3H16C15.4477 3 15 3.44772 15 4V10C15 10.5523 15.4477 11 16 11H20ZM19 9H17V5H19V9Z',
    );
  });
});
