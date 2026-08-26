// Snapshot admission has to answer two different questions, and the account
// generation only answers one of them. It advances when the workspace identity
// changes; it does NOT necessarily advance when the AMR session ends — the
// message centre's own signed-out transition is written to work without one,
// and the app's status polling can observe a remote or expired session the same
// way. A snapshot published while signed in therefore stayed adoptable after
// the account went away.
//
// Pinned here rather than through the component: the component adopts before it
// syncs, so it cannot discover the change itself. `noteAuthoritativeAuthMode`
// is the entry point the app calls from `applyAmrLoginStatus`, and these assert
// the contract that entry point carries.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  adoptableSnapshot,
  noteAuthoritativeAuthMode,
  publishSnapshot,
  recordSnapshotRead,
  resetMessageCenterSnapshot,
  type MessageCenterSnapshot,
} from '../../src/components/message-center-snapshot';
import { currentWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';

function snapshot(loggedIn: boolean): MessageCenterSnapshot {
  return {
    at: Date.now(),
    accountGeneration: currentWorkspaceAccountGeneration(),
    locale: 'zh-CN',
    loggedIn,
    messages: [{
      id: 'row-1',
      audienceType: 'global',
      typeName: 'Product update',
      title: 'row-1',
      body: 'row-1',
      ctaLabel: null,
      ctaUrl: null,
      publishedAt: '2026-07-16T12:00:00.000Z',
      readAt: null,
    }] as MessageCenterSnapshot['messages'],
    readIds: new Set<string>(),
    pendingReadIds: new Set<string>(),
  };
}

beforeEach(() => {
  resetMessageCenterSnapshot();
});

describe('snapshot admission across an auth-mode change', () => {
  it('drops a signed-in snapshot when an authoritative sign-out is observed', () => {
    publishSnapshot(snapshot(true));
    expect(adoptableSnapshot('zh-CN')).not.toBeNull();

    noteAuthoritativeAuthMode(false);

    expect(adoptableSnapshot('zh-CN')).toBeNull();
  });

  it('drops a signed-out snapshot when an authoritative sign-in is observed', () => {
    publishSnapshot(snapshot(false));
    expect(adoptableSnapshot('zh-CN')).not.toBeNull();

    noteAuthoritativeAuthMode(true);

    expect(adoptableSnapshot('zh-CN')).toBeNull();
  });

  it('keeps a snapshot when the observation agrees with it', () => {
    publishSnapshot(snapshot(true));
    noteAuthoritativeAuthMode(true);
    expect(adoptableSnapshot('zh-CN')).not.toBeNull();
  });

  it('refuses a read recorded under the other authority', () => {
    publishSnapshot(snapshot(true));

    recordSnapshotRead({
      messageId: 'row-1',
      readAt: '2026-07-16T13:00:00.000Z',
      accountGeneration: currentWorkspaceAccountGeneration(),
      account: false,
    });

    const kept = adoptableSnapshot('zh-CN');
    expect(kept?.messages[0]?.readAt).toBeNull();
    expect(kept?.readIds.has('row-1')).toBe(false);
  });
});
