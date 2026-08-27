/**
 * 执行记录 —— 一轮里装「过程」的那一块(设计稿组件 7 / 9 / 10 / 11)。
 *
 * 它是**通用容器,没有类型**(D11):有清单就按 todo 分段,没有就把动作平铺。
 * 内容从哪来、怎么分,全在 `runtime/chat/build-turn-blocks.ts` 里定了;
 * 这个组件只负责画,不做任何归属判断 —— 判断留在纯函数层才能脱离 React 测。
 *
 * 壳头四种样子(设计稿只有三态,手动停止是旗标不是第四态):
 *   进行中   球 + 会扫光的「进行中」+ 秒数,默认展开
 *   思考中   同上但换文案 + 三个点。**靠事件驱动**:claude 的 thinking 全是空串,
 *            靠文字判断永远等不到(S21 / W11)
 *   已完成   纯文本 + 总耗时,**默认收起**
 *   运行失败 红色状态词,默认收起 —— 原因和下一步交给下面的报错卡(B18)
 *   (手动停止:状态词仍是「进行中」、秒数停住,「已手动停止」是下方那行的词)
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useT } from '../../i18n';
import type { ExecutionShell as ShellData, ImageRow as ImageRowData, ShellItem, TodoSegment } from '../../runtime/chat/contract';
import { isExpandable, isStruck } from '../../runtime/chat/contract';
import { formatElapsed, formatShellElapsed } from '../../runtime/chat/format';
import { groupThinking, type GroupedShellItem } from '../../runtime/chat/group-thinking';
import { Foldable } from './primitives/Foldable';
import { ImageRow } from './primitives/ImageRow';
import { useThinkingStream } from './primitives/useThinkingStream';
import { Orb } from './primitives/Orb';
import { SayText } from './primitives/SayText';
import { StatusMark } from './primitives/StatusMark';
import { ToolRow } from './primitives/ToolRow';
import styles from './primitives/record.module.css';

/**
 * 多久算「等太久」。60 秒来自 `error-ux-design.md:33`(10 分钟 / Cloud 30 分钟才报超时,
 * 这一句只是等待期间的回音,不改变任何超时判定)。
 *
 * **2026-08-27 起壳头不再读它** —— S12 的那句文案撤回了(裁决与理由见下面 `head` 里
 * 的注释)。门槛本身留着:整条探测逻辑一行没删,产品打算换一种展现形式把它请回来,
 * 到时候不必重新考据这个 60 秒是哪来的。
 *
 * 导出是**故意**的:保留测试直接引用它,谁把它删了
 * `tests/components/chat/s12-copy-revert.test.tsx` 会当场红。
 */
export const SLOW_UPSTREAM_AFTER_MS = 60_000;

export interface ExecutionShellProps {
  shell: ShellData;
  onOpenFile?: (path: string) => void;
  /** 生图失败格的「重试」—— 没有回调时那一格只画不点(稿子也允许只画) */
  onRetryImage?: (row: ImageRowData, index: number) => void;
}

