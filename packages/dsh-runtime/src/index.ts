import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-loader';
import {
  installModelSelection,
  type AgentHandle,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-agent-default-model';
import { createUserMessage, type ContentBlock, type TokenUsage } from '@deepseek-ai/dsh-llm';
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-cmdline';
import { CAPABILITIES, identityFrame, parseHostCommand, type ExecuteCommand } from './protocol.js';

export const name = 'open-design-runtime';
export const inject = [
  'openDesignStartup',
  'agentDefaultModel',
  'agents',
  'sessions',
  'sessionPersistence',
];

const PLUGIN_VERSION = '0.1.0';

type Output = { write(chunk: string): unknown };

function writeFrame(output: Output, frame: unknown): void {
  output.write(`${JSON.stringify(frame)}\n`);
}

function errorFacts(error: unknown, fallbackCode: string) {
  return {
    code: typeof (error as { code?: unknown } | null)?.code === 'string'
      ? (error as { code: string }).code
      : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function contentText(content: readonly ContentBlock[]): string {
  const text: string[] = [];
  const visit = (blocks: readonly ContentBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'text' || block.type === 'reasoning') text.push(block.text);
      if (block.type === 'tool-result') visit(block.content);
    }
  };
  visit(content);
  return text.join('');
}

function resultStatus(reason: TurnEndReason | undefined): 'completed' | 'cancelled' | 'failed' {
  if (reason?.kind === 'completed' || reason?.kind === 'max-tokens') return 'completed';
  if (reason?.kind === 'aborted') return 'cancelled';
  return 'failed';
}

function usageFrame(requestId: string, provider: string, model: string, usage: TokenUsage) {
  return {
    v: 1,
    type: 'usage',
    request_id: requestId,
    provider,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    ...(usage.cacheReadTokens === undefined ? {} : { cache_read_tokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cache_write_tokens: usage.cacheWriteTokens }),
  };
}

function emitSessionEvent(
  output: Output,
  request: ExecuteCommand,
  provider: string,
  model: string,
  event: SessionEvent,
): void {
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = event.data.chunk;
      if (chunk.type === 'text-delta' && chunk.text !== '') {
        writeFrame(output, { v: 1, type: 'text', request_id: request.request_id, content: chunk.text });
      } else if (chunk.type === 'reasoning-delta' && chunk.text !== '') {
        writeFrame(output, { v: 1, type: 'thinking', request_id: request.request_id, content: chunk.text });
      }
      return;
    }
    case 'tool/call':
      writeFrame(output, {
        v: 1,
        type: 'tool_call',
        request_id: request.request_id,
        call_id: String(event.data.callId),
        name: event.data.name,
        arguments: event.data.arguments,
      });
      return;
    case 'tool/result':
      writeFrame(output, {
        v: 1,
        type: 'tool_result',
        request_id: request.request_id,
        call_id: String(event.data.message.content[0].toolCallId),
        name: event.data.error?.name ?? 'tool',
        output: contentText(event.data.message.content[0].content),
        is_error: event.data.message.content[0].isError === true,
      });
      return;
    case 'assistant/message':
      if (event.data.usage) writeFrame(output, usageFrame(request.request_id, provider, model, event.data.usage));
      return;
    default:
      return;
  }
}

