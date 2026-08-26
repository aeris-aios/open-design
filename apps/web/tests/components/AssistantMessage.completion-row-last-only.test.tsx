// @vitest-environment jsdom

/**
 * 回合状态行(「已完成 · 👍👎 复制 分叉 · 20:28」)**只在最后一轮出**。
 *
 * 产品裁决(2026-08-26,用户转述):「应该只有最后一轮底部才会显示,
 * 之前轮次不要显示,hover 也不显示」。
 *
 * 为什么钉在**渲染层**:早先它是 `opacity: 0` + hover 显形,而同一份门控在
 * `styles/viewer/composio.css` 和 `styles/viewer/routines.css` **各写了一遍**,
 * 后者靠 `.app` 拔到 (0,2,0) 且排在 `index.css` 最后 —— 特异性和顺序两头都赢。
 * 只删一处不生效,而 jsdom 又不算层叠,CSS 层面的断言在这里等于没有。
 * 所以判据必须是「渲染不渲染」,这条测试才有意义。
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => store.delete(k),
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
});

afterEach(cleanup);

function finishedTurn(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '两页都好了。',
    runStatus: 'succeeded',
    startedAt: 1700000000,
    endedAt: 1700000042,
    events: [] as ChatMessage['events'],
    producedFiles: [],
  } as ChatMessage;
}

const footerOf = (container: HTMLElement) => container.querySelector('.assistant-footer');

describe('回合状态行只在最后一轮出', () => {
  it('最后一轮:跑完之后出', () => {
    const { container } = render(
      <AssistantMessage
        message={finishedTurn('m-last')}
        streaming={false}
        isLast
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );
    expect(footerOf(container)).toBeTruthy();
  });

  it('**不是**最后一轮:整行不渲染 —— 所以 hover 也不可能把它带出来', () => {
    const { container } = render(
      <AssistantMessage
        message={finishedTurn('m-old')}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );
    expect(footerOf(container)).toBeNull();
    // 连同这一行上的动作一起消失(这是产品要的取舍,不是疏漏)
    expect(screen.queryByText('已完成')).toBeNull();
  });

  it('最后一轮但还在跑:仍然不出(壳头已经在报状态)', () => {
    const { container } = render(
      <AssistantMessage
        message={{ ...finishedTurn('m-live'), runStatus: 'running', endedAt: undefined } as ChatMessage}
        streaming
        isLast
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );
    expect(footerOf(container)).toBeNull();
  });
});
