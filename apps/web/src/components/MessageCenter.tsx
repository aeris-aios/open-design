import { Button } from '@open-design/components';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useI18n, type Locale } from '../i18n';
import {
  clearAnonymousState,
  isAmrLoggedIn,
  markAccountMessageRead,
  pullMessageCenter,
  readAnonymousMessages,
  readAnonymousReadIds,
  type MessageCenterMessage,
  writeAnonymousState,
} from '../message-center-client';
import { currentWorkspaceAccountGeneration } from '../collab/workspace-identity';
import { Icon } from './Icon';
import styles from './MessageCenter.module.css';

function unreadBadgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count);
}

function formatPublishedDate(value: string, locale: Locale): string | null {
  const publishedAt = new Date(value);
  if (Number.isNaN(publishedAt.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(publishedAt);
}

interface Props {
  onOpenNotificationSettings?: () => void;
  /** Hide the built-in bell trigger — the host renders its own entry point
   *  (e.g. an account-menu row) and drives the panel via `open`/`onOpenChange`. */
  hideTrigger?: boolean;
  /** The still-mounted host control focus returns to when the panel closes.
   *  Required alongside `hideTrigger`: the built-in bell is what focus would
   *  otherwise return to, and a host that hides it owns that duty instead. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Controlled open state; pair with `onOpenChange` when `hideTrigger` is set. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Streams the unread count so hosts can render their own badge (e.g. the
   *  rail avatar's red dot). */
  onUnreadCountChange?: (count: number) => void;
}

type SyncState = 'loading' | 'ready' | 'error';

/**
 * The last successful sync, shared across mounts.
 *
 * `EntryNavRail` and `App` own two mutually-exclusive hosts for this panel —
 * the rail's cluster on the entry views, `WorkspaceTopRightAccountCluster` on a
 * project route — so every project↔home navigation unmounts one and mounts the
 * other. Without this, each of those remounts re-ran the whole sync:
 * `isAmrLoggedIn` plus a paginated `pullMessageCenter`, for a panel the user
 * has not opened and whose contents cannot have changed in the time it takes to
 * switch routes.
 *
 * Only the MOUNT sync consults this. The 60s interval, the visibility listener
 * and opening the panel all still fetch, so nothing that exists to observe a
 * change is weakened — the snapshot only answers "did we just fetch this?".
 *
 * Keyed on the account boundary: a sign-out/sign-in makes the previous
 * account's messages inadmissible no matter how recent they are.
 */
const MOUNT_SNAPSHOT_WINDOW_MS = 10_000;

let lastSyncSnapshot: {
  at: number;
  accountGeneration: number;
  /** `pullMessageCenter` asks for locale-specific fields, so a snapshot is only
   *  valid for the language it was fetched under. */
  locale: string;
  loggedIn: boolean;
  messages: MessageCenterMessage[];
  readIds: Set<string>;
} | null = null;

/**
 * The sync a mount is currently running, if any.
 *
 * The snapshot alone only dedupes SEQUENTIAL remounts: it is written when a
 * sync finishes, so mounts that start while one is still in flight all miss it
 * and stampede. A route switch produces exactly that shape — the outgoing host
 * unmounts and the incoming one mounts within the same frame — so both halves
 * are needed. A mount that finds a sync already running waits for it instead of
 * starting its own.
 */
let inFlightSync: { generation: number; locale: string; run: Promise<void> } | null = null;

/** Test hook: module state must not leak between cases. */
export function resetMessageCenterSnapshot(): void {
  lastSyncSnapshot = null;
  inFlightSync = null;
  snapshotWriteToken = 0;
}

/**
 * Orders snapshot PUBLICATION across every host, which `syncRequestIdRef`
 * cannot: that ref lives on one component, so a host which has since unmounted
 * still matches its own counter forever. Rail and account cluster swap on a
 * route change, so a slow pull issued by the host that went away resolves with
 * its request id, account generation and locale all still valid — and would
 * write its older rows over the snapshot its successor already published, which
 * the next remount then adopts. Only the newest issued run may publish.
 */
let snapshotWriteToken = 0;

function adoptableSnapshot(locale: string): typeof lastSyncSnapshot {
  const snapshot = lastSyncSnapshot;
  if (!snapshot) return null;
  if (snapshot.accountGeneration !== currentWorkspaceAccountGeneration()) return null;
  if (snapshot.locale !== locale) return null;
  if (Date.now() - snapshot.at >= MOUNT_SNAPSHOT_WINDOW_MS) return null;
  return snapshot;
}

export function MessageCenter({
  onOpenNotificationSettings,
  hideTrigger = false,
  returnFocusRef,
  open: controlledOpen,
  onOpenChange,
  onUnreadCountChange,
}: Props) {
  const { locale, t } = useI18n();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [openInternal, setOpenInternal] = useState(false);
  const open = controlledOpen ?? openInternal;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenInternal(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const [messages, setMessages] = useState<MessageCenterMessage[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loggedIn, setLoggedIn] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const loggedInRef = useRef(false);
  const messagesRef = useRef<MessageCenterMessage[]>([]);
  const readIdsRef = useRef<Set<string>>(new Set());
  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const syncRequestIdRef = useRef(0);

  const commitState = useCallback(
    (nextMessages: MessageCenterMessage[], nextReadIds: Set<string>, options?: { persistAnonymous?: boolean }) => {
      messagesRef.current = nextMessages;
      readIdsRef.current = nextReadIds;
      setMessages(nextMessages);
      setReadIds(nextReadIds);
      if (options?.persistAnonymous) writeAnonymousState(window.localStorage, nextMessages, nextReadIds);
    },
    [],
  );

  const sync = useCallback(async () => {
    const requestId = syncRequestIdRef.current + 1;
    syncRequestIdRef.current = requestId;
    // Capture the account boundary the request is issued under. Reading it
    // again at completion would stamp a pre-boundary response with the new
    // account's generation, and a later mount would adopt the previous
    // account's messages as current.
    const issuedAccountGeneration = currentWorkspaceAccountGeneration();
    const writeToken = ++snapshotWriteToken;
    if (messagesRef.current.length === 0) setSyncState('loading');
    const account = await isAmrLoggedIn();
    const wasAccount = loggedInRef.current;
    loggedInRef.current = account;
    setLoggedIn(account);
    if (wasAccount && !account) {
      readIdsRef.current = new Set();
      pendingReadIdsRef.current = new Set();
    }
    const pulled = await pullMessageCenter({ locale, loggedIn: account });
    if (requestId !== syncRequestIdRef.current) return;
    const serverReadIds = new Set(pulled.filter((message) => Boolean(message.readAt)).map((message) => message.id));
    if (account) {
      pendingReadIdsRef.current = new Set(
        [...pendingReadIdsRef.current].filter((messageId) => !serverReadIds.has(messageId)),
      );
    }
    const overlayReadIds = new Set([
      ...serverReadIds,
      ...(account ? pendingReadIdsRef.current : []),
      ...(!account ? readIdsRef.current : []),
    ]);
    const merged = pulled.map((message) => ({
      ...message,
      readAt: message.readAt ?? (overlayReadIds.has(message.id) ? new Date().toISOString() : null),
    }));
    // A sign-out/sign-in landed while this was in flight: the response
    // describes an authority that is no longer current, so it may neither be
    // committed nor published as a snapshot.
    if (currentWorkspaceAccountGeneration() !== issuedAccountGeneration) return;
    if (account) clearAnonymousState(window.localStorage);
    commitState(merged, overlayReadIds, { persistAnonymous: !account });
    // Component state above is this host's own business and its own request id
    // already ordered it. The snapshot is shared, so it is published only by
    // the newest run: a later run has strictly fresher rows, and if it fails
    // the absent snapshot simply sends the next mount to the network.
    if (writeToken === snapshotWriteToken) {
      lastSyncSnapshot = {
        at: Date.now(),
        accountGeneration: issuedAccountGeneration,
        locale,
        loggedIn: account,
        messages: merged,
        readIds: overlayReadIds,
      };
    }
    setSyncState('ready');
  }, [commitState, locale]);

  const resolveLoggedInForWrite = useCallback(async () => {
    const account = await isAmrLoggedIn();
    loggedInRef.current = account;
    setLoggedIn(account);
    return account;
  }, []);

  const retrySync = useCallback(() => {
    // Publish the run so a mount that lands mid-flight can wait for it instead
    // of starting a second identical sync. Keyed by the account boundary it was
    // started under, so a post-boundary mount never joins pre-boundary work.
    const generation = currentWorkspaceAccountGeneration();
    const entry: { generation: number; locale: string; run: Promise<void> } = {
      generation,
      locale,
      run: Promise.resolve(),
    };
    entry.run = sync()
      .catch(() => setSyncState('error'))
      .finally(() => {
        if (inFlightSync === entry) inFlightSync = null;
      });
    inFlightSync = entry;
    void entry.run;
  }, [sync]);

  const invalidateSyncResponses = useCallback(() => {
    syncRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    commitState(
      readAnonymousMessages(window.localStorage),
      readAnonymousReadIds(window.localStorage),
    );
  }, [commitState]);

  useEffect(() => {
    // A remount that lands within the window adopts what the previous mount
    // already fetched; everything else below still goes to the network.
    let cancelled = false;
    const adopt = (snapshot: NonNullable<typeof lastSyncSnapshot>) => {
      if (cancelled) return;
      loggedInRef.current = snapshot.loggedIn;
      setLoggedIn(snapshot.loggedIn);
      commitState(snapshot.messages, snapshot.readIds);
      setSyncState('ready');
    };
    const adopted = adoptableSnapshot(locale);
    if (adopted) {
      adopt(adopted);
    } else if (
      inFlightSync
      && inFlightSync.generation === currentWorkspaceAccountGeneration()
      && inFlightSync.locale === locale
    ) {
      // Someone else's sync is already on the wire for this same data and the
      // same account; take its result rather than racing a second copy of it.
      if (messagesRef.current.length === 0) setSyncState('loading');
      void inFlightSync.run.then(() => {
        const settled = adoptableSnapshot(locale);
        if (settled) adopt(settled);
        else if (!cancelled) retrySync();
      });
    } else {
      retrySync();
    }
    const interval = window.setInterval(retrySync, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retrySync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [retrySync, commitState, locale]);

  useEffect(() => {
    if (open) retrySync();
  }, [open, retrySync]);

  const unreadCount = messages.filter((message) => !message.readAt).length;

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [unreadCount, onUnreadCountChange]);

  /** The control keyboard focus must land on after the panel closes. Opening
   *  focuses the portaled dialog, so closing always unmounts the focused node —
   *  without a target here focus falls to the document and the user loses their
   *  place in the rail. The built-in bell owns it by default; under
   *  `hideTrigger` that button does not exist and the host's opener does. */
  const returnFocusTarget = (): HTMLElement | null =>
    triggerRef.current ?? returnFocusRef?.current ?? null;

  const closePanel = () => {
    setOpen(false);
    returnFocusTarget()?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markRead = async (messageId: string) => {
    const message = messagesRef.current.find((item) => item.id === messageId);
    if (!message || message.readAt) return;
    // Same rule as `sync`: capture the boundary this action began under. Two
    // awaits follow, and if a sign-out/sign-in lands across them this write
    // describes an account that is no longer current — it may not reach
    // component state, and it certainly may not stamp its rows over a snapshot
    // the new account has already published.
    const issuedAccountGeneration = currentWorkspaceAccountGeneration();
    const account = await resolveLoggedInForWrite();
    if (currentWorkspaceAccountGeneration() !== issuedAccountGeneration) return;
    const readAt = new Date().toISOString();
    const snapshotAtIssue = lastSyncSnapshot;
    if (account) await markAccountMessageRead(messageId);
    // Immediately after the await, before ANY mutation. Bailing out further
    // down was too late: `pendingReadIdsRef` had already taken the old
    // account's message id — which the next sync replays, marking a
    // same-id message read for whoever signed in — and the anonymous cache
    // had already been cleared on the way out of a signed-in session.
    if (currentWorkspaceAccountGeneration() !== issuedAccountGeneration) return;
    const nextIds = new Set(readIdsRef.current).add(messageId);
    const nextMessages = messagesRef.current.map((item) => (item.id === messageId ? { ...item, readAt } : item));
    if (account) {
      pendingReadIdsRef.current = new Set(pendingReadIdsRef.current).add(messageId);
      clearAnonymousState(window.localStorage);
    }
    invalidateSyncResponses();
    commitState(nextMessages, nextIds, { persistAnonymous: !account });
    // Keep the cross-mount snapshot consistent with what the user just did.
    // Without this a remount inside the window adopts the pre-read rows and the
    // unread count comes back until the next network sync. The timestamp is
    // deliberately left alone: the underlying fetch is no fresher than it was.
    //
    // Matched against the CAPTURED generation, not the current one, so this can
    // only ever update a snapshot belonging to the same account this read began
    // under — never one a newer account published while the write was pending.
    // Identity, not just shape: `nextMessages` is derived from the rows this
    // read began on, so patching a snapshot some sync published in the
    // meantime would drop that sync's newer rows.
    if (
      lastSyncSnapshot
      && lastSyncSnapshot === snapshotAtIssue
      && lastSyncSnapshot.accountGeneration === issuedAccountGeneration
      && lastSyncSnapshot.locale === locale
    ) {
      lastSyncSnapshot = { ...lastSyncSnapshot, messages: nextMessages, readIds: nextIds };
    }
  };

  const openLabel = unreadCount > 0 ? `${t('messageCenter.openAria')} (${t('messageCenter.unreadCount', { count: unreadCount })})` : t('messageCenter.openAria');

  return <div className={styles.root}>
    {hideTrigger ? null : <button ref={triggerRef} type="button" className={`settings-icon-btn od-tooltip ${styles.trigger}`} onClick={() => setOpen(!open)} title={t('messageCenter.openAria')} data-tooltip={t('messageCenter.openAria')} data-tooltip-placement="bottom" aria-label={openLabel} aria-haspopup="dialog" aria-expanded={open} data-testid="message-center-trigger">
      <Icon name="bell" size={17} />{unreadCount > 0 ? <span className={styles.badge} aria-hidden>{unreadBadgeLabel(unreadCount)}</span> : null}
    </button>}
    {open ? createPortal(<div className={styles.backdrop} data-testid="message-center-backdrop"><aside ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="message-center-dialog">
      <header className={styles.header}><div className={styles.headerCopy}><h2 id={titleId}>{t('messageCenter.title')}</h2><p>{t('messageCenter.subtitle')}</p></div><Button size="icon" className={styles.close} onClick={closePanel} aria-label={t('messageCenter.close')}><Icon name="close" size={18} strokeWidth={2}/></Button></header>
      <div className={styles.list} aria-live="polite">
        {syncState === 'error' && messages.length > 0 ? (
          <div className={styles.syncStatus} role="status">
            <span>{t('settings.updateStatusFailed')}</span>
            <button type="button" onClick={retrySync}>
              {t('settings.updateRetry')}
            </button>
          </div>
        ) : null}
        {syncState === 'loading' && messages.length === 0 ? (
          <div className={styles.empty} role="status">
            <Icon name="spinner" size={20} className="icon-spin" />
            <strong>{t('settings.updateStatusChecking')}</strong>
          </div>
        ) : syncState === 'error' && messages.length === 0 ? (
          <div className={styles.empty}>
            <Icon name="bell" size={20}/>
            <div className={styles.emptyError} role="status">
              <span>{t('settings.updateStatusFailed')}</span>
              <button type="button" onClick={retrySync}>
                {t('settings.updateRetry')}
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? <div className={styles.empty}><Icon name="bell" size={20}/><strong>{t('messageCenter.emptyAllTitle')}</strong><p>{t('messageCenter.emptyBody')}</p></div> : messages.map((message) => <MessageItem key={message.id} locale={locale} message={message} onRead={markRead} onError={() => setSyncState('error')}/>)}
      </div>
      <footer className={styles.footer}><p>{t('messageCenter.desktopSettingsHint')}</p>{onOpenNotificationSettings ? <Button variant="ghost" onClick={() => { closePanel(); onOpenNotificationSettings(); }}>{t('messageCenter.desktopSettings')}</Button> : null}</footer>
    </aside></div>, document.body) : null}
  </div>;
}

function MessageItem({
  locale,
  message,
  onRead,
  onError,
}: {
  locale: Locale;
  message: MessageCenterMessage;
  onRead: (id: string) => Promise<void>;
  onError: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatPublishedDate(message.publishedAt, locale);
  const ctaUrl = safeExternalUrl(message.ctaUrl);
  return <article className={`${styles.item}${message.readAt ? '' : ` ${styles.itemUnread}`}${expanded ? ` ${styles.itemExpanded}` : ''}`}>
    <button type="button" className={styles.itemSummary} aria-expanded={expanded} onClick={() => { setExpanded((value) => !value); void onRead(message.id).catch(onError); }}><span className={styles.itemMeta}><span>{message.typeName}</span>{formatted ? <time dateTime={message.publishedAt}>{formatted}</time> : null}</span><strong>{message.title}</strong><span className={styles.bodyPreview}>{message.body}</span></button>
    {expanded && message.ctaLabel && ctaUrl ? <div className={styles.itemActions}><button type="button" className={styles.primaryAction} onClick={() => window.open(ctaUrl, '_blank', 'noopener,noreferrer')}>{message.ctaLabel}</button></div> : null}
  </article>;
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