async function execute(
  ctx: Context,
  request: ExecuteCommand,
  output: Output,
  onHandle: (handle: AgentHandle | undefined) => void,
  signal: AbortSignal,
): Promise<void> {
  const defaultSelection = ctx.agentDefaultModel.currentSelection();
  const selection = request.model
    ? { provider: request.model.provider, model: request.model.id }
    : defaultSelection;
  const sessionId = SessionId(request.resume_session_id ?? `od-${randomUUID()}`);
  let handle: AgentHandle | undefined;
  let firstSeq = 0;
  let turnEnd: SessionEvent<'turn/end'> | undefined;
  let assistantOutput = '';
  const setup = (agentCtx: Context) => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined };
    installModelSelection(agentCtx, selected);
  };
  const disposeEvent = ctx.on('session/event', (session, event) => {
    if (String(session.id) !== String(sessionId) || event.seq < firstSeq) return;
    emitSessionEvent(output, request, selection.provider, selection.model, event);
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      assistantOutput += event.data.chunk.text;
    }
    if (event.type === 'turn/end') turnEnd = event;
  });

  try {
    try {
      handle = request.resume_session_id
        ? await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: selection, setup, signal })
        : await ctx.agents.create({
            sessionId,
            meta: { cwd: request.cwd },
            agentOptions: selection,
            setup,
            signal,
          });
      onHandle(handle);
    } catch (error: unknown) {
      if (signal.aborted) {
        writeFrame(output, {
          v: 1,
          type: 'result',
          request_id: request.request_id,
          status: 'cancelled',
          session_id: String(sessionId),
          resume_rejected: false,
        });
        return;
      }
      const facts = errorFacts(error, request.resume_session_id
        ? 'DSH_PROFILE_RESUME_REJECTED'
        : 'DSH_PROFILE_SESSION_CREATE_FAILED');
      writeFrame(output, {
        v: 1,
        type: 'result',
        request_id: request.request_id,
        status: 'failed',
        session_id: String(sessionId),
        resume_rejected: Boolean(request.resume_session_id),
        error: facts,
      });
      return;
    }

    writeFrame(output, {
      v: 1,
      type: 'session',
      request_id: request.request_id,
      session_id: String(sessionId),
      resumed: Boolean(request.resume_session_id),
    });
    await handle.agent.whenIdle();
    firstSeq = handle.agent.session.seq;
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: request.prompt }],
      source: { kind: 'user' },
    }));
    await handle.agent.whenIdle();
    await ctx.sessions.flush(handle.agent.session);

    const reason = turnEnd?.data.reason;
    const status = resultStatus(reason);
    const failed = reason?.kind === 'error' ? reason.error : undefined;
    writeFrame(output, {
      v: 1,
      type: 'result',
      request_id: request.request_id,
      status,
      session_id: String(sessionId),
      output: assistantOutput,
      stop_reason: reason?.kind ?? 'unknown',
      resume_rejected: false,
      ...(failed === undefined ? {} : { error: failed }),
    });
  } catch (error: unknown) {
    writeFrame(output, {
      v: 1,
      type: 'result',
      request_id: request.request_id,
      status: 'failed',
      session_id: String(sessionId),
      resume_rejected: false,
      error: errorFacts(error, 'DSH_PROFILE_EXECUTION_FAILED'),
    });
  } finally {
    disposeEvent();
    await handle?.dispose().catch(() => undefined);
    onHandle(undefined);
  }
}

async function serve(ctx: Context, output: Output, exit: (code: number) => void): Promise<void> {
  writeFrame(output, identityFrame('ready', PLUGIN_VERSION));
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let requestId: string | null = null;
  let handle: AgentHandle | undefined;
  let task: Promise<void> | undefined;
  let taskAbort: AbortController | undefined;
  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      lines.close();
      resolve();
    };
    lines.on('line', (line) => {
      if (line.trim() === '') return;
      let command;
      try {
        command = parseHostCommand(JSON.parse(line) as unknown);
      } catch {
        writeFrame(output, {
          v: 1,
          type: 'protocol_error',
          ...(requestId ? { request_id: requestId } : {}),
          code: 'DSH_PROFILE_INVALID_COMMAND',
          message: 'Open Design sent an invalid profile command.',
        });
        return;
      }
      if (command.type === 'cancel') {
        if (command.request_id === requestId) {
          taskAbort?.abort();
          handle?.agent.cancel({ kind: 'user' });
        }
        return;
      }
      if (task) {
        writeFrame(output, {
          v: 1,
          type: 'protocol_error',
          request_id: command.request_id,
          code: 'DSH_PROFILE_BUSY',
          message: 'This profile process accepts exactly one execute command.',
        });
        return;
      }
      requestId = command.request_id;
      taskAbort = new AbortController();
      task = execute(
        ctx,
        command,
        output,
        (nextHandle) => { handle = nextHandle; },
        taskAbort.signal,
      );
      void task.finally(settle);
    });
    lines.on('close', () => {
      if (!task) settle();
    });
  });
  exit(0);
}

export function apply(ctx: Context): void {
  const startup = ctx.openDesignStartup;
  const exit = ctx.get('appExit');
  if (!startup || !exit) throw new Error('open-design-runtime requires startup and appExit services');
  if (startup.mode === 'probe') {
    writeFrame(process.stdout, identityFrame('probe', PLUGIN_VERSION));
    exit(0);
    return;
  }
  void ctx.get('loader')?.await().then(() => serve(ctx, process.stdout, exit)).catch((error: unknown) => {
    process.stderr.write(`open-design-runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
}

export const internals = {
  contentText,
  emitSessionEvent,
  resultStatus,
};
