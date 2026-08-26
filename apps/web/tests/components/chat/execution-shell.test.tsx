// @vitest-environment jsdom
/**
 * 执行记录组件:把 buildTurnBlocks 的产出画出来。
 * 这里**不重复测落块规则**(那在 runtime/chat 的单测里),测的是「同一份数据画成什么样」——
 * 壳头四种样子、清单分段、划线与可展开、平铺形态。
 *
 * 用真实的 buildTurnBlocks 产出当输入,而不是手捏 shell 对象:
 * 手捏的话组件与数据层可能各自漂移,接起来才发现对不上。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { I18nProvider } from '../../../src/i18n';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell as ShellData } from '../../../src/runtime/chat/contract';

afterEach(() => { cleanup(); });

const render = (ui: ReactElement) => rtlRender(<I18nProvider initial="zh-CN">{ui}</I18nProvider>);

function shellsOf(events: PersistedAgentEvent[], runStatus?: 'succeeded' | 'failed' | 'canceled' | 'running'): ShellData[] {
  return buildTurnBlocks({ events, runStatus, nowMs: 60_000 })
    .filter((b): b is ShellData => b.kind === 'shell');
}

const nth = <T,>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} missing`);
  return v;
};

function call(id: string, name: string, input: unknown, opts: { content?: string; startedAt?: number; completedAt?: number } = {}): PersistedAgentEvent[] {
  return [
    opts.startedAt != null
      ? { kind: 'tool_use', id, name, input, startedAt: opts.startedAt }
      : { kind: 'tool_use', id, name, input },
    {
      kind: 'tool_result',
      toolUseId: id,
      content: opts.content ?? 'ok',
      isError: false,
      ...(opts.completedAt != null ? { completedAt: opts.completedAt } : {}),
    },
  ];
}

const todo = (id: string, items: Array<[string, string]>): PersistedAgentEvent[] => ([
  { kind: 'tool_use', id, name: 'TodoWrite', input: { todos: items.map(([content, status]) => ({ content, status })) } },
]);

describe('壳头', () => {
  it('运行中:会动的「进行中」+ 球,默认摊开', () => {
    const [shell] = shellsOf([{ kind: 'status', label: 'requesting' }, ...call('t1', 'Bash', { command: 'ls' })], 'running');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(document.querySelector('[data-orb="connecting"]')).not.toBeNull();
    expect(document.querySelector('details')?.open).toBe(true);
  });

  it('收到 thinking 就换成「思考中」并带三个点 —— 即使一个字都没有(S21)', () => {
    const [shell] = shellsOf([{ kind: 'thinking', text: '' }], 'running');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText(/思考中/)).toBeTruthy();
    expect(document.querySelector('[data-orb="composing"]')).not.toBeNull();
  });

  it('结束:纯文本「已完成」,默认收起,球撤掉', () => {
    const [shell] = shellsOf(call('t1', 'Bash', { command: 'ls' }), 'succeeded');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(document.querySelector('[data-orb]')).toBeNull();
    expect(document.querySelector('details')?.open).toBe(false);
  });

  it('整轮失败:状态词换成「运行失败」,默认收起(原因交给报错卡)', () => {
    const [shell] = shellsOf(call('t1', 'Bash', { command: 'npm run build' }), 'failed');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText('运行失败')).toBeTruthy();
    expect(document.querySelector('details')?.open).toBe(false);
  });

  it('手动停止:状态词仍是「进行中」,不挂球(秒数停住,不是第四种状态)', () => {
    const [shell] = shellsOf(call('t1', 'Bash', { command: 'ls' }), 'canceled');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(document.querySelector('[data-orb]')).toBeNull();
  });

  it('空态:没有内容时不出箭头(D21)', () => {
    const [shell] = shellsOf([{ kind: 'status', label: 'requesting' }], 'running');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(document.querySelector('details svg')).toBeNull();
  });

  it('壳头耗时按粗档写(31s 而不是 31.0s)', () => {
    const [shell] = shellsOf(call('t1', 'Bash', { command: 'ls' }, { startedAt: 0, completedAt: 31_000 }), 'succeeded');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText('31s')).toBeTruthy();
  });
});

describe('有清单:按 todo 分段', () => {
  const events = [
    ...todo('p1', [['复刻商品列表页', 'in_progress'], ['抽出商品卡', 'pending'], ['按同一套间距做设置页', 'pending']]),
    ...call('t1', 'Bash', { command: 'grep -n gap a.css' }, { content: 'a.css:1: gap' }),
    ...todo('p2', [['复刻商品列表页', 'completed'], ['抽出商品卡', 'completed'], ['按同一套间距做设置页', 'in_progress']]),
    ...call('t2', 'Write', { file_path: 'card.html', content: 'x\ny' }),
  ];

  it('清单卡先出「执行计划 · N 步」', () => {
    const shells = shellsOf(events, 'succeeded');
    render(<ExecutionShell shell={nth(shells, shells.length - 1)} />);
    expect(screen.getByText('执行计划 · 3 步')).toBeTruthy();
  });

  it('做过事的那条可展开;一次性关掉、名下没内容的那条划线且没有箭头(D35)', () => {
    const shells = shellsOf(events, 'succeeded');
    render(<ExecutionShell shell={nth(shells, shells.length - 1)} />);
    const drawers = [...document.querySelectorAll('details details')];
    const byName = (name: string) => drawers.find((d) => d.querySelector('summary')?.textContent?.includes(name));

    const worked = byName('复刻商品列表页');
    expect(worked?.querySelector('summary svg')).not.toBeNull();   // 有箭头 = 可展开

    const empty = byName('抽出商品卡');
    expect(empty?.querySelector('summary svg')).toBeNull();        // 无箭头
    const strucked = empty?.querySelector('summary span[class*="struck"]');
    expect(strucked).not.toBeNull();                               // 划线
  });

  it('正在跑的那条默认摊开', () => {
    // 必须用「还在跑」的轮次:轮次一结束,没关掉的 todo 会被收成停止态,自然也就不该再摊开
    const shells = shellsOf(events, 'running');
    render(<ExecutionShell shell={nth(shells, shells.length - 1)} />);
    const drawers = [...document.querySelectorAll('details details')] as HTMLDetailsElement[];
    const current = drawers.find((d) => d.querySelector('summary')?.textContent?.includes('按同一套间距'));
    expect(current?.open).toBe(true);
  });
});

describe('没有清单:平铺', () => {
  it('工具行直接挂在壳下,不出分段', () => {
    const [shell] = shellsOf([
      ...call('t1', 'Bash', { command: 'cat 规格.md' }),
      ...call('t2', 'Bash', { command: 'grep -n gap a.css' }, { content: 'a.css:1: gap' }),
    ], 'succeeded');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(document.querySelectorAll('details details')).toHaveLength(0);
    expect(screen.getByText('读取')).toBeTruthy();
    expect(screen.getByText('搜索')).toBeTruthy();
  });

  /*
   * 2026-08-26 **最终裁决**:done 之前的一切都在卡片里 —— 普通正文和工具调用
   * 一样收在壳内。中间那版「没有 todo 时正文落壳外」已被用户在真机上撤销
   * (开场白因此排到了整张卡之后)。
   */
  it('没有清单时,普通正文照样在壳里(2026-08-26 最终裁决)', () => {
    const [shell] = shellsOf([
      { kind: 'text', text: '我先看一下工作区里的规格文件。' },
      ...call('t1', 'Bash', { command: 'cat 规格.md' }),
    ], 'running');
    render(<ExecutionShell shell={shell as ShellData} />);
    expect(screen.getByText('我先看一下工作区里的规格文件。')).toBeTruthy();
    // 工具行照旧在壳里,而且排在那句话后面
    expect(screen.getByText('读取')).toBeTruthy();
  });
});