export function ExecutionShell({ shell, onOpenFile, onRetryImage }: ExecutionShellProps): ReactElement {
  const t = useT();
  const running = shell.status === 'running' && !shell.stopped;
  const elapsed = formatShellElapsed(shell.elapsedMs);
  /**
   * 「思考中」时正文走流式形态:限高 + 自己一行行往上走(D46)。
   * 一有工具行或结论落下来,壳头就回到「进行中」,这里也跟着变回普通文本流 ——
   * 所以判据挂在 `shell.thinking` 上,不另设开关。
   */
  const streaming = running && shell.thinking;
  const bodyRef = useRef<HTMLDivElement>(null);
  useThinkingStream(bodyRef, streaming);

  /**
   * 折叠态跟着 **run 的生命周期**走(D18):跑着的时候摊开,结束就收起来。
   *
   * 不能只靠 `Foldable` 的 `defaultOpen` —— 那是初始值,run 结束时不会再看它一眼,
   * 壳会一直摊在那儿。也不能每次都把它写回去:用户中途手点收起/展开之后就该听用户的
   * (同一条约束在 `Foldable` 的注释里,老的执行记录卡也是这么做的)。
   */
  const lifecycleOpen = running || shell.stopped;
  const [open, setOpen] = useState(lifecycleOpen);
  const [userToggled, setUserToggled] = useState(false);
  useEffect(() => {
    if (!userToggled) setOpen(lifecycleOpen);
  }, [lifecycleOpen, userToggled]);
  const onToggle = useCallback((next: boolean) => {
    setUserToggled(true);
    setOpen(next);
  }, []);

  const head = (() => {
    if (shell.status === 'failed') {
      return <span className={styles.stFail}>{t('chat.record.failedTurn')}</span>;
    }
    if (shell.stopped) {
      // 停住:不再动,所以不挂扫光也不挂球 —— 秒数就停在那儿(场景稿注释)
      return <span>{t('chat.record.running')}</span>;
    }
    if (running) {
      /**
       * 壳头就是普通的「进行中 / 思考中」。
       *
       * ── S12 文案撤回(2026-08-27,只撤展现,不撤探测)────────────────────
       *
       * 这里曾经在静默超过 `SLOW_UPSTREAM_AFTER_MS` 时把壳头换成
       * 「上游响应慢，已等 N 秒」(S12「等太久没动静」,P1,18,891 次/月、6,372 台,
       * 门槛与文案逐字来自 `docs/design/run-errors/error-ux-design.md:33`)。
       * 产品裁决把它撤了,原话:「这个文案先让 subagent 改回 进行中 吧,跟产品讨论了下,
       * 但背后的探测逻辑先保留,后续可能会用到,只不过用别的展现形式」。
       * 触发裁决的画面是壳头那一行「上游响应慢，已等 411 秒  13m 7s」—— 一句话占满壳头,
       * 右边的总耗时还在说同一段时间,读起来像故障,而它只是在等。
       *
       * **撤的只有这一行取值。** 探测整条链一行没删,而且还在跑:
       *   `providers/daemon.ts` 的 `markUpstreamActivity`(每收到一条真运行帧)
       *     → `runtime/chat/upstream-activity.ts`(按 run 记的到达时刻表)
       *     → `AssistantMessage` 的 `useTickingNow` 每秒喂给 `buildTurnBlocks`
       *     → `build-turn-blocks.ts` 的 `shellQuiet` 算出静默
       *     → `contract.ts` 的 `quietMs` 挂在每张运行中的壳上。
       * 这里只是**暂时不读** `shell.quietMs`;它照旧被算出来、照旧送到这个组件手上,
       * 换个展现形式时接上就行。
       *
       * ⚠️ 想「顺手把死代码清干净」的下一位:这不是死代码。
       * 钉子在 `tests/components/chat/s12-copy-revert.test.tsx` 的「探测保留」一节 ——
       * 删掉 `shellQuiet` / `quietMs` / `SLOW_UPSTREAM_AFTER_MS` 中任何一个都会当场红。
       * 传输层那一截另有 `tests/components/chat/s12-upstream-alive.test.tsx` 钉着。
       */
      const label = shell.thinking ? t('chat.record.thinking') : t('chat.record.running');
      return (
        <>
          {/* 不给标签:紧跟着的就是「进行中 / 思考中」那行字,读屏念一遍就够 */}
          <Orb state={shell.thinking ? 'composing' : 'connecting'} box={24} className={styles.orb} />
          <span className={`${styles.shimmer} ${styles.head}`}>
            {label}
            {shell.thinking ? (
              <span className={styles.dots} aria-hidden><i /><i /><i /></span>
            ) : null}
          </span>
        </>
      );
    }
    return <span>{t('chat.record.done')}</span>;
  })();

  /**
   * 跑完之后把连续的推理收成「思考过程」那一格(用户裁决,见 `groupThinking` 的注释)。
   * 还在思考时原样返回 —— 那一段归上面那个 96px 的流式窗管。
   */
  const items = groupThinking(shell.items, Boolean(streaming));
  /**
   * 这张壳有没有清单 —— 夹心正文对不对齐那条竖线全看它(用户裁决 2026-08-27)。
   * 有清单时顶层正文是清单上面的开场白,不在链上,贴左;没清单时正文和工具行交替
   * 往下走,夹在中间那几段要落回 22px 并接线。判据只挂在 CSS 上,见
   * `record.module.css` 的 `:not(.hasTodo)`。
   */
  const hasTodo = shell.items.some((item) => item.kind === 'todo' || item.kind === 'plan');

  return (
    <Foldable
      summary={head}
      variant="flat"
      elapsed={elapsed ?? undefined}
      open={open}
      onToggle={onToggle}
      expandable={items.length > 0}
      stream={streaming}
      bodyRef={bodyRef}
      className={hasTodo ? styles.hasTodo : undefined}
    >
      {items.length ? items.map((item, i) => renderItem(item, i, { t, onOpenFile, onRetryImage })) : null}
    </Foldable>
  );
}

