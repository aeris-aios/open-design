import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// Wiring coverage for the ACP handshake-rejection classification, driven
// through the FULL server run cycle rather than the pure helpers in isolation.
//
// The failure this pins down (Kimi Code 0.37.x / 0.38.0): the agent CLI answers
// `initialize`, then rejects `session/new` with a bare JSON-RPC `Internal
// error`. `attachAcpSession` turns that into `fail('json-rpc id 2: Internal
// error')`, whose payload the ACP `send` bridge in server.ts forwards to the
// SSE client verbatim; the close handler then short-circuits on
// `acpFatalErrorObservedBeforeCancellation && hasFatalError()`, well before the
// stderr-tail `rewriteKnownAgentStreamError` fallback further down.
//
// So a unit test over the pure predicates proves nothing about what the user
// reads. These tests assert on the two surfaces a user and the telemetry
// pipeline actually observe — the `error` SSE event recorded in the run's
// events log, and `run.error` / `run.errorCode` on `GET /api/runs/:id` — plus
// the spawn count, which is what "stop retrying a deterministic failure" means
// in practice.
//
// The daemon's job here is to NAME the failure, not to word it: it emits the
// `AGENT_CLI_SESSION_REFUSED` code plus the structured identity (agent display
// name, detected CLI version) and leaves `run.error` as the agent's own line.
// The sentence the user reads is the web's, resolved from that code through
// i18n — a daemon-authored English paragraph can never be localized.

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

