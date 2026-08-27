/**
 * Upgrade 那颗按钮的**绿墨**必须赢得过共享 Button 的 primary。
 *
 * 用户 2026-08-27:「这个 upgrade 按钮样式不对」。真机量下来只差一件事 ——
 *   padding 8px ✅  圆角 999px ✅  底色 rgb(32,32,32) ✅
 *   **字与图标 rgb(255,255,255) ❌**,稿子要的是 `--upgrade-ink: #00FF08`
 *
 * 根因是层叠打平:变量本身是好的(真机读到 `--chat-upgrade-ink: #00ff08`),
 * 但两条规则**特异性相同**,靠 import 顺序决胜负 ——
 *   `.button_…`      → `color: var(--bg)`                 (0,1,0)  共享 Button primary
 *   `.UpgradeCard_…` → `color: var(--chat-upgrade-ink)`   (0,1,0)  我们的
 * 同分时后加载的赢,于是绿被刷回白。今天同一副病灶已经在 `routines.css` 上
 * 出现过一次(`.app .assistant-footer .assistant-label`),两条声明逐字相同、
 * 纯靠顺序取胜 —— **文本 diff 照不出来,只有量计算样式才看得见**。
 *
 * 修法照搬稿子的祖先链:`.up .h .btn.mod-primary` 是**三个类**。
 * 把祖先补回来,这条就不再靠顺序取胜。
 *
 * 判据钉在「选择器里带不带祖先」上:CSS Module 的类名带哈希,
 * 断言具体像素在 jsdom 里拿不到(`var()` 不解析),而祖先是特异性的来源。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(
  resolve(__dirname, '../../../src/components/chat/UpgradeCard.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** 只切顶层逗号 —— `:is(.a, .b)` 里的逗号是参数分隔,一刀切会造出假选择器 */
function splitTopLevel(head: string): string[] {
  const out: string[] = [];
  let depth = 0, buf = '';
  for (const ch of head) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

const selectors = CSS.split('}')
  .map((b) => b.split('{')[0] ?? '')
  .flatMap(splitTopLevel)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const ctaRules = selectors.filter((s) => /\.cta\b/.test(s));

describe('Upgrade 按钮的绿墨', () => {
  it('确实存在给 .cta 上色的规则 —— 找不到就说明改名了,后面几条会空转', () => {
    expect(ctaRules.length).toBeGreaterThan(0);
    expect(CSS).toMatch(/--chat-upgrade-ink/);
  });

  it('每一条 .cta 规则都带卡片祖先 —— 不靠 import 顺序取胜', () => {
    for (const s of ctaRules) {
      expect(s).toMatch(/\.up\b[\s>]/);
    }
  });

  it('hover 也要写一遍 —— 稿子注释:不覆盖的话鼠标压上去绿就掉了', () => {
    expect(ctaRules.some((s) => /:hover/.test(s))).toBe(true);
  });

  it('四边等距 8px 不许动 —— 那是稿子给这一枚单独定的', () => {
    expect(CSS).toMatch(/\.cta[^{]*\{[^}]*padding:\s*8px/);
  });
});
