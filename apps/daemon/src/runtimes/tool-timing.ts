/**
 * 给工具调用盖时间戳,让界面能显示「这次调用花了多久」。
 *
 * 为什么放在这里,而不是各家适配器里(规格 §4 ①):
 * daemon 的 ring buffer 每条事件本来就有到达时间,诊断统计也一直在用它算单工具耗时 ——
 * **数据一直都在,只是没送到前端**。SSE 只发 `(event, data, id)`,web 的 `toAgentEvent()`
 * 也不带,时间在链路上丢了两次。所以只要在**唯一的出口**(`emitAgentEvent`)补两个字段,
 * 27 家 runtime 就全部受益,不用一家一家改。
 *
 * 为什么两端都可能缺(§2.2b / W10):
 *  · claude 的 `tool_use` 在 assistant 消息到达时就发出 → 出口盖的时间就是真实开始时间
 *  · codex 的 `tool_use` 在 `item.completed` 才发出,和 `tool_result` 同时到达 →
 *    两端相减接近 0。那不是「跑得快」,是「不知道」。前端按 `< 100ms` 一律当未知处理,
 *    不显示、也不估算(界面上出过「0.0s」,是这条规则的由来)。
 *  · ACP 家族自己带 `startedAt`(首帧时间),已经有的就不覆盖。
 *
 * 只补不改:任何一端已经有值,原样保留。
 */

export interface ToolTimingClock { now(): number }

const systemClock: ToolTimingClock = { now: () => Date.now() };

/** 出口处的事件形状(daemon 内部用 `type`,落库/送前端后叫 `kind`) */
interface MaybeToolEvent {
  type?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
}

/**
 * 在事件对象上补齐工具时间戳。原地改 —— 这里是事件的唯一出口,
 * 对象由各家适配器现造,没有别处引用它。
 */
export function stampToolTiming(event: unknown, clock: ToolTimingClock = systemClock): void {
  if (!event || typeof event !== 'object') return;
  const ev = event as MaybeToolEvent;
  if (ev.type === 'tool_use') {
    if (typeof ev.startedAt !== 'number') ev.startedAt = clock.now();
    return;
  }
  if (ev.type === 'tool_result') {
    if (typeof ev.completedAt !== 'number') ev.completedAt = clock.now();
  }
}
