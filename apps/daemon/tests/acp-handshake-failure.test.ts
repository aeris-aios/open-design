import { describe, expect, it } from 'vitest';

import {
  acpRpcErrorId,
  buildAcpHandshakeFailureMessage,
  isAcpHandshakeRpcErrorText,
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
