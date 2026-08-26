/**
 * B13 的判据本体:一轮**没建出 run** 的失败,该收回到用户气泡上,还是留给
 * 助手侧的报错卡?
 *
 * 这条线是硬的:两边同时出的话,屏幕上会有**两个重试入口**,而它们做的还不是
 * 一件事。所以这里把两侧各自的成员逐条钉住。
 */
import { describe, expect, it } from 'vitest';

import { turnCollapsesIntoSendFailure } from '../../src/runtime/send-failure';

describe('turnCollapsesIntoSendFailure', () => {
  it.each([
    // `POST /api/runs` 真正「没建出来」的那几档 —— 报错卡上除了「重试」
    // 没有别的可点,那颗重试搬到气泡上就是全部。
    ['CONVERSATION_NOT_FOUND'],
    ['IDEMPOTENCY_CONFLICT'],
    ['RUN_IN_PROGRESS'],
    ['BAD_REQUEST'],
    ['VALIDATION_FAILED'],
    ['PROJECT_NOT_FOUND'],
    ['INTERNAL'],
  ])('%s 收回到气泡上', (code) => {
    expect(turnCollapsesIntoSendFailure({ code })).toBe(true);
  });

  it('传输层直接抛错(连码都没有)也收回到气泡上', () => {
    // fetch 抛出来的时候连 daemon 的错误体都没读到 —— 这一轮显然没送出去。
    expect(turnCollapsesIntoSendFailure({ detail: 'Failed to fetch' })).toBe(true);
  });

  it.each([
    // 这几档报错卡上挂着 AMR 切换卡 / 去登录 / 去充值 —— 气泡给不出同一条出路,
    // 收掉等于把唯一的出口删了。
    ['UNAUTHORIZED'],
    ['AGENT_AUTH_REQUIRED'],
    ['RATE_LIMITED'],
    ['UPSTREAM_UNAVAILABLE'],
  ])('%s 留给报错卡', (code) => {
    expect(turnCollapsesIntoSendFailure({ code })).toBe(false);
  });

  it('可续跑的失败留给报错卡 —— 「继续」是助手侧独有的出路', () => {
    expect(
      turnCollapsesIntoSendFailure({ code: 'BAD_REQUEST', resumable: true }),
    ).toBe(false);
  });

  it.each([
    // primaryAction 是 'none':卡上根本不画重试,全靠下面那张切换卡。
    // 把它收成一颗「重试」等于教人做一件确定会再失败一次的事。
    ['hard_quota'],
    ['workspace_credits_exhausted'],
    // 「先装个 Git for Windows 再来」这类:卡上有自己的引导文案,别搬走。
    ['git_bash_missing'],
  ] as const)('%s 这种带自有引导的档留给报错卡', (failureDetail) => {
    expect(
      turnCollapsesIntoSendFailure({
        code: 'AGENT_EXECUTION_FAILED',
        failureDetail,
      }),
    ).toBe(false);
  });
});
