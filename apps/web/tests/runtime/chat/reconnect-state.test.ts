/**
 * 组件 22 · 重连(84 格状态矩阵第 82–84 格)· S29「网络连接中断 / 正在重连」。
 *
 * 这里测的是**流水尾部那一行的状态机**,不是它长什么样(长相在
 * `tests/components/chat-reconnect.test.tsx`)。三条硬要求全在这一层成立:
 *
 *   1. 恢复后整行消失,不留「已恢复」          → `cleared` / `succeeded` 归 null
 *   2. 次数用尽换成「重新连接」交回给人          → `exhausted` 立住,不被随后的 failed 抹掉
 *   3. 与组件 20 · PauseLine 不同时出现          → 落到 `canceled` 立刻归 null
 *
 * 第 3 条是接线约束(`PauseLine.tsx` 把它写死在文档里,自己不判),
 * 而 PauseLine 只在 `runStatus: 'canceled'` + `cancelOrigin: 'user_stop'` 时才画。
 * 所以「掉线那一行在 canceled 上必须让位」就是这条约束的**结构性**保证:
 * 两者的显示条件在数据层就交不上,不靠调用方记得写 else。
 */
import { describe, expect, it } from 'vitest';
import {
  type ChatReconnectView,
  nextChatReconnectView,
  reconnectViewForConversation,
  settledSignalFromMessages,
} from '../../../src/runtime/chat/reconnect-state';

const RUN = 'run-1';
const CONV = 'conv-1';

const reconnecting = (attempt: number, over: Partial<{ runId: string; conversationId: string }> = {}) =>
  ({
    kind: 'transport',
    runId: over.runId ?? RUN,
    conversationId: over.conversationId ?? CONV,
    attempt,
    max: 5,
    phase: 'reconnecting',
  }) as const;

describe('nextChatReconnectView · 82 重连中', () => {
  it('starts from nothing on screen', () => {
    expect(reconnectViewForConversation(null, CONV)).toBeNull();
  });

  it('carries the transport reading straight through', () => {
    const view = nextChatReconnectView(null, reconnecting(2));
    expect(view).toEqual<ChatReconnectView>({
      runId: RUN,
      conversationId: CONV,
      attempt: 2,
      max: 5,
      exhausted: false,
    });
  });

  it('counts up inside one dropped stretch', () => {
    let view = nextChatReconnectView(null, reconnecting(1));
    view = nextChatReconnectView(view, reconnecting(2));
    view = nextChatReconnectView(view, reconnecting(3));
    expect(view?.attempt).toBe(3);
  });
});

describe('nextChatReconnectView · 恢复后自动消失', () => {
  it('drops the row when the transport says the drop is over', () => {
    const dropped = nextChatReconnectView(null, reconnecting(3));
    const back = nextChatReconnectView(dropped, {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 0,
      max: 5,
      phase: 'cleared',
    });
    // 「恢复后整行消失,不留『已恢复』」—— 不是换一句话,是没有这一行。
    expect(back).toBeNull();
  });

  it('drops the row when the turn finishes', () => {
    const dropped = nextChatReconnectView(null, reconnecting(3));
    expect(nextChatReconnectView(dropped, { kind: 'settled', runId: RUN, status: 'succeeded' })).toBeNull();
  });

  it('ignores a clear that belongs to some other run', () => {
    // 后台重挂的另一条流恢复了,不该把当前这一轮的读数抹掉。
    const dropped = nextChatReconnectView(null, reconnecting(3));
    const after = nextChatReconnectView(dropped, {
      kind: 'transport',
      runId: 'run-other',
      conversationId: CONV,
      attempt: 0,
      max: 5,
      phase: 'cleared',
    });
    expect(after).toBe(dropped);
  });
});

describe('nextChatReconnectView · 84 次数用尽', () => {
  it('turns the row over to the user instead of counting further', () => {
    const dropped = nextChatReconnectView(null, reconnecting(5));
    const out = nextChatReconnectView(dropped, {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 5,
      max: 5,
      phase: 'exhausted',
    });
    expect(out).toMatchObject({ attempt: 5, max: 5, exhausted: true });
  });

  it('survives the failed status the transport stamps on its way out', () => {
    // 传输层用尽预算时的顺序是 onRunStatus('failed') → emitReconnect('exhausted')
    // → onError(...)。晚到的 failed(报错卡那条路上还会再来一次)不能把
    // 已经交回给人的那一行抹掉,否则「重新连接」按钮会一闪而过。
    let view = nextChatReconnectView(null, reconnecting(5));
    view = nextChatReconnectView(view, { kind: 'settled', runId: RUN, status: 'failed' });
    view = nextChatReconnectView(view, {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 5,
      max: 5,
      phase: 'exhausted',
    });
    view = nextChatReconnectView(view, { kind: 'settled', runId: RUN, status: 'failed' });
    expect(view).toMatchObject({ exhausted: true });
  });
});

describe('nextChatReconnectView · 交回给人之后又接上了', () => {
  const exhausted = () =>
    nextChatReconnectView(nextChatReconnectView(null, reconnecting(5)), {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 5,
      max: 5,
      phase: 'exhausted',
    });

  it('steps aside as soon as the same run reports itself alive again', () => {
    // 用尽之后由外层(ProjectView 的重挂扫描 / 用户点〔重新连接〕)再试一次。
    // 那次重挂自己的读数从 0 起,所以它**不会**发 `cleared` —— 恢复的证据只有
    // 「这一轮又在跑了」。收到它就必须撤掉「连接失败」,否则正文一边流进来、
    // 底下一边挂着一句已经不成立的话。
    expect(nextChatReconnectView(exhausted(), { kind: 'settled', runId: RUN, status: 'running' })).toBeNull();
    expect(nextChatReconnectView(exhausted(), { kind: 'settled', runId: RUN, status: 'queued' })).toBeNull();
  });

  it('does not let a mid-drop status ping wipe the count', () => {
    // 还在数(没用尽)的时候,一条 running 只是状态回声,不是恢复 ——
    // 真正的恢复由传输层的 `cleared` 说了算。
    const counting = nextChatReconnectView(null, reconnecting(3));
    expect(nextChatReconnectView(counting, { kind: 'settled', runId: RUN, status: 'running' })).toBe(counting);
  });
});

