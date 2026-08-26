// @vitest-environment node
/**
 * 落块规则(2026-08-26 产品裁决,原话见 `specs/current/chat-panel-feedback.md` D 节)。
 *
 *   1. 还没有 todo 时:壳里**只收工具调用 / thinking**,普通正文留在**壳外**。
 *   2. 第一条 TodoWrite 落下:另起第二张壳;此前已经落在壳外的正文**原地不动**。
 *   3. 有 todo 之后:后续**所有**内容(工具 / thinking / 正文)都收进
 *      **当前正在进行的那条 todo**。
 *
 * 这条收紧了 D43(原来「done 之前的过程叙述画在壳里」)——
 * 现在「过程叙述」在**没有 todo 的阶段属于壳外**。thinking 任何阶段都在壳里。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, TurnBlock } from '../../../src/runtime/chat/contract';

const call = (id: string, name: string, input: unknown): PersistedAgentEvent[] => ([
  { kind: 'tool_use', id, name, input },
  { kind: 'tool_result', toolUseId: id, content: 'ok', isError: false },
]);

const todos = (id: string, items: Array<[string, string]>): PersistedAgentEvent[] => ([
  { kind: 'tool_use', id, name: 'TodoWrite', input: { todos: items.map(([content, status]) => ({ content, status })) } },
]);

const build = (events: PersistedAgentEvent[], runStatus: 'running' | 'succeeded' = 'running'): TurnBlock[] =>
  buildTurnBlocks({ events, runStatus, nowMs: 60_000 });

const shellsOf = (blocks: TurnBlock[]): ExecutionShell[] =>
  blocks.filter((b): b is ExecutionShell => b.kind === 'shell');

const proseOf = (blocks: TurnBlock[]): string[] =>
  blocks.filter((b) => b.kind === 'prose').map((b) => (b as { text: string }).text);

const shellTexts = (shell: ExecutionShell): string[] =>
  shell.items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);

describe('规则 1 · 还没有 todo:正文在壳外,工具与 thinking 在壳里', () => {
  const events: PersistedAgentEvent[] = [
    { kind: 'thinking', text: '先看一眼两张图的栅格。' },
    ...call('t1', 'Read', { file_path: '首页.png' }),
    { kind: 'text', text: '两页都好了,商品卡已经抽成共享组件。' },
  ];

  it('普通正文落在壳外', () => {
    expect(proseOf(build(events))).toContain('两页都好了,商品卡已经抽成共享组件。');
  });

  it('壳里没有那段正文', () => {
    const [shell] = shellsOf(build(events));
    expect(shellTexts(shell!)).not.toContain('两页都好了,商品卡已经抽成共享组件。');
  });

  it('thinking 仍然在壳里', () => {
    const [shell] = shellsOf(build(events));
    expect(shellTexts(shell!)).toContain('先看一眼两张图的栅格。');
  });

  it('工具调用仍然在壳里', () => {
    const [shell] = shellsOf(build(events));
    expect(shell!.items.some((i) => i.kind === 'tool')).toBe(true);
  });
});

describe('规则 2 · 清单一到就另起一张壳,之前的壳外正文原地不动', () => {
  const events: PersistedAgentEvent[] = [
    ...call('t1', 'Read', { file_path: '首页.png' }),
    { kind: 'text', text: '看完了,开始动手。' },
    ...todos('p1', [['复刻列表页', 'in_progress'], ['抽出商品卡', 'pending']]),
    ...call('t2', 'Write', { file_path: 'a.html', content: 'x' }),
  ];

  it('分成两张壳', () => {
    expect(shellsOf(build(events))).toHaveLength(2);
  });

  it('第一张壳收起(不再是进行中)', () => {
    expect(shellsOf(build(events))[0]!.status).not.toBe('running');
  });

  it('那段正文还在壳外', () => {
    expect(proseOf(build(events))).toContain('看完了,开始动手。');
  });
});

describe('规则 3 · 有 todo 之后,连正文也进当前那条 todo', () => {
  const events: PersistedAgentEvent[] = [
    ...todos('p1', [['复刻列表页', 'in_progress'], ['抽出商品卡', 'pending']]),
    ...call('t1', 'Write', { file_path: 'a.html', content: 'x' }),
    { kind: 'text', text: '列表页写完了,接着抽卡。' },
  ];

  it('正文不在壳外', () => {
    expect(proseOf(build(events))).not.toContain('列表页写完了,接着抽卡。');
  });

  it('正文落在进行中的那条 todo 里', () => {
    const shells = shellsOf(build(events));
    const card = shells[shells.length - 1]!;
    const current = card.segments.find((s) => s.status === 'in_progress');
    expect(current).toBeTruthy();
    const texts = current!.items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
    expect(texts).toContain('列表页写完了,接着抽卡。');
  });
});
