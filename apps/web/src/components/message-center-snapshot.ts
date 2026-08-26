// Module-scope state shared by every MessageCenter host.
//
// It lives in its own module for two reasons. The first is the convention the
// test setup already follows: every other module-level cache it resets
// (`coalesced-get`, `team-members-store`, `project-cover-cache`, …) is a small
// dedicated module, so the global setup never has to import a component. When
// this state sat inside `MessageCenter.tsx`, that import pulled the whole
// component tree into every test file's registry BEFORE their `vi.mock` calls
// applied — which silently defeated the analytics mock in the Go Plan sunset
// dialog's specs the moment `MessageCenter` began importing that dialog.
//
// The second is that the shared/host-local boundary is the thing this
// component keeps getting wrong. Refs and React state belong to one host and
// are ordered by its own request id; everything in THIS file is shared across
// hosts and outlives all of them, so it needs global ordering. Putting the two
// kinds in different files makes the question "is this shared?" answerable by
// looking at where the value is declared.

import { currentWorkspaceAccountGeneration } from '../collab/workspace-identity';
import type { MessageCenterMessage } from '../message-center-client';

/** How long a settled sync may satisfy a fresh mount. */
const MOUNT_SNAPSHOT_WINDOW_MS = 10_000;

export interface MessageCenterSnapshot {
  at: number;
  accountGeneration: number;
  /** `pullMessageCenter` asks for locale-specific fields, so a snapshot is only
   *  valid for the language it was fetched under. */
  locale: string;
  loggedIn: boolean;
  messages: MessageCenterMessage[];
  readIds: Set<string>;
  /**
   * The optimistic reads not yet visible in the server's projection. Adopting
   * a snapshot restores `readIdsRef`, but a signed-in sync builds its overlay
   * from `serverReadIds` plus `pendingReadIdsRef` and never consults
   * `readIdsRef` — so without carrying these, a remount inside the window
   * followed by any refresh drops them and marks a just-read row unread again,
   * which is the exact regression the pending set exists to prevent.
   */
  pendingReadIds: Set<string>;
}

export interface MessageCenterInFlightSync {
  generation: number;
  locale: string;
  run: Promise<void>;
}

let lastSyncSnapshot: MessageCenterSnapshot | null = null;

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
let inFlightSync: MessageCenterInFlightSync | null = null;

/**
 * Orders snapshot PUBLICATION across every host, which a component's own
 * request-id ref cannot: that ref lives on one component, so a host which has
 * since unmounted still matches its own counter forever. Rail and account
 * cluster swap on a route change, so a slow pull issued by the host that went
 * away resolves with its request id, account generation and locale all still
 * valid — and would write its older rows over the snapshot its successor
 * already published, which the next remount then adopts. Only the newest
 * issued run may publish.
 */
let snapshotWriteToken = 0;

/** Test hook: module state must not leak between cases. */
export function resetMessageCenterSnapshot(): void {
  lastSyncSnapshot = null;
  inFlightSync = null;
  snapshotWriteToken = 0;
  readListeners.clear();
}

/** Claim a publication slot. Taken when a run is ISSUED, not when it lands. */
export function issueSnapshotWriteToken(): number {
  snapshotWriteToken += 1;
  return snapshotWriteToken;
}

/** Whether the run holding `token` is still the newest issued one. */
export function ownsLatestSnapshotWrite(token: number): boolean {
  return token === snapshotWriteToken;
}

/**
 * Bar every run issued before now from publishing. A durable read outranks
 * pulls that were already in flight when the user made it: they carry pre-read
 * rows, and a component's own request-id invalidation only covers its own.
 */
export function supersedeEarlierSnapshotWrites(): void {
  snapshotWriteToken += 1;
}

export function publishSnapshot(next: MessageCenterSnapshot): void {
  lastSyncSnapshot = next;
}

/**
 * The snapshot a fresh mount may adopt: same account, same language, and young
 * enough that the network could not meaningfully disagree with it.
 */
export function adoptableSnapshot(locale: string): MessageCenterSnapshot | null {
  const snapshot = lastSyncSnapshot;
  if (!snapshot) return null;
  if (snapshot.accountGeneration !== currentWorkspaceAccountGeneration()) return null;
  if (snapshot.locale !== locale) return null;
  if (Date.now() - snapshot.at >= MOUNT_SNAPSHOT_WINDOW_MS) return null;
  return snapshot;
}

/**
 * A durable read, broadcast to every mounted host.
 *
 * Patching the shared snapshot only helps hosts that adopt it AFTERWARDS. A
 * successor that mounted while the read was still in flight has already
 * rendered from the pre-read snapshot and finished its mount effect, so the row
 * stayed unread on screen until an open, a visibility refresh or the 60s poll —
 * which is exactly the guarantee a remount is supposed to preserve.
 *
 * Broadcasting is safe because a read is monotonic: a row only ever goes from
 * unread to read, so applying the delta late, twice, or to a host that already
 * has it are all no-ops.
 */
export interface MessageCenterReadDelta {
  messageId: string;
  readAt: string;
  accountGeneration: number;
  locale: string;
  account: boolean;
}

const readListeners = new Set<(delta: MessageCenterReadDelta) => void>();

export function subscribeMessageCenterReads(
  listener: (delta: MessageCenterReadDelta) => void,
): () => void {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

/**
 * Record a read against the current snapshot as a DELTA.
 *
 * Writing a host's whole row set here would drop rows a sync published in the
 * meantime, and guarding that with snapshot identity made concurrent reads lose
 * each other — two quick clicks capture the same snapshot, the first replaces
 * it, and the second finds the identity no longer matching and records nothing.
 * Adding one id needs neither guard. The timestamp is deliberately untouched:
 * the underlying fetch is no fresher than it was.
 */
export function recordSnapshotRead(args: MessageCenterReadDelta): void {
  // Announced before the snapshot work and regardless of whether a snapshot
  // exists: the delta is about the READ, and a host that fetched its own rows
  // needs it just as much as one that adopted.
  for (const listener of [...readListeners]) {
    try {
      listener(args);
    } catch (error) {
      console.error('[message-center] read-delta subscriber failed', error);
    }
  }
  const snapshot = lastSyncSnapshot;
  if (!snapshot) return;
  // Matched against the generation the read BEGAN under, so this can only ever
  // update a snapshot belonging to that account.
  if (snapshot.accountGeneration !== args.accountGeneration) return;
  if (snapshot.locale !== args.locale) return;
  lastSyncSnapshot = {
    ...snapshot,
    messages: snapshot.messages.map((item) => (
      item.id === args.messageId ? { ...item, readAt: item.readAt ?? args.readAt } : item
    )),
    readIds: new Set(snapshot.readIds).add(args.messageId),
    pendingReadIds: args.account
      ? new Set(snapshot.pendingReadIds).add(args.messageId)
      : snapshot.pendingReadIds,
  };
}

/** The in-flight sync a mount may wait on instead of starting its own. */
export function joinableSync(locale: string): MessageCenterInFlightSync | null {
  if (!inFlightSync) return null;
  if (inFlightSync.generation !== currentWorkspaceAccountGeneration()) return null;
  if (inFlightSync.locale !== locale) return null;
  return inFlightSync;
}

export function publishInFlightSync(entry: MessageCenterInFlightSync): void {
  inFlightSync = entry;
}

/** Retire an entry only if it is still the published one. */
export function retireInFlightSync(entry: MessageCenterInFlightSync): void {
  if (inFlightSync === entry) inFlightSync = null;
}
