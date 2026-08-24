/** @module runtimes/acp-handshake-failure
 * Recognises an ACP *handshake* rejection — the agent CLI answered
 * `initialize` and then refused to open a session — and NAMES it, so the
 * client can say what to do about it in the reader's own language.
 *
 * `agent-protocol/acp/session.ts` numbers the handshake deterministically:
 * request id 1 is `initialize`, id 2 is `session/new` (or `session/load` when
 * resuming), and ids from 3 up belong to model selection and `session/prompt`.
 * So a JSON-RPC error carrying id 1 or 2 is, by construction, a handshake
 * failure: nothing has streamed yet. Anything numbered 3 or higher happened
 * after a session existed and keeps the old transient treatment.
 *
 * The id answers *when* the failure happened, never *why* — so it alone can
 * never justify the verdict. A CLI that is signed out, throttled, or talking to
 * a dead upstream also fails inside the handshake, and telling that user to
 * change a perfectly good CLI sends them after the wrong fix.
 * `isAcpCliSessionRefusalText` is the predicate the verdict hangs off:
 * handshake numbering AND no cause with a remedy of its own.
 *
 * What this module does NOT do is write the sentence. The daemon has no locale
 * — a paragraph composed here lands verbatim in `run.error` and is rendered
 * verbatim by the chat, so a Chinese UI showed a Chinese title over an English
 * body, and the paragraph's own `Details: …` restatement printed the agent's
 * line a second time in a card that already shows it. Instead the failure
 * travels as `AGENT_CLI_SESSION_REFUSED` plus the runtime identity as
 * structured `details`, and `apps/web/src/runtime/amr-guidance.ts` maps that
 * code to localized copy.
 *
 * The raw `json-rpc id N: …` line is left untouched in the message fields on
 * purpose. `run.error` is both what the details block shows and what
 * `run-failure-classification.ts` reads, so rewriting it would silently degrade
 * the telemetry shape to `unknown` and make this class of failure untriageable
 * in aggregate.
 *
 * Deliberately carries no list of known-bad CLI versions: which versions are
 * blocked is a product decision, so the payload reports only the version the
 * daemon actually detected and leaves the wording to the client.
 */

import { classifyAgentServiceFailure } from './auth.js';

/** Highest JSON-RPC request id the ACP handshake can use (`initialize`, then `session/new` / `session/load`). */
export const ACP_HANDSHAKE_MAX_RPC_ID = 2;

/**
 * Reads the JSON-RPC request id out of an ACP failure line.
 *
 * @param text - Failure text as surfaced by the ACP session (`rpcErrorMessage`).
 * @returns The request id, or `null` when the text carries no `json-rpc id N:` prefix.
 */
export function acpRpcErrorId(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || !text) return null;
  const match = /\bjson-rpc id (\d+):/i.exec(text);
  if (!match?.[1]) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * True when a failure text is a JSON-RPC error raised during the ACP
 * handshake, i.e. before any session existed. Structural only: it reports
 * *when* the failure happened and says nothing about its cause.
 *
 * @param text - Failure text as surfaced by the ACP session.
 */
export function isAcpHandshakeRpcErrorText(text: string | null | undefined): boolean {
  const id = acpRpcErrorId(text);
  return id !== null && id >= 1 && id <= ACP_HANDSHAKE_MAX_RPC_ID;
}

/**
 * True when the handshake failure names a cause the user fixes some other way
 * — an expired credential, an exhausted quota, an upstream outage.
 *
 * Reuses `classifyAgentServiceFailure` instead of growing a second signature
 * list: it is agent-agnostic, covers exactly these three classes, and carries
 * its own suite. It is unrelated to `isCliNotInstalledText` in
 * `run-failure-classification.ts` and must stay narrower than it — that
 * predicate answers "was the binary even there", which a CLI that already
 * answered `initialize` has plainly settled.
 *
 * @param text - Failure text as surfaced by the ACP session.
 */
function handshakeFailureNamesItsOwnRemedy(text: string | null | undefined): boolean {
  return classifyAgentServiceFailure(typeof text === 'string' ? text : '') !== null;
}

/**
 * True when a handshake failure reads as the agent CLI itself refusing to open
 * a session: it answered `initialize`, rejected `session/new` / `session/load`,
 * and offered no cause of its own. That is the one shape "this CLI build cannot
 * start a session — change it, then retry" actually answers, because the build
 * is the only variable left. A handshake error that does name its cause keeps
 * that cause's own code, so the user reads the card that points at their real
 * fix.
 *
 * @param text - Failure text as surfaced by the ACP session.
 */
