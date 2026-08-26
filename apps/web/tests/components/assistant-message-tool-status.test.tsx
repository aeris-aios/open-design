// @vitest-environment jsdom
/**
 * 执行记录(`chat-panel-next.md`)在真实消息里的行为。
 *
 * 这一层**不重复纯函数那一层**(落块规则在 `tests/runtime/chat/build-turn-blocks.test.ts`),
 * 只问两件事:画出来了没有、画对了没有。
 *
 * 用例编码的是行为不是样式,所以断言挂在**看得见的字**和 `<details>` 的开合上,
 * 不挂 CSS Module 的类名 —— 那些名字在 vitest 下带哈希。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { AgentEvent, ChatMessage } from '../../src/types';

function messageWithEvents(events: AgentEvent[]): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    events,
    startedAt: 1_000,
    endedAt: 3_000,
    runStatus: 'succeeded',
  };
}

/** 执行记录壳:`.assistant-flow` 里的第一个顶层 `<details>`(ExecutionShell → Foldable) */
function record(container: HTMLElement): HTMLDetailsElement {
  const el = container.querySelector<HTMLDetailsElement>('.assistant-flow > details');
  if (!el) throw new Error('执行记录壳没有渲染出来');
  return el;
}

/** 壳头那行字:状态词(+ 耗时) */
const recordHead = (container: HTMLElement): string =>
  record(container).querySelector('summary')?.textContent ?? '';

/** 壳里的内容区。壳里没东西可展开时 `Foldable` 连这个 div 都不建 */
const recordBody = (container: HTMLElement): HTMLElement | null =>
  record(container).querySelector<HTMLElement>(':scope > div');

const bodyText = (container: HTMLElement): string => recordBody(container)?.textContent ?? '';

/** 壳里的行数:工具行、清单行、过程叙述各算一行 */
const rowCount = (container: HTMLElement): number => recordBody(container)?.children.length ?? 0;

