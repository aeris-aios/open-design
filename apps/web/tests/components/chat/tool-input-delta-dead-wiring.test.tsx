// @vitest-environment jsdom
/**
 * `tool_input_delta` 只是**心跳**,不是给界面看的东西。
 *
 * 这条帧是 claude 的 `input_json_delta` 原样转出来的(`claude-stream.ts:756`)——
 * 模型正在把下一个工具调用的入参一个字一个字吐出来。真机 run
 * `7ed15c2f-8ea0-4e55-b7e3-e463037dd868`(2026-08-27,claude,落盘 1357 行)里
 * 它是 1346 条 agent 帧中的 **699 条**,占了一半还多。
 *
 * ── 为什么删掉 `onToolInputDelta`,而不是拿它去画点什么 ──────────────────
 *
 * **1. 那 161 秒里没有任何工具在跑。** 这条 run 里 10 个超过 30 秒的空档,
 * 每一个都是 `tool_result → tool_use` —— 上一个工具**已经回来了**,模型在写下一个的入参。
 * 而这条 run 里最长的一次工具执行(`tool_use` → `tool_result`)是 **0.4 秒**,
 * 43 次调用无一例外。所谓「长工具调用没反馈」在这份证据上不成立:
 * 长的是**模型在生成**,不是工具在执行。161.6 秒那个窗口里的 97 条 `tool_input_delta`
 * 拼出来的是 `cat > …/login.html <<'ODEOF'` —— 一个写文件的 heredoc。
 *
 * **2. 设计稿把这件事明写死了。** 组件 9 / 10(工具调用-读 / 写)逐字:
 * 「**没有「执行中」这一档** —— 这一行是一条记录(动了哪个文件、耗时多少、成没成),
 * 调用还没回来时这几样都拿不到,摆出去只是一行光有名字的占位,几秒后当场变形;
 * 一次任务几十次调用就是几十次抖动。**"它在干活"由正在跑的那一步的转圈说,一处就够。**」
 * 落进规格就是 D3(`specs/current/chat-panel-next.md:413`)与 B8(`:754`)。
 * 「一处就够」这句是对本文件这个问题的**正面裁决**:在途反馈已经有了(壳头那颗球 +
 * 扫光的「进行中」+ 每秒在走的秒数),设计明说不要第二处。
 *
 * **3. 它也喂不动设计里唯一那格实时终端。** 组件 11(代码执行)确实有
 * 「执行中 · 终端实时追加」,可那要的是命令**跑起来之后的 stdout**,
 * 而 `tool_input_delta` 是命令**还没提交**时的入参 JSON —— 数据源根本对不上。
 *
 * 所以 `providers/daemon.ts` 里那个 `onToolInputDelta` 槽位是**纯死线**:
 * 全仓没有任何调用方接过它(`ProjectView` 没接,`s12-upstream-alive.test.tsx:210`
 * 特意也不接,好让路径与真机一致)。删掉的是槽位,**不是帧**。
 *
 * ── 帧本身是留着的,而且在干活 ────────────────────────────────────────
 *
 * 传输层在岔口**之前**就调了 `markUpstreamActivity(runId)`,S12 的静默计时全靠它。
 * 那 161.6 秒里 126 条帧有 124 条是 `tool_input_delta`;拿掉它,静默探测会当场谎报
 * (那正是 2026-08-27 修掉的那个 bug)。所以本文件第一条守的就是这个:
 * 槽位没了之后,帧照旧被记成心跳。
 *
 * 红测证据(源码没动之前跑的):
 *  · 「死槽位不许回来」当场红 —— `providers/daemon.ts` 里 `onToolInputDelta` 还在;
 *  · 其余三条绿 —— 它们守的是删除**不许弄坏**的东西,是回归钉子。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';

import { AssistantMessage } from '../../../src/components/AssistantMessage';
import { I18nProvider } from '../../../src/i18n';
import { reattachDaemonRun } from '../../../src/providers/daemon';
import { __resetUpstreamActivity, upstreamActivityAt } from '../../../src/runtime/chat/upstream-activity';
import type { AgentEvent, ChatMessage } from '../../../src/types';

const RUN_ID = '7ed15c2f-8ea0-4e55-b7e3-e463037dd868';
const T0 = 1_787_809_851_233;

/* ── 真机帧形状(逐字抄自落盘 events.jsonl)──────────────────────────── */

/**
 * +772.0s 那条:模型正在把 Bash 的 heredoc 一段段吐出来。
 * `delta` 是**半截 JSON**,单独拿出来根本 parse 不了 —— 这正是它不该被画出来的原因之一。
 */
const TOOL_INPUT_DELTA = {
  type: 'tool_input_delta',
  id: 'toolu_01R3Qxj2r9HqQ8mTgFsoY6RQ',
  name: 'Bash',
  delta: '{"command": "cat > /Users/elian/Documents/od-wt-chat-panel/.od/projects/cd6d',
} as const;

