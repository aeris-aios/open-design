import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// Wiring coverage for the ACP handshake-rejection guidance, driven through the
// FULL server run cycle rather than the pure helpers in isolation.
//
// The failure this pins down (Kimi Code 0.37.x / 0.38.0): the agent CLI answers
// `initialize`, then rejects `session/new` with a bare JSON-RPC `Internal
// error`. `attachAcpSession` turns that into `fail('json-rpc id 2: Internal
// error')`, whose payload the ACP `send` bridge in server.ts forwards to the
// SSE client verbatim; the close handler then short-circuits on
// `acpFatalErrorObservedBeforeCancellation && hasFatalError()`, well before the
// stderr-tail `rewriteKnownAgentStreamError` fallback further down.
//
// So a unit test over `buildAcpHandshakeFailureMessage` proves nothing about
// what the user reads. These tests assert on the two surfaces a user and the
// telemetry pipeline actually observe — the `error` SSE event recorded in the
// run's events log, and `run.error` on `GET /api/runs/:id` — plus the spawn
// count, which is what "stop retrying a deterministic failure" means in
// practice.

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  status: string;
  error: string | null;
  errorCode: string | null;
  eventsLogPath: string;
};

type RunEvent = { event: string; data: unknown };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_ACP_CLI = path.join(HERE, 'fixtures', 'fake-acp-handshake-cli.mjs');

/** The agent the reported users were actually running when this broke. */
const AGENT_ID = 'kimi';
const AGENT_BIN = 'kimi';
/** `kimiAgentDef.name` — the display name the guidance copy must lead with. */
const AGENT_DISPLAY_NAME = 'Kimi CLI';

describe('ACP handshake rejection — server wiring', () => {
  const originalEnv = snapshotEnv();
  let started: StartedServer | null = null;
  let binDir: string | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (binDir) await removeTempDir(binDir);
    binDir = null;
    restoreEnv(originalEnv);
  });

  it('replaces the bare json-rpc line with actionable guidance on the run and the SSE error event', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-acp-handshake-bin-'));
    const logPath = path.join(binDir, 'invocations.jsonl');
    await writeAcpCliShim(binDir, AGENT_BIN, { logPath, cliVersion: '0.38.0' });
    prependToPath(binDir);

    clearTelemetryEnv();
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    await putConfig(started.url, { agentId: AGENT_ID });
    // Detection records the `--version` probe result the guidance copy names.
    await detectAgents(started.url);

    const conversationId = await createConversation(started.url);
    const run = await sendRunAndWait(started.url, conversationId, 'draft a landing page');

    expect(run.status).toBe('failed');

    // 1. What the user reads. The bare protocol frame says nothing about the
    //    one thing that fixes this, so the message must name the CLI, the
    //    version that refused, and the action.
    const runError = run.error ?? '';
    expect(runError).toContain(AGENT_DISPLAY_NAME);
    expect(runError).toContain('0.38.0');
    expect(runError).toMatch(/refused to start a session/i);
    expect(runError).toMatch(/update the cli/i);

    // 2. The raw agent line survives. `run.error` is also the input to
    //    run-failure-classification.ts, so dropping the JSON-RPC frame would
    //    silently degrade this failure class to `unknown` in telemetry.
    expect(runError).toMatch(/json-rpc id 2: Internal error/i);

    // 3. The SSE `error` event carries the same rewritten copy. This is the
    //    payload the ACP bridge forwards to connected clients; before the fix
    //    it was the agent's raw JSON-RPC frame, forwarded verbatim.
    const events = await readRunEvents(run.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const message = effectiveErrorMessage(event.data);
      expect(message).toContain(AGENT_DISPLAY_NAME);
      expect(message).toMatch(/json-rpc id 2: Internal error/i);
    }
  });

  it('does not re-run a handshake rejection — the same CLI build refuses again', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-acp-handshake-retry-bin-'));
    const logPath = path.join(binDir, 'invocations.jsonl');
    // The CLI claims its own handshake rejection is transient. The daemon must
    // still refuse to retry: nothing streamed, and the identical request
    // against the identical build only reproduces the identical error.
    await writeAcpCliShim(binDir, AGENT_BIN, {
      logPath,
      cliVersion: '0.37.2',
      retryable: true,
    });
    prependToPath(binDir);

    clearTelemetryEnv();
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    await putConfig(started.url, { agentId: AGENT_ID });

    const conversationId = await createConversation(started.url);
    const run = await sendRunAndWait(started.url, conversationId, 'draft a landing page');

    expect(run.status).toBe('failed');
    expect(run.error ?? '').toMatch(/refused to start a session/i);

    // This shape carries a nested `error` object (the agent supplied
    // `error.data`), which is the field `run.error` is read from — so it must
    // be rewritten too, not just the top-level `message`.
    const events = await readRunEvents(run.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const payload = event.data as { error?: { message?: string } };
      expect(payload.error?.message ?? '').toMatch(/refused to start a session/i);
      expect(payload.error?.message ?? '').toMatch(/json-rpc id 2: Internal error/i);
    }

    // The daemon opened exactly one session for this run. (Model detection
    // probes the same CLI over ACP, so count only sessions opened by
    // `attachAcpSession`, which identifies itself as `open-design`.)
    const runSessions = await readRunSessionRequests(logPath);
    expect(runSessions).toEqual(['session/new']);

    // …and recorded the decision rather than reaching the cap silently.
    expect(events.some((event) => event.event === 'run_retry_attempted')).toBe(false);
    const retryFinished = events.filter((event) => event.event === 'run_retry_finished');
    expect(retryFinished.length).toBeGreaterThan(0);
    for (const event of retryFinished) {
      expect(event.data as Record<string, unknown>).toMatchObject({
        retry_result: 'suppressed',
      });
    }
  });
});

