import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toolsCss = readFileSync(new URL('../../src/styles/viewer/tools.css', import.meta.url), 'utf8');
const composioCss = readFileSync(new URL('../../src/styles/viewer/composio.css', import.meta.url), 'utf8');
const routinesCss = readFileSync(new URL('../../src/styles/viewer/routines.css', import.meta.url), 'utf8');
const theaterCss = readFileSync(new URL('../../src/styles/viewer/theater.css', import.meta.url), 'utf8');

function declarations(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1] ?? '';
}

describe('chat disclosure accessibility styles', () => {
  it('lets a running category badge retain the running state color', () => {
    expect(declarations(toolsCss, '.op-status-running')).toContain('color: var(--purple)');
    expect(declarations(toolsCss, '.op-status-category')).not.toMatch(/(?:^|\n)\s*color\s*:/);
  });

  it('keeps the thinking accordion expandable in the compact current activity row', () => {
    // The compact running row strips tool-card disclosures, but the thinking
    // block's accordion must stay displayable so streamed reasoning can be
    // expanded mid-run (incident recvqgLmAkUM6G). Hiding every
    // .accordion-collapsible under the row regresses that.
    expect(routinesCss).not.toMatch(/task-activity-current-row \.accordion-collapsible/);
    expect(routinesCss).toContain('.app .task-activity-current-row .op-card .accordion-collapsible');
  });

  it('keeps completed assistant controls discoverable without hover', () => {
    /*
     * 同一条用户可见的性质,判据换了地方。
     *
     * 从前这一行是 `opacity: 0` + hover 显形,于是触屏上够不着,要靠
     * `@media (hover: none)` 补一条把它拉回来 —— 而那份门控在 `composio.css` 和
     * `routines.css` 各写了一遍,旧皮肤那份靠 `.app` 拔到 (0,2,0) 且排在最后,
     * 两头都赢,想改行为得同时删两处。
     *
     * 2026-08-26 的裁决把门控整个挪到渲染层(「只在最后一轮出」,见
     * `AssistantMessage.showCompletionRow`):**渲染出来的就一直看得见**,
     * 不透明度这场层叠仗不打了。所以现在要钉的是「**没有**任何一处再用
     * 不透明度把这一行藏起来」—— 只要谁再加回来,这一条就红。
     */
    for (const [name, css] of [['composio.css', composioCss], ['routines.css', routinesCss]] as const) {
      const gated = [...css.matchAll(/\.assistant-footer[^{}]*\{([^}]*)\}/g)]
        .map(([, body]) => body ?? '')
        .filter((body) => /opacity\s*:\s*0(?:\.\d+)?\s*[;}]/.test(body));
      expect(gated, `${name} 又把回合状态行藏起来了`).toEqual([]);
    }
  });
});

describe('〔继续剩余任务〕是一颗有字的按钮,不能套图标按钮的尺寸', () => {
  /**
   * 真机复现(2026-08-27,codex 跑到一半按停):那一行渲染成
   * 「已取消　继续剩[余任务]」—— 六个字**压在**旁边的状态词上。
   *
   * 成因:T7 接线时复用了 `.assistant-copy-button`,而那是给图标用的
   * **固定 26×26** 方格(`width: 26px; height: 26px; padding: 0`),
   * 还带 `overflow: visible` —— 于是文字整个溢出到盒子外面,既压别人,
   * 又只有 26px 的地方点得到。
   *
   * 判据落在「这颗按钮用的那个类,不许把宽高钉死」上:jsdom 不做布局,
   * 量不出重叠,但类和规则的这层对应关系是能钉住的。
   */
  const CONTINUE_CLASS = 'assistant-continue-remaining';

  function ruleFor(css: string, selector: string): string | null {
    const m = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`));
    return m ? (m[1] ?? '') : null;
  }

  it('has a rule of its own', () => {
    expect(ruleFor(theaterCss, CONTINUE_CLASS), '没有自己的规则 = 还在蹭图标按钮那一套').not.toBeNull();
  });

  it('never pins its width or height the way the icon buttons do', () => {
    const body = ruleFor(theaterCss, CONTINUE_CLASS) ?? '';
    expect(body).not.toMatch(/(?:^|;)\s*width\s*:\s*\d+px/);
    expect(body).not.toMatch(/(?:^|;)\s*height\s*:\s*\d+px/);
    // 文字按钮要有左右内边距,否则贴着相邻元素
    expect(body, '有字的按钮得留左右内边距').toMatch(/padding\s*:/);
  });

  it('leaves the icon buttons on their fixed square', () => {
    // 反向:别顺手把图标按钮也放开了 —— 一排小图标各自变宽会散架。
    const icon = ruleFor(theaterCss, 'assistant-copy-button') ?? '';
    expect(icon).toMatch(/width\s*:\s*26px/);
    expect(icon).toMatch(/height\s*:\s*26px/);
  });
});
