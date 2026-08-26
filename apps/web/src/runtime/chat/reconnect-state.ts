/**
 * 组件 22 · 重连(84 格状态矩阵第 82–84 格)· S29「网络连接中断 / 正在重连」的**状态**。
 *
 * 产品裁决(2026-08-26,`specs/current/run-error-catalog.md` §6):
 * S29 用设计稿中现有的设计,位置在**会话中最后一行**。
 *
 * 这一层只回答一个问题:**流水尾部此刻该不该有那一行、上面写几分之几。**
 * 它是纯函数,不碰 DOM、不认识 React —— 长相在 `components/chat/Reconnect.tsx`,
 * 挂载点在 `ChatPane`,信号来自 `providers/daemon.ts` 的 `onReconnect`。
 *
 * 为什么值得单独一个 reducer,而不是在 `ProjectView` 里塞两个 `setState`:
 * 这一行有三条互相牵制的边界,散在组件里就只能靠调用方每处都记得写对 ——
 *
 *   1. **恢复后整行消失,不留「已恢复」**(cmp-ops 原话)。所以「恢复」只有一种表达:
 *      状态回到 `null`。这里没有任何一个分支能产出「已恢复」那种终态读数。
 *   2. **次数用尽换成〔重新连接〕交回给人**(22-3)。传输层用尽预算时的调用顺序是
 *      `onRunStatus('failed')` → `emitReconnect('exhausted')` → `onError(...)`,
 *      而报错那条路上还会再来一次 `failed`。所以 `exhausted` 必须能扛住随后到达的
 *      `failed`,否则那颗按钮会一闪而过。
 *   3. **与组件 20 · PauseLine 不同时出现**。`PauseLine` 自己不判这件事(它的文档把这条
 *      写成「调用方的接线约束」),而它的显示条件是 `runStatus: 'canceled'` +
 *      `cancelOrigin: 'user_stop'`。于是这里让**任何** `canceled` 立刻把重连行撤掉:
 *      两者的显示条件在数据层就交不上,不依赖调用方记得写 else。
 *      反方向(掉线不许走暂停行)由 `PauseLine` 只认 `user_stop` 保证 —— 掉线永远
 *      产不出 `user_stop`。
 */
import type { ChatRunStatus } from '@open-design/contracts';

/** 流水尾部那一行的读数。`null` = 此刻不该有这一行。 */
export interface ChatReconnectView {
  /**
   * 这一行属于哪一次运行。换一轮、翻历史、后台重挂的另一条流恢复了 —— 都靠它对齐,
   * 免得一条陈年重连留在流水里(「恢复后自动消失」的另一半)。
   */
  runId: string;
  /**
   * 这一行属于哪个会话。后台重挂会在**别的**会话上跑,当前会话的流水尾部不该
   * 长出一行别人的重连。渲染前用 `reconnectViewForConversation` 过一道。
   */
  conversationId: string;
  /** 本段掉线里的第几次尝试,1 起。传输层保证单调递增(见 `DaemonReconnectState`)。 */
  attempt: number;
  /** 传输层的重连预算,设计稿的「共几次」。 */
  max: number;
  /** 预算用尽:自动重连停止,交回给人(22-3)。 */
  exhausted: boolean;
}

export type ChatReconnectSignal =
  /** 传输层的原话,逐字来自 `DaemonStreamHandlers.onReconnect`。 */
  | {
      kind: 'transport';
      runId: string;
      conversationId: string;
      attempt: number;
      max: number;
      phase: 'reconnecting' | 'cleared' | 'exhausted';
    }
  /** 这一轮落了终态。`canceled` 是 PauseLine 的地盘,见文件头第 3 条。 */
  | { kind: 'settled'; runId: string; status: ChatRunStatus }
  /**
   * 本地不再跟这条流了:切会话、离开项目、组件卸载。不带 `runId` 就是全清。
   * 与 `settled` 分开是因为它不表达运行结果 —— 那一轮可能还在 daemon 上跑着。
   */
  | { kind: 'dropped'; runId?: string }
  /**
   * 用户按了〔重新连接〕。**刻意什么都不做** —— 撤那一行的唯一正当时机是
   * 「重挂真的开始了」,`ProjectView` 在 `reattachDaemonRun` 前一行推的 `dropped`
   * 已经占住了那个位置。
   *
   * 为什么不能在按下的那一刻乐观地撤:重挂有前置条件(要先拉到这一轮的运行状态),
   * 而断线时那一条也常常拉不到 —— 于是重挂根本没开始,那一行却已经没了。真机上
   * (2026-08-27)看到的正是这个:屏幕只剩壳头一句「运行失败」,报错卡按 R9 又是
   * 该压掉的,用户连再点一次的入口都没有。**宁可多留一行,不可留死胡同。**
   */
  | { kind: 'manual-retry'; runId: string };

