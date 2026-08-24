import { describe, expect, it } from 'vitest';

import {
  acpRpcErrorId,
  buildAcpHandshakeFailureMessage,
  isAcpCliSessionRefusalText,
  isAcpHandshakeRpcErrorText,
  withAcpHandshakeFailureGuidance,
} from '../src/runtimes/acp-handshake-failure.js';
import { classifyRunFailure } from '../src/run-failure-classification.js';
import { decideSafeRunRetry } from '../src/run-retry-policy.js';

function classify(errorCode: string | null, error: string) {
  return classifyRunFailure({
    result: 'failed',
    status: { status: 'failed', error, errorCode },
    ...(errorCode ? { errorCode } : {}),
    agentId: 'kimi',
  });
}

function retryDecisionFor(error: string) {
  const failure = classify('AGENT_EXECUTION_FAILED', error);
  return decideSafeRunRetry({
    result: 'failed',
    attemptCount: 0,
    failure: {
      ...(failure?.failure_category ? { failure_category: failure.failure_category } : {}),
      ...(failure?.failure_detail ? { failure_detail: failure.failure_detail } : {}),
      ...(failure?.failure_stage ? { failure_stage: failure.failure_stage } : {}),
      ...(failure ? { retryable: failure.retryable } : {}),
    },
    sideEffects: {},
    random: () => 0,
  });
}

describe('acpRpcErrorId', () => {
  it('reads the request id out of an ACP JSON-RPC error line', () => {
    expect(acpRpcErrorId('json-rpc id 2: Internal error')).toBe(2);
    expect(acpRpcErrorId('json-rpc id 11: Internal error')).toBe(11);
    expect(acpRpcErrorId('ACP session exited before completion (code=1, signal=none)')).toBeNull();
    expect(acpRpcErrorId('')).toBeNull();
  });

  it('treats only the two handshake requests as handshake failures', () => {
    // session.ts numbers `initialize` 1 and `session/new` / `session/load` 2;
    // model selection and `session/prompt` take 3 and up.
    expect(isAcpHandshakeRpcErrorText('json-rpc id 1: Internal error')).toBe(true);
    expect(isAcpHandshakeRpcErrorText('json-rpc id 2: Internal error')).toBe(true);
    expect(isAcpHandshakeRpcErrorText('json-rpc id 3: Internal error')).toBe(false);
    expect(isAcpHandshakeRpcErrorText('json-rpc id 12: Internal error')).toBe(false);
    expect(isAcpHandshakeRpcErrorText('thread/start failed')).toBe(false);
  });
});

describe('buildAcpHandshakeFailureMessage', () => {
  it('names the CLI and its detected version, and says what to do', () => {
    const message = buildAcpHandshakeFailureMessage({
      rawMessage: 'json-rpc id 2: Internal error',
      agentName: 'Kimi CLI',
      agentCliVersion: '0.38.0',
    });
    expect(message).toContain('Kimi CLI');
    expect(message).toContain('0.38.0');
    expect(message).toMatch(/refused to start a session/i);
    expect(message).toMatch(/update the cli/i);
    // No hardcoded known-bad version list in product copy — which versions are
    // blocked is a product decision, not a daemon constant.
    expect(message).not.toMatch(/0\.37/);
  });

  it('degrades cleanly when the agent name or version is unknown', () => {
    const message = buildAcpHandshakeFailureMessage({
      rawMessage: 'json-rpc id 2: Internal error',
    });
    expect(message).toMatch(/agent cli/i);
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('null');
    expect(message).not.toContain('()');
  });

  it('keeps the raw JSON-RPC text so classification and triage still see it', () => {
    const message = buildAcpHandshakeFailureMessage({
      rawMessage: 'json-rpc id 2: Internal error',
      agentName: 'Kimi CLI',
      agentCliVersion: '0.38.0',
    });
    expect(message).toContain('json-rpc id 2: Internal error');
    // The rewritten user-facing message is what lands in `run.error`, which is
    // the very text `classifyRunFailure` reads. Embedding the raw line keeps
    // the telemetry shape identical instead of degrading it to `unknown`.
    const failure = classify('AGENT_EXECUTION_FAILED', message);
    expect(failure).toMatchObject({
      failure_category: 'process_exit',
      failure_detail: 'agent_protocol_error',
      failure_stage: 'session_init',
    });
  });
});

