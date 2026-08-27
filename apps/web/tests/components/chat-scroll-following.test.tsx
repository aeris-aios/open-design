// @vitest-environment jsdom

// Polyfill scrollTo for jsdom (not available in jsdom's HTMLElement).
if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    _y?: number,
  ) {
    if (typeof options === 'object' && options !== null) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
    }
  };
}

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import { flushMounts, pressEnter, typeInComposer } from '../helpers/lexical-composer';
import type { ChatMessage } from '../../src/types';

/*
 * jsdom 没有排版引擎,`scrollTop / scrollHeight / clientHeight` 全是 0,所以滚动行为
 * 只能靠夹具喂几何。这里比同目录里既有的两份夹具多走一步:**让几何自洽**。
 *
 *  · `scrollHeight` = 真实内容高 + 尾部占位块当前的内联高度。占位块的高度是被测组件
 *    自己写的(anchor-to-top 的预留空白),不把它算进 `scrollHeight`,「底下还有多少」
 *    这件事在测试里就永远量不准。
 *  · `scrollTop` 的写入按浏览器语义**夹到 [0, scrollHeight - clientHeight]**。不夹的话
 *    `el.scrollTop = el.scrollHeight` 会留下一个真实浏览器里不存在的数,后面所有
 *    「离底部多远」都是错的。
 *  · 尾部占位块的 `offsetHeight` 也照着它自己的内联高度回答 —— `sizeAnchorSpacer`
 *    读的就是它。
 */
type Geom = { contentHeight: number; clientHeight: number; scrollTop: number };
let geom: Geom;
let rafCallbacks: FrameRequestCallback[];
let resizeCallbacks: ResizeObserverCallback[];
let savedDescriptors: Record<
  'scrollTop' | 'scrollHeight' | 'clientHeight' | 'offsetHeight',
  PropertyDescriptor | undefined
>;
let originalResizeObserver: typeof ResizeObserver | undefined;
let originalMutationObserver: typeof MutationObserver | undefined;

/**
 * 把 MutationObserver 摘掉,好让**只剩** anchor 那一帧自己的收尾。
 *
 * 子树变动那条路也会去重算(见 ChatPane 里的 `scheduleFollowSync`),两条路都排 rAF,
 * 谁后跑没有保证 —— 而只有 anchor 那一帧是跑在 `scrollAnchorToTop()` **之后**的。
 * 想验「那一帧自己会收尾」,就得先把另一条路挪开,否则测的是谁都说不清。
 */
function disableMutationObserver() {
  originalMutationObserver = globalThis.MutationObserver;
  class NoopMutationObserver {
    observe() {}
    disconnect() {}
    takeRecords(): MutationRecord[] {
      return [];
    }
  }
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: NoopMutationObserver,
  });
}

function isChatLog(el: HTMLElement): boolean {
  return typeof el?.classList?.contains === 'function' && el.classList.contains('chat-log');
}

function isTailSpacer(el: HTMLElement): boolean {
  return (
    typeof el?.classList?.contains === 'function' &&
    el.classList.contains('chat-log-tail-spacer')
  );
}