/**
 * 一条信号推一次状态。`prev` 原样返回表示「这条信号跟屏幕上这一行无关」。
 */
export function nextChatReconnectView(
  prev: ChatReconnectView | null,
  signal: ChatReconnectSignal,
): ChatReconnectView | null {
  if (signal.kind === 'manual-retry') return prev;

  if (signal.kind === 'dropped') {
    if (signal.runId && prev && prev.runId !== signal.runId) return prev;
    return null;
  }

  if (signal.kind === 'settled') {
    if (!prev || prev.runId !== signal.runId) return prev;
    switch (signal.status) {
      case 'queued':
      case 'running':
        // 已经交回给人之后又听到这一轮在跑 = 外层重挂接上了。用尽后的那次重挂
        // 自己的读数从 0 起,所以它不会发 `cleared`,「又活了」是仅有的恢复证据。
        // 还在数的时候不认这个:那只是状态回声,真正的恢复由 `cleared` 说了算。
        return prev.exhausted ? null : prev;
      case 'canceled':
        // 让位给组件 20。掉线自己产不出 canceled,所以这里丢掉的一定是
        // 「用户在掉线期间按了停」那一种 —— 该说的话由暂停行去说。
        return null;
      case 'succeeded':
        return null;
      case 'failed':
        // 用尽后传输层先发 failed 再发 exhausted,报错那条路上还会再来一次 failed。
        // 已经交回给人的那一行要立得住,没交回去的就跟着这一轮一起收场。
        return prev.exhausted ? prev : null;
    }
  }

  if (signal.phase === 'cleared') {
    if (prev && prev.runId !== signal.runId) return prev;
    return null;
  }

  return {
    runId: signal.runId,
    conversationId: signal.conversationId,
    attempt: signal.attempt,
    max: signal.max,
    exhausted: signal.phase === 'exhausted',
  };
}

/**
 * 从消息表里补一条「这一轮其实已经收场了」的信号,没有可补的就返回 `null`。
 *
 * 为什么需要它:`settled` 今天只在**流上**发 —— 流里读到终态、或重挂读到终态。
 * 可这一行出现的时刻恰恰是流断了的时刻,那一轮的结局于是常常从别的门进来
 * (会话刷新、切回这个会话时重新拉消息)。真机上(2026-08-27)看到的就是这个:
 * 用户按了〔重新连接〕,内容靠一次会话刷新回来了、消息写着「已完成」,
 * 而那一行还挂在下面说「连接失败」—— 正是稿子说的「不留残影」要挡的东西。
 *
 * 判据交回给 `nextChatReconnectView`,这里不自己决定要不要撤:
 * `failed` 对已经交回给人的那一行是**不动**的(22-3 那颗按钮要立得住),
 * 只有 `succeeded` / `canceled` 才是真的收场。
 */
export function settledSignalFromMessages(
  view: ChatReconnectView | null,
  messages: ReadonlyArray<{ runId?: string | null; runStatus?: ChatRunStatus | null }> | undefined,
): ChatReconnectSignal | null {
  if (!view || !messages) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.runId !== view.runId) continue;
    const status = message.runStatus;
    if (status === 'succeeded' || status === 'canceled') {
      return { kind: 'settled', runId: view.runId, status };
    }
    return null;
  }
  return null;
}

/**
 * 渲染前的最后一道:这一行是不是当前会话的事。不是就当没有。
 */
export function reconnectViewForConversation(
  view: ChatReconnectView | null,
  conversationId: string | null | undefined,
): ChatReconnectView | null {
  if (!view) return null;
  if (!conversationId) return null;
  return view.conversationId === conversationId ? view : null;
}
