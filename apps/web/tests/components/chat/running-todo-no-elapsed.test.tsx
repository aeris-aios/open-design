// @vitest-environment jsdom
/**
 * **进行中的 todo 不挂耗时** —— 这是设计稿要的,不是漏了。
 *
 * 用户 2026-08-27 问「这个进行中的旁边咋没计时呢?」。翻设计稿原件核实:
 * 组件 7(任务进度)进行中那一行的 DOM 是 `orb + 文字 + 箭头`,**没有 `.ms` 槽**;
 * 已完成那一行才有。全稿 10/10 条进行中都没有耗时、14/14 条已完成都有。
 * 稿子的注释写了理由 ——「这条只加在【没有耗时、只有计数】的那几行」:
 * 那颗会跳的绿点**就是**耗时数字的替代品,正在跑的那条是这一摞里唯一还会变的,
 * 给它一个自己在动的标记,比给一个每秒跳的数字更合适。总耗时在壳头上。
 *
 * 为什么要有这条测试:`ExecutionShell.tsx` 里那句抑制原来**一个断言都没有守着**,
 * 谁把 `status === 'in_progress'` 那个判断删掉,整套 web 测试照样全绿,
 * 而每条进行中的 todo 会挂上一个错的数字。这条就是那个守卫。
 *
 * 数据是有的(`build-turn-blocks` 给每条 todo 都算了 `elapsedMs`,含进行中的),
 * 所以这是**渲染选择**,不是缺时间戳 —— 夹具里特意给进行中那条也塞上耗时,
 * 否则这条测试就是空转:数据本来是 null,不渲染是理所当然的。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider } from '../../../src/i18n';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import type { ExecutionShell as Shell, ShellItem, TodoStatus } from '../../../src/runtime/chat/contract';

afterEach(cleanup);

const todo = (content: string, status: TodoStatus, elapsedMs: number): ShellItem => ({
  kind: 'todo',
  segment: { content, status, items: [], elapsedMs },
} as unknown as ShellItem);

function show(items: ShellItem[]): HTMLElement {
  const shell = {
    kind: 'shell', seq: 0, status: 'running', items, segments: [],
    thinking: false, stopped: false, elapsedMs: 31_000, quietMs: null,
  } as unknown as Shell;
  return render(
    <I18nProvider initial="zh-CN"><ExecutionShell shell={shell} /></I18nProvider>,
  ).container;
}

describe('进行中的 todo 不显示耗时(设计稿组件 7)', () => {
  it('哪怕数据里**有**耗时,进行中那一行也不渲染它', () => {
    const root = show([todo('按同一套间距做设置页', 'in_progress', 6_400)]);
    expect(root.textContent).toContain('按同一套间距做设置页');
    expect(root.textContent).not.toContain('6.4s');
  });

  it('已完成那一行照常显示 —— 否则上一条就是把耗时整个删了', () => {
    const root = show([todo('复刻商品列表页', 'completed', 18_200)]);
    expect(root.textContent).toContain('18.2s');
  });

  it('同一摞里两种状态并存时,只有已完成那条带数字', () => {
    const root = show([
      todo('复刻商品列表页', 'completed', 18_200),
      todo('按同一套间距做设置页', 'in_progress', 6_400),
    ]);
    expect(root.textContent).toContain('18.2s');
    expect(root.textContent).not.toContain('6.4s');
  });
});
