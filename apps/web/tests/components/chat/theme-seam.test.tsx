// @vitest-environment jsdom
/**
 * 主题接缝必须真的挂在 chat 树上。
 *
 * 为什么单独测:`--chat-*` 全部定义在 `ChatRoot.module.css` 的 `.root` 上,而组件 CSS
 * 只写 `var(--chat-…)`。少了这层包裹,变量落空 —— 而落空**不报错**:
 * 壳头那句「进行中」用的是 `background-clip: text` + `color: transparent`,
 * 渐变里只要有一个变量解析不出来,整条 `background` 失效,字就变成透明的,
 * 页面上看着像「状态词没渲染」。jsdom 不算样式,所以这一条只能从结构上守:
 * 消息树必须落在 `[data-chat-root]` 里面。
 *
 * 这个洞是连拍真实运行时才看见的(docs/design/chat-mirror/shots-film),
 * 单测全绿、类型全绿,唯独页面上少了三个字。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatPane } from '../../../src/components/ChatPane';
import type { ChatMessage } from '../../../src/types';

const originalScrollIntoView = Element.prototype.scrollIntoView;

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  HTMLElement.prototype.scrollTo = function () { /* jsdom 没有,给个空的 */ };
}

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.restoreAllMocks();
});

const assistant: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: '做完了。',
  createdAt: 1_700_000_000_000,
  runStatus: 'succeeded',
  events: [
    { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'tokens.css' } },
    { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
  ],
} as ChatMessage;

function renderPane() {
  return render(
    <ChatPane
      projectKindForTracking="prototype"
      messages={[assistant]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={() => {}}
      onStop={() => {}}
      conversations={[]}
      activeConversationId="conversation-1"
      onSelectConversation={() => {}}
      onDeleteConversation={() => {}}
    />,
  );
}

describe('chat 主题接缝', () => {
  it('聊天面板自己带上 ChatRoot —— 不然 --chat-* 全落空', () => {
    const { container } = renderPane();
    expect(container.querySelector('[data-chat-root]')).not.toBeNull();
  });

  it('接缝抹在 .pane 这个**已有**元素上,不另外套一层', () => {
    // 套一层会打断 `.split-chat-slot > .pane` 这类子选择器 —— 全仓有 11 条这样的规则
    // (shell.css / chat.css / design-system-flow.css / viewer/routines.css),
    // 一层 `display: contents` 的包裹元素不影响布局,但**照样出现在选择器树上**,
    // 于是那 11 条规则集体失配:聊天卡的圆角、白底、backdrop-filter、overflow 全没了,
    // 而且没有任何报错。所以接缝只能抹在原有元素上。
    const { container } = renderPane();
    const seam = container.querySelector('[data-chat-root]');
    expect(seam?.classList.contains('pane')).toBe(true);
  });

  it('执行记录壳落在接缝里面,不是接缝的兄弟节点', () => {
    const { container } = renderPane();
    const shell = container.querySelector('details');
    expect(shell).not.toBeNull();
    expect(shell?.closest('[data-chat-root]')).not.toBeNull();
  });
});
