import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

export type AnchoredPlacement = 'above' | 'below';

export interface AnchoredPopover {
  placement: AnchoredPlacement;
  /** `position: fixed` 的坐标 —— 浮层 portal 到 body 之后自己定位。 */
  style: CSSProperties;
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
  options: { estimatedHeight: number; estimatedWidth: number; gap?: number } = {
    estimatedHeight: 0,
    estimatedWidth: 0,
  },
): AnchoredPopover {
  const { estimatedHeight, estimatedWidth, gap = 6 } = options;
  const [state, setState] = useState<AnchoredPopover>({
    placement: 'below',
    style: { position: 'fixed', top: 0, left: 0 },
  });
  // 内联箭头每次渲染都是新的;放进 ref 后监听器只在开合时绑一次。
  const optionsRef = useRef({ estimatedHeight, estimatedWidth, gap });
  optionsRef.current = { estimatedHeight, estimatedWidth, gap };

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
    const rect = anchor.getBoundingClientRect();
    const { estimatedHeight: estH, estimatedWidth: estW, gap: g } = optionsRef.current;
    // 面板一旦挂上就用真实尺寸;第一帧还没有,退回估值。
    const panelRect = panelRef?.current?.getBoundingClientRect?.();
    const height = panelRect && panelRect.height > 0 ? panelRect.height : estH;
    const width = panelRect && panelRect.width > 0 ? panelRect.width : estW;

    const viewportHeight = window.innerHeight || 0;
    const viewportWidth = window.innerWidth || 0;
    const viewportPad = 12;
    const spaceBelow = viewportHeight - rect.bottom - g;
    const spaceAbove = rect.top - g;
    const placement: AnchoredPlacement =
      spaceBelow < height && spaceAbove > spaceBelow ? 'above' : 'below';

    // 右缘对齐按钮右缘:按钮贴在卡的右上角,浮层向左展开才不会越出卡外。
    // 再夹回视口内,免得窄窗口下半个浮层挂在屏幕外。
    const left = Math.min(
      Math.max(viewportPad, rect.right - width),
      Math.max(viewportPad, viewportWidth - width - viewportPad),
    );
    const top =
      placement === 'above'
        ? Math.max(viewportPad, rect.top - height - g)
        : rect.bottom + g;

    setState({ placement, style: { position: 'fixed', top, left } });
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
