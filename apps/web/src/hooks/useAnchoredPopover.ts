import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type AnchoredPlacement = 'above' | 'below';

/** 夹取框内缘留的余量 —— 菜单不贴死在框的边线上。 */
const INLINE_PAD = 8;

/**
 * 「这枚锚点本来会被谁裁掉」—— 往上找第一个 `overflow-x` 不是 `visible` 的祖先,
 * 取它的可视矩形;找不到就退回视口。结果再与视口取交集(祖先可能自己就有一半在
 * 屏幕外)。
 *
 * 按 `overflow` 找而不是认类名:这是个通用组件,不该知道 `.pane` 是什么。
 */
function clippingRect(anchor: HTMLElement): { left: number; right: number } {
  const viewport = { left: 0, right: window.innerWidth || 0 };
  let node: HTMLElement | null = anchor.parentElement;
  while (node && node !== document.documentElement && node !== document.body) {
    let overflowX = '';
    try {
      overflowX = window.getComputedStyle(node).overflowX;
    } catch {
      overflowX = '';
    }
    if (overflowX && overflowX !== 'visible') {
      const rect = node.getBoundingClientRect();
      return {
        left: Math.max(viewport.left, rect.left),
        right: Math.min(viewport.right, rect.right),
      };
    }
    node = node.parentElement;
  }
  return viewport;
}

export interface AnchoredPopover {
  placement: AnchoredPlacement;
  /**
   * 横向要往回收多少物理像素,才不越出夹取框。0 = 本来就放得下,别动它。
   *
   * 是**平移量**而不是一个算好的 `left`:面板的横向位置由既有的 CSS 决定
   * (产物卡这条路上是 `.chrome-share-menu .share-menu-popover { right: 0 }`),
   * 这里只做修正。用物理像素也让 RTL 自然成立 —— 量的是真实盒子越了哪边,
   * 不预设「起点在左边」。
   */
  inlineShift: number;
}

/**
 * 「贴着这枚按钮开,上面开不下就翻到下面」——**并且 portal 到 body**。
 *
 * ## 为什么必须 portal
 *
 * 就地 `position:absolute` 是不够的。产物卡的动作行 `.artifact-card-acts` 是
 * `position:absolute; z-index:2` —— 它**自己就是一个层叠上下文**,浮层留在
 * 里面时,不管写多大的 z-index,都只在这个 z=2 的盒子内部排序。于是 portal 到
 * body 的提示层(`.od-tooltip-layer`,z-index 4000)必然盖在它上面:用户
 * 2026-08-27 的截图里,一条深色 tooltip 正压着展开的导出菜单下半截。
 *
 * 仓库里已有同一形状的实现:`CustomSelect`(portal + fixed + 翻面 + 滚动重算),
 * 它的菜单类 `.od-select-menu` 落在 z 9000,本来就在提示层之上。这个 hook 把
 * 那套坐标计算抽出来,新的浮层不必再抄一遍。
 *
 * ## 翻面的判据
 *
 * 下面塞得下就在下面 —— 默认向下,视线本来就往下走;塞不下、而且上面更宽敞,
 * 才翻上去。两边都塞不下时留在下面,不为几像素的差别把浮层甩到视线上方。
 *
 * ## 为什么是 useLayoutEffect
 *
 * 方向和坐标必须在这一帧画出来之前定好,否则浮层会先在错的位置闪一下再跳过去。
 *
 * jsdom 里 `getBoundingClientRect()` 全是 0,于是算出来是「按钮在视口左上角、
 * 下面还有一整屏」→ `below`,坐标贴着那个 0 高按钮。测试因此可以给按钮喂一个
 * 真实 rect 再断言坐标跟上来,不必 mock 整套布局。
 */
export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null> | null,
  options: { estimatedHeight: number; gap?: number } = { estimatedHeight: 0 },
): AnchoredPopover {
  const { estimatedHeight, gap = 6 } = options;
  const [state, setState] = useState<AnchoredPopover>({ placement: 'below', inlineShift: 0 });
  // 内联箭头每次渲染都是新的;放进 ref 后监听器只在开合时绑一次。
  const optionsRef = useRef({ estimatedHeight, gap });
  optionsRef.current = { estimatedHeight, gap };

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
    const rect = anchor.getBoundingClientRect();
    const { estimatedHeight: estH, gap: g } = optionsRef.current;
    // 面板一旦挂上就用真实尺寸;第一帧还没有,退回估值。
    const panelRect = panelRef?.current?.getBoundingClientRect?.();
    const height = panelRect && panelRect.height > 0 ? panelRect.height : estH;

    const viewportHeight = window.innerHeight || 0;
    const spaceBelow = viewportHeight - rect.bottom - g;
    const spaceAbove = rect.top - g;
    const placement: AnchoredPlacement =
      spaceBelow < height && spaceAbove > spaceBelow ? 'above' : 'below';

    /*
     * 横轴的对应动作是**平移**,不是翻面 —— 菜单没有「左开 / 右开」两种形态,
     * 它只是被既有 CSS 按某一侧对齐了,越界多少就收回来多少。
     *
     * 夹到 `clippingRect(anchor)`:**锚点本来会被谁裁掉,就夹到谁**。portal 出去
     * 之前,菜单会被那个 `overflow: hidden` 的祖先切掉;portal 之后没人切它了,
     * 于是它能跑到那个框外面 —— 那正是 2026-08-27 那次的样子。只夹视口不够:
     * 真机量过,视口夹取之后菜单仍旧压在聊天栏左边那条 chrome 上。
     */
    let inlineShift = 0;
    if (panelRect && panelRect.width > 0) {
      const clip = clippingRect(anchor);
      const overStart = clip.left + INLINE_PAD - panelRect.left;
      const overEnd = panelRect.right - (clip.right - INLINE_PAD);
      // 两边都超(框比菜单还窄)时先保左缘:被切掉的开头比结尾更难读。
      if (overStart > 0) inlineShift = overStart;
      else if (overEnd > 0) inlineShift = -overEnd;
    }

    setState((prev) =>
      prev.placement === placement && prev.inlineShift === inlineShift
        ? prev
        : { placement, inlineShift },
    );
    // `anchorRef` / `panelRef` 是稳定的 ref 对象,不进依赖 —— 进了就等于把
    // 「每帧新建一个 ref-like 对象」的调用方拖进死循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // 面板挂上之后真实高度才有 —— 再量一次,把第一帧的估值换掉。
    const raf = requestAnimationFrame(measure);
    // `capture`:聊天流自己就是个滚动容器,它的 scroll 不冒泡到 window。
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  return state;
}