describe('思考流(D46)', () => {
  it('思考中:正文走流式形态(限高 + 自己往上走)', () => {
    const [shell] = shellsOf([{ kind: 'thinking', text: '两张图的栅格看着是同一套。' }], 'running');
    render(<ExecutionShell shell={shell as ShellData} />);
    const body = document.querySelector('details > div[class*="body"]');
    expect(body?.className).toMatch(/stream/);
    expect(body?.className).not.toMatch(/stack/);
  });

  it('一有工具行落下来就回到普通文本流 —— 它不是日志窗', () => {
    const [shell] = shellsOf([
      { kind: 'thinking', text: '先看一眼。' },
      ...call('t1', 'Bash', { command: 'ls' }),
    ], 'running');
    render(<ExecutionShell shell={shell as ShellData} />);
    const body = document.querySelector('details > div[class*="body"]');
    expect(body?.className).toMatch(/stack/);
    expect(body?.className).not.toMatch(/stream/);
  });

  it('跑完了不再流式', () => {
    const [shell] = shellsOf([{ kind: 'thinking', text: '想好了。' }], 'succeeded');
    render(<ExecutionShell shell={shell as ShellData} />);
    const body = document.querySelector('details > div[class*="body"]');
    expect(body?.className ?? '').not.toMatch(/stream/);
  });
});
