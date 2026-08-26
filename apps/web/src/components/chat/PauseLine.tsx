/**
 * 组件 20 · 暂停任务(84 格状态矩阵第 81 格)。
 *
 * 一行灰字,句首一枚跟正文同色的暂停符,**没有卡、没有按钮、没有第二句**。
 * cmp-ops 把边界写得很死,四条全在这个组件里成立:
 *
 *   1. 无操作 —— 只有这一句话。
 *   2. 不摊剩余步骤 —— 「是你自己按的暂停,剩几步、分别叫什么,上面那段执行记录
 *      本来就写着」(规格 D5:手动暂停只给一行文案,不显示剩余步数)。
 *      所以 `remainingSteps` 只用来判**出不出现**,一个数字都不往屏幕上放。
 *   3. 断线不走这一行 —— 那由组件 22 · 重连全程接管。掉线时调用方渲染 `Reconnect`,
 *      不渲染这一行;两者不同时出现是调用方的接线约束,不在本组件里判。
 *   4. 剩余为 0 时这一行也不出现 —— 那一轮已经跑完,「这轮被你停了」由回合状态行
 *      (组件 15)去报。判据取 `unfinishedTodosFromEvents(events).length`。
 *
 * 图标跟正文同色,不另染:「这一行报的是『停住了』这个事实,不是一条要人处理的告警;
 * 染色会把它抬成一条状态提示。」(设计稿 2769 附近原文)
 */
import type { ReactElement } from 'react';
import type { RunCancelOrigin } from '@open-design/contracts';
import { useT } from '../../i18n';
import styles from './PauseLine.module.css';

export interface PauseLineProps {
  /**
   * 是**谁**停的这一轮。契约 `RunCancelOrigin`:
   * `user_stop | project_cleanup | daemon_shutdown | unknown`,
   * 注释原话「Only `user_stop` proves the user explicitly stopped this run」。
   *
   * **只有 `user_stop` 才画这一行。** 稿子的「已手动暂停任务」预设是用户按的;
   * 而客户端今天只看 `runStatus: 'canceled'`,把「用户按停」和「daemon 关机 /
   * 项目清理杀掉」混成一种 —— 照那个判据画,daemon 重启后这一行就会**谎报**
   * (盘点 R8)。缺字段(旧 daemon 不发)时同样不画:证不出是用户按的就不说是。
   *
   * 其余三种取消今天什么都不显示 —— 该给它们哪句话属于新文案语义,待产品定,
   * 不在这里自造。
   */
  cancelOrigin?: RunCancelOrigin | null;
  /**
   * 本轮还剩几步没跑完。**永远不显示**(D5:手动暂停只给一行文案,不显示剩余步数)。
   *
   * 也**不作为出不出现的判据** —— D5 说的是「不显示步数」,不是「没有剩余就别出这一行」。
   * 把它读成后者是替设计拍板:用户按了停,这一行就该出,和当时还剩几步无关。
   * 留着这个字段是因为回合状态行(组件 15-6)要用同一份读数说「有没有剩余」,
   * 两处别各算各的。要不要在「一步不剩」时压掉这一行,是产品的事(T29)。
   */
  remainingSteps: number;
}

export function PauseLine({ cancelOrigin }: PauseLineProps): ReactElement | null {
  const t = useT();
  if (cancelOrigin !== 'user_stop') return null;

  return (
    <div className={styles.line} data-testid="chat-pause-line">
      <PauseIcon />
      {t('chat.edge.paused')}
    </div>
  );
}

/**
 * 句首那枚暂停符。路径逐字取自设计稿第 81 格(`.stopline > svg`),不重描。
 * 走 `currentColor`,继承这一行的 `--chat-text-muted`。
 */
function PauseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM9 9V15H11V9H9ZM13 9V15H15V9H13Z" />
    </svg>
  );
}
