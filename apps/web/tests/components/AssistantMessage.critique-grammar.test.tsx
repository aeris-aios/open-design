// @vitest-environment jsdom

/**
 * 评审剧场语法**不许出现在聊天正文里** —— 包括**已经落库的旧对话**。
 *
 * daemon 那道剥离(`panel-grammar-strip.ts`)只管新流。用户手上已经有一堆
 * 旧会话原样写着 `<CRITIQUE_RUN>` / `<PANELIST role="Critic" score="9.0">`,
 * 在真实客户端里连着撞到四次。旧数据不能因为「以后不会再有了」就烂在那儿。
 *
 * 这条守的是**渲染层**:同一段文字,刚生成时和刷新之后必须长得一样。
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

/** 用户真机上截到的那一段(原样,连空行都保留) */
const LEAKED = [
  '中文全篇使用同一套楷体衬线。',
  '',
  '<CRITIQUE_RUN>',
  '<ROUND index="1">',
  '<PANELIST role="Designer">',
  '已完成编辑式单页文档《把复杂工作写清楚》。',
  '</PANELIST>',
  '<PANELIST role="Critic" score="9.0">',
  '层级清晰,三栏节奏稳定。',
  '</PANELIST>',
  '</ROUND>',
  '<SHIP/>',
  '</CRITIQUE_RUN>',
].join('\n');

function historyMessage(content: string): ChatMessage {
  return {
    id: 'msg-history',
    role: 'assistant',
    content,
    runStatus: 'succeeded',
    startedAt: 1700000000,
    endedAt: 1700000005,
    events: [] as ChatMessage['events'],
    producedFiles: [],
  } as ChatMessage;
}

describe('旧对话里的评审剧场语法', () => {
  it('一条标记都不留在正文里', () => {
    const { container } = render(
      <AssistantMessage
        message={historyMessage(LEAKED)}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );
    const shown = container.textContent ?? '';
    for (const tag of ['CRITIQUE_RUN', 'PANELIST', 'ROUND', 'SHIP', 'MUSTFIX', 'RESOLVED']) {
      expect(shown).not.toContain(`<${tag}`);
      expect(shown).not.toContain(`</${tag}`);
    }
    // `score="9.0"` 是标记的属性,连同标记一起消失
    expect(shown).not.toContain('score=');
  });

  it('标记之间那几句人话原样留着 —— 剥的是壳,不是字', () => {
    render(
      <AssistantMessage
        message={historyMessage(LEAKED)}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.getByText(/中文全篇使用同一套楷体衬线/)).toBeTruthy();
    expect(screen.getByText(/已完成编辑式单页文档/)).toBeTruthy();
    expect(screen.getByText(/层级清晰/)).toBeTruthy();
  });

  it('长得像标记但不是的,一个字都不许动', () => {
    const innocent = '我们讨论了 <PANELISTS> 这个复数拼法,以及 a<b 和 5 < 7 的写法。';
    const { container } = render(
      <AssistantMessage
        message={historyMessage(innocent)}
        streaming={false}
        projectId="p1"
        errorCardOwnerId={null}
        onFeedback={vi.fn()}
      />,
    );
    const shown = container.textContent ?? '';
    expect(shown).toContain('复数拼法');
    expect(shown).toContain('5 < 7');
  });
});
