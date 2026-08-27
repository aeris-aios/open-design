/**
 * 悬浮层的两档,别再各写各的数字。
 *
 * 2026-08-27 用户截图:一条深色 tooltip 盖在展开的产物卡导出菜单上。真因有两层
 *  · **层叠上下文**:浮层原来就地留在 `.artifact-card-acts`(`position:absolute;
 *    z-index:2`)里,不管写多大都只在那个 z=2 的盒子里排序 —— 这条由
 *    `artifact-card-parity.test.tsx` 的「浮层的层位」那一组守着(portal 到 body);
 *  · **数字本身**:提示层 4000、菜单层 9000,而新浮层随手写了 30。
 *
 * 这一条只守第二层:两个档位有名字、方向正确、而且真的被用上了。它是**文本
 * 检查**,不是视觉断言 —— 「画出来谁盖谁」只有真排版量得出,那一步走 headless
 * Chrome 的 CDP,不在这儿冒充。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, '../../src', rel), 'utf8');

const tokens = read('styles/tokens.css');
const primitives = read('styles/primitives.css');
/** 注释里会引用别处的数字(比如那个 z-index:2 的层叠上下文),先剥掉。 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const popover = withoutComments(read('components/chat/ArtifactActionPopover.module.css'));

function tokenValue(name: string): number {
  const match = new RegExp(`--${name}:\\s*(\\d+)`).exec(tokens);
  expect(match, `tokens.css 里没有 --${name}`).toBeTruthy();
  return Number(match![1]);
}

describe('悬浮层的两档', () => {
  it('两个档位都在 tokens.css 里有名字', () => {
    expect(tokenValue('z-hint')).toBeGreaterThan(0);
    expect(tokenValue('z-menu')).toBeGreaterThan(0);
  });

  it('菜单层在提示层之上 —— 这是方向,不是巧合', () => {
    /*
     * 人主动打开的面板不该被一条没人要求的提示盖住。反过来(hint > menu)正是
     * 出事那次的形态。
     */
    expect(tokenValue('z-menu')).toBeGreaterThan(tokenValue('z-hint'));
  });

  it('提示层用的是 --z-hint,不是裸数字', () => {
    const rule = /\.od-tooltip-layer\s*\{[^}]*\}/.exec(primitives)?.[0] ?? '';
    expect(rule, '找不到 .od-tooltip-layer').not.toBe('');
    expect(rule).toContain('z-index: var(--z-hint)');
  });

  it('既有菜单层(od-select-menu)用的是 --z-menu', () => {
    const rule = /\.od-select-menu\s*\{[^}]*\}/.exec(primitives)?.[0] ?? '';
    expect(rule, '找不到 .od-select-menu').not.toBe('');
    expect(rule).toContain('z-index: var(--z-menu)');
  });

  it('产物卡的浮层也落在菜单层,而不是自己挑一个刚好压过今天那条 tooltip 的数', () => {
    expect(popover).toContain('z-index: var(--z-menu)');
    // 反向:整个文件里不许再出现裸的 z-index 数字
    const bare = popover.match(/z-index:\s*\d+/g) ?? [];
    expect(bare, `浮层样式里还有裸数字 ${bare.join(', ')}`).toHaveLength(0);
  });
});