function inlineHeight(el: HTMLElement | null): number {
  if (!el) return 0;
  const parsed = Number.parseFloat(el.style.height);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tailSpacerHeight(): number {
  return inlineHeight(document.querySelector<HTMLElement>('.chat-log-tail-spacer'));
}

function scrollHeightOf(): number {
  return geom.contentHeight + tailSpacerHeight();
}

function maxScrollTop(): number {
  return Math.max(0, scrollHeightOf() - geom.clientHeight);
}

beforeEach(() => {
  geom = { contentHeight: 1000, clientHeight: 400, scrollTop: 0 };
  rafCallbacks = [];
  resizeCallbacks = [];

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

  originalResizeObserver = globalThis.ResizeObserver;
  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  });

  savedDescriptors = {
    scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'),
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return isChatLog(this) ? geom.scrollTop : 0;
    },
    set(this: HTMLElement, v: number) {
      if (!isChatLog(this)) return;
      geom.scrollTop = Math.min(Math.max(0, v), maxScrollTop());
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isChatLog(this) ? scrollHeightOf() : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isChatLog(this) ? geom.clientHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isTailSpacer(this) ? inlineHeight(this) : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  rafCallbacks = [];
  resizeCallbacks = [];
  if (originalResizeObserver) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    });
  } else {
    delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  }
  if (originalMutationObserver) {
    Object.defineProperty(globalThis, 'MutationObserver', {
      configurable: true,
      writable: true,
      value: originalMutationObserver,
    });
    originalMutationObserver = undefined;
  }
  for (const key of ['scrollTop', 'scrollHeight', 'clientHeight', 'offsetHeight'] as const) {
    const original = savedDescriptors[key];
    if (original) {
      Object.defineProperty(HTMLElement.prototype, key, original);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  }
});

async function flushFrames() {
  await act(async () => {
    for (let round = 0; round < 5; round += 1) {
      const callbacks = rafCallbacks.splice(0);
      if (callbacks.length === 0) break;
      callbacks.forEach((callback) => callback(performance.now()));
      await Promise.resolve();
    }
  });
}

async function triggerResize() {
  await act(async () => {
    [...resizeCallbacks].forEach((callback) => callback([], {} as ResizeObserver));
    await Promise.resolve();
  });
}

function chatLog(): HTMLElement {
  return screen.getByTestId('chat-log');
}

/** 用户真的用滚轮/触控板滚了一下:位置变了,然后浏览器发 scroll。 */
async function userScrollTo(top: number) {
  await act(async () => {
    geom.scrollTop = Math.min(Math.max(0, top), maxScrollTop());
    fireEvent.scroll(chatLog());
    await Promise.resolve();
  });
}

/*
 * 只给**最后一条用户消息**装一个会说话的 `getBoundingClientRect`。
 * 不整体替换原型上的那个方法:Lexical 和一堆定位逻辑都在读它,全局造假会波及无关组件。
 * chat-log 自己的矩形保持 jsdom 默认的全零,于是
 * `lastUserMsgTopInContent` 正好等于 `scrollTop + (msgTop - scrollTop) = msgTop`。
 */
function stubUserMessageTop(container: HTMLElement, topInContent: number) {
  const userEls = container.querySelectorAll<HTMLElement>('.msg.user');
  const last = userEls[userEls.length - 1];
  if (!last) throw new Error('no .msg.user rendered');
  Object.defineProperty(last, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: topInContent - geom.scrollTop,
      bottom: topInContent - geom.scrollTop,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: topInContent - geom.scrollTop,
      toJSON: () => ({}),
    }),
  });
}

function jumpBtnShown(): boolean {
  return screen.getByTestId('chat-jump-btn').getAttribute('aria-hidden') === 'false';
}

function chatPaneEl(
  messages: ChatMessage[],
  overrides: { streaming?: boolean } = {},
) {
  return (
    <ChatPane
      messages={messages}
      streaming={overrides.streaming ?? false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={() => {}}
      onStop={() => {}}
      conversations={[]}
      activeConversationId="conv-1"
      onSelectConversation={() => {}}
      onDeleteConversation={() => {}}
    />
  );
}

function longConversation(chunkText: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < 8; i += 1) {
    messages.push({
      id: `u${i}`,
      role: 'user',
      content: `request ${i}`,
      createdAt: 1_700_000_000_000 + i * 2,
    });
    messages.push({
      id: `a${i}`,
      role: 'assistant',
      content: `reply ${i}`,
      createdAt: 1_700_000_000_000 + i * 2 + 1,
    });
  }
  messages.push({
    id: 'streaming',
    role: 'assistant',
    content: chunkText,
    createdAt: 1_700_000_000_100,
    runStatus: 'running',
  });
  return messages;
}

