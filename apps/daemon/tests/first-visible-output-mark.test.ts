import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// `time_to_first_visible_output_ms` is supposed to answer "once the model
// started producing, how long until the user could actually SEE something?".
// It was published for months as a copy of `time_to_first_token_ms`, because
// `noteFirstTokenAt()` stamped BOTH `first_token` and `first_visible_output`
// from the same call with the same timestamp — so the difference was 0 for
// every run ever recorded (205,795 `run_finished` events over 7 days, p50 =
// p90 = p99 = max = 0).
//
// The daemon does NOT emit every token it decodes. Between "this is a token"
// and "these bytes left the daemon" sit two filters that can withhold output:
// the `<od-title>` marker stripper and the fabricated-role-marker safety guard
// (#3247). The guard is the one that can hold bytes across chunks: when a
// chunk ENDS on a complete-but-unconfirmed marker keyword (`## user`), the
// guard withholds it until the next chunk proves it was ordinary prose
// (`## usernames …`) or a real fabricated marker. During that window the run
// has a first token and the user has an empty bubble.
//
// These tests drive the REAL wiring (`startServer` + a fake opencode CLI) and
// read the two fields off the real PostHog `run_finished` payload, because the
// bug was never in a helper — it was in which call site owned the mark.
describe('first_visible_output is stamped at emission, not at first token', () => {
  const originalEnv = snapshotEnv();
  let started: StartedServer | null = null;
  let binDir: string | null = null;
  let posthog: CaptureSink | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (posthog) await posthog.close();
    posthog = null;
    if (binDir) await removeTempDir(binDir);
    binDir = null;
    restoreEnv(originalEnv);
  });

  it('reports a real gap when the safety guard withholds the first bytes', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-fvo-withheld-'));
    // The model opens a markdown heading whose keyword lands exactly on a
    // chunk boundary. The role-marker guard cannot classify `## user` until it
    // sees the next character, so it withholds the whole chunk. The daemon has
    // its first token; the user still has nothing on screen.
    const bin = await writeFakeOpencode(binDir, 'opencode-withheld', `
  emit({ type: 'text', part: { type: 'text', text: '## user' } });
  setTimeout(() => {
    emit({ type: 'text', part: { type: 'text', text: 'names are listed below.' } });
    finishTurn();
  }, ${WITHHOLD_MS});`);

    const timing = await runOnceAndReadTiming(bin, 'guard-withheld');

    expect(timing.time_to_first_token_ms).toBeTypeOf('number');
    expect(timing.time_to_first_visible_output_ms).toBeTypeOf('number');
    const gap =
      timing.time_to_first_visible_output_ms! - timing.time_to_first_token_ms!;
    // The withheld window is the whole point of the metric. Allow generous
    // slack under load; the pre-fix value is exactly 0.
    expect(gap).toBeGreaterThanOrEqual(WITHHOLD_MS - 100);
  }, 90_000);

  it('does not manufacture a gap when the first token is emitted straight through', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-fvo-direct-'));
    const bin = await writeFakeOpencode(binDir, 'opencode-direct', `
  emit({ type: 'text', part: { type: 'text', text: 'Here is your answer.' } });
  finishTurn();`);

    const timing = await runOnceAndReadTiming(bin, 'direct-text');

    expect(timing.time_to_first_token_ms).toBeTypeOf('number');
    expect(timing.time_to_first_visible_output_ms).toBeTypeOf('number');
    const gap =
      timing.time_to_first_visible_output_ms! - timing.time_to_first_token_ms!;
    // Never negative: the daemon cannot show bytes before it has the token they
    // are made of. This held only by accident while both marks shared one
    // timestamp; now that they are stamped independently it is enforced by
    // reading the decode clock BEFORE the emit at every text_delta site.
    expect(gap).toBeGreaterThanOrEqual(0);
    // And no manufactured gap. The residue is the daemon's own SSE fan-out for
    // one delta — sub-millisecond when idle, a few ms on a loaded box — which is
    // an order of magnitude below the withheld window the metric reports.
    expect(gap).toBeLessThan(100);
  }, 90_000);

  it('keeps the first-token fallback when the run never emits visible output', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-fvo-never-'));
    // The guard withholds `## user` and the CLI exits before the next chunk
    // could release it, so nothing visible ever reaches the client. There is
    // no measurement to report, and the documented fallback keeps the field
    // pinned to the first token rather than dropping it.
    const bin = await writeFakeOpencode(binDir, 'opencode-never', `
  emit({ type: 'text', part: { type: 'text', text: '## user' } });
  finishTurn();`);

    const timing = await runOnceAndReadTiming(bin, 'never-visible');

    expect(timing.time_to_first_token_ms).toBeTypeOf('number');
    expect(timing.time_to_first_visible_output_ms).toBe(
      timing.time_to_first_token_ms,
    );
  }, 90_000);

  async function runOnceAndReadTiming(
    bin: string,
    label: string,
  ): Promise<RunTiming> {
    posthog = await startCaptureSink();
    clearTelemetryEnv();
    process.env.POSTHOG_KEY = 'phc_first_visible_output_test';
    process.env.POSTHOG_HOST = posthog.url;
    // The OD Next strategy protocol adds its own text-withholding layer and a
    // machine-contract gate on top of the stream. This suite is about the
    // daemon's generic emission choke point, so keep the strategy out of it.
    process.env.OD_NEXT_STRATEGY_ROLLOUT = 'off';

    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    await putConfig(started.url, {
      agentId: 'opencode',
      agentCliEnv: { opencode: { OPENCODE_BIN: bin } },
      telemetry: { metrics: true, content: false, artifactManifest: false },
      privacyDecisionAt: Date.now(),
    });

    const conversation = await createConversation(started.url, label);
    const run = await sendRunAndWait(started.url, conversation, `render ${label}`);
    expect(run.status).toBe('succeeded');
    return await posthog.waitForRunFinished(run.id);
  }
});

