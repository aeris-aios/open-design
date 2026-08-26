import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toolsCss = readFileSync(new URL('../../src/styles/viewer/tools.css', import.meta.url), 'utf8');
const composioCss = readFileSync(new URL('../../src/styles/viewer/composio.css', import.meta.url), 'utf8');
const routinesCss = readFileSync(new URL('../../src/styles/viewer/routines.css', import.meta.url), 'utf8');

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
