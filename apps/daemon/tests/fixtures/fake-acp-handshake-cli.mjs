#!/usr/bin/env node
/**
 * Fake ACP agent CLI that reproduces the Kimi Code 0.37.x / 0.38.0 failure:
 * the CLI answers `initialize` and then rejects `session/new` with a bare
 * JSON-RPC `Internal error`.
 *
 * Routes by the first argv:
 *
 *   `--version` → prints FAKE_ACP_CLI_VERSION so runtime detection can record
 *                 the version the guidance copy is expected to name.
 *   `acp`       → ACP stdio. Replies to `initialize` (request id 1) and then
 *                 fails `session/new` (request id 2) with the JSON-RPC error
 *                 described by FAKE_ACP_SESSION_NEW_ERROR_MESSAGE.
 *
 * Env knobs:
 *   FAKE_ACP_CLI_VERSION                 – `--version` stdout (default 0.38.0)
 *   FAKE_ACP_SESSION_NEW_ERROR_MESSAGE   – JSON-RPC error message for
 *                                          `session/new` (default `Internal error`)
 *   FAKE_ACP_SESSION_NEW_ERROR_RETRYABLE – when '1', the error carries
 *                                          `data.retryable = true`, modelling a
 *                                          CLI that claims its own handshake
 *                                          rejection is transient
 *   FAKE_ACP_INVOCATION_LOG              – append one JSON line per handshake
 *                                          request, tagged with the caller's
 *                                          `clientInfo.name`. `attachAcpSession`
 *                                          identifies as `open-design` and
 *                                          `detectAcpModels` as
 *                                          `open-design-detect`, so a test can
 *                                          count real run sessions without
 *                                          counting model-detection probes.
 *   FAKE_ACP_VERSION_GATE                – path prefix. `--version` writes
 *                                          `<prefix>.ready` and then blocks
 *                                          until `<prefix>.go` exists.
 *   FAKE_ACP_SESSION_GATE                – path prefix. A `session/new` /
 *                                          `session/load` from the `open-design`
 *                                          client (i.e. a real run, never a
 *                                          model-detection probe) writes
 *                                          `<prefix>.ready` and then blocks
 *                                          until `<prefix>.go` exists.
 *
 * The two gates exist so a test can hold a `--version` probe and a run's
 * handshake open AT THE SAME TIME and observe what the daemon reports in that
 * overlap, without sleeping on wall-clock timing.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, stdin, stdout, env, exit } from 'node:process';

const CLI_VERSION = env.FAKE_ACP_CLI_VERSION || '0.38.0';
const SESSION_NEW_ERROR_MESSAGE =
  env.FAKE_ACP_SESSION_NEW_ERROR_MESSAGE || 'Internal error';
const SESSION_NEW_ERROR_RETRYABLE = env.FAKE_ACP_SESSION_NEW_ERROR_RETRYABLE === '1';
const INVOCATION_LOG = env.FAKE_ACP_INVOCATION_LOG || '';
const VERSION_GATE = env.FAKE_ACP_VERSION_GATE || '';
const SESSION_GATE = env.FAKE_ACP_SESSION_GATE || '';

/**
 * Announces arrival at `<prefix>.ready`, then blocks until the test opens
 * `<prefix>.go`. Polling a file rather than sleeping keeps the overlap the test
 * is constructing exact: the caller knows this process is parked here, and
 * nothing moves until the caller says so.
 */
async function passGate(prefix) {
  if (!prefix) return;
  try {
    mkdirSync(dirname(prefix), { recursive: true });
    writeFileSync(`${prefix}.ready`, String(Date.now()));
  } catch {
    /* best-effort test instrumentation */
  }
  while (!existsSync(`${prefix}.go`)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function logInvocation(entry) {
  if (!INVOCATION_LOG) return;
  try {
    mkdirSync(dirname(INVOCATION_LOG), { recursive: true });
    appendFileSync(INVOCATION_LOG, `${JSON.stringify(entry)}\n`);
  } catch {
    /* the log is best-effort test instrumentation */
  }
}

function write(message) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

const mode = argv[2] || '';

if (mode === '--version' || mode === 'version') {
  await passGate(VERSION_GATE);
  stdout.write(`${CLI_VERSION}\n`);
  exit(0);
}

if (mode !== 'acp') {
  // Unknown subcommand: behave like a CLI that does not implement it.
  exit(0);
}

let clientName = 'unknown';
let buffer = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) void handleLine(line);
    index = buffer.indexOf('\n');
  }
});
stdin.on('end', () => exit(0));

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object' || message.id === undefined) return;

  if (message.method === 'initialize') {
    const info = message.params && message.params.clientInfo;
    if (info && typeof info.name === 'string') clientName = info.name;
    // A healthy handshake step: the CLI is installed, invocable, and speaks ACP.
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false, promptCapabilities: {} },
      },
    });
    return;
  }

  if (message.method === 'session/new' || message.method === 'session/load') {
    logInvocation({ method: message.method, client: clientName, at: Date.now() });
    // Gated only for a real run. `detectAcpModels` probes the same CLI as
    // `open-design-detect`, and holding THAT open would stall the very
    // `/api/agents` refresh the test is trying to overlap with.
    if (clientName === 'open-design') await passGate(SESSION_GATE);
    // The broken build: it accepted the connection and then refuses to open a
    // session. `rpcErrorMessage` renders this as `json-rpc id <id>: <message>`.
    write({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32603,
        message: SESSION_NEW_ERROR_MESSAGE,
        ...(SESSION_NEW_ERROR_RETRYABLE ? { data: { retryable: true } } : {}),
      },
    });
    return;
  }

  write({ jsonrpc: '2.0', id: message.id, result: {} });
}