describe('ACP handshake rejection classification', () => {
  it('attributes a handshake JSON-RPC error to session_init and asks for a CLI fix', () => {
    expect(classify('AGENT_EXECUTION_FAILED', 'json-rpc id 2: Internal error')).toMatchObject({
      failure_category: 'process_exit',
      failure_detail: 'agent_protocol_error',
      failure_stage: 'session_init',
      user_action: 'install_cli',
    });
  });

  it('leaves a prompt-time protocol error on child_close', () => {
    expect(classify('AGENT_EXECUTION_FAILED', 'json-rpc id 4: Internal error')).toMatchObject({
      failure_category: 'process_exit',
      failure_detail: 'agent_protocol_error',
      failure_stage: 'child_close',
      user_action: 'retry',
    });
  });
});

describe('ACP handshake rejection retry policy', () => {
  it('does not retry a handshake rejection — the same CLI refuses again', () => {
    const decision = retryDecisionFor('json-rpc id 2: Internal error');
    expect(decision.shouldRetry).toBe(false);
    // Classification already marks the handshake rejection non-retryable, so
    // that is the reason recorded end to end.
    expect(decision).toMatchObject({ retrySuppressedReason: 'not_retryable' });
  });

  it('suppresses on the stage even when the agent claims the error is retryable', () => {
    // Second layer: `rpcErrorRetryable(details)` lets an agent mark its own
    // JSON-RPC error retryable. The policy must still refuse a handshake-stage
    // protocol error, otherwise a CLI that lies about retryability re-creates
    // the endless-retry loop this fix removes.
    const decision = decideSafeRunRetry({
      result: 'failed',
      attemptCount: 0,
      failure: {
        failure_category: 'process_exit',
        failure_detail: 'agent_protocol_error',
        failure_stage: 'session_init',
        retryable: true,
      },
      random: () => 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision).toMatchObject({ retrySuppressedReason: 'unsafe_failure_stage' });
  });

  it('still retries protocol errors that are not the handshake', () => {
    expect(retryDecisionFor('json-rpc id 4: Internal error').shouldRetry).toBe(true);
    expect(
      retryDecisionFor('ACP session exited before completion (code=1, signal=none)').shouldRetry,
    ).toBe(true);
  });

  it('keeps every other transient process-exit detail retryable', () => {
    for (const failure_detail of [
      'qoder_stop_sequence',
      'session_resume_expired',
      'stream_error',
      'fatal_rpc_error',
    ] as const) {
      expect(
        decideSafeRunRetry({
          result: 'failed',
          attemptCount: 0,
          failure: {
            failure_category: 'process_exit',
            failure_detail,
            failure_stage: 'session_init',
            retryable: true,
          },
          random: () => 0,
        }).shouldRetry,
      ).toBe(true);
    }
  });
});

// Found by running a real Kimi CLI in an unauthenticated state, not by reading
// the code: the CLI answers `initialize`, then rejects `session/new` with
// `json-rpc id 2: Authentication required`. Because the handshake reading keyed
// on the JSON-RPC id alone, that user was told to update or reinstall a CLI
// that was working fine — the one thing they needed to do was sign in.
//
// Everything in this block is a handshake-numbered failure. What separates
// these from the CLI-refusal shape above is not *when* they happened but
// *why*: each names a cause with its own remedy.
describe('handshake failures that name their own remedy', () => {
  const AUTH_REQUIRED = 'json-rpc id 2: Authentication required';
  const UNAUTHORIZED = 'json-rpc id 1: HTTP 401 Unauthorized';
  const RATE_LIMITED = 'json-rpc id 2: rate limit exceeded';
  const NO_BALANCE = 'json-rpc id 2: insufficient balance';
  const UPSTREAM_DOWN = 'json-rpc id 2: HTTP 503 Service Unavailable';
  const REMEDIED = [AUTH_REQUIRED, UNAUTHORIZED, RATE_LIMITED, NO_BALANCE, UPSTREAM_DOWN];

  it.each(REMEDIED)('is still recognised as handshake-stage: %s', (raw) => {
    // The id question and the cause question are separate. These all happened
    // inside the handshake; none of them is the CLI refusing on its own.
    expect(isAcpHandshakeRpcErrorText(raw)).toBe(true);
    expect(isAcpCliSessionRefusalText(raw)).toBe(false);
  });

  it.each(REMEDIED)('leaves the agent error intact: %s', (raw) => {
    const payload = withAcpHandshakeFailureGuidance(
      { message: raw, error: { code: 'AGENT_EXECUTION_FAILED', message: raw } },
      { agentName: 'Kimi CLI', agentCliVersion: '0.38.0' },
    ) as { message: string; error: { message: string } };
    expect(payload.message).toBe(raw);
    expect(payload.error.message).toBe(raw);
  });

  it.each(REMEDIED)('never prescribes a CLI upgrade for: %s', (raw) => {
    const payload = withAcpHandshakeFailureGuidance({ message: raw }) as { message: string };
    expect(payload.message).not.toMatch(/update the cli/i);
    expect(payload.message).not.toMatch(/refused to start a session/i);
  });

  it('files an unauthenticated handshake under auth rather than install_cli', () => {
    expect(classify('AGENT_EXECUTION_FAILED', AUTH_REQUIRED)).toMatchObject({
      failure_category: 'auth',
      user_action: 'login',
    });
    // …including when the CLI wraps the reason in a JSON-RPC `Internal error`
    // envelope, which is the shape `isAgentProtocolErrorText` matches. Before,
    // the envelope won and the run was filed as a CLI-install problem.
    expect(
      classify('AGENT_EXECUTION_FAILED', 'json-rpc id 2: Internal error: 401 Unauthorized'),
    ).toMatchObject({
      failure_category: 'auth',
      user_action: 'login',
    });
  });

  it('files a throttled handshake under rate_limit rather than install_cli', () => {
    expect(
      classify('AGENT_EXECUTION_FAILED', 'json-rpc id 2: Internal error: 429 rate limit exceeded'),
    ).toMatchObject({ failure_category: 'rate_limit' });
  });

  it('does not retry a signed-out handshake either', () => {
    // Suppressed as an auth failure rather than as a handshake rejection —
    // a different, more accurate reason for the same outcome. Re-running while
    // still signed out would reproduce it just as reliably.
    const decision = retryDecisionFor(AUTH_REQUIRED);
    expect(decision.shouldRetry).toBe(false);
    expect(decision).toMatchObject({ retrySuppressedReason: 'non_retryable_category' });
  });

  it('still answers a bare CLI refusal with the upgrade guidance', () => {
    // A CLI that answered `initialize` and then rejected the session with a
    // bare protocol error, or with a method it does not implement, has told us
    // nothing except that this build cannot do it. That is the case the
    // upgrade copy was written for, and it is unchanged.
    for (const raw of [
      'json-rpc id 1: Internal error',
      'json-rpc id 2: Internal error',
      'json-rpc id 2: Method not found',
      'json-rpc id 2: Invalid params',
    ]) {
      expect(isAcpCliSessionRefusalText(raw)).toBe(true);
    }
    // …and a post-session error is still none of this module's business.
    expect(isAcpCliSessionRefusalText('json-rpc id 4: Internal error')).toBe(false);
    expect(isAcpHandshakeRpcErrorText('json-rpc id 4: Internal error')).toBe(false);

    const payload = withAcpHandshakeFailureGuidance(
      { message: 'json-rpc id 2: Internal error' },
      { agentName: 'Kimi CLI', agentCliVersion: '0.38.0' },
    ) as { message: string };
    expect(payload.message).toMatch(/refused to start a session/i);
    expect(payload.message).toContain('json-rpc id 2: Internal error');
    expect(
      classify('AGENT_EXECUTION_FAILED', 'json-rpc id 2: Internal error'),
    ).toMatchObject({
      failure_category: 'process_exit',
      failure_stage: 'session_init',
      user_action: 'install_cli',
    });
  });
});
