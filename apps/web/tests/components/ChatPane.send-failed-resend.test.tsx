// @vitest-environment jsdom
/**
 * 接线红测:发送失败的用户气泡上那颗「重试」必须**接到上游**。
 *
 * 稿子第 49 / 50 格早就画得出来,契约上 `ChatMessage.sendFailed` 也一直有 ——
 * 缺的是 `onResend`:全仓只有 `UserMessageImpl` 内部那三处,`ChatRows` →
 * `ChatPane` props → `ProjectView` 一路都没有这个 prop。于是那颗按钮点了
 * 什么都不会发生,而按钮长得跟能用一样,比没有更糟。
 *
 * 这条 spec 钉住整条链路:`ChatPane` 收到的 `onResend`,要能一路传到那条
 * 消息自己的气泡上。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

const translate = (key: string, vars?: Record<string, string | number>) => {
  if (vars && Object.keys(vars).length > 0) return `${key} ${Object.values(vars).join(' ')}`;
  return key;
};

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));

vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

vi.mock('../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/events')>();
  return {
    ...actual,
    trackChatPanelClick: vi.fn(),
    trackRunFailedToastSurfaceView: vi.fn(),
    trackRunRecoveryActionClick: vi.fn(),
    trackRunRecoveryActionSurfaceView: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function userMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: '等一下,价格行的字号先别动',
    createdAt: Date.UTC(2026, 7, 20, 8, 57),
    ...overrides,
  };
}

function renderChat(messages: ChatMessage[], onResend?: (message: ChatMessage) => void) {
  return render(
    <ChatPane
      messages={messages}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onResend={onResend}
      conversations={[
        { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
      ]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'claude', agentCliEnv: {} } as unknown as AppConfig}
    />,
  );
}

describe('ChatPane · 发送失败气泡的「重试」接线', () => {
  it('把 onResend 一路传到那条消息自己的气泡上', () => {
    const onResend = vi.fn();
    const message = userMessage({ sendFailed: true });
    renderChat([message], onResend);

    const retry = screen.getByTestId('user-send-failed');
    expect(retry.getAttribute('aria-label')).toBe('chat.sendFailedRetryAria');

    fireEvent.click(retry);
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend.mock.calls[0]![0]).toMatchObject({ id: 'user-1', sendFailed: true });
  });

  it('正常发出去的消息上没有这一颗 —— 它只属于「没发出去」那一档', () => {
    renderChat([userMessage()], vi.fn());
    expect(screen.queryByTestId('user-send-failed')).toBeNull();
  });
});
