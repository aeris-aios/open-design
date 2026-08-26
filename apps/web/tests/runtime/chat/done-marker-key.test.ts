// @vitest-environment node
/**
 * 红测:done 变成**真协议** —— 每轮一次性密钥。
 *
 * 背景(2026-08-26 核实):
 *  · 裸 `<done/>` 在产品提示词里从来没教过,任何一次命中按定义都是「内容里碰巧出现」。
 *  · 所以它可以被正文伪造:让 agent 输出一段含 `<done/>` 的 HTML、或者让它解释这个标签,
 *    后面的正文就被错误地甩到壳外(有 todo 时结论甚至会提前逃出 todo)。
 *
 * 新协议:daemon 每轮现生成一个随机 key,注入系统提示词,并随 SSE 下发
 * (`{ kind: 'done_key' }` 事件,和其它事件一起落库)。客户端**只认这一轮的 key**。
 * 模型复制不出它没见过的 key,所以正文伪造不了。
 *
 * 这个文件钉三件事:
 *   1. 带正确 key 的标记算信号,带错 key / 裸 `<done/>` 都不算;
 *   2. **旧数据**(没有 key 事件的历史消息)落块与改动前逐块一致;
 *   3. 标记被 SSE 逐字节切开时,半截字符一个都不许出现在屏幕上。
 */
import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell, TurnBlock } from '../../../src/runtime/chat/contract';
import { HISTORICAL_TURN_FIXTURES } from './historical-turn-fixtures';
import baseline from './historical-turn-baseline.json';

const BASELINE = baseline as Record<string, unknown>;

const KEY = 'a7f3c91ed2b40561';
const OTHER_KEY = '0123456789abcdef';

const keyEvent = (key: string): PersistedAgentEvent =>
  ({ kind: 'done_key', key }) as PersistedAgentEvent;

const todos = (id: string, items: Array<[string, string]>): PersistedAgentEvent[] => ([
  { kind: 'tool_use', id, name: 'TodoWrite', input: { todos: items.map(([c, s]) => ({ content: c, status: s })) } },
]);

/** 有清单时正文进「当前 todo」;done 一到就跳出 todo。用它判断标记有没有被当成信号 */
function landedOutsideTodo(events: PersistedAgentEvent[]): boolean {
  return buildTurnBlocks({ events, runStatus: 'running' }).some((b) => b.kind === 'prose');
}

/** 屏幕上真正出现过的全部文字(壳内 + 壳外),用来验「标记不许漏出去」 */
function allVisibleText(blocks: TurnBlock[]): string {
  const out: string[] = [];
  const walk = (items: ExecutionShell['items']): void => {
    for (const item of items) {
      if (item.kind === 'text') out.push(item.text);
      else if (item.kind === 'todo') walk(item.segment.items);
    }
  };
  for (const b of blocks) {
    if (b.kind === 'prose') out.push(b.text);
    else walk(b.items);
  }
  return out.join('\n');
}

