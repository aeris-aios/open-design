// Red spec for #7300-class reports: "the task says it has been running for 171
// minutes" while every individual attempt only ran for a few minutes.
//
// A same-run retry REUSES the run object. `run.createdAt` therefore keeps
// pointing at the moment the user first asked, and nothing the client can read
// tells it that a NEW attempt started. The web clock anchors on the persisted
// run/message start, so after a retry it keeps counting from attempt 0 and the
// user reads a live, monotonically growing number that no attempt ever spent.
//
// The daemon already knows the answer -- `run.analyticsTelemetry.attemptStartedAt`
// is stamped per attempt by the lifecycle tracer, and `run.retryAttemptCount`
// tracks the attempt index -- but neither is exposed through any contract, so
// no client can render a per-attempt clock.
//
// Timeline exercised here:
//   Attempt 0: the CLI announces itself and then HANGS with no output. The
//     inactivity watchdog fails it as a retryable no-output timeout -> the
//     policy schedules one same-run retry.
//   Attempt 1: the CLI streams a normal turn and exits 0 -> run succeeds.
//
// Expected (both client-visible transports must agree):
//   - GET /api/runs/:id reports `attemptStartedAt` for the attempt that is
//     actually current, i.e. clearly LATER than `createdAt`, plus `attemptIndex: 1`.
//   - The `start` SSE event for the retried attempt carries the same pair, so a
//     live client does not have to poll to reset its clock.
// Before the fix: both fields are absent, so the only start time a client can
// read is `createdAt` -- attempt 0's -- which is exactly the 171-minute bug.

import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunDiagnosticValue = { state: string; value?: number };

type RunStatus = {
  id: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
  eventsLogPath: string | null;
  // The fields under test. Absent before the fix.
  attemptStartedAt?: number | null;
  attemptIndex?: number;
  executionDiagnostics?: {
    timing?: {
      queueDurationMs?: RunDiagnosticValue;
      retryWaitDurationMs?: RunDiagnosticValue;
    };
  };
};

type ConversationMessage = {
  id: string;
  role: string;
  startedAt?: number;
  endedAt?: number;
  attemptStartedAt?: number;
  attemptIndex?: number;
};

type RunEventRecord = {
  id: number;
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
};

// Attempt 0 must hang long enough for the watchdog to be the thing that fails
// it, and the watchdog window must comfortably outlast daemon startup work, or
// the run fails for the wrong reason and the retry never happens.
const INACTIVITY_TIMEOUT_MS = 1_200;

