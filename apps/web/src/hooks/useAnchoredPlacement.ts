import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export type AnchoredPlacement = 'above' | 'below';

/**
 * 「贴着这枚按钮开,上面开不下就翻到下面」。
 *
 * 仓库里这段判据原来在六处各写了一遍(`CustomSelect`、`InlineModelSwitcher`、
 * `DesignSystemPicker`、`NewProjectPanel`、`AvatarMenu`、`modelOptions`),
 * 每处一个自己的阈值。这里只把**方向**这件事抽出来:
 *
 *   · 下面塞得下就在下面 —— 默认向下,因为人的视线本来就往下走;
 *   · 塞不下、而且上面更宽敞,才翻上去。
 *
 * 不抽「坐标」:上面那几处有的 portal 到 `<body>` 用 fixed,有的就地
 * `position:absolute`,把两种定位塞进同一个 hook 只会得到一堆分支。方向是
 * 它们唯一真正共有的那一半。
 *
 * `useLayoutEffect`:方向必须在这一帧画出来之前定好,否则浮层会先在错的一侧
 * 闪一下再跳过去。
 *
 * jsdom 里 `getBoundingClientRect()` 全是 0,于是永远算成「下面还有一整屏」
 * → `below`。这正是我们要的默认值,测试不必去 mock 布局。
 */
export function useAnchoredPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  options: { estimatedHeight: number; gap?: number } = { estimatedHeight: 0 },
): AnchoredPlacement {
  const { estimatedHeight, gap = 6 } = options;
  const [placement, setPlacement] = useState<AnchoredPlacement>('below');

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 0;
    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    // 只有「下面确实放不下」**并且**「上面更宽敞」才翻上去 —— 两个都放不下时
    // 留在下面,免得为了几像素的差别把浮层甩到视线上方。
    setPlacement(spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? 'above' : 'below');
  }, [anchorRef, estimatedHeight, gap]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // 滚动 / 改窗口大小之后原来的判断可能已经不成立了。`capture` 是为了接住
    // 祖先容器(聊天流自己就是个滚动容器)的滚动,它不冒泡。
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  return placement;
}
