/**
 * 把**一块已经存在的菜单**搬到某枚按钮旁边开 —— 只换位置,不换东西。
 *
 * ## 为什么是这个形状
 *
 * 产品 2026-08-27:产物卡上那两枚胶囊点开的,必须就是预览区现在那两块菜单
 * (「为啥不直接复用现在那个分享弹窗??」「导出这个样式也不对呢, 为啥不直接复用?」),
 * 只是位置要贴着按钮(「动态根据上下空间判断是显示在按钮上面还是下面」)。
 *
 * 两条路走不通,所以选了第三条:
 *  · **把菜单抽成共享组件、两处各挂一份** —— 那块分享面板吃三十多个 viewer 状态
 *    (`filePublished` / `publishedFileUrl` / `sharePageUrl` / 部署配置 / 正文……)
 *    和二十来个 handler。卡上要凑齐这些,等于把 viewer 的取数再实现一遍,
 *    最后是两份状态、两份菜单 —— 正是这次要消掉的东西。
 *  · **把菜单整块复制到卡上** —— 同上,而且更糟。
 *  · ✅ **菜单留在原处,让它换个地方开**。JSX 一行不动,只是外面套上这层壳:
 *    给了锚点就 portal 到 body 并按锚点定位,没给就原地渲染。
 *    一份实现,改一处两处都变。
 *
 * ## 祖先类必须跟着走
 *
 * 菜单的宽度、内边距、底色、阴影、以及「贴在触发键下面」这件事,全写在**后代
 * 选择器**上(`shell.css`):
 *
 *     .chrome-share-menu .share-menu-popover        { top: calc(100% + 6px); right: 0 }
 *     .chrome-share-menu--unified .chrome-unified-popover { width; min/max-width; padding;
 *                                                          border-radius; background; box-shadow }
 *
 * portal 出去时如果只搬那个 `.share-menu-popover`,这些规则**集体失配** ——
 * 而 CSS 文本一个字没改,读代码完全看不出来,页面上是一块没有底色、没有宽度的
 * 裸菜单。所以 `wrapperClassName` 把那两个祖先类一起带出去,包裹盒**盖在按钮的
 * 矩形上**(同位置同尺寸),于是 `top: calc(100% + 6px); right: 0` 原封不动地
 * 就得到「贴在按钮下缘、右缘对齐」——既有的 CSS 继续干它本来的活。
 *
 * 往上翻的那一档由 `[data-placement="above"]` 覆写(见 `AnchoredMenuShell.module.css`)。
 *
 * ## 层位
 *
 * portal 到 body 之后,菜单不再被 `.artifact-card-acts`(`position:absolute;
 * z-index:2`,自成层叠上下文)困住;层位取 `--z-menu`,和 `.od-select-menu`
 * 同一档,在提示层 `--z-hint` 之上 —— 人主动打开的面板不该被一条没人要求的
 * 提示盖住(2026-08-27 用户截图)。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import styles from './AnchoredMenuShell.module.css';

/** 卡上那两枚胶囊各自的锚点属性;`FileViewer` 靠它把菜单找回按钮身边。 */
export const ARTIFACT_ANCHOR_ATTR = 'data-artifact-anchor';

export function artifactAnchorId(kind: 'publish' | 'export', name: string): string {
  return `${kind}:${name}`;
}

function findAnchor(anchorId: string | null): HTMLElement | null {
  if (!anchorId) return null;
  return document.querySelector<HTMLElement>(
    `[${ARTIFACT_ANCHOR_ATTR}="${CSS.escape(anchorId)}"]`,
  );
}

export function AnchoredMenuShell({
  anchorId,
  className,
  wrapperClassName,
  testId,
  portalRef,
  children,
}: {
  /** null = 原地渲染(工具栏点开的那一条路,和搬动之前完全一样)。 */
  anchorId: string | null;
  /** 菜单本体的类名 —— 原样照抄调用处,一个字都不改。 */
  className: string;
  /** 后代选择器依赖的那些祖先类,portal 时要一起带走。 */
  wrapperClassName: string;
  testId?: string;
  /** portal 出去那一份的引用 —— 调用方的「点在外面就关」要认它作「里面」。 */
  portalRef?: { current: HTMLDivElement | null };
  children: ReactNode;
}) {
  /*
   * 锚点是**按 id 在文档里现查**的,不是点击时冻结的一个矩形:卡上点一下会先把
   * 文件开进工作区,菜单要等 viewer 挂好、`canShare` 翻真才出现,这中间聊天流
   * 可能已经滚过了。查元素还让位置能随滚动重算(`useAnchoredPopover` 自己会跟)。
   */
  const [anchor, setAnchor] = useState<HTMLElement | null>(() => findAnchor(anchorId));
  useEffect(() => {
    setAnchor(findAnchor(anchorId));
  }, [anchorId]);
  /*
   * 稳定的 ref,不是每次渲染新建的 `{ current: anchor }` —— 后者会让 hook 里的
   * `measure` 每帧换一个身份,布局 effect 于是每帧重跑并 setState,直接把
   * 「Maximum update depth exceeded」撞出来(写这段时踩过一次)。
   */
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  // 包裹盒盖在按钮上,所以它的尺寸就是按钮的尺寸;菜单相对它排。
  const rect = anchor?.getBoundingClientRect?.();
  // 菜单本体的引用:横向修正要量它**真实的盒子**,因为它的横向位置来自既有 CSS
  // (`.chrome-share-menu .share-menu-popover { right: 0 }`),不是这里算出来的。
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { placement, inlineShift } = useAnchoredPopover(Boolean(anchor), anchorRef, menuRef, {
    // 分享面板最高,导出面板矮一些;只用来判上/下,不必精确。
    estimatedHeight: 320,
  });

  const menu = (
    <div
      ref={anchorId ? menuRef : undefined}
      className={className}
      role="menu"
      {...(anchorId ? { 'data-placement': placement } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </div>
  );

  if (!anchorId) return menu;
  // 锚点还没进 DOM(文件正在打开):什么都不画,别先在角上闪一块出来。
  if (!anchor || !rect) return null;

  return createPortal(
    <div
      ref={portalRef}
      className={`${wrapperClassName} ${styles.anchored}`}
      style={{
        position: 'fixed',
        top: rect.top,
        /*
         * 横向修正加在**包裹盒**上,不加在菜单上:包裹盒不可见也不吃事件,挪动它
         * 等于整体平移,而菜单自己的 `right: 0` 一个字不用改 —— 既有 CSS 继续
         * 干它本来的活。加在菜单上则要动 `transform`,会跟它自己的动画打架。
         */
        left: rect.left + inlineShift,
        width: rect.width,
        height: rect.height,
      }}
      data-anchored-menu={anchorId}
    >
      {menu}
    </div>,
    document.body,
  );
}