describe('per-attempt run clock (red spec)', () => {
  const originalEnv = {
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
    OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS: process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS,
  };
  let started: StartedServer | null = null;
  let binDir: string | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (binDir) await rm(binDir, { recursive: true, force: true });
    binDir = null;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // One daemon + one fake CLI whose attempt 0 hangs until the inactivity
  // watchdog fails it as retryable, so every spec here exercises a real
  // policy-scheduled same-run retry rather than a simulated one.
  const startDaemonWithRetryingClaude = async (binName: string): Promise<string> => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-attempt-clock-bin-'));
    const fakeClaude = await writeHangThenSucceedClaude(binDir, binName);

    delete process.env.POSTHOG_KEY;
    delete process.env.POSTHOG_HOST;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS = String(INACTIVITY_TIMEOUT_MS);

    started = await startServer({ port: 0, returnServer: true }) as StartedServer;
    await putConfig(started.url, {
      agentId: 'claude',
      agentCliEnv: { claude: { CLAUDE_BIN: fakeClaude } },
      telemetry: { metrics: true, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });
    return started.url;
  };

  it('exposes the retried attempt’s start time, not the first attempt’s', async () => {
    const url = await startDaemonWithRetryingClaude('claude-attempt-clock');

    const { run, projectId, conversationId, assistantMessageId } =
      await createAndWaitForRun(url);

    // Guard the premise: attempt 0 must really have been retried and attempt 1
    // must really have succeeded, or the clock assertions below prove nothing.
    expect(run.status).toBe('succeeded');

    // --- Transport 1: run status (what a page refresh reads back) ------------
    expect(typeof run.attemptStartedAt).toBe('number');
    expect(run.attemptIndex).toBe(1);
    // The whole point: the current attempt did NOT start when the run did. The
    // watchdog alone burned INACTIVITY_TIMEOUT_MS before the retry was even
    // scheduled, so a correct per-attempt anchor must be at least that much
    // later than `createdAt`.
    expect(run.attemptStartedAt as number).toBeGreaterThan(
      run.createdAt + INACTIVITY_TIMEOUT_MS,
    );

    // --- Transport 2: the live SSE stream (what an open tab reads) -----------
    // The retried attempt re-sends `start`; that event must carry the same
    // per-attempt anchor so a live client resets its clock without polling.
    const events = await readRunEvents(run.eventsLogPath);
    const startEvents = events.filter((record) => record.event === 'start');
    expect(startEvents.length).toBeGreaterThanOrEqual(2);
    const retriedStart = startEvents[startEvents.length - 1]!;
    expect(typeof retriedStart.data.attemptStartedAt).toBe('number');
    expect(retriedStart.data.attemptIndex).toBe(1);
    // And the two transports must not disagree, or a refresh would visibly jump
    // the clock.
    expect(retriedStart.data.attemptStartedAt).toBe(run.attemptStartedAt);

    // --- Transport 3: the persisted message (what survives a reload) --------
    // The run object is in-memory + a state file; the chat transcript is the DB.
    // If the anchor does not reach the message row, reloading the page reads
    // back attempt 0 and the cumulative clock returns.
    const messages = await fetchConversationMessages(url, projectId, conversationId);
    const assistant = messages.find((m) => m.id === assistantMessageId);
    expect(assistant).toBeDefined();
    expect(assistant?.attemptStartedAt).toBe(run.attemptStartedAt);
    expect(assistant?.attemptIndex).toBe(1);
    // `startedAt` must stay pinned to the logical turn start, or the cumulative
    // time is lost and the secondary "N attempts / total" line cannot be built.
    expect(typeof assistant?.startedAt).toBe('number');
    expect(assistant!.startedAt!).toBeLessThan(assistant!.attemptStartedAt!);
  }, 30_000);

  // Red spec for review thread PRRT_kwDOSOgY8s6bwoqw.
  //
  // The retry boundary is opened when the FAILED attempt is torn down, but the
  // next attempt is not spawned until the policy backoff (250-1000ms) elapses.
  // Throughout that window `/api/runs/:id` advertises the next attempt (a fresh
  // anchor, an incremented index) while the transcript row still carries the
  // attempt that just ended -- so a refresh or a reattach during the backoff
  // reads one attempt, the live stream then reports another, and the clock
  // visibly jumps. The PR promises status, SSE, and the persisted message agree;
  // this is the window where they do not.
  //
  // Sampled with a sandwich read (status -> transcript -> status) so a mismatch
  // can only mean a real divergence: if the run's own anchor is unchanged across
  // the transcript read, the two reads did not straddle the respawn.
  it('keeps run status and the persisted transcript on the same attempt while a retry waits out its backoff', async () => {
    const url = await startDaemonWithRetryingClaude('claude-attempt-backoff');

    type Sample = { status: RunStatus; assistant: ConversationMessage | undefined };
    const samples: Sample[] = [];
    let sawRunning = false;

    const { run } = await createAndWaitForRun(url, {
      pollIntervalMs: 5,
      onPoll: async (status, ctx) => {
        if (status.status === 'running') sawRunning = true;
        // The retry backoff is the only stretch where a run that has already
        // executed goes back to `queued`.
        if (!sawRunning || status.status !== 'queued') return;
        const messages = await fetchConversationMessages(url, ctx.projectId, ctx.conversationId);
        const assistant = messages.find((m) => m.id === ctx.assistantMessageId);
        const after = await fetchRunStatus(url, status.id);
        if (
          after.status !== status.status ||
          after.attemptIndex !== status.attemptIndex ||
          after.attemptStartedAt !== status.attemptStartedAt
        ) {
          return;
        }
        samples.push({ status, assistant });
      },
    });

    expect(run.status).toBe('succeeded');
    // Premise guard: if the backoff window was never observed the assertions
    // below are vacuous.
    expect(samples.length).toBeGreaterThan(0);

    for (const sample of samples) {
      expect(sample.assistant).toBeDefined();
      expect(sample.assistant?.attemptStartedAt).toBe(sample.status.attemptStartedAt);
      expect(sample.assistant?.attemptIndex).toBe(sample.status.attemptIndex);
    }
  }, 30_000);

  // Red spec for review thread PRRT_kwDOSOgY8s6bwoq3.
  //
  // `RunTimingProps` defines `retry_wait_duration_ms` as everything earlier
  // attempts consumed -- their execution AND the policy backoff -- leaving
  // `queue_duration_ms` as the wait the CURRENT attempt endured. Because the
  // attempt boundary is stamped at teardown, the backoff falls after the
  // boundary and is booked as the next attempt's queueing instead. The daemon
  // has no queue at all, so a `queue_duration_ms` at or above the policy delay
  // is that misattribution, and every dashboard reading the new field
  // undercounts retry time by exactly the backoff.
  it('books the retry backoff as retry wait, not as the next attempt’s queueing', async () => {
    const url = await startDaemonWithRetryingClaude('claude-attempt-backoff-metric');
    const { run } = await createAndWaitForRun(url);
    expect(run.status).toBe('succeeded');

    const events = await readRunEvents(run.eventsLogPath);
    const retryAttempted = events.find((record) => record.event === 'run_retry_attempted');
    expect(retryAttempted).toBeDefined();
    const retryDelayMs = retryAttempted!.data.retry_delay_ms;
    expect(typeof retryDelayMs).toBe('number');
    // Premise guard: an immediate retry would make both spans indistinguishable.
    expect(retryDelayMs as number).toBeGreaterThan(0);

    const timing = run.executionDiagnostics?.timing;
    const queueDurationMs = timing?.queueDurationMs?.value;
    const retryWaitDurationMs = timing?.retryWaitDurationMs?.value;
    expect(typeof queueDurationMs).toBe('number');
    expect(typeof retryWaitDurationMs).toBe('number');

    // The backoff is time the RUN spent between attempts. Charging it to the
    // next attempt's queueing is the bug.
    expect(queueDurationMs as number).toBeLessThan(retryDelayMs as number);

    // ...and it has to actually land in retry wait. The retry is decided at the
    // `run_retry_attempted` frame and the timer cannot fire before its delay,
    // so a correctly anchored boundary is at least that far out.
    expect(retryWaitDurationMs as number).toBeGreaterThanOrEqual(
      retryAttempted!.timestamp - run.createdAt + (retryDelayMs as number),
    );
  }, 30_000);
});