describe('流式输出时的滚动跟随(用户 2026-08-27)', () => {
  /*
   * 「agent 在快速流式输出内容时,每次输出就会自动回到最底,整个对话框连向上滚动都不行」
   *
   * 关键在**「连向上滚动都不行」**:不是「跟随太积极」,是**滚不动**。原因是
   * 「我是否在跟随」这件事**由位置反推**(`distance < 80`),而跟随本身**又把位置写回底部**——
   * 触控板一格 40px 抬不出 80px 的坑,下一帧就被拽回去,于是永远逃不掉。
   * 所以这一条必须用「连着滚好几下」来测:滚一下就跳出阈值的写法测不出这个死锁。
   */
  it('用户向上滚之后,后续每一块流式内容都不许把视图拽回底部', async () => {
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    let text = 'chunk';
    const { rerender } = render(chatPaneEl(longConversation(text), { streaming: true }));
    await flushFrames();
    // 初始落底。
    expect(geom.scrollTop).toBe(4600);

    // 用户连着往上滚五下,每下 40px —— 触控板/鼠标滚轮的真实粒度。
    // 每两下之间模型又吐一块内容(内容变高 + ResizeObserver 回调)。
    for (let step = 0; step < 5; step += 1) {
      await userScrollTo(geom.scrollTop - 40);
      text += ' more';
      geom.contentHeight += 120;
      await act(async () => {
        rerender(chatPaneEl(longConversation(text), { streaming: true }));
      });
      await triggerResize();
      await flushFrames();
    }

    // 用户把视图放在 4600 - 5*40 = 4400,五块内容之后它必须还在 4400。
    expect(geom.scrollTop).toBe(4400);
  });

  it('用户停在底部时,流式内容仍然自动跟随', async () => {
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    let text = 'chunk';
    const { rerender } = render(chatPaneEl(longConversation(text), { streaming: true }));
    await flushFrames();
    expect(geom.scrollTop).toBe(4600);

    for (let step = 0; step < 5; step += 1) {
      text += ' more';
      geom.contentHeight += 120;
      await act(async () => {
        rerender(chatPaneEl(longConversation(text), { streaming: true }));
      });
      await triggerResize();
      await flushFrames();
    }

    // 5 * 120 = 600 的增长,视图必须一路跟到新的底。
    expect(geom.scrollTop).toBe(maxScrollTop());
    expect(geom.scrollTop).toBe(5200);
  });

  it('滚轮往上拨一下就停手 —— 哪怕浏览器把这一格滚动整个吃掉', async () => {
    /*
     * 快速流式时,同一帧里只要我们写过 `scrollTop`,浏览器就会把这一次滚轮滚动
     * **直接取消**:位置纹丝不动,连 scroll 事件都不发。只看 scroll 事件的话,
     * 用户的手在这一帧就凭空消失了 —— 这正是「连向上滚动都不行」的手感来源之一。
     * 所以 wheel 事件本身要能松开跟随。
     */
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    let text = 'chunk';
    const { rerender } = render(chatPaneEl(longConversation(text), { streaming: true }));
    await flushFrames();
    expect(geom.scrollTop).toBe(4600);

    // 滚轮往上 —— 位置**没有**变化,浏览器把这一格吃了。
    await act(async () => {
      fireEvent.wheel(chatLog(), { deltaY: -40 });
      await Promise.resolve();
    });

    text += ' more';
    geom.contentHeight += 120;
    await act(async () => {
      rerender(chatPaneEl(longConversation(text), { streaming: true }));
    });
    await triggerResize();
    await flushFrames();

    // 没被拽到新的底(4720)。
    expect(geom.scrollTop).toBe(4600);
  });

  it('手指下拉也算停手(触屏)', async () => {
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    let text = 'chunk';
    const { rerender } = render(chatPaneEl(longConversation(text), { streaming: true }));
    await flushFrames();

    await act(async () => {
      fireEvent.touchStart(chatLog(), { touches: [{ clientY: 200 }] });
      fireEvent.touchMove(chatLog(), { touches: [{ clientY: 280 }] });
      await Promise.resolve();
    });

    text += ' more';
    geom.contentHeight += 120;
    await act(async () => {
      rerender(chatPaneEl(longConversation(text), { streaming: true }));
    });
    await triggerResize();
    await flushFrames();

    expect(geom.scrollTop).toBe(4600);
  });

  it('向上滚开之后再滚回底部,跟随要重新接上', async () => {
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    let text = 'chunk';
    const { rerender } = render(chatPaneEl(longConversation(text), { streaming: true }));
    await flushFrames();

    await userScrollTo(3000);
    text += ' more';
    geom.contentHeight += 120;
    await act(async () => {
      rerender(chatPaneEl(longConversation(text), { streaming: true }));
    });
    await triggerResize();
    await flushFrames();
    expect(geom.scrollTop).toBe(3000);

    // 用户自己滚回底部 —— 跟随重新接上。
    await userScrollTo(maxScrollTop());
    text += ' more';
    geom.contentHeight += 120;
    await act(async () => {
      rerender(chatPaneEl(longConversation(text), { streaming: true }));
    });
    await triggerResize();
    await flushFrames();
    expect(geom.scrollTop).toBe(maxScrollTop());
  });
});

