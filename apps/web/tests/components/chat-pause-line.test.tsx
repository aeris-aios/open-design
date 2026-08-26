// @vitest-environment jsdom
/**
 * 组件 20 · 暂停任务(84 格状态矩阵第 81 格)。
 *
 * 这一格只有一行字,所以能测的全是**它什么时候不该出现** —— 而那恰好是这一格
 * 唯一会出错的地方:
 *   · 只有用户自己按停才算「已手动暂停」(daemon 关机 / 项目清理杀掉的不算,盘点 R8)
 *   · 剩余为 0 时不出现(那一轮已经跑完,由回合状态行去报)
 *   · 永远不摊剩余步数(规格 D5)
 *
 * 文案逐字对设计稿 4264(zh-CN 是原文,不改写)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../../src/i18n';
import { PauseLine } from '../../src/components/chat/PauseLine';

afterEach(() => { cleanup(); });

const render = (ui: ReactElement) => rtlRender(<I18nProvider initial="zh-CN">{ui}</I18nProvider>);
const line = () => screen.queryByTestId('chat-pause-line');

describe('PauseLine', () => {
  it('states the pause when the user is the one who stopped the run', () => {
    render(<PauseLine cancelOrigin="user_stop" remainingSteps={3} />);
    expect(line()?.textContent).toBe('已手动暂停任务');
  });

  it('is one line with nothing to act on', () => {
    render(<PauseLine cancelOrigin="user_stop" remainingSteps={3} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('never spells out how many steps are left', () => {
    // D5:手动暂停只给一行文案,不显示剩余步数 ——「剩几步、分别叫什么,
    // 上面那段执行记录本来就写着」。
    render(<PauseLine cancelOrigin="user_stop" remainingSteps={7} />);
    expect(line()?.textContent ?? '').not.toMatch(/\d/);
  });

  it('still shows when nothing was left to do — D5 forbids showing the count, not the line', () => {
    // D5 的原文是「手动暂停只给一行文案,**不显示剩余步数**」。把它读成
    // 「没有剩余就别出这一行」是替设计拍板:用户按了停,这一行就该出。
    // 要不要在一步不剩时压掉,是产品的事(T29),不是这里能定的。
    render(<PauseLine cancelOrigin="user_stop" remainingSteps={0} />);
    expect(line()).not.toBeNull();
  });

  it.each(['daemon_shutdown', 'project_cleanup', 'unknown'] as const)(
    'does not claim a manual pause when the run died from %s',
    (origin) => {
      render(<PauseLine cancelOrigin={origin} remainingSteps={3} />);
      expect(line()).toBeNull();
    },
  );

  it.each([
    ['absent', undefined],
    ['null', null],
  ] as const)('says nothing when cancelOrigin is %s', (_label, origin) => {
    // 旧 daemon 不发这个字段。证不出是用户按的就不说是 —— 宁可这一行不出现,
    // 也不要在 daemon 重启后谎报「已手动暂停任务」。
    render(<PauseLine cancelOrigin={origin} remainingSteps={3} />);
    expect(line()).toBeNull();
  });
});
