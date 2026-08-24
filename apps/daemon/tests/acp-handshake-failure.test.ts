import { describe, expect, it } from 'vitest';

import {
  ACP_CLI_SESSION_REFUSED_CODE,
  acpRpcErrorId,
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

describe('withAcpHandshakeFailureGuidance', () => {
  const RAW = 'json-rpc id 2: Internal error';

  it('names the failure with a code and structured identity instead of a sentence', () => {
    const payload = withAcpHandshakeFailureGuidance(
      { message: RAW },
      { agentName: 'Kimi CLI', agentCliVersion: '0.38.0' },
    ) as {
      message: string;
      error: { code: string; message: string; retryable: boolean; details: Record<string, unknown> };
    };

    // A code crosses the daemon/web boundary; an English paragraph does not.
    // The web maps this code to localized copy (see amr-guidance.ts), so the
    // identity the copy interpolates has to travel as data, not as prose.
    expect(payload.error.code).toBe(ACP_CLI_SESSION_REFUSED_CODE);
    expect(payload.error.details).toMatchObject({
      kind: 'agent_cli',
      action: 'update_cli',
      agent: 'Kimi CLI',
      agentCliVersion: '0.38.0',
    });
    // A CLI build that refuses `session/new` refuses it again; the payload says so.
    expect(payload.error.retryable).toBe(false);
  });

  it('leaves the agent line verbatim on both message surfaces', () => {
    const payload = withAcpHandshakeFailureGuidance(
      { message: RAW, error: { code: 'AGENT_EXECUTION_FAILED', message: RAW } },
      { agentName: 'Kimi CLI', agentCliVersion: '0.38.0' },
    ) as { message: string; error: { message: string } };

    // `run.error` is read from `error.message ?? message` and is BOTH the
    // classifier's input and the text the card shows under 「查看错误详情」.
    // Appending a `Details:` restatement made the card print it twice.
    expect(payload.message).toBe(RAW);
    expect(payload.error.message).toBe(RAW);
    expect(JSON.stringify(payload)).not.toMatch(/Details:/i);
    expect(JSON.stringify(payload)).not.toMatch(/refused to start a session/i);
  });

  it('degrades cleanly when the agent name or version was never detected', () => {
    const payload = withAcpHandshakeFailureGuidance({ message: RAW }) as {
      error: { details: Record<string, unknown> };
    };
    expect(payload.error.details).toMatchObject({ kind: 'agent_cli', action: 'update_cli' });
    expect(payload.error.details).not.toHaveProperty('agent');
    expect(payload.error.details).not.toHaveProperty('agentCliVersion');
    expect(JSON.stringify(payload)).not.toContain('undefined');
    expect(JSON.stringify(payload)).not.toContain('null');
  });

  it('keeps the agent\'s own error data alongside the identity it adds', () => {
    const payload = withAcpHandshakeFailureGuidance(
      {
        message: RAW,
        error: { code: 'AGENT_EXECUTION_FAILED', message: RAW, details: { retryable: true } },
      },
      { agentName: 'Kimi CLI' },
    ) as { error: { details: Record<string, unknown> } };
    expect(payload.error.details).toMatchObject({
      retryable: true,
      kind: 'agent_cli',
      agent: 'Kimi CLI',
    });
  });

  it('keeps the raw line readable by the classifier', () => {
    const payload = withAcpHandshakeFailureGuidance({ message: RAW }) as {
      error: { message: string };
    };
    // Same text, same classification: naming the failure with a code must not
    // move it off `agent_protocol_error` / `session_init`.
    expect(
      classify(ACP_CLI_SESSION_REFUSED_CODE, payload.error.message),
    ).toMatchObject({
      failure_category: 'process_exit',
      failure_detail: 'agent_protocol_error',
      failure_stage: 'session_init',
      user_action: 'install_cli',
    });
  });

  it('leaves every non-refusal payload untouched by identity', () => {
    for (const raw of [
      'json-rpc id 4: Internal error',
      'ACP session exited before completion (code=1, signal=none)',
    ]) {
      const payload = withAcpHandshakeFailureGuidance(
        { message: raw },
        { agentName: 'Kimi CLI', agentCliVersion: '0.38.0' },
      );
      expect(payload).toEqual({ message: raw });
    }
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

  it.each(REMEDIED)('never files it as a CLI-version refusal: %s', (raw) => {
    // The whole card hangs off the code now, so a wrong code here would tell a
    // signed-out / throttled user to change their perfectly good CLI build.
    expect(withAcpHandshakeFailureGuidance({ message: raw })).toEqual({ message: raw });
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

  it('files the remaining named causes under the category that owns them', () => {
    expect(classify('AGENT_EXECUTION_FAILED', UNAUTHORIZED)).toMatchObject({
      failure_category: 'auth',
      user_action: 'login',
    });
    expect(classify('AGENT_EXECUTION_FAILED', RATE_LIMITED)).toMatchObject({
      failure_category: 'rate_limit',
    });
    expect(classify('AGENT_EXECUTION_FAILED', NO_BALANCE)).toMatchObject({
      failure_category: 'insufficient_balance',
    });
    expect(classify('AGENT_EXECUTION_FAILED', UPSTREAM_DOWN)).toMatchObject({
      failure_category: 'upstream_unavailable',
    });
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
    ) as { message: string; error: { code: string } };
    expect(payload.error.code).toBe(ACP_CLI_SESSION_REFUSED_CODE);
    expect(payload.message).toBe('json-rpc id 2: Internal error');
    expect(
      classify('AGENT_EXECUTION_FAILED', 'json-rpc id 2: Internal error'),
    ).toMatchObject({
      failure_category: 'process_exit',
      failure_stage: 'session_init',
      user_action: 'install_cli',
    });
  });
});
