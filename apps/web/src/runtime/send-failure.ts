import type { RunFailureDetail } from '@open-design/contracts';

import { resolveRunFailureUi } from './amr-guidance';

/**
 * B13「发送失败态」的唯一判据。
 *
 * ── 这一档说的是什么 ───────────────────────────────────────────────
 * 一轮**从来没建出 run**:`POST /api/runs` 就没成功,或者请求根本没发出去。
 * 这一轮没有助手侧可言 —— 没跑过、没计过费、没有可续的会话。设计稿第 49 / 50 格
 * 要的就是这一档:把它收回到**用户气泡**上(一行失败说明 + 一枚常驻「重试」),
 * 而不是留一条空的助手占位在那儿假装「它回过话了」。
 *
 * ── 为什么不是所有「没建出 run」都收 ─────────────────────────────
 * 有几档失败,报错卡上挂着**用户气泡给不出的出路**:去登录、去充值、去升级、
 * 切到 AMR、去终端里把 OAuth 走完。把它们收掉等于删掉唯一的出口 —— 人只剩下
 * 一颗会以同样理由再失败一次的「重试」。所以这些档**原样保留今天的行为**:
 * 助手占位留着、报错卡照出、`sendFailed` 不置。
 *
 * ── 为什么必须二选一 ──────────────────────────────────────────────
 * 两边同时出的话,屏幕上会有**两个重试入口**(气泡下的红色「重试」 + 报错卡里的
 * 那颗),而它们做的事还不一样。任何时候只能有一个。
 *
 * 判据直接问 `resolveRunFailureUi` —— 报错卡自己就是拿它决定画什么的
 * (`ChatPane` 里的 `runFailureUi` / `amrSwitchPayload` 同一个出处),
 * 所以「卡上有没有别的出路」不会和卡实际画出来的东西走散。
 */
export function turnCollapsesIntoSendFailure(input: {
  /** 结构化 API 错误码(`daemonCreateRunError` 从 daemon 的错误体上读下来的)。 */
  code?: string | null;
  /** daemon 的失败分类,和报错卡读的是同一份。 */
  failureDetail?: RunFailureDetail | null;
  /** 发这一轮用的 agent —— 有几档出路是按 agent 分的(Antigravity 走终端)。 */
  agentId?: string | null;
  /** 上游原话。窗口类限流的文案要从里面读重开时间。 */
  detail?: string | null;
  /** 这次失败 daemon 说可以「继续」—— 那是助手侧独有的出路。 */
  resumable?: boolean;
}): boolean {
  // 可续跑的失败带着一颗「继续」,那是这条 run 自己的会话在续,气泡上的
  // 「重发」做不到同一件事。
  if (input.resumable) return false;
  const ui = resolveRunFailureUi(
    input.code,
    input.failureDetail ?? undefined,
    input.agentId,
    input.detail,
  );
  // AMR 切换卡:登录 / 余额 / 限流 / 上游不可用这几档都挂它。
  if (ui.showSwitchCard) return false;
  // 「重试」以外的主操作(授权 / 充值 / 升级 / 开终端),以及
  // 「主操作之外还挂一颗重试」的那几档,都是卡自己的出路。
  if (ui.primaryAction !== 'retry') return false;
  if (ui.secondaryRetry) return false;
  // 卡有自己的产品文案(「装个 CLI 再来」这类)—— 那句话是这一档独有的引导,
  // 收掉之后气泡上只剩一颗光秃秃的「重试」,人不知道该先去做什么。
  // 收的只有一种:卡上除了原始报错和一颗普通「重试」什么都没有 —— 那颗重试
  // 搬到气泡上就是全部,一样都没少。
  if (ui.messageKey) return false;
  return true;
}