async function writeHangThenSucceedClaude(dir: string, name: string): Promise<string> {
  const bin = path.join(dir, name);
  const counterPath = path.join(dir, `${name}-attempts`);
  await writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const counterPath = ${JSON.stringify(counterPath)};
if (process.argv.includes('--version')) {
  console.log('claude-code 1.0.0-attempt-clock');
  process.exit(0);
}
if (process.argv.includes('--help')) {
  console.log('Usage: claude -p [--include-partial-messages] [--add-dir DIR]');
  process.exit(0);
}
// Count only real turn invocations. The daemon also spawns this bin for
// side probes (\`claude auth status\`), which are neither --version nor --help;
// counting those can consume attempt 0 before the turn starts, so the turn
// takes the already-retried branch, succeeds immediately, and no retry ever
// happens -- a flaky false green.
if (!process.argv.includes('-p')) {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-attempt-clock-test' }));
  process.exit(0);
}
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-attempt-clock-test' }));
if (attempts === 0) {
  // Announce, then produce nothing. The inactivity watchdog fails this attempt
  // as a retryable no-output timeout, which is what schedules the same-run retry.
  setTimeout(() => process.exit(0), 60000);
} else {
  // The retried attempt behaves normally: real text, a clean turn, exit 0.
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg-attempt-clock',
      content: [{ type: 'text', text: 'recovered on the retried attempt' }],
      stop_reason: 'end_turn',
    },
  }));
  setTimeout(() => process.exit(0), 20);
}
`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

async function putConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

async function readRunEvents(eventsLogPath: string | null): Promise<RunEventRecord[]> {
  expect(typeof eventsLogPath).toBe('string');
  const raw = await readFile(eventsLogPath as string, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RunEventRecord);
}

async function fetchConversationMessages(
  url: string,
  projectId: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const response = await fetch(
    `${url}/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { messages?: ConversationMessage[] } | ConversationMessage[];
  return Array.isArray(body) ? body : body.messages ?? [];
}

async function fetchRunStatus(url: string, runId: string): Promise<RunStatus> {
  const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
  expect(response.status).toBe(200);
  return await response.json() as RunStatus;
}

interface RunPollContext {
  projectId: string;
  conversationId: string;
  assistantMessageId: string;
}

async function createAndWaitForRun(url: string, opts?: {
  /** Tight enough to land several samples inside a 250-1000ms retry backoff. */
  pollIntervalMs?: number;
  onPoll?: (run: RunStatus, ctx: RunPollContext) => Promise<void>;
}): Promise<{
  run: RunStatus;
  projectId: string;
  conversationId: string;
  assistantMessageId: string;
}> {
  const projectId = `attempt_clock_${randomUUID()}`;
  const assistantMessageId = `assistant_attempt_${randomUUID()}`;
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'Per-attempt clock repro',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(projectResponse.status).toBe(200);
  const projectBody = await projectResponse.json() as { conversationId: string };
  const runResponse = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-od-analytics-device-id': 'attempt-clock-test',
      'x-od-analytics-session-id': 'attempt-clock-session',
      'x-od-analytics-client-type': 'web',
    },
    body: JSON.stringify({
      projectId,
      conversationId: projectBody.conversationId,
      assistantMessageId,
      clientRequestId: `client_attempt_${randomUUID()}`,
      agentId: 'claude',
      message: 'reproduce the per-attempt run clock',
      currentPrompt: 'reproduce the per-attempt run clock',
    }),
  });
  expect(runResponse.status).toBe(202);
  const body = await runResponse.json() as { runId: string };
  const ctx: RunPollContext = {
    projectId,
    conversationId: projectBody.conversationId,
    assistantMessageId,
  };
  const waitStartedAt = Date.now();
  while (Date.now() - waitStartedAt < 25_000) {
    const run = await fetchRunStatus(url, body.runId);
    if (['failed', 'succeeded', 'canceled'].includes(run.status)) {
      return { run, ...ctx };
    }
    await opts?.onPoll?.(run, ctx);
    await new Promise((resolve) => setTimeout(resolve, opts?.pollIntervalMs ?? 100));
  }
  throw new Error(`run ${body.runId} did not finish`);
}