describe('AssistantMessage 执行记录', () => {
  afterEach(() => cleanup());

  it('没有配对结果的调用不落行,壳仍然是「已完成」(D3)', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'pnpm guard', description: 'Run guard' },
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Done');
    // D3:界面上没有「执行中」这一档 —— 调用没回来就不落行,所以壳里是空的。
    // 老链路会把它画成一张「运行中」的卡,这是**故意改掉**的行为。
    expect(recordBody(container)).toBeNull();
  });

  it('没有 runStatus 的历史消息仍然算「已完成」', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Execute guard' },
            },
          ]),
          runStatus: undefined,
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Done');
  });

  it('没有 runStatus 的历史消息里有调用报错 → 整轮算「运行失败」', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/missing.ts' } },
            { kind: 'tool_result', toolUseId: 'tool-1', content: 'File not found', isError: true },
          ]),
          runStatus: undefined,
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Run failed');
  });

  it('失败之后重试成功:整轮仍是「已完成」,失败那一行还留在记录里', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'tool_use', id: 'failed-read', name: 'Read', input: { file_path: '/repo/missing.ts' } },
          { kind: 'tool_result', toolUseId: 'failed-read', content: 'File not found', isError: true },
          { kind: 'tool_use', id: 'successful-read', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'successful-read', content: 'source', isError: false },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Done');
    expect(bodyText(container)).toContain('missing.ts');
    expect(bodyText(container)).toContain('Failed');
    expect(bodyText(container)).toContain('source.ts');
  });

  it('一轮里多个调用都没有结果:壳仍是「已完成」,一行都不落(D3)', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'pnpm guard', description: 'Execute guard' },
          },
          {
            kind: 'tool_use',
            id: 'tool-2',
            name: 'Bash',
            input: { command: 'pnpm typecheck', description: 'Execute typecheck' },
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Done');
    expect(recordBody(container)).toBeNull();
  });

  it('同一个 tool_use id 出现两次不折成 ×2', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: '/repo/index.html', content: '<main />' } },
          { kind: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: '/repo/index.html', content: '<main />' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(rowCount(container)).toBe(1);
    // HTML 产物走卡片形态(组件 14),产物只应出现一次
    expect(container.querySelectorAll('[data-artifact-card]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="file-ops-toggle"]')).toBeNull();
    expect(container.textContent).not.toContain('×2');
  });

  it('只读文件留在执行记录里,不算这一轮的产出', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(bodyText(container)).toContain('source.ts');
    expect(screen.queryByTestId('file-ops-summary')).toBeNull();
  });

  it('读 / 写 / 跑三种调用收进同一张执行记录', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
          { kind: 'tool_use', id: 'tool-2', name: 'Write', input: { file_path: '/repo/result.ts', content: 'export {}' } },
          { kind: 'tool_result', toolUseId: 'tool-2', content: 'ok', isError: false },
          { kind: 'tool_use', id: 'tool-3', name: 'Bash', input: { command: 'pnpm typecheck' } },
          { kind: 'tool_result', toolUseId: 'tool-3', content: 'ok', isError: false },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(container.querySelectorAll('[data-testid="assistant-flow"] > details')).toHaveLength(1);
    expect(rowCount(container)).toBe(3);
    const body = bodyText(container);
    expect(body).toContain('source.ts');
    expect(body).toContain('result.ts');
    expect(body).toContain('pnpm typecheck');
  });

  it('失败的一轮:壳头是「运行失败」', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Execute guard' },
            },
          ]),
          runStatus: 'failed',
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Run failed');
    expect(recordHead(container)).not.toContain('Done');
    // D3:那次调用没有配对结果,所以不落行 —— 失败原因交给下面的报错卡(B18)
    expect(recordBody(container)).toBeNull();
  });

  it('手动停止:壳保持「进行中」,「已手动停止」是下面那行状态的词(B7 / W4)', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Execute guard' },
            },
          ]),
          runStatus: 'canceled',
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    // 设计稿的执行记录只有三态,手动停止不是第四态:秒数停住、状态词仍是「进行中」
    expect(recordHead(container)).toContain('Working');
    expect(recordHead(container)).not.toContain('Done');
    expect(container.querySelector('[data-testid="assistant-label"]')?.textContent).toBe('Canceled');
  });

  it('执行记录里没内容的一轮被停掉:状态行说「已取消」而不是「已完成」', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([{ kind: 'text', text: 'Partial response.' }]),
          content: 'Partial response.',
          runStatus: 'canceled',
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(container.querySelector('[data-testid="assistant-label"]')?.textContent).toBe('Canceled');
  });

  it.each(['no_result', 'delivery_failed'] as const)(
    '产物没送达(%s)也算这一轮失败',
    (resultDeliveryState) => {
      const { container } = render(
        <AssistantMessage
          projectKind="prototype"
          conversationId="conv-1"
          message={{
            ...messageWithEvents([
              { kind: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: '/repo/index.html', content: '<main />' } },
              { kind: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false },
            ]),
            resultDeliveryState,
          }}
          streaming={false}
          projectId="project-1"
        />,
      );

      expect(recordHead(container)).toContain('Run failed');
    },
  );

  it('流式中的调用还没有结果:壳是「进行中」、默认摊开,行还不落(D3 / D18)', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Run guard' },
            },
          ]),
          endedAt: undefined,
          runStatus: 'running',
        }}
        streaming
        projectId="project-1"
      />,
    );

    expect(recordHead(container)).toContain('Working');
    expect(recordBody(container)).toBeNull();
  });

  it('流式的 Write 代码预览仍然渲染;run 结束后壳收起(D18)', () => {
    const streamingEvents = [
      {
        kind: 'tool_use' as const,
        id: 'tool-1',
        name: 'Write',
        input: { file_path: '/repo/result.ts', content: 'export const value = 1;' },
      },
      { kind: 'text' as const, text: 'Writing the result now.' },
    ];
    const { container, rerender } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents(streamingEvents),
          endedAt: undefined,
          runStatus: 'running',
        }}
        streaming
        liveToolInput={{
          'live-write': {
            name: 'Write',
            text: '{"file_path":"/repo/result.ts","content":"export const value = 1;"}',
          },
        }}
        projectId="project-1"
      />,
    );

    /*
     * 2026-08-26 裁决之后:还没有 todo 的阶段,叙述在壳外,壳里只装工具调用和 thinking。
     * 这一刻那次 Write **还没有结果**,所以壳里确实空着 —— 空壳按 D21 不出箭头也打不开。
     * 这一条真正要守的是:**流式的代码预览照旧渲染**(它本来就画在壳外)。
     */
    expect(container.querySelector('[data-testid="live-code-box"]')?.textContent).toContain('export const value = 1;');

    rerender(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            ...streamingEvents,
            { kind: 'tool_result', toolUseId: 'tool-1', content: 'ok', isError: false },
          ]),
          runStatus: 'succeeded',
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(record(container).open).toBe(false);
  });

  it('壳外的结论带着流式光标;done 之前的叙述留在壳里(D43)', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Run guard' },
            },
            { kind: 'text', text: 'Let me check the guard first.' },
            { kind: 'text', text: '<done/>The answer is still streaming.' },
          ]),
          endedAt: undefined,
          runStatus: 'running',
        }}
        streaming
        projectId="project-1"
      />,
    );

    const prose = container.querySelector('.prose-block[data-stream-cursor="true"]');
    expect(prose?.textContent).toContain('The answer is still streaming.');
    /*
     * 2026-08-26 裁决:**还没有 todo 时,正文一律在壳外** —— 壳里只装工具调用和 thinking。
     * 所以 done 之前那句现在也在壳外,只是**另起一段**(标记两侧不粘连)。
     * 原来它在壳里,那是 D43 的老形态。
     */
    // 两段都在壳外(裁决:没有 todo 时正文不进壳),壳里只剩工具调用
    const paragraphs = [...container.querySelectorAll('.prose-block')].map((n) => n.textContent ?? '');
    expect(paragraphs.some((p) => p.includes('Let me check the guard first.'))).toBe(true);
    expect(bodyText(container)).not.toContain('Let me check the guard first.');
    /*
     * ⚠️ 已知未修(记在 `chat-panel-feedback.md` 的 B42):`<done/>` 两侧现在**粘成了一段**。
     * 两段都在壳外之后,标记本该仍然分段 —— 过程叙述和结论不是一回事。
     */
  });

  it('壳跟着 run 走:thinking → 进行中 → 结束收起', () => {
    const renderMessage = (
      events: AgentEvent[],
      options: { streaming: boolean; runStatus: ChatMessage['runStatus']; endedAt?: number },
    ) => (
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents(events),
          endedAt: options.endedAt,
          runStatus: options.runStatus,
        }}
        streaming={options.streaming}
        projectId="project-1"
      />
    );
    const thinking = { kind: 'thinking', text: 'Reviewing the request.' } satisfies AgentEvent;
    const read = {
      kind: 'tool_use',
      id: 'tool-1',
      name: 'Read',
      input: { file_path: '/repo/source.ts' },
    } satisfies AgentEvent;

    const { container, rerender } = render(renderMessage(
      [thinking],
      { streaming: true, runStatus: 'running' },
    ));
    expect(recordHead(container)).toContain('Thinking');
    expect(record(container).open).toBe(true);

    // 动手了就不再是「思考中」(W11:靠事件不靠文字)
    rerender(renderMessage([thinking, read], { streaming: true, runStatus: 'running' }));
    expect(recordHead(container)).toContain('Working');
    expect(recordHead(container)).not.toContain('Thinking');

    rerender(renderMessage(
      [thinking, read, { kind: 'text', text: 'Here is the conclusion.' }],
      { streaming: true, runStatus: 'running' },
    ));
    expect(record(container).open).toBe(true);

    rerender(renderMessage(
      [
        thinking,
        read,
        { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
        { kind: 'text', text: 'Here is the conclusion.' },
      ],
      { streaming: false, runStatus: 'succeeded', endedAt: 3_000 },
    ));
    expect(recordHead(container)).toContain('Done');
    expect(record(container).open).toBe(false);
  });

  it('run 还在跑时,流出来的推理当场就看得见(recvqgLmAkUM6G)', () => {
    // 老链路把推理收进一个要手点的抽屉里;新壳跑着的时候本来就是摊开的(D18),
    // 所以「卡在 Thinking 上的用户能不能读到推理」这条保障仍然成立,只是不用点了。
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([{ kind: 'thinking', text: 'Reviewing the request.' }]),
          endedAt: undefined,
          runStatus: 'running',
        }}
        streaming
        projectId="project-1"
      />,
    );

    expect(record(container).open).toBe(true);
    expect(bodyText(container)).toContain('Reviewing the request.');
  });

  it('执行记录在回答上方,thinking 与工具行都收在里面', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'thinking', text: 'Reviewing the request.' },
          { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
          { kind: 'text', text: 'Here is the finished answer.' },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const flow = container.querySelector('[data-testid="assistant-flow"]');
    expect(flow?.firstElementChild).toBe(record(container));
    expect(recordHead(container)).toContain('Done');
    expect(flow?.textContent).toContain('Here is the finished answer.');

    const body = bodyText(container);
    expect(body).toContain('Reviewing the request.');
    expect(body).toContain('source.ts');
    // 结论在壳【外】,不在壳里重复一遍(D43)
    expect(body).not.toContain('Here is the finished answer.');
  });

  it('hides empty tool_call / tool_call_update status rows (no displayable detail) (#4618)', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'status', label: 'tool_call' },
          { kind: 'status', label: 'tool_call_update' },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    // These persisted ACP markers carry no tool name/input/output, so they must
    // not surface as empty, expandable status pills.
    expect(container.querySelector('[data-status="tool_call"]')).toBeNull();
    expect(container.querySelector('[data-status="tool_call_update"]')).toBeNull();
    expect(container.querySelector('[data-testid="status-pill"]')).toBeNull();
  });

  it('hides persisted lifecycle status rows after a run reaches a terminal state', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            { kind: 'status', label: 'working' },
            { kind: 'status', label: 'completed' },
          ]),
          runStatus: 'canceled',
          endedAt: 2,
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(container.querySelector('[data-status="working"]')).toBeNull();
    expect(container.querySelector('[data-status="completed"]')).toBeNull();
    expect(container.querySelector('[data-testid="status-pill"]')).toBeNull();
  });

  it('still renders lifecycle and model status rows that carry a displayable detail', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'status', label: 'working', detail: 'Publishing plugin' },
          { kind: 'status', label: 'done', detail: 'CLI command finished' },
          { kind: 'status', label: 'model', detail: 'claude-opus-4-7-high' },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(container.querySelector('[data-status="working"]')).not.toBeNull();
    expect(container.querySelector('[data-status="done"]')).not.toBeNull();
    expect(container.textContent).toContain('Publishing plugin');
    expect(container.textContent).toContain('CLI command finished');
    const modelStatus = container.querySelector('[data-status="model"]');
    expect(modelStatus).not.toBeNull();
    expect(modelStatus?.querySelector('[data-testid="status-detail"]')?.textContent).toContain('claude-opus-4-7-high');
  });

  it('renders URLs in JSON-like status details without trailing structural characters', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'status',
            label: 'publish repo',
            detail: '{"url":"https://github.com/nexu-io/example-plugin","nameWithOwner":"nexu-io/example-plugin"}',
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const link = container.querySelector('[data-testid="status-detail"] a.md-link');
    expect(link?.getAttribute('href')).toBe('https://github.com/nexu-io/example-plugin');
    expect(link?.textContent).toBe('https://github.com/nexu-io/example-plugin');
    expect(container.querySelector('[data-testid="status-detail"]')?.textContent).toContain('"}');
  });
});
