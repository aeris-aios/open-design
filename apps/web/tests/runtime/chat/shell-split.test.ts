/**
 * 什么时候该多出第二张执行记录壳。
 *
 * **2026-08-26 裁决(现行)**:「第一张卡片那边还没产生 todo,那部分收起的应该只有
 * 工具调用或 thinking……当有了 todo 后,**来了第二张卡片**,第一个展开收起卡片就收起」。
 * 判据 = **第一张壳里有没有东西**(工具 / thinking 都算),空壳仍然复用。
 *
 * 上一版(T34,2026-08-25)是「清单之前**说过话**才分张」。它的顾虑是:分出来两张都写
 * 「已完成」、**耗时还是同一个数**,读着像同一件事说了两遍 —— 那是耗时按轮次算的 bug,
 * 已经在 `shell-elapsed.test.ts` 里修掉(每张壳按自己的起止定秒)。
 * 两条裁决的取舍记在 `specs/current/chat-panel-feedback.md`。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';

const call = (id: string, name: string, input: unknown): PersistedAgentEvent[] => ([
  { kind: 'tool_use', id, name, input },
  { kind: 'tool_result', toolUseId: id, content: 'ok', isError: false },
]);

const todo = (id: string, items: Array<[string, string]>): PersistedAgentEvent[] => ([
  { kind: 'tool_use', id, name: 'TodoWrite', input: { todos: items.map(([content, status]) => ({ content, status })) } },
]);

const shells = (events: PersistedAgentEvent[]) =>
  buildTurnBlocks({ events, runStatus: 'succeeded' }).filter((b) => b.kind === 'shell');

describe('第二张壳的出现条件', () => {
  it('清单之前干过活 → 分成两张:活在第一张,清单在第二张', () => {
    const out = shells([
      ...call('t1', 'Read', { file_path: 'a.css' }),
      ...call('t2', 'Bash', { command: 'ls' }),
      ...todo('p1', [['复刻列表页', 'in_progress']]),
      ...call('t3', 'Write', { file_path: 'card.html', content: 'x' }),
    ]);
    expect(out).toHaveLength(2);
    const first = (out[0] as { items: Array<{ kind: string }> }).items.map((i) => i.kind);
    const second = (out[1] as { items: Array<{ kind: string }> }).items.map((i) => i.kind);
    expect(first).toEqual(['tool', 'tool']);
    expect(second).toEqual(['plan', 'todo']);
  });

  it('清单之前**什么都没干** → 空壳复用,不多出一张空卡', () => {
    const out = shells([
      ...todo('p1', [['复刻列表页', 'in_progress']]),
      ...call('t3', 'Write', { file_path: 'card.html', content: 'x' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('清单之前说过话 → 话在**壳外**,第一张壳只留工具', () => {
    // 2026-08-26 裁决:没有 todo 的阶段,正文不进壳。所以「说过话」不再体现为
    // 第一张壳里的 text,而是壳外多出一段 prose。
    const blocks = buildTurnBlocks({
      events: [
        { kind: 'text', text: '我先看一眼两张图的栅格。' },
        ...call('t1', 'Read', { file_path: 'a.css' }),
        ...todo('p1', [['复刻列表页', 'in_progress']]),
        ...call('t2', 'Write', { file_path: 'card.html', content: 'x' }),
      ],
      runStatus: 'succeeded',
    });
    const out = blocks.filter((b) => b.kind === 'shell');
    expect(out).toHaveLength(2);
    const first = out[0] as { items: Array<{ kind: string }> };
    expect(first.items.map((i) => i.kind)).toEqual(['tool']);
    expect(blocks.filter((b) => b.kind === 'prose').map((b) => (b as { text: string }).text))
      .toEqual(['我先看一眼两张图的栅格。']);
  });

  it('第一张壳完全空着时仍然直接复用,不留空壳(D13,老规则不动)', () => {
    const out = shells([
      ...todo('p1', [['复刻列表页', 'in_progress']]),
      ...call('t1', 'Write', { file_path: 'card.html', content: 'x' }),
    ]);
    expect(out).toHaveLength(1);
  });
});