describe('done 密钥协议 · 只认这一轮的 key', () => {
  it('带**正确** key 的标记算 done', () => {
    expect(landedOutsideTodo([
      keyEvent(KEY),
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: `干完了。<od-done key="${KEY}"/>这是结论。` },
    ])).toBe(true);
  });

  it('带**别人的** key 不算 done —— 伪造不了', () => {
    expect(landedOutsideTodo([
      keyEvent(KEY),
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: `<od-done key="${OTHER_KEY}"/>这段是内容,不是信号。` },
    ])).toBe(false);
  });

  it('这一轮有 key 时,裸 `<done/>` **不再**算 done', () => {
    expect(landedOutsideTodo([
      keyEvent(KEY),
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: '<done/>这段是内容,不是信号。' },
    ])).toBe(false);
  });

  it('key 对不上的标记**不许渲染出来** —— 它是协议噪音,不是正文', () => {
    const blocks = buildTurnBlocks({
      events: [
        keyEvent(KEY),
        ...todos('p1', [['做第一件事', 'in_progress']]),
        { kind: 'text', text: `前面。<od-done key="${OTHER_KEY}"/>后面。` },
      ],
      runStatus: 'running',
    });
    const visible = allVisibleText(blocks);
    expect(visible).toContain('前面。');
    expect(visible).toContain('后面。');
    expect(visible).not.toContain('od-done');
  });

  it('正确的标记本身也不许渲染出来', () => {
    const blocks = buildTurnBlocks({
      events: [
        keyEvent(KEY),
        { kind: 'text', text: `过程。<od-done key="${KEY}"/>结论。` },
      ],
      runStatus: 'succeeded',
    });
    expect(allVisibleText(blocks)).not.toContain('od-done');
  });

  it('围栏代码块里的带 key 标记不算信号(agent 在讲协议本身)', () => {
    expect(landedOutsideTodo([
      keyEvent(KEY),
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: `这样写:\n\`\`\`html\n<od-done key="${KEY}"/>\n\`\`\`\n继续干活。` },
    ])).toBe(false);
  });

  /**
   * 兜底 (a) 会在「清单全关」那一刻就把 doneSeen 置上,而 agent 通常正是在关完最后一条
   * todo **之后**才发标记。这条路径上标记到达时 done 已经定了,老实现从此不再扫描 ——
   * 于是 `<od-done key="…"/>` 会原样画到屏幕上。密钥标记比裸 `<done/>` 长得多、还带着
   * 一串随机字符,漏出来格外刺眼。
   */
  it('清单已经全关之后才发的标记,也不许渲染出来', () => {
    const blocks = buildTurnBlocks({
      events: [
        keyEvent(KEY),
        ...todos('p1', [['做第一件事', 'in_progress']]),
        { kind: 'text', text: '干活中。' },
        ...todos('p2', [['做第一件事', 'completed']]),
        { kind: 'text', text: `<od-done key="${KEY}"/>都弄好了。` },
      ],
      runStatus: 'succeeded',
    });
    const visible = allVisibleText(blocks);
    expect(visible).not.toContain('od-done');
    expect(visible).not.toContain(KEY);
    expect(visible).toContain('都弄好了。');
  });

  it('done 之后被切成两半的标记也不许露半截', () => {
    const blocks = buildTurnBlocks({
      events: [
        keyEvent(KEY),
        ...todos('p1', [['做第一件事', 'completed']]),
        { kind: 'text', text: `<od-done key="${KEY.slice(0, 6)}` },
        { kind: 'text', text: `${KEY.slice(6)}"/>都弄好了。` },
      ],
      runStatus: 'succeeded',
    });
    const visible = allVisibleText(blocks);
    expect(visible).not.toContain('od-done');
    expect(visible).toContain('都弄好了。');
  });

  it('有 key 的轮次里,`<artifact>` 仍然算隐式 done', () => {
    expect(landedOutsideTodo([
      keyEvent(KEY),
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: '<artifact type="html">…' },
    ])).toBe(true);
  });
});

describe('旧数据兼容 · 没有 key 的历史消息落块与改动前一致', () => {
  it('裸 `<done/>` 在**没有 key** 的轮次里仍然算 done', () => {
    expect(landedOutsideTodo([
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: '<done/>这是结论。' },
    ])).toBe(true);
  });

  it('隐式 done(`<artifact>`)在没有 key 的轮次里仍然算', () => {
    expect(landedOutsideTodo([
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: '<artifact type="html">…' },
    ])).toBe(true);
  });

  it('没有 key 时代码区间防护照旧生效', () => {
    expect(landedOutsideTodo([
      ...todos('p1', [['做第一件事', 'in_progress']]),
      { kind: 'text', text: '这个标记写作 `<done/>`,别手打。' },
    ])).toBe(false);
  });

  /**
   * 这条是硬指标,也是整个改动里最该红的一条。
   *
   * `historical-turn-baseline.json` 是**改动前**的实现(git HEAD 上的
   * `build-turn-blocks.ts`)跑 `historical-turn-fixtures.ts` 逐字导出的结果 ——
   * 不是我手写的期望值,是当时的真实输出。这里做全量深比较:壳的分张、每一行落在
   * 哪个 todo 里、哪几段留在壳外、耗时、todo 状态,全都要一模一样。
   *
   * 任何「没有 key 就一律吞进抽屉」「没有 key 就一律甩到壳外」「顺手把老判据也改了」
   * 的实现,都会在这里红。
   *
   * 基线要重新生成时:把 HEAD 上的 build-turn-blocks.ts 拷进 src 跑一遍这批 fixture,
   * 覆盖这个 JSON —— 但先想清楚为什么历史消息的渲染需要变。
   */
  it('九种历史轮次:落块与改动前逐字一致', () => {
    for (const [name, input] of Object.entries(HISTORICAL_TURN_FIXTURES)) {
      const actual = JSON.parse(JSON.stringify(buildTurnBlocks(input)));
      expect(actual, `历史轮次 ${name} 的落块变了`).toEqual(BASELINE[name]);
    }
  });

  it('基线覆盖到了每一条 fixture(别让 fixture 悄悄漏出基线)', () => {
    expect(Object.keys(BASELINE).sort()).toEqual(Object.keys(HISTORICAL_TURN_FIXTURES).sort());
  });
});

