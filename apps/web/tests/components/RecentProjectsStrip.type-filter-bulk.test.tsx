// @vitest-environment jsdom
//
// Acceptance #77 (type filter must speak the card-chip vocabulary) and #75
// (多选 bar must actually offer actions).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RecentProjectsStrip,
  projectCardCategory,
} from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';
import type { WorkspaceProjectSummary } from '@open-design/contracts';

// Typed on the argument the component actually passes, so `.mock.calls`
// destructures instead of widening to the empty tuple.
interface MoveCall { projectId: string; visibility: string }
function movedProject(input: MoveCall): WorkspaceProjectSummary {
  return {
    id: input.projectId,
    name: input.projectId,
    workspaceId: 'ws-1',
    visibility: input.visibility === 'team' ? 'team' : 'personal',
    resourceState: 'active',
    createdByWorkspaceMemberId: 'wm-1',
    currentUserAccess: {
      canOpen: true,
      canRename: true,
      canDelete: true,
      canDuplicate: true,
      canMoveToTeam: input.visibility !== 'team',
      canMoveToPersonal: input.visibility === 'team',
      canExport: true,
      canSendTo: true,
      canRestoreVersion: true,
    },
    createdAt: 1,
    updatedAt: 2,
    project: {
      id: input.projectId,
      name: input.projectId,
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
    },
  };
}
const moveWorkspaceProject = vi.fn(async (input: MoveCall) => movedProject(input));

vi.mock('../../src/state/projects', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  moveWorkspaceProject: (...args: unknown[]) => moveWorkspaceProject(args[0] as MoveCall),
}));

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => null),
  fetchProjectFiles: vi.fn(async () => []),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

afterEach(() => {
  cleanup();
  moveWorkspaceProject.mockClear();
  vi.restoreAllMocks();
});

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Project',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    status: { value: 'not_started' },
    ...overrides,
  };
}

const PROTOTYPE = project({ id: 'p-prototype', name: 'Prototype project', updatedAt: 5 });
const DECK = project({
  id: 'p-deck',
  name: 'Deck project',
  updatedAt: 4,
  metadata: { kind: 'deck' },
});
const LIVE = project({
  id: 'p-live',
  name: 'Live project',
  updatedAt: 3,
  metadata: { kind: 'prototype', intent: 'live-artifact' },
});
// recvpZbvupSr1o: a web-clone project still stores `kind: 'prototype'`
// (home-hero/chips.ts's 'web-clone' chip keeps preview behavior identical to
// a blank prototype) — only `intent: 'web-clone'` marks the scenario.
const WEB_CLONE = project({
  id: 'p-web-clone',
  name: 'Web clone project',
  updatedAt: 2.5,
  metadata: { kind: 'prototype', intent: 'web-clone' },
});
const MEDIA = project({
  id: 'p-media',
  name: 'Media project',
  updatedAt: 2,
  metadata: { kind: 'video' },
});
const DESIGN_SYSTEM = project({
  id: 'p-ds',
  name: 'Design system project',
  updatedAt: 1,
  metadata: { kind: 'other', importedFrom: 'design-system' },
});

const ALL_PROJECTS = [PROTOTYPE, DECK, LIVE, WEB_CLONE, MEDIA, DESIGN_SYSTEM];

function renderGrid(props: Partial<React.ComponentProps<typeof RecentProjectsStrip>> = {}) {
  return render(
    <RecentProjectsStrip
      heading="All projects"
      projects={ALL_PROJECTS}
      onOpen={() => {}}
      {...props}
    />,
  );
}

function openKindMenu(container: HTMLElement): HTMLElement {
  const filters = container.querySelectorAll('.recent-projects__filter');
  // [0] is the owner filter, [1] the type filter.
  fireEvent.click(filters[1]!);
  return container.querySelectorAll('.recent-projects__filter-menu')[0] as HTMLElement;
}

function cardNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.recent-projects__card-name')].map(
    (node) => node.textContent ?? '',
  );
}

describe('projectCardCategory', () => {
  // The chip a card wears IS the filter vocabulary; if these drift, the
  // dropdown starts offering types no card can display (acceptance #77).
  it('maps each project to the chip its card renders', () => {
    expect(projectCardCategory(PROTOTYPE)).toBe('prototype');
    expect(projectCardCategory(DECK)).toBe('slide');
    expect(projectCardCategory(LIVE)).toBe('live-artifact');
    expect(projectCardCategory(WEB_CLONE)).toBe('web-clone');
    expect(projectCardCategory(MEDIA)).toBe('media');
    expect(projectCardCategory(DESIGN_SYSTEM)).toBe('design-system');
  });

  it('recvpZbvupSr1o: resolves a web-clone-intent project to its own chip, not the blank prototype bucket', () => {
    // Both projects store `kind: 'prototype'`; only `intent` distinguishes a
    // website clone from a real blank prototype. Before this fix every clone
    // fell through the missing branch straight to the 'prototype' default.
    expect(
      projectCardCategory(project({ id: 'p-blank', metadata: { kind: 'prototype' } })),
    ).toBe('prototype');
    expect(
      projectCardCategory(
        project({ id: 'p-clone', metadata: { kind: 'prototype', intent: 'web-clone' } }),
      ),
    ).toBe('web-clone');
  });

  it('resolves brand-kind projects to the design-system chip the card shows', () => {
    // `projectCategory` alone would answer 'brand', but the card branches on
    // `isDesignSystemProject` first — so 'brand' is not an offerable filter.
    expect(projectCardCategory(project({ id: 'p-brand', metadata: { kind: 'brand' } }))).toBe(
      'design-system',
    );
  });
});