describe('nextChatReconnectView · 与组件 20 PauseLine 互斥', () => {
  it('yields the row the moment the run lands on canceled', () => {
    // 用户在掉线期间按了停:PauseLine 的显示条件(canceled + user_stop)成立,
    // 这一行必须同时消失 —— 两者不同时出现。
    const dropped = nextChatReconnectView(null, reconnecting(3));
    expect(nextChatReconnectView(dropped, { kind: 'settled', runId: RUN, status: 'canceled' })).toBeNull();
  });

  it('yields even from the exhausted state', () => {
    const out = nextChatReconnectView(nextChatReconnectView(null, reconnecting(5)), {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 5,
      max: 5,
      phase: 'exhausted',
    });
    expect(nextChatReconnectView(out, { kind: 'settled', runId: RUN, status: 'canceled' })).toBeNull();
  });

  it('keeps a stale settled signal from another run out of it', () => {
    const dropped = nextChatReconnectView(null, reconnecting(3));
    expect(
      nextChatReconnectView(dropped, { kind: 'settled', runId: 'run-other', status: 'canceled' }),
    ).toBe(dropped);
  });
});

describe('nextChatReconnectView · 不残留', () => {
  it('is wiped when the local side stops following the stream', () => {
    const dropped = nextChatReconnectView(null, reconnecting(3));
    expect(nextChatReconnectView(dropped, { kind: 'dropped' })).toBeNull();
  });

  it('never leaks into another conversation', () => {
    // 后台重挂发生在别的会话上:当前会话的流水尾部不该长出一行别人的重连。
    const other = nextChatReconnectView(null, reconnecting(2, { conversationId: 'conv-2' }));
    expect(reconnectViewForConversation(other, CONV)).toBeNull();
    expect(reconnectViewForConversation(other, 'conv-2')).toBe(other);
  });
});

describe('nextChatReconnectView · 按了〔重新连接〕之后不许留下死胡同', () => {
  /**
   * 真机复现(2026-08-27):断线走到「连接失败 +〔重新连接〕」,点那颗按钮,
   * 那一行**整个消失了,而且什么都没重连** —— 屏幕上只剩壳头一句「运行失败」,
   * 报错卡又被 R9 按设计压掉了,于是用户连再点一次的入口都没有。
   *
   * 成因:`ProjectView.handleManualReconnect` 乐观地推了一条 `dropped`。可
   * `dropped` 的语义是「本地不再跟这条流了」(切会话、卸载),按重连恰恰相反。
   * 而重挂本身有前置条件(要先拉到运行状态),断线时那一条也常常拉不到 ——
   * 重挂于是根本没开始,没有人再把那一行画回来。
   *
   * 撤那一行的唯一正当时机是**重挂真的开始了**,`ProjectView` 在
   * `reattachDaemonRun` 的前一行已经推了 `dropped`(见那里的注释)。
   */
  it('leaves the handed-back row on screen so it can be pressed again', () => {
    const exhausted = nextChatReconnectView(null, {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 5,
      max: 5,
      phase: 'exhausted',
    });
    expect(exhausted?.exhausted).toBe(true);

    const afterPress = nextChatReconnectView(exhausted, { kind: 'manual-retry', runId: RUN });
    expect(afterPress, '点了重连就把行撤掉 = 重挂起不来时没有第二次机会').toBe(exhausted);
  });

  it('ignores a press aimed at some other run', () => {
    const view = nextChatReconnectView(null, reconnecting(2));
    expect(nextChatReconnectView(view, { kind: 'manual-retry', runId: 'run-other' })).toBe(view);
  });
});

describe('settledSignalFromMessages · 结局从别的门进来时也要撤那一行', () => {
  const exhaustedView = () =>
    nextChatReconnectView(null, {
      kind: 'transport',
      runId: RUN,
      conversationId: CONV,
      attempt: 5,
      max: 5,
      phase: 'exhausted',
    });

  it('reports a run that finished while nobody was listening to the stream', () => {
    const view = exhaustedView();
    const signal = settledSignalFromMessages(view, [
      { runId: 'run-other', runStatus: 'failed' },
      { runId: RUN, runStatus: 'succeeded' },
    ]);
    expect(signal).toEqual({ kind: 'settled', runId: RUN, status: 'succeeded' });
    expect(nextChatReconnectView(view, signal!), '收场了还挂着 = 稿子说的残影').toBeNull();
  });

  it('leaves the handed-back row alone while the run is still failed-and-disconnected', () => {
    const view = exhaustedView();
    // 掉线时传输层写的正是 'failed' —— 拿它当「收场」会把 22-3 那颗按钮一闪而过。
    expect(settledSignalFromMessages(view, [{ runId: RUN, runStatus: 'failed' }])).toBeNull();
  });

  it('says nothing when there is no row on screen', () => {
    expect(settledSignalFromMessages(null, [{ runId: RUN, runStatus: 'succeeded' }])).toBeNull();
  });
});
