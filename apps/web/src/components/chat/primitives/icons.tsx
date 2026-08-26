/**
 * chat 用到的图标。**路径数据逐字取自设计稿**(`docs/design/chat-panel-next.html`),
 * 不手抄、不换库 —— 手抄一次就会和稿子漂移,后面再也对不上。
 *
 * 尺寸和颜色一律由 CSS 决定(`.ti > svg` / `.mk svg`),这里只给形状,
 * 所以每个图标都不写 width/height,`stroke-width` 也交给全局 `svg` 规则。
 */
import type { ReactElement } from 'react';
import type { ToolKind } from '../../../runtime/chat/tool-kind';

const strokeProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'aria-hidden': true,
} as const;

/** 读取 —— 眼睛 */
export const ReadIcon = (): ReactElement => (
  <svg {...strokeProps}>
    <path d="M2 12s3.6-6.4 10-6.4S22 12 22 12s-3.6 6.4-10 6.4S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

/** 新建 / 改写 —— 笔 */
export const WriteIcon = (): ReactElement => (
  <svg {...strokeProps}>
    <path d="M17 3a2.83 2.83 0 014 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

/** 搜索 —— 放大镜(D23:搜索是一等类别,有自己的图标) */
export const SearchIcon = (): ReactElement => (
  <svg {...strokeProps}>
    <circle cx="10.8" cy="10.8" r="6.8" />
    <path d="M20.5 20.5l-4.9-4.9" />
  </svg>
);

/** 执行 —— 命令提示符 */
export const ExecIcon = (): ReactElement => (
  <svg {...strokeProps}>
    <path d="M4.5 6.5l5 5.5-5 5.5" />
    <path d="M12.5 18h7" />
  </svg>
);

/** 生成 —— 图片 */
export const ImageIcon = (): ReactElement => (
  <svg {...strokeProps}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.6" cy="10" r="1.4" />
    <path d="M21 15.5L16 10.5 7.5 19" />
  </svg>
);

/**
 * 认不出类别时的兜底 —— 一个中性的「工具」记号(六边螺帽 + 中心孔)。
 *
 * 为什么不硬塞进已有的五类:归错比「我认不出来」更糟。把一次子 agent 调度画成
 * 「读取」是**谎报**,而这一格的全部作用就是让人一眼知道刚才干了哪一类事。
 * 为什么不留圆点:产品 2026-08-25 裁决「不许出现圆点,每一格都要能指到图标」——
 * 这推翻了交付稿的 `.ti:empty::before` 兜底。
 *
 * 笔画粗细、圆角、24 视框都跟着同族其它五枚走,放在一列里不会显得是外来的。
 */
export const ToolFallbackIcon = (): ReactElement => (
  <svg {...strokeProps}>
    <path d="M12 3.2l7 4v9.6l-7 4-7-4V7.2l7-4z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

/** 折叠箭头。展开时由 CSS 旋转 180°,不换图标 */
export const ChevronIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="11" height="11" aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** 重试 —— 生图失败格上那枚 */
export const RetryIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M5.46257 4.43262C7.21556 2.91688 9.5007 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C9.84982 4 7.89777 4.84827 6.46023 6.22842L5.46257 4.43262ZM18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 9.86386 2.66979 7.88416 3.8108 6.25944L7 12H4C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z" />
  </svg>
);

/**
 * 「这件事过了」那枚勾。**不用 svg**:设计稿把它做成了一整张图
 * (`--chat-tick-img`,盘绿勾挖空),这样深浅两套主题不用各挑一个勾色。
 * 全稿凡是「过了」的记号(折叠块行首、Plan 里打完勾的一步、Plan 卡头)都指同一张图。
 */
export const TICK_IMAGE_VAR = 'var(--chat-tick-img)';

/**
 * 工具类别 → 图标。**每一类都有,永远不返回 null**。
 *
 * 交付稿的兜底是空格子画一颗 5px 圆点;产品 2026-08-25 裁决不许出现圆点,
 * 所以「认不出来」那一档也给图标(`ToolFallbackIcon`)。
 * 相应地 `record.module.css` 里那条 `.icon:empty::before` 已经撤掉 ——
 * 留着会变成一条永远走不到的死规则,以后有人加了新类别忘了配图标,
 * 圆点会悄悄回来(所以改由 `tool-icon.test.tsx` 逐类断言守着)。
 */
export function toolIcon(kind: ToolKind): ReactElement {
  switch (kind) {
    case 'read': return <ReadIcon />;
    case 'write':
    case 'edit': return <WriteIcon />;
    case 'search': return <SearchIcon />;
    case 'exec': return <ExecIcon />;
    case 'image': return <ImageIcon />;
    default: return <ToolFallbackIcon />;
  }
}
