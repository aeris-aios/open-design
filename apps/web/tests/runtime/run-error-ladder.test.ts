// 红测(E1 / E4 / E6):报错卡的主按钮必须由「失败的性质」推导,而不是每一档手挑一颗。
//
// 权威:`specs/current/run-error-catalog.md` §6.Z(阶梯)、§6.T(阶梯 ↔ F0–F10)、
// §6.X(逐条裁决);`docs/design/run-errors/error-ux-design.md`(32 个场景 + 频次表)。
//
// 在补映射之前这一整份都是红的:
//   - `primaryActionForFailure` / `RunFailureNature` 不存在(阶梯函数没写);
//   - `'contact-support'` 不是 `RunFailurePrimaryAction` 的成员(第 4 档没有出口);
//   - S19(进程异常退出,每月 20,868 次、第二大类)三张表里一档都没有,整个落兜底;
//   - `account_suspended`(封号)没有分类,落兜底 → 拿到一颗必然白点的〔重试〕。
import { describe, expect, it } from 'vitest';
import {
  primaryActionForFailure,
  resolveRunFailureUi,
  RUN_FAILURE_FALLBACK_MESSAGE_KEY,
} from '../../src/runtime/amr-guidance';

describe('主按钮阶梯(§6.Z)', () => {
  // 档 1:我们有能直接解决它的动作 —— 去设置改 key / 换个模型 / 新建对话 /
  // 授权并重试 / 去充值·升级。有它就永远优先,不许越过它去劝人切 Cloud
  // (用户原话:「那是把营销放在解决问题前面」)。
  it('第 1 档:有一键解决的动作时,它就是主按钮', () => {
    expect(primaryActionForFailure({ directFix: 'switch-model' })).toBe('switch-model');
    expect(primaryActionForFailure({ directFix: 'authorize' })).toBe('authorize');
    // 就算这次失败同时是「暂时性」且「本地走不通」,档 1 依然赢。
    expect(
      primaryActionForFailure({
        directFix: 'recharge',
        transient: true,
        localDeadEnd: true,
      }),
    ).toBe('recharge');
  });

  // 档 2:暂时性 —— 从失败处重试。
  it('第 2 档:暂时性失败给重试,并且赢过档 3', () => {
    expect(primaryActionForFailure({ transient: true })).toBe('retry');
    expect(primaryActionForFailure({ transient: true, localDeadEnd: true })).toBe('retry');
  });

  // 档 3:本地这条路根本走不通 —— 主按钮是「切换到 Cloud」。
  // 卡自己不再另起一颗按钮,那颗按钮在下面那张切换卡上(`showSwitchCard`)。
  it('第 3 档:本地走不通时主按钮是切换到 Cloud', () => {
    expect(primaryActionForFailure({ localDeadEnd: true })).toBe('switch-to-cloud');
  });

  // 档 4:上面都没有 —— 〔联系支持〕从常驻次级**提为主**(E6)。
  it('第 4 档:都没有出路时联系支持提为主按钮', () => {
    expect(primaryActionForFailure({})).toBe('contact-support');
  });
});

describe('原则四:重试只在有用时出现', () => {
  // 设计原则四逐字点名的三类。§6.Z:「第 4 档正好兜住原则四:额度用完、
  // 账号被封、CPU 不支持这三类拿不到重试」。这三条各自的依据:
  //   - 额度用完  hard_quota            → §6.Z 点名裁决(S08,每月 23,333 次、P0 最大类)
  //   - 账号被封  account_suspended     → §6.Z 原则四那一句 + 主表 R-064(「卡(联系支持,不给 Retry)」)
  //   - CPU 不支持 cpu_unsupported      → §6.Z 原则四那一句
  it.each([
    ['hard_quota' as const],
    ['account_suspended' as const],
    ['cpu_unsupported' as const],
  ])('%s 拿不到任何形态的重试', (detail) => {
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', detail, 'claude');
    expect(ui.primaryAction).not.toBe('retry');
    expect(ui.secondaryRetry).toBe(false);
  });

  it('封号落第 4 档:主按钮是联系支持,且不劝人切 Cloud', () => {
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'account_suspended', 'amr');
    expect(ui.primaryAction).toBe('contact-support');
    expect(ui.showSwitchCard).toBe(false);
    expect(ui.titleKey).toBe('chat.runError.title.accountSuspended');
    expect(ui.messageKey).toBe('chat.runError.accountSuspendedMessage');
  });

  // R-031 主表:「后续流程 F10 反馈」「可重试:不可」。文案本来就写着
  // 「请更新到最新版本或联系支持」,今天给的却是一颗重试 —— 按钮和句子对不上。
  it('运行时定义非法落第 4 档,不再给一颗白点的重试', () => {
    const ui = resolveRunFailureUi('AGENT_RUNTIME_DEF_INVALID', null, 'claude');
    expect(ui.primaryAction).toBe('contact-support');
    expect(ui.secondaryRetry).toBe(false);
  });
});

