// @vitest-environment jsdom
/**
 * 预览区那块菜单被搬到产物卡按钮旁边时,**只换位置,不换东西**。
 *
 * 产品 2026-08-27 推翻了卡上自制的窄浮层:「为啥不直接复用现在那个分享弹窗??」
 * 于是卡上那两枚胶囊不再有自己的菜单,改成让预览区把**它本来那块**开在按钮旁边。
 *
 * 这一层只负责壳:给了锚点就 portal 到 body 并按锚点定位,没给就原地渲染。
 * 内容(分享面板 / 导出面板)仍旧长在 `FileViewer` 里,一份实现。
 *
 * ⚠️ 最容易出事的是**层叠上下文与祖先选择器**:
 *   · `.chrome-share-menu .share-menu-popover { top: calc(100% + 6px); right: 0 }`
 *   · `.chrome-share-menu--unified .chrome-unified-popover { width…; background…; box-shadow… }`
 * 两条都是**后代选择器**。portal 出去时如果不把那两个祖先类一起带走,菜单会
 * 丢掉宽度、内边距、底色和阴影 —— 而 CSS 规则文本一个字没改,光读代码看不出来。
 * 所以这里钉住「祖先类必须跟着走」,真实层叠另外用 headless Chrome 量。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnchoredMenuShell } from '../../../src/components/chat/AnchoredMenuShell';

afterEach(() => {
  cleanup();
  /*
   * `anchorAt` 直接往 body 上挂,`cleanup()` 只收 testing-library 自己建的容器 ——
   * 不手动清掉,上一条用例的锚点会留在文档里,而 `findAnchor` 取的是**第一个**
   * 匹配,于是下一条量到的是上一条那枚按钮的位置(写这组时被它骗过一次:
   * 「翻到上面」那条一直报 below)。
   */
  document.querySelectorAll('[data-artifact-anchor]').forEach((el) => el.remove());
});

const ANCHOR_ID = 'publish:landing.html';

function anchorAt(box: { top: number; left: number; width?: number; height?: number }) {
  const el = document.createElement('button');
  el.setAttribute('data-artifact-anchor', ANCHOR_ID);
  const width = box.width ?? 60;
  const height = box.height ?? 21;
  const rect = {
    x: box.left,
    y: box.top,
    left: box.left,
    top: box.top,
    right: box.left + width,
    bottom: box.top + height,
    width,
    height,
  };
  el.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function shell(anchorId: string | null) {
  return (
    <AnchoredMenuShell
      anchorId={anchorId}
      wrapperClassName="share-menu chrome-share-menu chrome-share-menu--unified"
      className="share-menu-popover chrome-unified-popover"
      testId="unified-action-menu"
    >
      <button type="button" data-testid="a-row">row</button>
    </AnchoredMenuShell>
  );
}

describe('AnchoredMenuShell', () => {
  it('没有锚点时**原地**渲染,和搬动之前一模一样', () => {
    const { container } = render(<div className="share-menu chrome-share-menu chrome-share-menu--unified">{shell(null)}</div>);
    const menu = screen.getByTestId('unified-action-menu');
    expect(menu.className).toBe('share-menu-popover chrome-unified-popover');
    expect(menu.getAttribute('role')).toBe('menu');
    // 留在原地 = 还在调用方的子树里,没有 portal
    expect(container.contains(menu)).toBe(true);
    expect(menu.parentElement).not.toBe(document.body);
    // 原地形态不该带落位标记 —— 位置由那两条既有的后代选择器管
    expect(menu.getAttribute('data-placement')).toBeNull();
  });

  it('有锚点时 portal 到 body,并且**把祖先类一起带走**', () => {
    anchorAt({ top: 300, left: 600 });
    render(shell(ANCHOR_ID));

    const menu = screen.getByTestId('unified-action-menu');
    expect(menu.parentElement?.parentElement).toBe(document.body);
    // 菜单自己的类名一个字不改 —— 内容是同一块
    expect(menu.className).toBe('share-menu-popover chrome-unified-popover');
    // 祖先类跟着走,否则 `.chrome-share-menu .share-menu-popover` 一族集体失配
    const wrapper = menu.parentElement as HTMLElement;
    for (const cls of ['share-menu', 'chrome-share-menu', 'chrome-share-menu--unified']) {
      expect(wrapper.classList.contains(cls), `portal 之后丢了祖先类 ${cls}`).toBe(true);
    }
    // 里面的行原样在
    expect(screen.getByTestId('a-row')).toBeTruthy();
  });

  it('包裹盒**盖在按钮上**:既有的 `top: calc(100% + 6px)` 因此落在按钮下缘', () => {
    const anchor = anchorAt({ top: 300, left: 600, width: 60, height: 21 });
    render(shell(ANCHOR_ID));
    const wrapper = screen.getByTestId('unified-action-menu').parentElement as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    expect(wrapper.style.position).toBe('fixed');
    expect(Number.parseFloat(wrapper.style.top)).toBe(rect.top);
    expect(Number.parseFloat(wrapper.style.left)).toBe(rect.left);
    expect(Number.parseFloat(wrapper.style.width)).toBe(rect.width);
    expect(Number.parseFloat(wrapper.style.height)).toBe(rect.height);
  });

  it('按钮在视口中段 → 往下开', () => {
    anchorAt({ top: 300, left: 600 });
    render(shell(ANCHOR_ID));
    expect(screen.getByTestId('unified-action-menu').getAttribute('data-placement')).toBe('below');
  });

  it('按钮贴着视口下缘 → 翻到上面', () => {
    anchorAt({ top: (window.innerHeight || 768) - 40, left: 600 });
    render(shell(ANCHOR_ID));
    expect(screen.getByTestId('unified-action-menu').getAttribute('data-placement')).toBe('above');
  });

  it('锚点还没挂上来(文件正在打开)时不硬画在角上', () => {
    // 卡上点一下会先把文件开进工作区,菜单要等 viewer 挂好 —— 这中间锚点可能还在
    render(shell('publish:not-in-dom-yet'));
    expect(screen.queryByTestId('unified-action-menu'), '锚点找不到就不该先画一块出来').toBeNull();
  });
});