describe('「回到最新」什么时候该在(用户 2026-08-27:「总是在不该出现的时候出现」)', () => {
  it('滚到很上面时必须给入口', async () => {
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    render(chatPaneEl(longConversation('chunk'), { streaming: true }));
    await flushFrames();
    expect(jumpBtnShown()).toBe(false);

    await userScrollTo(1000);
    expect(jumpBtnShown()).toBe(true);
  });

  it('内容缩到滚不动之后,浮标必须自己收起(没有任何 scroll 事件)', async () => {
    /*
     * run 结束、执行记录自动收起,内容一下矮了一大截 —— 这是**没有 scroll 事件**的
     * 高度变化。浮标的判据如果只挂在 scroll 事件和「消息条数」上,这里就没人去重算,
     * 于是它挂在一屏根本滚不动的对话上。
     */
    geom = { contentHeight: 5000, clientHeight: 400, scrollTop: 0 };
    render(chatPaneEl(longConversation('chunk'), { streaming: true }));
    await flushFrames();
    await userScrollTo(1000);
    expect(jumpBtnShown()).toBe(true);

    /*
     * 执行记录收起来了:内容比视口还矮,滚都滚不动了。
     *
     * **刻意不重渲染** —— 折叠是组件自己的内部状态,消息数组一个字没变。这里只有
     * 一次 ResizeObserver 回调,没有 React 更新、也没有 scroll 事件。如果观察者
     * 那条路只在「正在跟随」时才做事(老写法就是),这一拍就没人去重算,浮标挂着不走。
     */
    geom.contentHeight = 300;
    geom.scrollTop = 0;
    await triggerResize();
    await flushFrames();

    expect(maxScrollTop()).toBe(0);
    expect(jumpBtnShown()).toBe(false);
  });

  it('在一屏装得下的对话里展开执行记录,不该唤出浮标', async () => {
    /*
     * 展开折叠块要「点开的那一行别动」,所以它会停掉跟随 —— 这是对的。
     * 但它同时**无条件**把浮标点亮了,不管底下有没有东西可回。
     */
    geom = { contentHeight: 300, clientHeight: 400, scrollTop: 0 };
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'build something', createdAt: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'on it',
        createdAt: 2,
        events: [
          { kind: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
        ],
      },
    ];
    const { container } = render(chatPaneEl(messages));
    await flushFrames();
    expect(jumpBtnShown()).toBe(false);

    const toggle = container.querySelector<HTMLElement>(
      '.chat-log summary, .chat-log .thinking-toggle, .chat-log .action-card-toggle, .chat-log button.op-card-head, .chat-log [aria-expanded]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle!);
      await Promise.resolve();
    });
    await flushFrames();

    expect(maxScrollTop()).toBe(0);
    expect(jumpBtnShown()).toBe(false);
  });


  const priorTurns: ChatMessage[] = [
    { id: 'u0', role: 'user', content: 'first request', createdAt: 1 },
    { id: 'a0', role: 'assistant', content: 'first reply', createdAt: 2 },
  ];

  const sentTurn: ChatMessage[] = [
    ...priorTurns,
    { id: 'u1', role: 'user', content: 'make the hero punchier', createdAt: 3 },
    { id: 'a1', role: 'assistant', content: '', createdAt: 4, runStatus: 'running' },
  ];

  /**
   * 走真实的发送路径(Lexical 编辑器 + Enter),把 anchor-to-top 真正点着。
   * `anchorPendingRef` 只有 ChatComposer 的 onSend 会点,绕不过去。
   *
   * `contentAfterSend` 是这一轮渲染出来之后的**真内容高**(不含预留空白);
   * `userMsgTop` 是这条用户消息在内容里的起始位置 —— jsdom 没有排版,只能喂进去,
   * 否则 anchor 的全部算术都塌成 `scrollTop` 本身。
   */
  async function sendAnchoredTurn(opts: { contentAfterSend: number; userMsgTop: number }) {
    const view = render(chatPaneEl(priorTurns));
    await flushFrames();

    await flushMounts();
    typeInComposer('make the hero punchier');
    pressEnter();

    geom.contentHeight = opts.contentAfterSend;
    await act(async () => {
      view.rerender(chatPaneEl(sentTurn, { streaming: true }));
    });
    stubUserMessageTop(view.container, opts.userMsgTop);
    await flushFrames();
    return view;
  }

  it('刚发出的一轮里,底下只有预留空白时不该给入口', async () => {
    /*
     * 用户截图里的那一屏:**一条用户消息 + 一个「进行中」头**,面板下面大半是空的,
     * 浮标却贴在输入框上方。
     *
     * 那片「空」不是内容,是 anchor-to-top 给回复预留的尾部占位块;占位块的尺寸
     * 恰好让这条用户消息顶到视口顶端,也就是说视图**正正好停在底部**,底下一个像素的
     * 真内容都没有。老写法在 anchor 接管的那一行无条件 `setScrolledFromBottom(true)`,
     * 之后再没人回来问一句「底下到底有没有东西」。
     */
    geom = { contentHeight: 1200, clientHeight: 400, scrollTop: 0 };
    // 新的一轮渲染出来:用户消息 + 「进行中」头,内容从 1200 长到 1460。
    const { rerender } = await sendAnchoredTurn({ contentAfterSend: 1460, userMsgTop: 1200 });

    // 先确认 anchor-to-top 真的接管了 —— 否则下面那条断言就是空的:
    // 预留空白被撑起来了(400 - 260 - 12),视图停在这条用户消息顶到头的位置。
    expect(tailSpacerHeight()).toBe(128);
    expect(geom.scrollTop).toBe(1188);
    expect(maxScrollTop()).toBe(1188);

    expect(jumpBtnShown()).toBe(false);

    // 一帧里长出一大块(400px 的工具卡),占位块要到下一帧才缩。
    geom.contentHeight = 1660;
    await act(async () => {
      rerender(
        chatPaneEl(
          [
            ...priorTurns,
            { id: 'u1', role: 'user', content: 'make the hero punchier', createdAt: 3 },
            {
              id: 'a1',
              role: 'assistant',
              content: 'looking at the hero section now',
              createdAt: 4,
              runStatus: 'running',
              events: [
                { kind: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
              ],
            },
          ],
          { streaming: true },
        ),
      );
    });
    await triggerResize();
    await flushFrames();

    // 占位块缩完之后,底下那点真内容(72px)离「很上面」差得远,不该给入口。
    expect(geom.contentHeight - geom.scrollTop - geom.clientHeight).toBe(72);
    expect(jumpBtnShown()).toBe(false);

    // 反面:回复真长过一屏之后,最新的输出确实跑到视口下面去了 —— 这时必须给入口。
    geom.contentHeight = 2100;
    await act(async () => {
      rerender(
        chatPaneEl(
          [
            ...priorTurns,
            { id: 'u1', role: 'user', content: 'make the hero punchier', createdAt: 3 },
            {
              id: 'a1',
              role: 'assistant',
              content: 'a much longer reply that runs well past one screen',
              createdAt: 4,
              runStatus: 'running',
              events: [
                { kind: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
                { kind: 'tool_use', id: 'call-2', name: 'Write', input: { file_path: '/tmp/b.txt' } },
              ],
            },
          ],
          { streaming: true },
        ),
      );
    });
    await triggerResize();
    await flushFrames();

    expect(geom.contentHeight - geom.scrollTop - geom.clientHeight).toBe(512);
    expect(jumpBtnShown()).toBe(true);
  });

  it('预留空白不算「底下还有内容」—— 在 anchor 轮里往上滚不该唤出浮标', async () => {
    /*
     * 这一条钉的是「量几何时把预留空白扣掉」。
     *
     * anchor 轮进行中,用户往上滚去看更早的内容。他离**内容**底部 260px,离
     * **含预留空白**的底部 388px。400px 高的面板里,「很上面」的门槛是 300px
     * (0.75 视口,再夹到 [320, 1200] → 320)—— 260 不到,388 超了。
     * 不扣掉那块空白,浮标就会因为一屏根本不存在的东西冒出来。
     */
    geom = { contentHeight: 1200, clientHeight: 400, scrollTop: 0 };
    await sendAnchoredTurn({ contentAfterSend: 1460, userMsgTop: 1200 });
    expect(tailSpacerHeight()).toBe(128);
    expect(maxScrollTop()).toBe(1188);

    await userScrollTo(800);

    expect(scrollHeightOf() - geom.scrollTop - geom.clientHeight).toBe(388);
    expect(geom.contentHeight - geom.scrollTop - geom.clientHeight).toBe(260);
    expect(jumpBtnShown()).toBe(false);

    // 反面:再往上滚到真内容也确实剩一大截时,入口必须出现。
    await userScrollTo(700);
    expect(geom.contentHeight - geom.scrollTop - geom.clientHeight).toBe(360);
    expect(jumpBtnShown()).toBe(true);
  });

  it('一轮发出时这一帧长了一大截 —— 视图落到 anchor 位置之后浮标要跟着收回去', async () => {
    /*
     * 这一条钉的是「占位块改完尺寸之后要重算一次」。
     *
     * 发送的那一帧,React 的 effect 先跑:那时占位块还是 0、视图还停在旧内容的底部,
     * 于是「底下还有 400px」—— 浮标按几何点亮,**这是对的**。紧接着的那一帧里
     * 占位块定尺寸、视图滚到这条用户消息顶到头的位置,底下只剩 12px —— 浮标就该收回去。
     *
     * 占位块自己是**不被 ResizeObserver 观察的**(观察它会把它自己的尺寸变化喂回给
     * 跟随逻辑),所以这一拍没有观察者会替我们补算:那一帧里必须自己叫一次。
     */
    disableMutationObserver();
    geom = { contentHeight: 1200, clientHeight: 400, scrollTop: 0 };
    // 这一轮的用户消息 + 「进行中」头一次性撑出 400px。
    await sendAnchoredTurn({ contentAfterSend: 1600, userMsgTop: 1200 });

    expect(tailSpacerHeight()).toBe(0);
    expect(geom.scrollTop).toBe(1188);
    expect(geom.contentHeight - geom.scrollTop - geom.clientHeight).toBe(12);
    expect(jumpBtnShown()).toBe(false);
  });
});