describe('personal projects collection toolbar', () => {
  it('puts the collection switch below the heading and combines sort with view options', () => {
    const { container } = renderGrid({
      heading: 'Personal projects',
      space: 'drafts',
      canManageProjectCollection: true,
    });

    const header = container.querySelector('.recent-projects__head');
    expect(header?.classList.contains('recent-projects__head--personal')).toBe(true);

    const collectionSwitch = screen.getByRole('radiogroup', { name: 'Personal projects' });
    expect(within(collectionSwitch).getAllByRole('radio')).toHaveLength(3);
    expect(within(collectionSwitch).getByRole('radio', { name: 'Recently viewed' })).toBeTruthy();
    expect(within(collectionSwitch).getByRole('radio', { name: 'Personal projects' })).toBeTruthy();
    expect(within(collectionSwitch).getByRole('radio', { name: 'Team projects' })).toBeTruthy();
    expect(container.querySelector('.recent-projects__collection-switch .recent-projects__filter-menu')).toBeNull();

    fireEvent.click(within(collectionSwitch).getByRole('radio', { name: 'Personal projects' }));
    expect(
      within(collectionSwitch).getByRole('radio', { name: 'Personal projects' }).getAttribute('aria-checked'),
    ).toBe('true');

    const displayButton = screen.getByRole('button', { name: 'Sort projects · View mode' });
    fireEvent.click(displayButton);
    const displayMenu = container.querySelector('.recent-projects__filter-menu--display');
    expect(displayMenu).not.toBeNull();
    expect(
      within(displayMenu as HTMLElement).getByRole('menuitemradio', { name: 'Newest first' }),
    ).toBeTruthy();
    expect(
      within(displayMenu as HTMLElement).getByRole('menuitemradio', { name: 'Grid view' }),
    ).toBeTruthy();

    fireEvent.click(
      within(displayMenu as HTMLElement).getByRole('menuitemradio', { name: 'List view' }),
    );
    expect(
      container
        .querySelector('.recent-projects__row')
        ?.classList.contains('recent-projects__row--list'),
    ).toBe(true);
    expect(container.querySelectorAll('.recent-projects__view-btn')).toHaveLength(1);
  });

  it('switches the card collection between recent, personal, and team projects', () => {
    const personalProject = project({ id: 'personal-project', name: 'Personal card', updatedAt: 3 });
    const teamProject = project({ id: 'team-project', name: 'Team card', updatedAt: 2 });
    const { container } = renderGrid({
      heading: 'Personal projects',
      projects: [personalProject, teamProject],
      space: 'drafts',
      isSharedProject: (projectId) => projectId === teamProject.id,
      collaborationEnabled: true,
      canManageProjectCollection: true,
    });

    const collectionSwitch = screen.getByRole('radiogroup', { name: 'Personal projects' });
    expect(cardNames(container)).toEqual(['Personal card', 'Team card']);

    fireEvent.click(within(collectionSwitch).getByRole('radio', { name: 'Personal projects' }));
    expect(cardNames(container)).toEqual(['Personal card']);

    fireEvent.click(within(collectionSwitch).getByRole('radio', { name: 'Team projects' }));
    expect(cardNames(container)).toEqual(['Team card']);

    fireEvent.click(screen.getByRole('button', { name: 'Multi-select' }));
    expect(screen.queryByRole('button', { name: 'Move to team space' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move out of team space' })).toBeTruthy();

    fireEvent.click(within(collectionSwitch).getByRole('radio', { name: 'Personal projects' }));
    expect(screen.getByRole('button', { name: 'Move to team space' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move out of team space' })).toBeNull();
  });
});

// The #77 type-filter cases and the #75 bulk-selection-bar cases both drove the
// header controls that Recent Projects no longer renders — the owner / type
// filter chips and the Multi-select toggle. Their entry points are gone, so the
// cases were removed rather than left clicking for buttons that cannot appear.
// The bulk move / delete handlers they covered still exist in the component and
// are currently unreachable; restore the controls (or delete the handlers) and
// these are worth writing again.