interface RenderCtx {
  t: ReturnType<typeof useT>;
  onOpenFile?: (path: string) => void;
  onRetryImage?: (row: ImageRowData, index: number) => void;
}

function renderItem(item: GroupedShellItem, index: number, ctx: RenderCtx): ReactElement | null {
  if (item.kind === 'thoughts') {
    return <ThoughtsRow key={`thoughts-${index}`} texts={item.texts} t={ctx.t} />;
  }
  if (item.kind === 'tool') {
    return <ToolRow key={`tool-${item.id}-${index}`} row={item} onOpenFile={ctx.onOpenFile} />;
  }
  if (item.kind === 'text') {
    return <SayText key={`text-${index}`} text={item.text} />;
  }
  if (item.kind === 'image') {
    return <ImageRow key={`img-${item.id}-${index}`} row={item} onRetry={ctx.onRetryImage} />;
  }
  if (item.kind === 'plan') {
    return <PlanRow key={`plan-${index}`} steps={item.steps} t={ctx.t} />;
  }
  return <TodoRow key={`todo-${item.segment.content}-${index}`} segment={item.segment} ctx={ctx} />;
}

/**
 * 「思考过程」:跑完之后收起来的那几段推理,点开才读得到细节。
 *
 * 默认收起 —— 这一格存在的**全部理由**就是别让推理在思考结束的瞬间原地铺开。
 * 用 `Foldable` 的默认(非 flat)形态,和普通工具行同一副壳,与用户原话
 * 「变成普通工具调用的状态」一致。不挂耗时:推理的时长在壳头的总耗时里,
 * 这一格再报一次等于把同一段时间说两遍。
 */
function ThoughtsRow({ texts, t }: { texts: string[]; t: RenderCtx['t'] }): ReactElement {
  return (
    <Foldable summary={<><StatusMark status="ok" /><span>{t('chat.record.thoughts')}</span></>}>
      {texts.map((text, i) => <SayText key={i} text={text} />)}
    </Foldable>
  );
}

/** 「执行计划 · N 步」:清单刚到时的全貌。每一步只有序号,还没跑,没有「哪类调用」可标 */
function PlanRow({ steps, t }: { steps: string[]; t: RenderCtx['t'] }): ReactElement {
  return (
    <Foldable summary={<><StatusMark status="ok" /><span>{t('chat.record.plan', { count: steps.length })}</span></>}>
      {steps.map((step, i) => (
        <div className={styles.tool} key={`${step}-${i}`}>
          <StatusMark status="pending" index={i + 1} />
          <span className={styles.name}>{step}</span>
        </div>
      ))}
    </Foldable>
  );
}

/**
 * 一条 todo 的抽屉。
 *
 * **两件事解耦**:
 *  · 能不能展开 —— 只看**本轮有没有内容**(D25)
 *  · 划不划线 —— 只看**是不是本轮新开的活**(见 `isStruck` 的注释)
 *
 * 所以「**划线 + 可展开**」是合法形态:线说的是「这是旧账」,
 * 展开看到的是本轮新增的那部分。
 * (这里曾经写着「划线表示这一条本轮没有内容」,**说反了**,只描述了 D35 那一条。)
 */
function TodoRow({ segment, ctx }: { segment: TodoSegment; ctx: RenderCtx }): ReactElement {
  const expandable = isExpandable(segment);
  const struck = isStruck(segment);
  const elapsed = segment.status === 'in_progress' ? null : formatElapsed(segment.elapsedMs);

  return (
    <Foldable
      summary={
        <>
          <StatusMark status={markFor(segment)} />
          <span className={struck ? styles.struck : undefined}>{segment.content}</span>
        </>
      }
      elapsed={elapsed ?? undefined}
      expandable={expandable}
      defaultOpen={segment.status === 'in_progress'}
    >
      {expandable ? segment.items.map((item, i) => renderItem(item, i, ctx)) : null}
    </Foldable>
  );
}

function markFor(segment: TodoSegment): 'ok' | 'running' | 'pending' | 'skip' {
  if (segment.status === 'in_progress') return 'running';
  if (segment.status === 'stopped') return 'pending';   // 中断时正在跑的:中性灰,红要留给真的错误
  if (segment.abandoned) return 'skip';                 // D16:作废沿用完成态
  if (segment.status === 'completed') return 'ok';
  return 'pending';
}
