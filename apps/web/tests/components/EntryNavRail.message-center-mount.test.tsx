// @vitest-environment jsdom
//
// `EntryNavRail` renders two mutually-exclusive MessageCenter instances: the
// signed-in one lives in the account cluster, the signed-out one on the rail.
// The gate is the `context` prop alone, so during launch — before
// `/api/workspace/context` has answered — `context` is null and the SIGNED-OUT
// instance mounts. When the context arrives it unmounts and the signed-in one
// mounts in its place, and that second mount re-runs a full sync:
// `isAmrLoggedIn` plus a paginated `pullMessageCenter`.
//
// Measured on a cold Home launch, that remount is what puts
// `/api/integrations/vela/status` and `/api/integrations/vela/message-center/messages`
// on the duplicate list. Nothing about the panel needs the early mount: it is
// hidden behind an opener, and the count it would report belongs to an identity
// that has not resolved yet.

import { cleanup, render } from '@testing-library/react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';

const workspaceContextState = {
  context: null as WorkspaceCollabContext | null,
  loading: true,
  failure: null,
  identityChangePending: false,
  accountGeneration: 0,
  resourceReadIdentity: null,
};

vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>()),
  useWorkspaceContext: () => workspaceContextState,
}));

const mountCounter = vi.hoisted(() => ({ mounts: 0 }));

vi.mock('../../src/components/MessageCenter', async () => {
  const { useEffect } = await import('react');
  return {
    // Count MOUNTS, not renders: the point of the gate is that the component
    // is never constructed twice per launch, and a re-render is not a resync.
    MessageCenter: () => {
      useEffect(() => {
        mountCounter.mounts += 1;
      }, []);
      return null;
    },
  };
});

function teamContext(): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-team',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: 'team_plus',
    displayName: 'Leaf',
    seatSummary: { seatLimit: 5, usedSeats: 1, availableSeats: 4, isSeatFull: false },
    permissions: { canInviteMembers: true, canViewWorkspaceSettings: true },
  } as unknown as WorkspaceCollabContext;
}

async function renderRail() {
  const { EntryNavRail } = await import('../../src/components/EntryNavRail');
  return render(
    <I18nProvider initial="zh-CN">
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        context={workspaceContextState.context}
        workspaceContextResolving={workspaceContextState.loading}
        billing={null}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mountCounter.mounts = 0;
  workspaceContextState.context = null;
  workspaceContextState.loading = true;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EntryNavRail message-center mounting', () => {
  it('does not mount the message center while the workspace context is still loading', async () => {
    await renderRail();
    expect(mountCounter.mounts).toBe(0);
  });

  it('mounts exactly once across a launch that resolves into a workspace', async () => {
    // The launch shape: context unresolved, then it arrives. Before this gate
    // that was two mounts — signed-out, then signed-in — and the second one
    // re-ran the whole sync.
    const view = await renderRail();
    expect(mountCounter.mounts).toBe(0);

    workspaceContextState.context = teamContext();
    workspaceContextState.loading = false;
    const { EntryNavRail } = await import('../../src/components/EntryNavRail');
    view.rerender(
      <I18nProvider initial="zh-CN">
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          open
          context={workspaceContextState.context}
          billing={null}
        />
      </I18nProvider>,
    );

    expect(mountCounter.mounts).toBe(1);
  });

  it('still mounts for a shell that resolves as signed out', async () => {
    // The gate delays the signed-out instance; it must not suppress it.
    workspaceContextState.loading = false;
    await renderRail();
    expect(mountCounter.mounts).toBe(1);
  });
});