/** The structured half of an SSE `error` frame — what the web localizes from. */
type ErrorFrame = {
  message?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    details?: Record<string, unknown>;
  };
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
  // Gates the fake CLI may still be parked at. Released before shutdown so a
  // failed assertion cannot leave a held probe wedging teardown.
  let heldGates: string[] = [];

  afterEach(async () => {
    for (const gate of heldGates) await openGate(gate).catch(() => undefined);
    heldGates = [];
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (binDir) await removeTempDir(binDir);
    binDir = null;
    restoreEnv(originalEnv);
  });

  it('names the refusal with an error code and structured identity, leaving the agent line verbatim', async () => {
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

    // 1. `run.error` is the agent's own line, unedited. It is the input to
    //    run-failure-classification.ts, so dropping or padding the JSON-RPC
    //    frame would degrade this failure class in telemetry — and it is the
    //    text the card shows under 「查看错误详情」, so it must appear once and
    //    carry no prose of the daemon's own.
    const runError = run.error ?? '';
    expect(runError).toBe('json-rpc id 2: Internal error');
    expect(runError).not.toMatch(/refused to start a session/i);
    expect(runError).not.toMatch(/update the cli/i);
    expect(runError).not.toMatch(/Details:/i);

    // 2. The failure is NAMED, not worded. A code is localizable; an English
    //    paragraph written in the daemon is not.
    expect(run.errorCode).toBe('AGENT_CLI_SESSION_REFUSED');

    // 3. The SSE `error` frame carries the same code plus the identity the
    //    localized copy interpolates. This is the payload the ACP bridge
    //    forwards to connected clients, and the one `run.error` is read from.
    const events = await readRunEvents(run.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const frame = event.data as ErrorFrame;
      expect(frame.error?.code).toBe('AGENT_CLI_SESSION_REFUSED');
      expect(frame.error?.details).toMatchObject({
        kind: 'agent_cli',
        action: 'update_cli',
        agent: AGENT_DISPLAY_NAME,
      });
      expectDetectedVersion(frame, '0.38.0');
      // The message fields stay the agent's line on both surfaces.
      expect(effectiveErrorMessage(event.data)).toBe('json-rpc id 2: Internal error');
      expect(JSON.stringify(event.data)).not.toMatch(/refused to start a session/i);
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
    await detectAgents(started.url);

    const conversationId = await createConversation(started.url);
    const run = await sendRunAndWait(started.url, conversationId, 'draft a landing page');

    expect(run.status).toBe('failed');
    expect(run.error ?? '').toBe('json-rpc id 2: Internal error');
    expect(run.errorCode).toBe('AGENT_CLI_SESSION_REFUSED');

    // This shape carries a nested `error` object (the agent supplied
    // `error.data`), which is the field `run.error` and `run.errorCode` are
    // read from — so the code has to land there, not only on the top level.
    // The agent's own `data` survives alongside the identity the card needs.
    const events = await readRunEvents(run.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const frame = event.data as ErrorFrame;
      expect(frame.error?.code).toBe('AGENT_CLI_SESSION_REFUSED');
      expect(frame.error?.message).toBe('json-rpc id 2: Internal error');
      expect(frame.error?.details).toMatchObject({
        kind: 'agent_cli',
        action: 'update_cli',
        agent: AGENT_DISPLAY_NAME,
        retryable: true,
      });
      expectDetectedVersion(frame, '0.37.2');
      // A CLI that calls its own handshake rejection transient does not get to
      // mark the run retryable: the identical request against the identical
      // build only reproduces it.
      expect(frame.error?.retryable).toBe(false);
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

  // Regression for the misfire this guidance shipped with: reading only the
  // JSON-RPC id made EVERY handshake-stage error a CLI-compatibility verdict.
  // Running a real Kimi CLI while signed out produces `json-rpc id 2:
  // Authentication required` — a healthy, current CLI reporting the one thing
  // it cannot do for the user — and the daemon answered it by telling them to
  // update or downgrade that CLI. No pure-function test caught it, because the
  // helpers were consistent with themselves; only the end-to-end text a signed
  // out user reads shows the prescription is wrong.
  it('does not blame the CLI version when the agent says the user is signed out', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-acp-handshake-auth-bin-'));
    const logPath = path.join(binDir, 'invocations.jsonl');
    await writeAcpCliShim(binDir, AGENT_BIN, {
      logPath,
      cliVersion: '0.38.0',
      errorMessage: 'Authentication required',
    });
    prependToPath(binDir);

    clearTelemetryEnv();
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    await putConfig(started.url, { agentId: AGENT_ID });
    await detectAgents(started.url);

    const conversationId = await createConversation(started.url);
    const run = await sendRunAndWait(started.url, conversationId, 'draft a landing page');

    expect(run.status).toBe('failed');

    const runError = run.error ?? '';
    // What the agent actually said survives — that is the sentence pointing at
    // the fix (sign in), and it is also what the classifier reads.
    expect(runError).toMatch(/json-rpc id 2: Authentication required/i);
    // …and the CLI-compatibility verdict is not pinned on it. Getting this
    // wrong now costs a whole localized card, not just a paragraph.
    expect(run.errorCode).not.toBe('AGENT_CLI_SESSION_REFUSED');

    const events = await readRunEvents(run.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const frame = event.data as ErrorFrame;
      expect(frame.error?.code).not.toBe('AGENT_CLI_SESSION_REFUSED');
      expect(frame.error?.details?.kind).not.toBe('agent_cli');
    }
  });

  // Same misfire, a different cause: the predicate that decides "the CLI gave
  // no reason" recognised only the three agent-service classes, so every OTHER
  // cause the run classifier already knows how to advise on — prompt size
  // first among them — was rewritten into "your CLI version is incompatible".
  // The user whose content was too long was told to change a healthy CLI, while
  // the telemetry for the same run said `prompt_too_large` / `reduce_context`.
  it('does not blame the CLI version when the agent says the request was too large', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-acp-handshake-size-bin-'));
    const logPath = path.join(binDir, 'invocations.jsonl');
    await writeAcpCliShim(binDir, AGENT_BIN, {
      logPath,
      cliVersion: '0.38.0',
      errorMessage: '[code=request_too_large] request body exceeds configured limit',
    });
    prependToPath(binDir);

    clearTelemetryEnv();
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    await putConfig(started.url, { agentId: AGENT_ID });
    await detectAgents(started.url);

    const conversationId = await createConversation(started.url);
    const run = await sendRunAndWait(started.url, conversationId, 'draft a landing page');

    expect(run.status).toBe('failed');
    // Verbatim, as with every other named cause — this is the line that says
    // what to shorten, and the line the classifier reads.
    expect(run.error ?? '').toBe(
      'json-rpc id 2: [code=request_too_large] request body exceeds configured limit',
    );
    expect(run.errorCode).not.toBe('AGENT_CLI_SESSION_REFUSED');

    const events = await readRunEvents(run.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const frame = event.data as ErrorFrame;
      expect(frame.error?.code).not.toBe('AGENT_CLI_SESSION_REFUSED');
      // The prescription the card would render must not be "update your CLI".
      expect(frame.error?.details?.action).not.toBe('update_cli');
      expect(frame.error?.details?.kind).not.toBe('agent_cli');
      expect(effectiveErrorMessage(event.data)).toBe(
        'json-rpc id 2: [code=request_too_large] request body exceeds configured limit',
      );
    }
  });

  // The detected CLI version is part of the promise this failure makes: the
  // card names the build that refused. Reading it from the process-wide
  // detection cache at failure time made that promise depend on whether some
  // other request happened to be re-probing at that instant — `probe()` clears
  // the entry before it re-reads it. CI hit exactly that window (run
  // 32683047377) and the assertion was loosened rather than the race closed.
  //
  // Deterministic, not timed: the fake CLI parks at a named gate and announces
  // it, so the run's handshake and a concurrent `/api/agents` refresh are held
  // open TOGETHER, and the failure is built at the precise moment a probe is in
  // flight — the window that used to leave the cache blank. Both halves of the
  // fix are exercised at once: the run reports the version it froze at spawn,
  // and the in-flight probe no longer retracts the cached reading behind it.
  it('names the version this run spawned with, even mid-refresh', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-acp-handshake-race-bin-'));
    const logPath = path.join(binDir, 'invocations.jsonl');
    const versionGate = path.join(binDir, 'version-gate');
    const sessionGate = path.join(binDir, 'session-gate');
    heldGates = [versionGate, sessionGate];
    await writeAcpCliShim(binDir, AGENT_BIN, {
      logPath,
      cliVersion: '0.38.0',
      versionGate,
      sessionGate,
    });
    prependToPath(binDir);

    clearTelemetryEnv();
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    await putConfig(started.url, { agentId: AGENT_ID });

    // Warm detection with the version gate already open, then shut it so the
    // NEXT probe parks inside `--version` instead of completing.
    await openGate(versionGate);
    await detectAgents(started.url);
    await closeGate(versionGate);

    const conversationId = await createConversation(started.url);
    const run = await startRun(started.url, conversationId, 'draft a landing page');

    // The run's child has answered `initialize` and is holding `session/new`.
    await waitForGate(sessionGate);

    // Now open the window: a refresh that has started re-probing and not yet
    // published. Nothing here sleeps — the gate reports arrival.
    const refresh = fetch(`${started.url}/api/agents`);
    await waitForGate(versionGate);

    // Release the handshake. The refusal is classified and emitted while the
    // process-wide detection cache is mid-probe.
    await openGate(sessionGate);
    const finished = await waitForRun(started.url, run.runId, run.headers);

    expect(finished.status).toBe('failed');
    expect(finished.errorCode).toBe('AGENT_CLI_SESSION_REFUSED');

    const events = await readRunEvents(finished.eventsLogPath);
    const errorEvents = events.filter((event) => event.event === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      expectDetectedVersion(event.data as ErrorFrame, '0.38.0');
    }

    await openGate(versionGate);
    await refresh.then((response) => response.text()).catch(() => '');
  });
});

