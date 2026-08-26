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

import { I18nProvider, useI18n } from '../../src/i18n';
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


function row(id: string, readAt: string | null) {
  return {
    id,
    audienceType: 'global',
    typeName: 'Product update',
    title: id,
    body: id,
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: '2026-07-16T12:00:00.000Z',
    readAt,
  };
}

/** fetch stub whose FIRST message pull is held open until released. */
function stubFetchWithGatedFirstPull(first: unknown[], later: unknown[]) {
  let releaseFirst: (() => void) | null = null;
  let pulls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/integrations/vela/status')) {
      statusCalls += 1;
      return Response.json({ loggedIn: false });
    }
    if (url.includes('/message-center') && url.includes('/messages')) {
      messageCalls += 1;
      pulls += 1;
      if (pulls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return Response.json({ messages: first, nextCursor: null, unreadCount: first.length });
      }
      return Response.json({ messages: later, nextCursor: null, unreadCount: later.length });
    }
    return Response.json({});
  }));
  return { release: () => releaseFirst?.() };
}

describe('MessageCenter remount snapshot', () => {
  it('does not let a host that already unmounted publish over a newer snapshot', async () => {
    // `syncRequestIdRef` lives on ONE component, so it can only order that
    // component's own runs. A host that unmounts mid-flight never bumps its
    // ref again: when its slow pull finally lands, its request id, the account
    // generation and the locale all still match, and it wrote its older rows
    // straight over the snapshot its successor had already published. The next
    // remount then adopted the stale rows and the unread count went backwards.
    const gate = stubFetchWithGatedFirstPull(
      [row('a', null), row('b', null)],   // stale: 2 unread
      [row('a', '2026-07-16T13:00:00.000Z'), row('b', null)],   // fresh: 1 unread
    );

    const first = mount();
    await waitFor(() => expect(messageCalls).toBe(1));
    first.unmount();

    // The successor joins the in-flight run rather than racing it, so a second
    // run needs a refresh trigger — the same visibility refresh the component
    // wires up in production.
    const second = mount();
    await Promise.resolve();
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(messageCalls).toBe(2));

    // The fresh run has published. Now let the abandoned host land.
    gate.release();
    await new Promise((r) => setTimeout(r, 20));
    second.unmount();

    const counts: number[] = [];
    render(
      <I18nProvider initial="zh-CN">
        <MessageCenter
          hideTrigger
          open={false}
          onOpenChange={() => {}}
          onUnreadCountChange={(n) => counts.push(n)}
        />
      </I18nProvider>,
    );

    // Adopted, not refetched — otherwise this asserts the network, not the
    // snapshot the stale writer was supposed to have corrupted.
    await waitFor(() => expect(counts.length).toBeGreaterThan(0));
    expect(messageCalls).toBe(2);
    expect(counts[counts.length - 1]).toBe(1);
  });

  it('does not replay the previous account\'s read after a boundary crosses mid-POST', async () => {
    // `markAccountMessageRead` is an await, and the boundary re-check used to
    // sit BELOW the mutations that follow it. A sign-out/sign-in landing across
    // that POST therefore left the old account's message id sitting in
    // `pendingReadIdsRef` (and the anonymous cache already cleared) before the
    // function bailed out — and the next sync replays that overlay, so a
    // same-id message belonging to whoever signed in came back already read.
    let releaseRead: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/integrations/vela/status')) {
        statusCalls += 1;
        return Response.json({ loggedIn: true });
      }
      if (url.includes('/read') && init?.method === 'POST') {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        return Response.json({ read: true, markedCount: 1 });
      }
      if (url.includes('/message-center') && url.includes('/messages')) {
        messageCalls += 1;
        return Response.json({
          messages: [row('zeta-notice', null)],
          nextCursor: null,
          unreadCount: 1,
        });
      }
      return Response.json({});
    }));

    const counts: number[] = [];
    render(
      <I18nProvider initial="zh-CN">
        <MessageCenter onUnreadCountChange={(n) => counts.push(n)} />
      </I18nProvider>,
    );
    await waitFor(() => expect(messageCalls).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('message-center-trigger'));
    fireEvent.click(await screen.findByRole('button', { name: /zeta-notice/ }));
    await waitFor(() => expect(releaseRead).not.toBeNull());

    // The account changes underneath the pending write.
    advanceWorkspaceAccountGeneration('mark-read-post-boundary');
    releaseRead!();
    await new Promise((r) => setTimeout(r, 20));

    // The new account's sync must not inherit that read.
    const before = messageCalls;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(messageCalls).toBeGreaterThan(before));
    await waitFor(() => expect(counts[counts.length - 1]).toBe(1));
  });

  it('records both of two concurrent reads in the shared snapshot', async () => {
    // Two clicks land before either account POST resolves, so both capture the
    // same snapshot. Patching by wholesale replacement guarded on snapshot
    // identity meant the first completion replaced it and the second found the
    // identity no longer matching, committed only host-local state, and left
    // its row unread in the snapshot — so the badge came back on the next
    // remount.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/integrations/vela/status')) {
        statusCalls += 1;
        return Response.json({ loggedIn: true });
      }
      if (url.includes('/read') && init?.method === 'POST') {
        return Response.json({ read: true, markedCount: 1 });
      }
      if (url.includes('/message-center') && url.includes('/messages')) {
        messageCalls += 1;
        return Response.json({
          messages: [row('alpha-notice', null), row('beta-notice', null)],
          nextCursor: null,
          unreadCount: 2,
        });
      }
      return Response.json({});
    }));

    const host = render(
      <I18nProvider initial="zh-CN">
        <MessageCenter />
      </I18nProvider>,
    );
    await waitFor(() => expect(messageCalls).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('message-center-trigger'));
    const alpha = await screen.findByRole('button', { name: /alpha-notice/ });
    const beta = await screen.findByRole('button', { name: /beta-notice/ });

    // Back-to-back: neither POST has resolved when the second one starts.
    fireEvent.click(alpha);
    fireEvent.click(beta);
    await new Promise((r) => setTimeout(r, 40));
    host.unmount();

    const counts: number[] = [];
    render(
      <I18nProvider initial="zh-CN">
        <MessageCenter
          hideTrigger
          open={false}
          onOpenChange={() => {}}
          onUnreadCountChange={(n) => counts.push(n)}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(counts.length).toBeGreaterThan(0));
    expect(counts[counts.length - 1]).toBe(0);
  });

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

  it('does not serve the previous locale\'s rows after a language switch', async () => {
    // `pullMessageCenter` asks the server for locale-specific fields, so a
    // snapshot is only valid for the language it was fetched under. Changing
    // language re-runs the mount effect (via `sync`'s identity); without the
    // locale in the key that re-run adopts the old language's rows and the
    // panel stays in the wrong language until an open, a visibility refresh or
    // the 60s poll.
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/integrations/vela/status')) {
        statusCalls += 1;
        return Response.json({ loggedIn: false });
      }
      if (url.includes('/message-center') && url.includes('/messages')) {
        messageCalls += 1;
        const locale = new URL(url, 'http://x').searchParams.get('locale') || '?';
        seen.push(locale);
        return Response.json({
          messages: [{
            id: 'm1',
            title: `row for ${locale}`,
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

    // `I18nProvider` seeds its locale from `initial` once, so switching has to
    // go through the provider's own `setLocale`.
    function Harness() {
      const { setLocale } = useI18n();
      return (
        <>
          <button type="button" data-testid="to-en" onClick={() => setLocale('en')}>en</button>
          {/* Closed on purpose: the `open` effect re-runs on any `retrySync`
              identity change and would fetch regardless of the snapshot logic,
              hiding the defect this pins. */}
          <MessageCenter hideTrigger open={false} onOpenChange={() => {}} />
        </>
      );
    }

    render(
      <I18nProvider initial="zh-CN">
        <Harness />
      </I18nProvider>,
    );
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const firstLocale = seen[0];

    fireEvent.click(screen.getByTestId('to-en'));

    // The mount effect must fetch for the new locale rather than adopt the
    // previous language's snapshot.
    await waitFor(() => expect(seen.some((l) => l !== firstLocale)).toBe(true));
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
