/**
 * The unfinished-work handoff block — the one channel that carries "what was
 * still open when the previous turn ended" back to the agent.
 *
 * Why this exists at all: nothing else in the pipeline can carry it. The
 * conversation history the daemon renders (`buildDaemonTranscript`) is plain
 * text built from `message.content`, and `content` only accumulates
 * `kind === 'text'` events. A task list is a `tool_use`, so it can never reach
 * the transcript. The 21 runtimes without native session resume therefore start
 * every turn with zero knowledge of the plan they wrote one turn earlier.
 *
 * Why it lives HERE and not in the system prompt: the stable instruction slice
 * (see `stable-sections.ts` in the daemon) is hashed per conversation and
 * re-sent only when it changes; upstream prompt caching keys off exactly that
 * prefix. A list that changes every turn would move the prefix every turn — a
 * guaranteed cache miss on every turn of every conversation. The per-turn user
 * body carries no such penalty.
 *
 * Why it lives in CONTRACTS and not in the daemon: the daemon composes one user
 * body for both execution profiles (`filesystem` CLI runs and `plain`
 * API/BYOK runs). Keeping the single renderer here makes "the two modes say the
 * same thing" structurally true instead of a rule someone has to remember. The
 * wording is deliberately tool-agnostic for the same reason — API mode has no
 * TodoWrite (see `API_MODE_OVERRIDE` in ./system.ts), so this block must never
 * name a tool.
 *
 * Tone contract: this block STATES A FACT and HANDS THE DECISION BACK. It is
 * not an instruction to resume. Whether this turn picks the work back up,
 * replans it, or ignores it because the user moved on is the agent's call —
 * that is the product's explicit shape. The client side does not decide
 * anything either: it only recognizes items the agent chose to re-emit.
 */

import {
  isTodoWriteToolName,
  todoItemsFromTodoWriteInput,
  todoStatusIsUnfinished,
} from '../api/run-completeness.js';

/** One carried-over task: the agent's own wording plus the status it stopped at. */
export interface RecalledTodo {
  content: string;
  status: string;
}

/** Heading the block opens with. Exported so callers can detect/strip it. */
export const UNFINISHED_TODO_RECALL_HEADING = '## Unfinished tasks from an earlier turn';

/**
 * A task list item's wording, across the shapes different runtimes emit.
 * Mirrors `parseTodoWriteInput` in apps/web/src/runtime/todos.ts — the two must
 * agree, because the client matches recall by exact content string (D17) and a
 * field the daemon read differently would break that match.
 */
function todoContent(todo: unknown): string {
  if (!todo || typeof todo !== 'object') return '';
  const record = todo as Record<string, unknown>;
  for (const key of ['content', 'step', 'description', 'label', 'text']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function todoStatus(todo: unknown): string {
  if (!todo || typeof todo !== 'object') return 'pending';
  const record = todo as Record<string, unknown>;
  if (record.completed === true) return 'completed';
  return typeof record.status === 'string' && record.status ? record.status : 'pending';
}

/**
 * The still-open items of a TodoWrite tool_use's raw `input`.
 *
 * "Open" is the repository's one canonical predicate (`todoStatusIsUnfinished`):
 * anything other than `completed`, including `stopped`. A snapshot with nothing
 * open returns `[]`, which is the caller's signal to inject nothing at all.
 */
export function unfinishedTodosFromTodoWriteInput(input: unknown): RecalledTodo[] {
  const items = todoItemsFromTodoWriteInput(input);
  if (!Array.isArray(items)) return [];
  const out: RecalledTodo[] = [];
  for (const item of items) {
    const content = todoContent(item);
    if (!content) continue;
    const status = todoStatus(item);
    if (!todoStatusIsUnfinished(status)) continue;
    out.push({ content, status });
  }
  return out;
}

/**
 * The most recent TodoWrite tool_use `input` inside one message's persisted
 * event array, or `null` when that message declared no task list. Persisted
 * events carry `kind`, not the live stream's `type`.
 */
export function latestTodoWriteInputFromEvents(events: unknown): unknown | null {
  if (!Array.isArray(events)) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || typeof event !== 'object') continue;
    const record = event as { kind?: unknown; name?: unknown; input?: unknown };
    if (record.kind !== 'tool_use' || !isTodoWriteToolName(record.name)) continue;
    return record.input ?? null;
  }
  return null;
}

/**
 * Render the handoff block, or `null` when there is nothing outstanding.
 *
 * `null` is load-bearing: the caller must then produce a user body that is
 * BYTE-IDENTICAL to the pre-feature one, so a conversation with no outstanding
 * work cannot shift a single prompt byte.
 */
export function renderUnfinishedTodoRecall(
  todos: readonly RecalledTodo[] | null | undefined,
): string | null {
  if (!todos || todos.length === 0) return null;
  const lines = todos.map(
    (todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`,
  );
  return [
    UNFINISHED_TODO_RECALL_HEADING,
    '',
    'The most recent task list in this conversation still had these items open when that turn ended:',
    '',
    ...lines,
    '',
    'This is context, not an instruction, and the user did not write it. You decide what this turn does with it: pick those items back up, replan them, or leave them alone because the user is asking about something else now.',
    '',
    'If you do pick any of them back up, list those items again in this turn\'s task list using their original wording above, so the user can see which ones carried over. Do not mention this note itself to the user.',
  ].join('\n');
}