describe('S19 进程崩了 / 异常退出(每月 20,868 次、占失败 16.3%、P0 第二大类)', () => {
  // 稿子 `error-ux-design.md:212-217` 原文:
  //   显示:{智能体} 意外退出了 —— 它没说为什么。重试一般能恢复;反复出现的话,
  //         把日志发给我们。〔重试 | 导出日志〕
  // 「导出日志」是常驻次级(§6.Z),所以这里只钉主按钮 = 重试(档 2)。
  const S19_DETAILS = [
    'process_crashed',
    'signal_killed',
    'terminated_unknown',
    'exit_code',
    'exit_nonzero',
    'execution_failed',
  ] as const;

  it.each(S19_DETAILS)('%s 有专属文案,主按钮是重试', (detail) => {
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', detail, 'claude');
    expect(ui.titleKey).toBe('chat.runError.title.agentCrashed');
    expect(ui.messageKey).toBe('chat.runError.agentCrashedMessage');
    expect(ui.primaryAction).toBe('retry');
    // 这不是「本地走不通」,不该顺手劝人切 Cloud。
    expect(ui.showSwitchCard).toBe(false);
  });

  // S19 对每个 agent 都一样(AMR 也会崩)。今天 AMR 分支的 catch-all 会把它
  // 吃成「任务执行失败」+ 原始英文串。
  it('AMR 自己崩了也走 S19,不落 AMR 的 catch-all', () => {
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'process_crashed', 'amr');
    expect(ui.titleKey).toBe('chat.runError.title.agentCrashed');
    expect(ui.messageKey).toBe('chat.runError.agentCrashedMessage');
  });
});

describe('兜底不许把上游原文摊在卡面(E2)', () => {
  // 兜底文案是一条真实存在的 i18n 键,不是 `null`。ChatPane 拿它替掉
  // 「没命中映射表就直接渲染 rawError」那条路。
  it('导出了一条兜底文案键', () => {
    expect(RUN_FAILURE_FALLBACK_MESSAGE_KEY).toBe('chat.runError.fallbackMessage');
  });
});

describe('新文案进了 19 个语言包', () => {
  // 新键必须在全部 19 个 locale 里都有真值 —— 缺一个,那个语种的用户会在卡上
  // 看到一条裸键名。顺带:这条会把 19 个 locale 文件全 import 一遍,所以它同时
  // 是一次语法体检。
  const NEW_KEYS = [
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
    'chat.runError.title.accountSuspended',
    'chat.runError.accountSuspendedMessage',
    'chat.runError.fallbackMessage',
  ] as const;

  it('每个语种都有这五条,且都不是空串', async () => {
    const modules = import.meta.glob('../../src/i18n/locales/*.ts');
    const paths = Object.keys(modules);
    expect(paths).toHaveLength(19);
    for (const path of paths) {
      const mod = (await modules[path]!()) as Record<string, unknown>;
      const dict = (mod.default ?? Object.values(mod)[0]) as Record<string, string>;
      for (const key of NEW_KEYS) {
        expect(typeof dict[key], `${path} → ${key}`).toBe('string');
        expect(dict[key]!.trim().length, `${path} → ${key}`).toBeGreaterThan(0);
      }
    }
  });

  // 稿子里 S19 那句是「{智能体} 意外退出了」—— 插值位不能在翻译里掉。
  it('S19 文案每个语种都保留了 {agent} 插值位', async () => {
    const modules = import.meta.glob('../../src/i18n/locales/*.ts');
    for (const path of Object.keys(modules)) {
      const mod = (await modules[path]!()) as Record<string, unknown>;
      const dict = (mod.default ?? Object.values(mod)[0]) as Record<string, string>;
      expect(dict['chat.runError.agentCrashedMessage'], path).toContain('{agent}');
    }
  });
});