/** +11.4s 那条 —— 正面对照组,证明这套录音夹真的听得见回调 */
const TEXT_DELTA = {
  type: 'text_delta',
  delta: "\n\nI'll start by reading the skill's seed template and reference files.",
} as const;

/** SSE 帧:`id: N\nevent: E\ndata: {…}\n\n` */
function sseEvent(id: number, event: string, data: Record<string, unknown>): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/* ── 一条「还开着」的 SSE 连接 ───────────────────────────────────────── */

type ReadResult = { value: Uint8Array; done: false } | { value: undefined; done: true };

function makeLiveStream() {
  const queued: Uint8Array[] = [];
  let parked: ((r: ReadResult) => void) | null = null;
  return {
    push(text: string): void {
      const bytes = new TextEncoder().encode(text);
      if (parked) {
        const resolve = parked;
        parked = null;
        resolve({ value: bytes, done: false });
        return;
      }
      queued.push(bytes);
    },
    reader: {
      read: (): Promise<ReadResult> =>
        new Promise<ReadResult>((resolve) => {
          const next = queued.shift();
          if (next) {
            resolve({ value: next, done: false });
            return;
          }
          parked = resolve;
        }),
      cancel: () => Promise.resolve(),
    },
  };
}

function streamResponse(reader: { read: () => Promise<ReadResult>; cancel: () => Promise<void> }): Response {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

const renderTurn = (ui: ReactElement) => render(<I18nProvider initial="zh-CN">{ui}</I18nProvider>);

/** vitest 的 root 是 `apps/web`,源码按它取 */
const readSrc = (relative: string): string =>
  readFileSync(resolve(process.cwd(), 'src', relative), 'utf8');

/** 壳头那一行(含右边的耗时)—— 用户在这段时间里唯一看得见的东西 */
function shellSummaryText(container: HTMLElement): string {
  return container.querySelector('details > summary')?.textContent ?? '';
}

describe('tool_input_delta 是心跳,不是界面', () => {
  let live: ReturnType<typeof makeLiveStream>;
  let abort: AbortController;
  let frameId = 2000;
  let agentEvents: AgentEvent[];
  let deltas: string[];

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

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    __resetUpstreamActivity();
    live = makeLiveStream();
    abort = new AbortController();
    frameId = 2000;
    agentEvents = [];
    deltas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith(`/api/runs/${RUN_ID}/events`)) return streamResponse(live.reader);
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    /*
     * handlers 照 `ProjectView` 的接法给 —— **只有这四格**。
     * 这正是本文件要守的事实:没有第五格给 `tool_input_delta` 用。
     */
    void reattachDaemonRun({
      runId: RUN_ID,
      signal: abort.signal,
      handlers: {
        onDelta: (text: string) => { deltas.push(text); },
        onAgentEvent: (ev: AgentEvent) => { agentEvents.push(ev); },
        onDone: () => {},
        onError: () => {},
      },
    }).catch(() => {});
  });

  afterEach(() => {
    abort.abort();
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function frame(data: Record<string, unknown>, ms: number): Promise<void> {
    live.push(sseEvent((frameId += 1), 'agent', data));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function idle(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /**
   * 回归钉子:槽位删掉之后,这条帧**照旧**被记成「上游给过我们东西」。
   *
   * `markUpstreamActivity` 在岔口之前调,所以删岔口不该动它 —— 但「不该」得有人守。
   * 谁把它挪到岔口后面、或者让 `tool_input_delta` 提前 `continue` 掉,这条当场红。
   */
  it('帧照旧算心跳:每一条都把上游活动时刻往前推', async () => {
    await idle(0);
    expect(upstreamActivityAt(RUN_ID)).toBeNull();

    let previous = -1;
    for (let i = 0; i < 8; i += 1) {
      await frame({ ...TOOL_INPUT_DELTA }, 1_300);
      const at = upstreamActivityAt(RUN_ID);
      expect(at, '这条帧没被记成心跳 —— S12 的静默会当场谎报').not.toBeNull();
      expect(at ?? 0).toBeGreaterThan(previous);
      previous = at ?? 0;
    }
  });

  /**
   * 它不许变成 `AgentEvent`,也不许当正文喂给 `onDelta`。
   *
   * 末尾那段 `text_delta` 是**正面对照**:没有它,前面两个 `toHaveLength(0)`
   * 可以靠「录音夹根本没接上」来通过。
   *
   * **这条守的是行为,不是某一种写法。** 岔口删掉之后,拦住它的是
   * `translateAgentEvent` —— 那个函数没有 `tool_input_delta` 分支,返回 `null`,
   * 于是 `if (!translated) continue` 把它丢掉。改之前这里还有一句专门的
   * `if (… === 'tool_input_delta') continue`,消融实测**删掉它全绿**
   * (两套机制守同一条规则),所以那句已经撤了,只留这一条测试当守卫:
   * 谁哪天给 `translateAgentEvent` 加上 `tool_input_delta` 分支,这里当场红。
   */
  it('它不进事件流、不进正文;同一条连接上的 text_delta 照进(正面对照)', async () => {
    await idle(0);

    for (let i = 0; i < 5; i += 1) await frame({ ...TOOL_INPUT_DELTA }, 700);

    expect(agentEvents, 'tool_input_delta 变成了 AgentEvent —— D3/B8 不允许它落行').toHaveLength(0);
    expect(deltas, 'tool_input_delta 被当正文喂进去了 —— 半截 JSON 会漏到聊天里').toHaveLength(0);

    // 对照组:同一条连接、同一个录音夹,正文帧必须听得见
    await frame({ ...TEXT_DELTA }, 700);
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]).toMatchObject({ kind: 'text', text: TEXT_DELTA.delta });
    expect(deltas).toEqual([TEXT_DELTA.delta]);
  });

  /**
   * 死槽位不许回来。
   *
   * 这一条是本次改动的**红证据**:改之前 `providers/daemon.ts` 里
   * `onToolInputDelta` 还在(声明 + 调用两处),它当场红;删掉之后转绿。
   * 谁要把它接回来,得先在这里给出理由 —— 而不是悄悄多出一个没人接的回调。
   *
   * 守的是**槽位**不是帧:下面那条 `tool_input_delta` 的断言保证帧本身还在被认出来。
   */
  it('providers/daemon.ts 里不再有没人接的 onToolInputDelta 槽位', () => {
    const provider = readSrc('providers/daemon.ts');
    expect(provider).not.toContain('onToolInputDelta');
    // 帧本身没被一起删掉 —— 它还要当心跳
    expect(provider).toContain('tool_input_delta');
    expect(provider).toContain('markUpstreamActivity');
  });

  /**
   * 「模型写了 161 秒,界面一动不动」是不是真的?——不是。
   *
   * 真机那 161.6 秒里 `message.events` 一次都没变(帧全是不进数组的那几种),
   * 可壳头的秒数是挂在**墙上时间**上的(`useTickingNow` 每秒一跳),所以它一直在走。
   * 这条把「在途反馈已经有了」钉成断言 —— 它同时是「不加新界面」这个结论的依据。
   *
   * 成对的另一半在同一条用例里:那颗还没回来的 `tool_use` **不许**落行(D3 / B8),
   * 而已经跑完的那一对**必须**落行 —— 否则「没落行」可以靠「这个测试里根本不画行」通过。
   */
  it('161 秒只有 tool_input_delta:秒数一直在走,在途的工具一行都不落', async () => {
    const turn: ChatMessage = {
      id: 'm-1',
      role: 'assistant',
      content: '',
      runId: RUN_ID,
      runStatus: 'running',
      createdAt: T0,
      events: [
        // 已经跑完的那一对 —— 正面对照,它必须看得见
        { kind: 'tool_use', id: 'toolu_01prev', name: 'Bash', input: { command: 'ls docs' }, startedAt: T0 },
        { kind: 'tool_result', toolUseId: 'toolu_01prev', content: 'ok', isError: false, completedAt: T0 },
        // 还没回来的那一个 —— 就是那 161 秒里模型正在写入参的 Bash
        {
          kind: 'tool_use',
          id: TOOL_INPUT_DELTA.id,
          name: 'Bash',
          input: { command: 'cat > login.html <<ODEOF' },
          startedAt: T0,
        },
      ],
    } as ChatMessage;

    const { container } = renderTurn(<AssistantMessage message={turn} streaming projectId="p1" />);
    await idle(0);

    const first = shellSummaryText(container);
    expect(first).toContain('进行中');

    // 真机节奏:124 条铺满 161.6 秒
    for (let i = 0; i < 124; i += 1) await frame({ ...TOOL_INPUT_DELTA }, 1_300);

    const later = shellSummaryText(container);
    // 秒数在走 = 界面**有**反馈。壳头这一行整段时间都在变。
    expect(later).toContain('进行中');
    expect(later, '壳头秒数冻住了 —— 那才是真的「没有任何反应」').not.toBe(first);
    expect(later).toMatch(/\d+m \d+s/);

    // 跑完的那一对落了语义化的搜索行(对照组:这个 harness 确实会画工具行)
    expect(container.textContent ?? '').toContain('搜索 docs');
    // 在途那一个一行都不落(D3 / B8)
    expect(container.textContent ?? '').not.toContain('login.html');
    expect(screen.queryByText(/ODEOF/)).toBeNull();
  });
});
