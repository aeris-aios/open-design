// @vitest-environment jsdom
/**
 * N5:**没有清单的平铺壳**里,夹在两条步骤中间的正文要落回 22px 那条竖线并接上线。
 *
 * 用户裁决(2026-08-27):「缩进你要看看有没有 todo,如果文本不在 todo 下面,你看是这样的」
 * —— 配图是一张**有清单**的壳,开场白贴最左。所以判据是**这张壳有没有清单**:
 *   · 有清单 → 顶层正文一律贴左(它是清单上面的开场白,设计稿:「开头那句…不动」)
 *   · 没清单 → 正文和工具行交替往下走,夹在中间那几段要对齐、接线
 *
 * 为什么原来不生效:设计稿那条规则写的是 `.fold ~ .think:has(~ .fold)`,**只认 `.fold`**。
 * 而工具行有两种 DOM —— 能展开的(命令、有输出)走 `Foldable` → `details.fold`,
 * 不能展开的(读取 / 改写 / 搜索)是 `ToolRow` 直接返回的 `div.tool`。
 * 真实产品里没输出的调用占多数,于是夹心正文一条都匹配不上。
 * 设计稿注释写的意图是「**前后都还有步骤**,中间这段才该接上」——「步骤」不是「可折叠的步骤」。
 *
 * 这里钉的是**选择器文本与特异性**,不是渲染结果:CSS Module 在 jsdom 里不参与层叠,
 * 只有把规则本身读出来比对才照得出「祖先掉了导致层叠翻转」这类事故。
 * 同一副打法见 `next-step-cascade.test.ts` / `record-cascade.test.ts`。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { I18nProvider } from '../../../src/i18n';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import type { ExecutionShell as Shell, ShellItem } from '../../../src/runtime/chat/contract';

afterEach(cleanup);

const CSS = readFileSync(
  resolve(__dirname, '../../../src/components/chat/primitives/record.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');   // 注释里有逗号和选择器样子的文字,先剥掉

/**
 * 取出所有选择器(逗号分隔的每一支单独成条)。
 *
 * **只切顶层逗号**:`:is(.fold, .tool)` / `:has(~ :is(.a, .b))` 里面的逗号是参数分隔,
 * 一刀切下去会把一支选择器劈成两条假的,断言全部失真 —— 第一版就是这么写挂的。
 */
function splitTopLevel(head: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of head) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

const selectors = CSS
  .split('}')
  .map((block) => block.split('{')[0] ?? '')
  .flatMap(splitTopLevel)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const has = (needle: string): boolean => selectors.some((s) => s === needle);

describe('N5 夹心正文落回 22px 竖线', () => {
  it('认**两种**步骤形态,不只认可折叠的那种', () => {
    const rail = selectors.filter((s) => s.includes('.think:has('));
    expect(rail.length).toBeGreaterThan(0);
    for (const s of rail) {
      // 前一个兄弟(谁在我上面)和后一个兄弟(我下面还有没有)都要认 .tool
      expect(s).toMatch(/:is\(\.fold, ?\.tool\) ~ \.think/);
      expect(s).toMatch(/:has\(~ :is\(\.fold, ?\.tool\)\)/);
    }
  });

  it('**有清单的壳不参与** —— 顶层正文在那种壳里是开场白,贴左', () => {
    const rail = selectors.filter((s) => s.includes('.think:has('));
    for (const s of rail) {
      expect(s).toContain(':not(.hasTodo)');
    }
  });

  it('缩进和竖线是**同一条**规则的两半,不能只搬一半', () => {
    const rail = selectors.filter((s) => s.includes('.think:has('));
    expect(rail.some((s) => s.endsWith('::before'))).toBe(true);
    expect(rail.some((s) => !s.endsWith('::before'))).toBe(true);
  });

  it('祖先链一个都不能省 —— 少一段就换了一个层叠位置', () => {
    const rail = selectors.filter((s) => s.includes('.think:has('));
    for (const s of rail) {
      expect(s.startsWith('.fold.flat')).toBe(true);
      expect(s).toContain('> .body.stack >');
    }
  });

  it('夹心正文那 22px 不许动 —— 它对齐的是上面那一行的**名字**,不是它的图标', () => {
    /*
     * ⚠️ **这条 2026-08-27 换过一次基准。**
     *
     * 原来它钉的是「工具行自己那 22px 不许动 —— 它和稿子逐字相同」,读的是
     * `.fold.flat > .body.stack > .tool { padding: 5px 7px 5px 29px }`。
     * 那条规则确实和稿子逐字相同,但**抄错了位置**:把交付稿放进 Chrome 数过,
     * `.fold.mod-flat > .body.mod-stack > .tool` 在稿子自己的 84 格里命中 **0 处** ——
     * 稿子里工具行永远住在某个步骤里面,顶层清一色是步骤。用户 2026-08-27 指出
     * 「todo 外面的工具调用应该也没这个缩进吧?」之后,顶层工具行挪回第 0 列。
     *
     * 夹心正文那 22px **没有跟着动**,因为它的依据从来不是工具行的缩进:
     * 稿子写的是「让它的首字和上面那行步骤名对齐…22 = 步骤行的 7 内边距 + 状态点 15」。
     * 顶层的行首那一格挪没挪,名字都还在 22。真机量过(§F-18):
     * 顶层行图标 0 / 名字 22~23,夹心正文 22 —— 对齐关系原样保住。
     */
    expect(has('.fold.flat > .body.stack > .tool')).toBe(true);
    expect(CSS).toMatch(/\.fold\.flat > \.body\.stack > \.tool \{[^}]*padding: 5px 7px/);

    const proseBlock = CSS.split('}')
      .find((b) => (b.split('{')[0] ?? '').includes('.think:has(') && !(b.split('{')[0] ?? '').includes('::before'));
    expect(proseBlock).toBeDefined();
    expect(proseBlock).toMatch(/padding-inline-start:\s*22px/);
    // 正向对照:22 是从「7 内边距 + 15 状态点」来的,那两个数还在原处
    expect(CSS).toMatch(/\.fold\.flat > \.body\.stack > \.fold > summary \{[^}]*padding: 5px 7px/);
    expect(CSS).toMatch(/--row-slot:\s*15px/);
  });

  /**
   * 上面几条只读了 CSS 文本 —— 文本对了不等于**标记真的落到 DOM 上**。
   * `.hasTodo` 如果被 CSS Module 当空规则优化掉,`styles.hasTodo` 就是 undefined,
   * `className={undefined}` 静默无事发生,整条判据废掉而所有文本断言照旧全绿。
   */
  describe('标记要真的落到壳上', () => {
    const shellOf = (items: ShellItem[]): Shell => ({
      kind: 'shell', seq: 0, status: 'succeeded', items,
      thinking: false, stopped: false, elapsedMs: null, quietMs: null,
    } as unknown as Shell);
    const show = (items: ShellItem[]) => render(
      <I18nProvider initial="zh-CN"><ExecutionShell shell={shellOf(items)} /></I18nProvider>,
    ).container.querySelector('details');

    const tool = { kind: 'tool', id: 't', tool: 'read', title: '读取 a.png', elapsedMs: 400, failed: false } as ShellItem;
    const todo = { kind: 'todo', segment: { content: '复刻列表页', status: 'completed', items: [], struck: false } } as unknown as ShellItem;

    it('有清单 → 壳带 hasTodo', () => {
      expect(show([todo, tool])?.className).toMatch(/hasTodo/);
    });

    it('没清单 → 壳不带', () => {
      expect(show([tool])?.className ?? '').not.toMatch(/hasTodo/);
    });
  });
});
