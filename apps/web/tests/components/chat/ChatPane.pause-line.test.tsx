// @vitest-environment jsdom
//
// 红测:交付稿第 81 格「暂停任务」那一行灰字,产品的渲染路径要真的画出来。
//
// `apps/web/src/components/chat/PauseLine.tsx` 写好之后**零消费者** —— 只有陈列页
// import 它。这里的每一条断言都从 `<ChatPane>` 出发。
//
// 最要紧的一条不是「出得来」,是「**不该出的时候不出**」:客户端今天只看
// `runStatus: 'canceled'`,会把「用户按停」和「daemon 关机 / 项目清理杀掉」
// 混成一种。照那个判据画,daemon 重启后这一行就会谎报「你手动停了任务」。
// 判据只能是 `cancelOrigin === 'user_stop'`,缺字段(旧 daemon 不发)也不画。

import { cleanup, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../../src/types';

const translate = (key: string, vars?: Record<string, string | number>) => {
  if (vars && Object.keys(vars).length > 0) {
    return `${key} ${Object.values(vars).join(' ')}`;
  }
  return key;
};

vi.mock('../../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));

vi.mock('../../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

vi.mock('../../../src/analytics/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/analytics/events')>();
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

/** 一份 TodoWrite 快照,3 步里剩 2 步没跑完 —— 「还有剩余」的那一边。 */
const TODO_EVENTS = [
  {
    kind: 'tool_use' as const,
    id: 'todo-1',
    name: 'TodoWrite',
    input: {
      todos: [
        { content: '梳理页面结构', status: 'completed' },
        { content: '铺商品卡', status: 'in_progress' },
        { content: '接筛选', status: 'pending' },
      ],
    },
  },
];

function stoppedMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-stopped',
    role: 'assistant',
    content: '铺到一半。',
    createdAt: 1,
    runId: 'run-stopped',
    runStatus: 'canceled',
    agentId: 'amr',
    cancelOrigin: 'user_stop',
    events: TODO_EVENTS,
    ...overrides,
  } as ChatMessage;
}

function renderChat(opts: { messages: ChatMessage[]; streaming?: boolean }) {
  return render(
    <ChatPane
      messages={opts.messages}
      streaming={opts.streaming ?? false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onRetry={vi.fn()}
      conversations={[
        { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
      ]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'amr', agentCliEnv: {} } as unknown as AppConfig}
    />,
  );
}

describe('ChatPane — 暂停任务那一行', () => {
  it('用户按停(user_stop)时,流水里出现这一行', () => {
    const { container } = renderChat({ messages: [stoppedMessage()] });

    const line = screen.getByTestId('chat-pause-line');
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('chat.edge.paused');
    expect(container.querySelector('.chat-log')?.contains(line)).toBe(true);
    // 边界 1:无操作 —— 这一行里不该有任何按钮。
    expect(line.querySelector('button')).toBeNull();
    // 边界 2:不摊剩余步骤 —— 一个数字都不往屏幕上放。
    expect(line.textContent).not.toMatch(/\d/);
  });

  // 这条最重要:它防的是谎报。
  it('daemon 关机 / 项目清理杀掉的,不出这一行', () => {
    for (const origin of ['daemon_shutdown', 'project_cleanup', 'unknown'] as const) {
      renderChat({ messages: [stoppedMessage({ cancelOrigin: origin })] });
      expect(screen.queryByTestId('chat-pause-line')).toBeNull();
      cleanup();
    }
  });

  it('缺 cancelOrigin(旧 daemon 不发)时也不出 —— 证不出是用户按的就不说是', () => {
    renderChat({ messages: [stoppedMessage({ cancelOrigin: undefined })] });
    expect(screen.queryByTestId('chat-pause-line')).toBeNull();
  });

  it('剩余为 0 时不出现(那一轮已经跑完,由回合状态行去报)', () => {
    renderChat({
      messages: [
        stoppedMessage({
          events: [
            {
              kind: 'tool_use',
              id: 'todo-2',
              name: 'TodoWrite',
              input: {
                todos: [
                  { content: '梳理页面结构', status: 'completed' },
                  { content: '铺商品卡', status: 'completed' },
                ],
              },
            },
          ] as never,
        }),
      ],
    });
    expect(screen.queryByTestId('chat-pause-line')).toBeNull();
  });

  // 边界 3:断线不走这一行 —— 那由「重连」那一族全程接管。一条还在跑 / 还在
  // 重连的 run 不是 canceled,所以两者结构上不会同时出现。
  it('还在跑(掉线重连中)时不出这一行', () => {
    renderChat({
      messages: [stoppedMessage({ runStatus: 'running', cancelOrigin: undefined })],
      streaming: true,
    });
    expect(screen.queryByTestId('chat-pause-line')).toBeNull();
  });

  it('只盖最后一轮:后面又跑了一轮就不再显示上一轮的暂停行', () => {
    renderChat({
      messages: [
        stoppedMessage(),
        {
          id: 'msg-user',
          role: 'user',
          content: '继续',
          createdAt: 2,
        } as ChatMessage,
        {
          id: 'msg-after',
          role: 'assistant',
          content: '好的。',
          createdAt: 3,
          runId: 'run-after',
          runStatus: 'succeeded',
          agentId: 'amr',
        } as ChatMessage,
      ],
    });
    expect(screen.queryByTestId('chat-pause-line')).toBeNull();
  });
});