export function isAcpCliSessionRefusalText(text: string | null | undefined): boolean {
  return isAcpHandshakeRpcErrorText(text) && !handshakeFailureNamesItsOwnRemedy(text);
}

/**
 * Structured API error code for an ACP CLI that answered `initialize` and then
 * refused to open a session. The client owns the wording; this is the whole of
 * the daemon's verdict.
 */
export const ACP_CLI_SESSION_REFUSED_CODE = 'AGENT_CLI_SESSION_REFUSED';

/** Runtime identity the localized copy interpolates. */
export interface AcpAgentIdentity {
  /** Display name of the runtime (`RuntimeAgentDef.name`), when known. */
  agentName?: string | null;
  /** CLI version the daemon detected for this run, when known. */
  agentCliVersion?: string | null;
}

function readable(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The `details` bag a session refusal ships: what kind of thing failed, what
 * resolves it, and whichever identity the daemon actually detected.
 *
 * Mirrors the shape `createAmrModelUnavailablePayload` uses for
 * `AMR_MODEL_UNAVAILABLE` (`kind` / `action` / the one fact the copy names), so
 * a client reads every structured failure the same way. Undetected identity is
 * OMITTED rather than sent as null: the copy degrades to a version-less
 * sentence, and a client must never render the word "null" at a user.
 *
 * @param identity - Runtime name and detected CLI version, either possibly absent.
 * @param existing - The agent's own JSON-RPC `error.data`, preserved underneath.
 */
function acpCliSessionRefusalDetails(
  identity: AcpAgentIdentity,
  existing: unknown,
): Record<string, unknown> {
  const agent = readable(identity.agentName);
  const agentCliVersion = readable(identity.agentCliVersion);
  return {
    ...(existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}),
    kind: 'agent_cli',
    action: 'update_cli',
    ...(agent ? { agent } : {}),
    ...(agentCliVersion ? { agentCliVersion } : {}),
  };
}

/** The failure frame `agent-protocol/acp/session.ts` puts on `send('error', …)`. */
interface AcpErrorFrame {
  message?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * Invariant: no ACP handshake rejection leaves the daemon as an unnamed
 * JSON-RPC frame the client can only print raw.
 *
 * `attachAcpSession` hands its failure payload to the caller's
 * `send('error', payload)`, and in server.ts that one payload feeds BOTH
 * user-facing surfaces at once: it is streamed to SSE clients verbatim, and
 * `design.runs.emit` reads `error.message ?? message` and `error.code ?? code`
 * out of it to populate `run.error` / `run.errorCode`. The close handler that
 * runs afterwards short-circuits on `hasFatalError()`, so nothing downstream
 * gets a second chance to classify the failure — the payload is the last point
 * where both surfaces can be corrected together.
 *
 * Stamps only the structured half — code, retryability, identity — and only for
 * a handshake-numbered JSON-RPC error that named no cause of its own. The
 * message fields keep the agent's own line on both surfaces. Every other
 * payload is returned by identity, so structured failures
 * (`AMR_MODEL_UNAVAILABLE`, promoted opencode errors), post-session protocol
 * errors, and handshake errors that already say what went wrong
 * (`Authentication required`, a 429, an upstream 5xx) keep the exact shape and
 * code their own handling depends on.
 *
 * `retryable` is forced to false even when the agent claimed otherwise: a build
 * that refuses `session/new` refuses the identical request identically.
 *
 * @param payload - The raw ACP error payload, forwarded unchanged when it is not a handshake rejection.
 * @param identity - Runtime name and detected CLI version for the client's copy.
 * @returns The payload to send, carrying `AGENT_CLI_SESSION_REFUSED` when applicable.
 */
export function withAcpHandshakeFailureGuidance(
  payload: unknown,
  identity: AcpAgentIdentity = {},
): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const frame = payload as AcpErrorFrame;
  const nested =
    frame.error && typeof frame.error === 'object'
      ? (frame.error as Record<string, unknown>)
      : null;
  // Same precedence `extractErrorDetails` uses to fill `run.error`, so the text
  // matched here is the text the user would otherwise have been shown.
  const rawMessage =
    readable(typeof nested?.message === 'string' ? nested.message : null) ??
    readable(typeof frame.message === 'string' ? frame.message : null);
  if (!rawMessage || !isAcpCliSessionRefusalText(rawMessage)) return payload;

  return {
    ...frame,
    error: {
      ...(nested ?? {}),
      code: ACP_CLI_SESSION_REFUSED_CODE,
      message: rawMessage,
      retryable: false,
      details: acpCliSessionRefusalDetails(identity, nested?.details),
    },
  };
}
