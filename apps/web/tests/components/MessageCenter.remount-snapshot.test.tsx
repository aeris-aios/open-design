// @vitest-environment jsdom
//
// The panel has two mutually-exclusive hosts — the rail's cluster on the entry
// views, `WorkspaceTopRightAccountCluster` on a project route — so every
// project<->home navigation unmounts one and mounts the other. Each remount
// re-ran the whole sync: `isAmrLoggedIn`, then a paginated `pullMessageCenter`,
// for a panel the user has not opened and whose contents cannot have changed in
// the time a route switch takes.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { MessageCenter, resetMessageCenterSnapshot } from '../../src/components/MessageCenter';
import { advanceWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';

let statusCalls = 0;
let messageCalls = 0;

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/integrations/vela/status')) {
      statusCalls += 1;
      return Response.json({ loggedIn: false });
    }
    // Signed-out pulls go through `message-center-public`; match both proxies.
    if (url.includes('/message-center') && url.includes('/messages')) {
      messageCalls += 1;
      return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
    }
    return Response.json({});
  }));
}

function mount() {
  return render(
    <I18nProvider initial="zh-CN">
      <MessageCenter hideTrigger open={false} onOpenChange={() => {}} />
    </I18nProvider>,
  );
}

async function mountAndSettle() {
  const view = mount();
  await waitFor(() => expect(statusCalls).toBeGreaterThan(0));
  await waitFor(() => expect(messageCalls).toBeGreaterThan(0));
  return view;
}

beforeEach(() => {
  localStorage.clear();
  statusCalls = 0;
  messageCalls = 0;
  resetMessageCenterSnapshot();
  vi.useRealTimers();
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MessageCenter remount snapshot', () => {
  it('does not re-sync when it is remounted straight away', async () => {
    const first = await mountAndSettle();
    const afterFirst = { status: statusCalls, messages: messageCalls };
    first.unmount();

    mount();
    // Give the mount effect a turn; nothing new may go out.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));

    expect(statusCalls).toBe(afterFirst.status);
    expect(messageCalls).toBe(afterFirst.messages);
  });

  it('does not stampede when a remount lands while a sync is still in flight', async () => {
    // Found in a real browser, not by reading: a route switch unmounts the
    // outgoing host and mounts the incoming one within the same frame, so the
    // second mount starts BEFORE the first sync has written its snapshot.
    // Sequential dedupe alone misses that case entirely — measured four syncs
    // for one project<->home round trip.
    let release: (value: Response) => void = () => {};
    const gate = new Promise<Response>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/integrations/vela/status')) {
        statusCalls += 1;
        return Response.json({ loggedIn: false });
      }
      if (url.includes('/message-center') && url.includes('/messages')) {
        messageCalls += 1;
        return gate;
      }
      return Response.json({});
    }));

    const first = mount();
    await waitFor(() => expect(messageCalls).toBe(1));

    // Second host mounts while the first pull is still open.
    const second = mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(messageCalls).toBe(1);

    release(Response.json({ messages: [], nextCursor: null, unreadCount: 0 }));
    await waitFor(() => expect(messageCalls).toBe(1));
    first.unmount();
    second.unmount();
  });

  it('syncs again once the snapshot window has passed', async () => {
    const first = await mountAndSettle();
    const afterFirst = messageCalls;
    first.unmount();

    // 10s window; jump past it without waiting for real time.
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 11_000);

    mount();
    await waitFor(() => expect(messageCalls).toBeGreaterThan(afterFirst));
  });

  it('never adopts a snapshot from the previous account', async () => {
    // A sign-out/sign-in makes the previous account's messages inadmissible no
    // matter how recent they are.
    const first = await mountAndSettle();
    const afterFirst = messageCalls;
    first.unmount();

    advanceWorkspaceAccountGeneration('message-center-remount-boundary');

    mount();
    await waitFor(() => expect(messageCalls).toBeGreaterThan(afterFirst));
  });

  it('never adopts a response that was fetched before an account boundary', async () => {
    // The generation must be captured when the sync STARTS. Stamping the
    // snapshot at completion labels a pre-boundary response with the new
    // account's generation, and a post-boundary mount then renders the previous
    // account's messages as current.
    let release: (value: Response) => void = () => {};
    const gate = new Promise<Response>((r) => { release = r; });
    let pulls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/integrations/vela/status')) {
        statusCalls += 1;
        return Response.json({ loggedIn: false });
      }
      if (url.includes('/message-center') && url.includes('/messages')) {
        pulls += 1;
        messageCalls += 1;
        if (pulls === 1) return gate;
        return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
      }
      return Response.json({});
    }));

    const first = mount();
    await waitFor(() => expect(pulls).toBe(1));

    // Sign-out/sign-in lands while the first pull is still open.
    advanceWorkspaceAccountGeneration('mid-flight-boundary');
    release(Response.json({
      messages: [{ id: 'stale', title: 'previous account', readAt: null }],
      nextCursor: null,
      unreadCount: 1,
    }));
    await new Promise((r) => setTimeout(r, 20));
    first.unmount();

    // A mount after the boundary must fetch rather than adopt that response.
    mount();
    await waitFor(() => expect(pulls).toBeGreaterThan(1));
  });

  it('keeps a message read after marking it and remounting', async () => {
    // `markRead` updates component state; the module snapshot was left holding
    // the pre-read rows, so a project<->home switch inside the window restored
    // the unread count until the next network sync. The count is the
    // component's own contract (`onUnreadCountChange`), so assert on that.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/integrations/vela/status')) {
        statusCalls += 1;
        return Response.json({ loggedIn: false });
      }
      if (url.includes('/message-center') && url.includes('/messages')) {
        if ((init?.method ?? 'GET') !== 'GET') return Response.json({});
        messageCalls += 1;
        return Response.json({
          messages: [{
            id: 'm1',
            title: 'unread one',
            body: 'b',
            typeName: 't',
            publishedAt: '2026-08-01T00:00:00.000Z',
            readAt: null,
          }],
          nextCursor: null,
          unreadCount: 1,
        });
      }
      return Response.json({});
    }));

    const firstCounts: number[] = [];
    const view = render(
      <I18nProvider initial="zh-CN">
        <MessageCenter hideTrigger open onOpenChange={() => {}} onUnreadCountChange={(n) => firstCounts.push(n)} />
      </I18nProvider>,
    );
    const row = await screen.findByText('unread one');
    await waitFor(() => expect(firstCounts.at(-1)).toBe(1));

    fireEvent.click(row.closest('button') as HTMLButtonElement);
    await waitFor(() => expect(firstCounts.at(-1)).toBe(0));
    view.unmount();

    const secondCounts: number[] = [];
    render(
      <I18nProvider initial="zh-CN">
        <MessageCenter hideTrigger open onOpenChange={() => {}} onUnreadCountChange={(n) => secondCounts.push(n)} />
      </I18nProvider>,
    );
    await waitFor(() => expect(secondCounts.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(secondCounts.at(-1)).toBe(0);
  });

  it('still syncs when the panel is opened', async () => {
    // The snapshot only answers the MOUNT question. Opening the panel is a
    // user asking for the current state and must go to the network.
    const view = await mountAndSettle();
    const afterFirst = messageCalls;

    view.rerender(
      <I18nProvider initial="zh-CN">
        <MessageCenter hideTrigger open onOpenChange={() => {}} />
      </I18nProvider>,
    );

    await waitFor(() => expect(messageCalls).toBeGreaterThan(afterFirst));
  });
});