describe('流式不闪 · 标记被切成两半时半截字符不许上屏', () => {
  const marker = `<od-done key="${KEY}"/>`;
  const head = '正在收尾。';
  const tail = '这是结论。';
  const full = `${head}${marker}${tail}`;

  /**
   * 逐字节切开:每个切点都当成两条 SSE `text_delta` 送进去,
   * 断言**任何一个中间帧**都没有把半截标记画到屏幕上。
   */
  it('每一个切点上,屏幕上都不出现半截标记', () => {
    for (let cut = 0; cut <= full.length; cut += 1) {
      const first = full.slice(0, cut);
      const second = full.slice(cut);
      // 第一帧到达后的中间态 —— 这一帧就是用户眼睛真正看到的东西
      const mid = allVisibleText(buildTurnBlocks({
        events: [keyEvent(KEY), { kind: 'text', text: first }],
        runStatus: 'running',
      }));
      // 这段 fixture 自己一个 `<` 都没有 —— 屏幕上出现尖括号,就只能是半截标记漏出去了
      expect(mid, `切点 ${cut} 漏了半截标记: ${JSON.stringify(mid)}`).not.toContain('<');
      expect(mid, `切点 ${cut} 漏了标记名: ${JSON.stringify(mid)}`).not.toMatch(/od-done/i);
      expect(mid, `切点 ${cut} 漏了 key: ${JSON.stringify(mid)}`).not.toContain(KEY.slice(0, 4));

      // 两帧都到齐之后,结论必须完整落在壳外,一个字不少
      const done = buildTurnBlocks({
        events: [keyEvent(KEY), { kind: 'text', text: first }, { kind: 'text', text: second }],
        runStatus: 'succeeded',
      });
      const prose = done.filter((b) => b.kind === 'prose').map((b) => (b as { text: string }).text).join('');
      expect(prose, `切点 ${cut} 结论不完整`).toContain(tail);
    }
  });

  it('三帧切开(标记被切成三段)也不闪', () => {
    const a = full.indexOf(marker) + 3;
    const b = full.indexOf(marker) + marker.length - 3;
    const frames = [full.slice(0, a), full.slice(a, b), full.slice(b)];
    for (let n = 1; n <= frames.length; n += 1) {
      const mid = allVisibleText(buildTurnBlocks({
        events: [keyEvent(KEY), ...frames.slice(0, n).map((text) => ({ kind: 'text', text }) as PersistedAgentEvent)],
        runStatus: n === frames.length ? 'succeeded' : 'running',
      }));
      if (n < frames.length) expect(mid).not.toContain('od-done');
    }
    const final = buildTurnBlocks({
      events: [keyEvent(KEY), ...frames.map((text) => ({ kind: 'text', text }) as PersistedAgentEvent)],
      runStatus: 'succeeded',
    });
    expect(allVisibleText(final)).not.toContain('od-done');
    expect(final.filter((x) => x.kind === 'prose').map((x) => (x as { text: string }).text).join('')).toContain(tail);
  });

  it('正文里普通的 `<` 不会被扣住不放', () => {
    const blocks = buildTurnBlocks({
      events: [keyEvent(KEY), { kind: 'text', text: '当 x < 3 时走这条分支。' }],
      runStatus: 'running',
    });
    expect(allVisibleText(blocks)).toContain('当 x < 3 时走这条分支。');
  });
});
