import type { ChatMessage } from '../types';
import type { RunFailureCategory, RunFailureDetail } from '@open-design/contracts';

export interface RunFailureClassificationFields {
  failureCategory?: RunFailureCategory | null;
  failureDetail?: RunFailureDetail | null;
  /** CLI build this run observed, for copy that names it (AGENT_CLI_SESSION_REFUSED). */
  agentCliVersion?: string | null;
}

function readAgentCliVersion(details: unknown): string | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const value = (details as { agentCliVersion?: unknown }).agentCliVersion;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Read the daemon-supplied failure facts the streaming layer stamped onto a
 *  surfaced run error — the classification from `markErrorRunFailure`, plus any
 *  structured `details` the SSE error frame carried (see daemonSseError in
 *  providers/daemon.ts). Returns undefined when the error carries none of them,
 *  so callers pass nothing through.
 *
 *  `agentCliVersion` rides along because the failure card's copy for a
 *  version-specific refusal has to name the build that refused, and the daemon
 *  sends that as data rather than as a pre-written sentence — a daemon-authored
 *  string never passes through i18n. */
export function runFailureFieldsFromError(
  err: unknown,
): RunFailureClassificationFields | undefined {
  const e = err as {
    failureCategory?: RunFailureCategory | null;
    failureDetail?: RunFailureDetail | null;
    details?: unknown;
  } | null;
  if (!e) return undefined;
  const agentCliVersion = readAgentCliVersion(e.details);
  if (!e.failureCategory && !e.failureDetail && !agentCliVersion) return undefined;
  return {
    ...(e.failureCategory ? { failureCategory: e.failureCategory } : {}),
    ...(e.failureDetail ? { failureDetail: e.failureDetail } : {}),
    ...(agentCliVersion ? { agentCliVersion } : {}),
  };
}

export function appendErrorStatusEvent(
  message: ChatMessage,
  detail: string,
  code?: string,
  failure?: RunFailureClassificationFields,
): ChatMessage {
  if (!detail.trim()) return message;
  const events = message.events ?? [];
  const lastIndex = events.length - 1;
  const last = events[lastIndex];
  if (last?.kind === 'status' && last.label === 'error' && last.detail === detail) {
    // The same terminal error is already recorded, but a later pass can bring
    // the finalize-time classification the first pass lacked — e.g. a reload
    // reads the daemon-persisted `error` frame, then the run finishes and
    // `onError` fires with `code` / `failureCategory` / `failureDetail`
    // attached. Merge those into the existing event instead of dropping them,
    // so the specific quota / CLI / long-tail card survives; no-op only when
    // the new pass adds nothing.
    const merged = {
      ...last,
      ...(code ? { code } : {}),
      ...(failure?.failureCategory ? { failureCategory: failure.failureCategory } : {}),
      ...(failure?.failureDetail ? { failureDetail: failure.failureDetail } : {}),
      ...(failure?.agentCliVersion ? { agentCliVersion: failure.agentCliVersion } : {}),
    };
    if (JSON.stringify(merged) === JSON.stringify(last)) return message;
    const nextEvents = events.slice();
    nextEvents[lastIndex] = merged;
    return { ...message, events: nextEvents };
  }
  return {
    ...message,
    events: [
      ...events,
      {
        kind: 'status',
        label: 'error',
        detail,
        ...(code ? { code } : {}),
        ...(failure?.failureCategory ? { failureCategory: failure.failureCategory } : {}),
        ...(failure?.failureDetail ? { failureDetail: failure.failureDetail } : {}),
        ...(failure?.agentCliVersion ? { agentCliVersion: failure.agentCliVersion } : {}),
      },
    ],
  };
}

export function removeErrorStatusEvent(
  message: ChatMessage,
  detail: string,
  code?: string,
): ChatMessage {
  if (!detail) return message;
  const events = message.events ?? [];
  const nextEvents = events.filter((event) => {
    if (event.kind !== 'status' || event.label !== 'error') return true;
    if (event.detail !== detail) return true;
    if (code !== undefined && event.code !== code) return true;
    return false;
  });
  if (nextEvents.length === events.length) return message;
  return {
    ...message,
    events: nextEvents,
  };
}
