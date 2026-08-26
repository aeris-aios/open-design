import type { ReactNode } from 'react';

import styles from './ChatRoot.module.css';

/**
 * chat 组件树的根:把 `--chat-*` 主题接缝挂到子树上。
 *
 * 所有 chat 组件都假定自己渲染在接缝之内;脱离它,`--chat-*` 变量全部落空,
 * 组件会退化成无色无字号的裸结构 —— **而且不报错**。壳头「进行中」那句用
 * `background-clip: text` + `color: transparent` 上色,渐变里任一变量解析不出来,
 * 整条 `background` 就失效,字变成透明的:页面上像是没渲染,单测一条都不会红。
 *
 * 接缝有两种用法,按「能不能多一层 DOM」选:
 *
 *  · `chatSeam('已有的类名')` —— **产品里用这个**。多一层包裹元素会打断
 *    `.split-chat-slot > .pane` 这类子选择器(全仓 11 条),`display: contents`
 *    去掉的是布局盒、不是选择器树上的那个节点,所以那些规则会集体失配。
 *  · `<ChatRoot>` —— 测试与陈列页用这个:那里需要凭空包一层,`display: contents`
 *    保证它不改排版。
 */
export function ChatRoot({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={className ? `${styles.root} ${className}` : styles.root} data-chat-root="">
      {children}
    </div>
  );
}

/**
 * 把接缝抹在一个**已有**元素上。展开到 JSX 里:`<div {...chatSeam('pane')}>`。
 *
 * `data-chat-root` 和变量类名绑在一起返回,是为了让「有接缝」这件事只有一个出口 ——
 * 回归测试(`tests/components/chat/theme-seam.test.tsx`)就是按这个属性找接缝的。
 */
export function chatSeam(className?: string): { className: string; 'data-chat-root': '' } {
  // CSS Module 的类名映射在类型上是可选的(`Record<string, string | undefined>`),
  // 这里兜一层空串,拿不到类名时不会渲染出 `class="undefined"`
  const seam = styles.vars ?? '';
  return {
    className: className ? `${seam} ${className}` : seam,
    'data-chat-root': '',
  };
}