const WITHHOLD_MS = 400;

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = { id: string; status: string };

type RunTiming = {
  time_to_first_token_ms?: number;
  time_to_first_visible_output_ms?: number;
};

type CaptureSink = {
  url: string;
  waitForRunFinished(runId: string): Promise<RunTiming>;
  close(): Promise<void>;
};

// Minimal stand-in for PostHog ingestion. posthog-node runs with `flushAt: 1`,
// so each daemon capture arrives as its own `/batch/` POST.
async function startCaptureSink(): Promise<CaptureSink> {
  const events: Array<{ event: string; properties: Record<string, unknown> }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      // posthog-node gzips its batch payloads.
      const raw = Buffer.concat(chunks);
      let body = '';
      try {
        body = /gzip/iu.test(req.headers['content-encoding'] ?? '')
          ? gunzipSync(raw).toString('utf8')
          : raw.toString('utf8');
      } catch {
        body = '';
      }
      try {
        const parsed = JSON.parse(body) as {
          batch?: Array<{ event?: unknown; properties?: unknown }>;
        };
        for (const record of parsed.batch ?? []) {
          if (typeof record.event !== 'string') continue;
          events.push({
            event: record.event,
            properties: (record.properties ?? {}) as Record<string, unknown>,
          });
        }
      } catch {
        // Non-batch probes (flags, etc.) are not interesting here.
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":1}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no capture port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async waitForRunFinished(runId: string): Promise<RunTiming> {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const match = events.find(
          (record) =>
            record.event === 'run_finished' && record.properties.run_id === runId,
        );
        if (match) return match.properties as RunTiming;
        await delay(100);
      }
      throw new Error(
        `no run_finished captured for ${runId}; saw ${events
          .map((record) => record.event)
          .join(', ')}`,
      );
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function writeFakeOpencode(
  dir: string,
  name: string,
  body: string,
): Promise<string> {
  const bin = path.join(dir, name);
  await writeFile(
    bin,
    `#!/usr/bin/env node
const SESSION = 'ses_first_visible_output_0001';
const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('1.17.7'); process.exit(0); }
if (argv.includes('--help')) { console.log('opencode run [message..]'); process.exit(0); }
if (argv[0] === 'models') { console.log('anthropic/claude-sonnet-4-5'); process.exit(0); }
let stdin = '';
let done = false;
function emit(obj) {
  console.log(JSON.stringify({ ...obj, sessionID: SESSION }));
}
function finishTurn() {
  emit({ type: 'step_finish', part: { type: 'step-finish', tokens: { input: 9, output: 4, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } });
  setTimeout(() => process.exit(0), 10);
}
function finish() {
  if (done) return; done = true;
  run();
}
function run() {
  emit({ type: 'step_start', part: { type: 'step-start' } });
${body}
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', finish);
process.stdin.on('error', finish);
setTimeout(finish, 1500);
`,
    'utf8',
  );
  await chmod(bin, 0o755);
  return bin;
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    OD_NEXT_STRATEGY_ROLLOUT: process.env.OD_NEXT_STRATEGY_ROLLOUT,
  };
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearTelemetryEnv(): void {
  delete process.env.OD_NEXT_STRATEGY_ROLLOUT;
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
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

async function createConversation(url: string, label: string): Promise<string> {
  const projectId = `fvo_${label.replace(/[^a-z0-9]+/giu, '_')}_${randomUUID()}`;
  const response = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'first visible output smoke',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { conversationId: string };
  return `${projectId}::${body.conversationId}`;
}

async function sendRunAndWait(
  url: string,
  encoded: string,
  message: string,
): Promise<RunStatus> {
  const [projectId, conversationId] = encoded.split('::');
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-od-analytics-device-id': 'first-visible-output-test',
      'x-od-analytics-session-id': 'first-visible-output-session',
      'x-od-analytics-client-type': 'web',
    },
    body: JSON.stringify({
      projectId,
      conversationId,
      assistantMessageId: `assistant_fvo_${randomUUID()}`,
      clientRequestId: `client_fvo_${randomUUID()}`,
      agentId: 'opencode',
      message,
      currentPrompt: message,
    }),
  });
  expect(response.status).toBe(202);
  const body = (await response.json()) as { runId: string };
  return await waitForRun(url, body.runId);
}

async function waitForRun(url: string, runId: string): Promise<RunStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
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
  await rm(dir, { force: true, recursive: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
