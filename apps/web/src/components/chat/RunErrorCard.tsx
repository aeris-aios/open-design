/**
 * 报错卡(设计稿组件 19 · 第 78 / 79 格)。
 *
 * **呈现层**:白卡 + 一行红标题 + 一段说明 + 靠右一排动作。
 * 「该出哪几颗按钮」是策略,不在这里 —— 那要看这一轮是授权失败、余额不够、
 * 还是本地环境跑不动,判断留在 `ChatPane`,按钮以 `actions` 传进来。
 *
 * 抽成组件之前它是 `ChatPane.tsx` 里 200 多行内联 JSX:样式没法集中对齐,
 * 陈列页也照不出来。这两件事都是抽出来才解决的。
 */
import type { ReactElement, ReactNode } from 'react';
import styles from './RunErrorCard.module.css';

export interface RunErrorCardProps {
  title: string;
  /** 一句人话:出了什么事、影响到哪 —— 稿子这一行走 `--text-muted`,不跟着标题变红 */
  description: ReactNode;
  /** 靠右那一排动作。顺序由调用方定(稿子:次要动作在左,主动作在最右) */
  actions?: ReactNode;
  /** 展开的诊断信息等附加内容,接在说明之后 */
  children?: ReactNode;
  /**
   * 保留 `data-user-action-card` 这个**测试与 e2e 的稳定钩子**。
   *
   * 这张卡从 `UserActionCard` 换过来时,形态变了(说明不再藏在折叠里),
   * 但「页面上有没有一张运行恢复卡」这个判据不该跟着改名 ——
   * 那会连带动 `e2e/lib/playwright/chat.ts` 和一批 web 测试,
   * 而它们要断言的东西一点没变。
   */
  dataKind?: string;
}

/**
 * 稿子标题前那一枚:**实心八边形 + 感叹号**(路径逐字节取自交付稿)。
 * 原来这里放的是三角警告 —— 形状不同,红色的重量也不一样:
 * 八边形是「停」,三角是「注意」,这一行说的是任务已经失败,不是提醒。
 */
function AlertIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.5 2.5L23 12L17.5 21.5H6.5L1 12L6.5 2.5H17.5ZM11 15V17H13V15H11ZM11 7V13H13V7H11Z" />
    </svg>
  );
}

export function RunErrorCard({ title, description, actions, children, dataKind }: RunErrorCardProps): ReactElement {
  return (
    <div
      className={styles.card}
      data-testid="chat-run-error-card"
      {...(dataKind ? { 'data-user-action-card': dataKind } : {})}
    >
      <div className={styles.title}>
        <AlertIcon />
        {title}
      </div>
      <div className={styles.description}>{description}</div>
      {children}
      {actions ? (
        /* `data-user-action-footer` 同样是保留下来的稳定钩子:测试与 e2e 用它
           定位「恢复动作那一排」,换组件不该让它们改选择器 */
        <div
          className={styles.ops}
          {...(dataKind ? { 'data-user-action-footer': 'true' } : {})}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