async function writeAcpCliShim(
  dir: string,
  name: string,
  opts: { logPath: string; cliVersion: string; retryable?: boolean },
): Promise<string> {
  const bin = path.join(dir, name);
  const lines = [
    '#!/bin/sh',
    `export FAKE_ACP_INVOCATION_LOG=${JSON.stringify(opts.logPath)}`,
    `export FAKE_ACP_CLI_VERSION=${JSON.stringify(opts.cliVersion)}`,
  ];
  if (opts.retryable) lines.push('export FAKE_ACP_SESSION_NEW_ERROR_RETRYABLE=1');
  lines.push(
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_ACP_CLI)} "$@"`,
    '',
  );
  await writeFile(bin, lines.join('\n'), 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

/** Warms the daemon-lifetime `--version` probe cache the failure copy reads. */
async function detectAgents(url: string): Promise<void> {
  const response = await fetch(`${url}/api/agents`);
  expect(response.status).toBe(200);
  await response.json();
}

function prependToPath(dir: string): void {
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;
}

/**
 * Handshake requests issued by `attachAcpSession` (client id `open-design`),
 * excluding the `open-design-detect` probes `detectAcpModels` makes against the
 * same CLI.
 */
async function readRunSessionRequests(logPath: string): Promise<string[]> {
  let raw = '';
  try {
    raw = await readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { method: string; client?: string })
    .filter((entry) => entry.client === 'open-design')
    .map((entry) => entry.method);
}

/** Mirrors `extractErrorDetails` in runtimes/runs.ts — the text that becomes `run.error`. */
function effectiveErrorMessage(data: unknown): string {
  const payload = (data ?? {}) as { message?: unknown; error?: unknown };
  const nested =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as { message?: unknown })
      : null;
  if (typeof nested?.message === 'string' && nested.message.trim()) return nested.message;
  return typeof payload.message === 'string' ? payload.message : '';
}

async function readRunEvents(eventsLogPath: string): Promise<RunEvent[]> {
  let raw = '';
  try {
    raw = await readFile(eventsLogPath, 'utf8');
  } catch {
    return [];
  }
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
  };
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearTelemetryEnv(): void {
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
}

async function putConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      telemetry: { metrics: true, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
      ...patch,
    }),
  });
  expect(response.status).toBe(200);
}

async function createConversation(url: string): Promise<string> {
  const projectId = `acp_handshake_${randomUUID().replace(/-/g, '')}`;
  const workspaceId = `acp_handshake_personal_${projectId}`;
  const workspaceMemberId = `acp_handshake_owner_${projectId}`;
  const workspaceHeaders = {
    'x-od-workspace-id': workspaceId,
    'x-od-workspace-type': 'personal',
    'x-od-workspace-member-id': workspaceMemberId,
    'x-od-workspace-role': 'owner',
  };
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...workspaceHeaders },
    body: JSON.stringify({
      id: projectId,
      name: 'ACP handshake smoke',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(projectResponse.status).toBe(200);
  const projectBody = (await projectResponse.json()) as { conversationId: string };
  return [projectId, projectBody.conversationId, workspaceId, workspaceMemberId].join('::');
}

async function sendRunAndWait(
  url: string,
  encoded: string,
  message: string,
): Promise<RunStatus> {
  const [projectId, conversationId, workspaceId, workspaceMemberId] = encoded.split('::');
  if (!projectId || !conversationId || !workspaceId || !workspaceMemberId) {
    throw new Error(`invalid ACP handshake fixture identity: ${encoded}`);
  }
  const workspaceHeaders = {
    'x-od-workspace-id': workspaceId,
    'x-od-workspace-type': 'personal',
    'x-od-workspace-member-id': workspaceMemberId,
    'x-od-workspace-role': 'owner',
  };
  const runResponse = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-od-analytics-device-id': 'acp-handshake-test',
      'x-od-analytics-session-id': 'acp-handshake-session',
      'x-od-analytics-client-type': 'web',
      ...workspaceHeaders,
    },
    body: JSON.stringify({
      projectId,
      conversationId,
      assistantMessageId: `assistant_acp_${randomUUID()}`,
      clientRequestId: `client_acp_${randomUUID()}`,
      agentId: AGENT_ID,
      message,
      currentPrompt: message,
    }),
  });
  const body = (await runResponse.json()) as { runId?: string };
  expect(runResponse.status, JSON.stringify(body)).toBe(202);
  expect(body.runId).toBeTypeOf('string');
  return await waitForRun(url, body.runId!, workspaceHeaders);
}

async function waitForRun(
  url: string,
  runId: string,
  headers: Record<string, string>,
): Promise<RunStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`, { headers });
    expect(response.status).toBe(200);
    const run = (await response.json()) as RunStatus;
    if (run.status === 'failed' || run.status === 'succeeded' || run.status === 'canceled') {
      return run;
    }
    await delay(100);
  }
  throw new Error(`run ${runId} did not finish`);
}

async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
