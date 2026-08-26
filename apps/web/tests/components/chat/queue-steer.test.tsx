// @vitest-environment jsdom
/**
 * B11 「引导对话」 —— 队列行第三颗按钮。
 *
 * 稿子上这颗是「引导对话」:把这条塞进**正在跑**的那一轮。它和我们原来那颗
 * 「立即发送」是两件事 —— 立即发送要先 `handleStop()` 掉在跑的一轮再发,
 * 引导一个字都不打断。
 *
 * 这条用例守的就是「名字不冒名顶替」:
 *   · 真能引导的时候,这颗叫「引导对话」,点它走引导那条路;
 *   · 引导不了的时候(比如当前 agent 的 CLI 中途就不读 stdin 了),
 *     它**连名字一起**退回「立即发送」,并把原因挂进 tooltip;
 *   · 带附件的那一行单独退回 —— 引导只走一帧纯文本,附件根本送不过去,
 *     不能让人点了以后模型收到一条被剥光的话。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../src/i18n';
import { QueuedSendStrip } from '../../../src/components/ChatPane';

type StripProps = Parameters<typeof QueuedSendStrip>[0];

function renderStrip(overrides: Partial<StripProps> = {}) {
  const props: StripProps = {
    items: [{ id: 'q1', prompt: '把首屏文案改短一点' }],
    onEdit: () => {},
    onRemove: () => {},
    onReorder: () => {},
    onSendNow: () => {},
    ...overrides,
  };
  return render(
    <I18nProvider>
      <QueuedSendStrip {...props} />
    </I18nProvider>,
  );
}

// 这个配置没开自动 cleanup(见 ChatPane.streaming.test.tsx 也是手动 cleanup),
// 不清的话上一条用例的 DOM 还挂着,getAllByTestId 会把它一起数进来。
afterEach(cleanup);

describe('队列行第三颗:引导对话', () => {
  it('能引导时这颗是「引导对话」,点击把这条交给正在跑的那一轮', () => {
    const onSteer = vi.fn();
    const onSendNow = vi.fn();
    renderStrip({ onSteer, onSendNow });

    const steer = screen.getByTestId('chat-queued-send-steer');
    // 名字必须是引导,不是发送 —— 这颗不打断在跑的一轮。
    expect(steer.getAttribute('aria-label')).toBe('Steer this turn');
    expect(screen.queryByTestId('chat-queued-send-now')).toBeNull();

    fireEvent.click(steer);
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer.mock.calls[0]?.[0]).toMatchObject({ id: 'q1' });
    // 引导绝不能顺手走「打断再发」那条路。
    expect(onSendNow).not.toHaveBeenCalled();
  });

  it('引导不了时退回「立即发送」,并把原因写在 tooltip 上', () => {
    const onSendNow = vi.fn();
    renderStrip({
      onSendNow,
      steerBlockedReason: 'This agent can’t take a message mid-turn',
    });

    expect(screen.queryByTestId('chat-queued-send-steer')).toBeNull();
    const sendNow = screen.getByTestId('chat-queued-send-now');
    // 名字退回去了:不能用「引导对话」的名字干「打断重发」的事。
    expect(sendNow.getAttribute('aria-label')).toBe('Send');
    expect(sendNow.getAttribute('data-tooltip')).toBe(
      'This agent can’t take a message mid-turn',
    );

    fireEvent.click(sendNow);
    expect(onSendNow).toHaveBeenCalledWith('q1');
  });

  it('带附件的那一行单独退回 —— 引导只送得动纯文本', () => {
    const onSteer = vi.fn();
    renderStrip({
      onSteer,
      items: [
        { id: 'text-only', prompt: '再紧凑一点' },
        {
          id: 'with-attachment',
          prompt: '按这张图改',
          attachments: [{ path: 'a.png', name: 'a.png', kind: 'image' }],
        },
      ],
    });

    // 纯文本那一行照常是引导。
    expect(screen.getAllByTestId('chat-queued-send-steer')).toHaveLength(1);
    // 带附件那一行退回发送,并说明为什么。
    const fallback = screen.getAllByTestId('chat-queued-send-now');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.getAttribute('data-tooltip')).toBe(
      'Only text fits into a running turn — send this one with its attachments separately',
    );
  });
});