/**
 * The CLI version the guidance names is the one this run's child was spawned
 * with — asserted, not tolerated.
 *
 * This used to be a soft check, because the version was read from the
 * process-wide `getDetectedRuntimeVersions` cache at FAILURE time and
 * `probe()` blanked that cache for the length of every refresh; CI caught the
 * resulting flake (run 32683047377). Both halves of that are now fixed — the
 * run captures its runtime identity at spawn, and a probe no longer clears the
 * last known answer while it re-reads it — so the version is deterministic and
 * a soft assertion would only hide the regression coming back.
 */
function expectDetectedVersion(frame: ErrorFrame, expected: string): void {
  expect(frame.error?.details?.agentCliVersion).toBe(expected);
}

/** Polls until the fake CLI announces it has parked at a gate. */
async function waitForGate(prefix: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      await readFile(`${prefix}.ready`, 'utf8');
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`fake CLI never reached gate ${prefix}`);
}

/** Releases a parked gate so the fake CLI continues. */
async function openGate(prefix: string): Promise<void> {
  await writeFile(`${prefix}.go`, '', 'utf8');
}

/** Shuts a gate again so the NEXT process to reach it parks. */
async function closeGate(prefix: string): Promise<void> {
  await rm(`${prefix}.go`, { force: true });
  await rm(`${prefix}.ready`, { force: true });
}

async function writeAcpCliShim(
  dir: string,
  name: string,
  opts: {
    logPath: string;
    cliVersion: string;
    retryable?: boolean;
    errorMessage?: string;
    versionGate?: string;
    sessionGate?: string;
  },
): Promise<string> {
  const bin = path.join(dir, name);
  const lines = [
    '#!/bin/sh',
    `export FAKE_ACP_INVOCATION_LOG=${JSON.stringify(opts.logPath)}`,
    `export FAKE_ACP_CLI_VERSION=${JSON.stringify(opts.cliVersion)}`,
  ];
  if (opts.errorMessage) {
    lines.push(
      `export FAKE_ACP_SESSION_NEW_ERROR_MESSAGE=${JSON.stringify(opts.errorMessage)}`,
    );
  }
  if (opts.versionGate) {
    lines.push(`export FAKE_ACP_VERSION_GATE=${JSON.stringify(opts.versionGate)}`);
  }
  if (opts.sessionGate) {
    lines.push(`export FAKE_ACP_SESSION_GATE=${JSON.stringify(opts.sessionGate)}`);
  }
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
  const started = await startRun(url, encoded, message);
  return await waitForRun(url, started.runId, started.headers);
}

/**
 * Posts the run and returns as soon as the daemon accepts it, WITHOUT waiting
 * for it to finish. Tests that need to act while the run is still in flight —
 * holding its handshake open, racing a detection refresh against it — drive
 * `waitForRun` themselves once they have arranged the overlap.
 */
async function startRun(
  url: string,
  encoded: string,
  message: string,
): Promise<{ runId: string; headers: Record<string, string> }> {
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
  return { runId: body.runId!, headers: workspaceHeaders };
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
