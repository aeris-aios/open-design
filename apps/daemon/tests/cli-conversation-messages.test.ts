// Contract test for the CLI half of the message-withdraw capability
// (AGENTS.md "Capability exposure"): the DELETE endpoint the send-failed turn
// uses to take back an assistant placeholder must also be reachable as an `od`
// subcommand, with `--json` for headless agents, and it must carry the same
// explicit workspace headers the web client sends — otherwise a team-bound
// project's withdraw 401s exactly like an unauthenticated caller's would.
//
// A stub HTTP server captures the requests instead of booting the daemon: this
// file's job is to prove SUBCOMMAND_MAP routing, flag parsing, the emitted
// HTTP shape, and the human/JSON output — the route's own behavior is covered
// by `tests/routes/message-send-failed.test.ts`.

import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  setResponder: (
    fn: (req: CapturedRequest) => { status: number; body: unknown } | null,
  ) => void;
  close: () => Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  let responder:
    | ((req: CapturedRequest) => { status: number; body: unknown } | null)
    | null = null;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: raw,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(',') : String(value ?? ''),
          ]),
        ),
      };
      requests.push(captured);
      const response = responder?.(captured) ?? { status: 200, body: { ok: true } };
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    setResponder: (fn) => {
      responder = fn;
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

async function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [TSX_CLI, CLI_SRC, ...args],
      { cwd: DAEMON_ROOT, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', code: failed.code ?? 1 };
  }
}

describe('od conversation message-delete CLI', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
    stub.setResponder(() => ({ status: 200, body: { ok: true } }));
  });

  it('documents both message verbs in `od conversation help`', async () => {
    const result = await runCli(['conversation', 'help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/od conversation messages/);
    expect(result.stdout).toMatch(/od conversation message-delete/);
  });

  it('DELETEs the message route and reports the withdraw in human output', async () => {
    stub.setResponder((req) =>
      req.method === 'DELETE'
        ? { status: 200, body: { ok: true, deleted: true } }
        : { status: 404, body: { error: 'unexpected' } },
    );

    const result = await runCli([
      'conversation', 'message-delete', 'proj-1', 'conv-1', 'assistant-1',
      '--daemon-url', stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({
      method: 'DELETE',
      url: '/api/projects/proj-1/conversations/conv-1/messages/assistant-1',
    });
    expect(result.stdout).toContain('withdrew assistant-1');
  });

  it('reports an already-gone message as a no-op, not a failure', async () => {
    stub.setResponder(() => ({ status: 200, body: { ok: true, deleted: false } }));

    const result = await runCli([
      'conversation', 'message-delete', 'proj-1', 'conv-1', 'gone-1',
      '--daemon-url', stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('already gone');
  });

  it('emits the raw response under --json for headless callers', async () => {
    stub.setResponder(() => ({ status: 200, body: { ok: true, deleted: true } }));

    const result = await runCli([
      'conversation', 'message-delete', 'proj-1', 'conv-1', 'assistant-1',
      '--daemon-url', stub.baseUrl, '--json',
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, deleted: true });
  });

  it('carries explicit workspace headers so a team-bound project authorizes', async () => {
    stub.setResponder(() => ({ status: 200, body: { ok: true, deleted: true } }));

    const result = await runCli([
      'conversation', 'message-delete', 'proj-1', 'conv-1', 'assistant-1',
      '--daemon-url', stub.baseUrl,
      '--workspace', 'ws-9', '--workspace-member', 'member-9',
    ]);

    expect(result.code).toBe(0);
    const headerBlob = JSON.stringify(stub.requests[0]?.headers ?? {});
    expect(headerBlob).toContain('ws-9');
    expect(headerBlob).toContain('member-9');
  });

  it('lists messages so a headless caller can find the id to withdraw', async () => {
    stub.setResponder((req) =>
      req.method === 'GET'
        ? {
            status: 200,
            body: {
              messages: [
                { id: 'user-1', role: 'user', content: 'redo the pricing row', sendFailed: true },
                { id: 'assistant-1', role: 'assistant', content: '', runStatus: 'failed' },
              ],
            },
          }
        : { status: 404, body: { error: 'unexpected' } },
    );

    const result = await runCli([
      'conversation', 'messages', 'proj-1', 'conv-1', '--daemon-url', stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/projects/proj-1/conversations/conv-1/messages',
    });
    expect(result.stdout).toContain('user-1');
    expect(result.stdout).toContain('send-failed');
    expect(result.stdout).toContain('assistant-1');
  });

  it('rejects a call that names no message', async () => {
    const result = await runCli([
      'conversation', 'message-delete', 'proj-1', 'conv-1', '--daemon-url', stub.baseUrl,
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/od conversation message-delete/);
    expect(stub.requests).toHaveLength(0);
  });
});
