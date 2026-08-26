// @vitest-environment jsdom

/**
 * 点一条「下一步引导」= 把那句话**直接发出去**。
 *
 * 上一版这三行是固定的工具箱目录,点下去是 `composerRef.setDraft(prompt)` ——
 * 往输入框里填草稿,人再按一次回车。产品裁决(2026-08-26)把这一族换成
 * agent 现写的三条行为引导,而稿子那三句(「再加一页订单列表」…)本来就是
 * 一句能直接发的话,所以中间那一步没有理由存在,行尾也因此没有 `›`。
 *
 * 这条钉的是**整条线**:`next_steps` 事件 → `AssistantMessage` → `NextStepActions`
 * → `ChatPane.handleNextStepSuggestion` → `onSend`。中间任何一节断了它都红。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { ChatSendMeta } from '../../src/components/ChatComposer';
import type { AppConfig, ChatMessage } from '../../src/types';

type OnSend = Parameters<typeof ChatPane>[0]['onSend'];
type SendArgs = Parameters<OnSend>;

const translate = (key: string, vars?: Record<string, string | number>) =>
  vars && Object.keys(vars).length > 0 ? `${key} ${Object.values(vars).join(' ')}` : key;

vi.mock('../../src/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/i18n')>();
  return {
    ...actual,
    useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
    useT: () => translate,
  };
});

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SUGGESTIONS = ['再加一页订单列表', '把商品卡换成两列布局', '补一套深色模式'];

function deliveredMessage(withSuggestions = true): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'Done.',
    createdAt: 1,
    runId: 'run-1',
    runStatus: 'succeeded',
    startedAt: 1700000000,
    endedAt: 1700000005,
    producedFiles: [
      {
        name: 'landing.html',
        path: 'landing.html',
        size: 100,
        mtime: 1700000005,
        kind: 'html',
        mime: 'text/html',
      },
    ],
    events: [
      { kind: 'text', text: 'Done.' },
      ...(withSuggestions ? [{ kind: 'next_steps' as const, suggestions: SUGGESTIONS }] : []),
    ],
  } as ChatMessage;
}

function renderChat(onSend: OnSend, withSuggestions = true) {
  return render(
    <ChatPane
      messages={[deliveredMessage(withSuggestions)]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={onSend}
      onStop={vi.fn()}
      onRetry={vi.fn()}
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

describe('ChatPane · 下一步引导', () => {
  it('点一条就把那句话当作用户的下一条消息发出去', () => {
    const onSend = vi.fn<OnSend>(() => undefined);
    renderChat(onSend);

    const row = screen.getByTestId('next-step-suggestion-1');
    expect(row.textContent).toContain('把商品卡换成两列布局');

    fireEvent.click(row);

    expect(onSend).toHaveBeenCalledTimes(1);
    const call = onSend.mock.calls[0]!;
    expect(call[0]).toBe('把商品卡换成两列布局');
    expect(call[1]).toEqual([]);
    expect(call[2]).toEqual([]);
    // 归因走 next_step —— 和这一族原来的埋点口径一致
    expect(call[3] as ChatSendMeta).toMatchObject({ entryFrom: 'next_step' });
  });

  it('旧会话(没有 next_steps 事件)不出这一行', () => {
    const onSend = vi.fn<OnSend>(() => undefined);
    renderChat(onSend, false);
    expect(screen.queryByTestId('next-step-suggestions')).toBeNull();
    expect(screen.queryByTestId('next-step-actions')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });
});
