/** @module runtimes/acp-handshake-failure
 * Recognises an ACP *handshake* rejection — the agent CLI answered
 * `initialize` and then refused to open a session — and turns it into copy the
 * user can act on.
 *
 * `agent-protocol/acp/session.ts` numbers the handshake deterministically:
 * request id 1 is `initialize`, id 2 is `session/new` (or `session/load` when
 * resuming), and ids from 3 up belong to model selection and `session/prompt`.
 * So a JSON-RPC error carrying id 1 or 2 is, by construction, a handshake
 * failure: nothing has streamed yet, and the same CLI build will refuse the
 * same request again — retrying only makes the user wait for an identical
 * error. Anything numbered 3 or higher happened after a session existed and
 * keeps the old transient treatment.
 *
 * The raw `json-rpc id N: …` line stays inside the rewritten message on
 * purpose. `run.error` is both what the user reads and what
 * `run-failure-classification.ts` reads, so dropping the raw line would
 * silently degrade the telemetry shape to `unknown` and make this class of
 * failure untriageable in aggregate.
 *
 * Deliberately carries no list of known-bad CLI versions: which versions are
 * blocked is a product decision, so the copy stays generic and reports only
 * the version the daemon actually detected.
 */

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
 * handshake, i.e. before any session existed.
 *
 * @param text - Failure text as surfaced by the ACP session.
 */
export function isAcpHandshakeRpcErrorText(text: string | null | undefined): boolean {
  const id = acpRpcErrorId(text);
  return id !== null && id >= 1 && id <= ACP_HANDSHAKE_MAX_RPC_ID;
}

/** Runtime identity the failure copy leads with. */
export interface AcpAgentIdentity {
  /** Display name of the runtime (`RuntimeAgentDef.name`), when known. */
  agentName?: string | null;
  /** CLI version the daemon detected for this run, when known. */
  agentCliVersion?: string | null;
}

export interface AcpHandshakeFailureMessageInput extends AcpAgentIdentity {
  /** The raw agent line (`json-rpc id 2: Internal error`), kept verbatim in the result. */
  rawMessage: string;
}

function readable(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Builds the user-facing message for an ACP handshake rejection: what the CLI
 * did, the version that did it, and the one action that resolves it.
 *
 * @param input - Raw agent line plus whatever identity the daemon detected.
 * @returns A single-paragraph message that still embeds the raw agent line.
 */
export function buildAcpHandshakeFailureMessage(
  input: AcpHandshakeFailureMessageInput,
): string {
  const name = readable(input.agentName);
  const version = readable(input.agentCliVersion);
  const subject = name ? `The ${name}` : 'The agent CLI';
  const versioned = version ? `${subject} (${version})` : subject;
  const raw = readable(input.rawMessage);
  const details = raw ? ` Details: ${raw}` : '';
  return (
    `${versioned} accepted the connection but refused to start a session. ` +
    'This usually means the installed CLI version is not compatible with the ' +
    'session request it received. Update the CLI, or reinstall a version that ' +
    `worked before, then retry.${details}`
  );
}

/** The failure frame `agent-protocol/acp/session.ts` puts on `send('error', …)`. */
interface AcpErrorFrame {
  message?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * Invariant: no ACP handshake rejection leaves the daemon still reading as a
 * bare JSON-RPC frame.
 *
 * `attachAcpSession` hands its failure payload to the caller's
 * `send('error', payload)`, and in server.ts that one payload feeds BOTH
 * user-facing surfaces at once: it is streamed to SSE clients verbatim, and
 * `design.runs.emit` reads `error.message ?? message` out of it to populate
 * `run.error`. The close handler that runs afterwards short-circuits on
 * `hasFatalError()`, so nothing downstream gets a second chance to explain the
 * failure — the payload is the last point where both surfaces can be corrected
 * together.
 *
 * Rewrites only the message fields, and only for a handshake-numbered JSON-RPC
 * error. Every other payload is returned by identity, so structured failures
 * (`AMR_MODEL_UNAVAILABLE`, promoted opencode errors) and post-session protocol
 * errors keep the exact shape their own handling depends on.
 *
 * @param payload - The raw ACP error payload, forwarded unchanged when it is not a handshake rejection.
 * @param identity - Runtime name and detected CLI version to lead the copy with.
 * @returns The payload to send, with `message` / `error.message` explained when applicable.
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
  if (!rawMessage || !isAcpHandshakeRpcErrorText(rawMessage)) return payload;

  const explained = buildAcpHandshakeFailureMessage({ rawMessage, ...identity });
  return {
    ...frame,
    ...(typeof frame.message === 'string' ? { message: explained } : {}),
    ...(nested ? { error: { ...nested, message: explained } } : {}),
  };
}
