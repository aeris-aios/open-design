/**
 * chat 重构 · L0 领域层契约(纯函数,无 JSX / 无 DOM)
 *
 * 这个文件是并行开发的分界线:业务组件只依赖这里的类型,不依赖彼此。
 * 改动它 = 打断并行,必须先同步全体(规格 §6)。
 *
 * 权威规格:`specs/current/chat-panel-next.md`(决策 D1–D43)
 * 架构视角:`specs/current/chat-panel-dev-design.md`
 * 参考实现:`docs/design/chat-sim/sim.js`(评审载体,15 个场景在跑)
 */
import type { PersistedAgentEvent } from '@open-design/contracts';

export type { ToolKind } from './tool-kind';
export type { ArtifactKind, DiffStat } from './format';

import type { ToolKind } from './tool-kind';
import type { DiffStat } from './format';

/* ── 壳内的一行 ─────────────────────────────────────────────── */

/** 工具调用行。没有「执行中」这一档(D3):调用跑完才落行,生图行是唯一例外 */
export interface ToolRow {
  kind: 'tool';
  id: string;
  tool: ToolKind;
  /** 原始工具名;`tool === 'other'` 时界面直接显示它(T4 的默认做法) */
  name: string;
  /** 有 description 用人话,没有回落成命令本身(S8) */
  title: string;
  /** title 是原始命令 → 界面用等宽显示 */
  rawTitle: boolean;
  file: { path: string; label: string } | null;
  /** 搜索行的「搜了什么」与「N 处」(D23) */
  pattern: string | null;
  hits: number | null;
  /** 写 / 改文件的改动量;数不出来就是 null,那一行改显示耗时 */
  delta: DiffStat | null;
  /** 拿不到就是 null —— 不显示,不估算(§2.2b) */
  elapsedMs: number | null;
  failed: boolean;
  /** 失败原因;有原因走「· 原因」写法,没有只给「失败」按钮(S1 待设计确认) */
  failReason: string | null;
  /** 跑命令专用 */
  command: string | null;
  /** 终端输出。AMR 上被安全打码 → null(D19) */
  terminal: string | null;
}

/** thinking 落下的文字,以及 done 之前的过程叙述(D43)—— 两者同一种渲染 */
/**
 * 壳内的一段文字。
 *
 * `thinking` 标出「这段是模型在想,不是在答」—— 两者在屏幕上长得一样,但**归属不同**:
 * 整轮没发 done 时要把最后一段**回答**提到卡外(否则用户看不到答案),
 * 而 thinking 提出来就是把「想什么」当成「答什么」。踩过一次:整轮只有一句 thinking 时
 * 它被提到壳外、壳空掉后整张壳被丢,「思考中」那一格直接没了。
 */
export interface ShellText { kind: 'text'; text: string; thinking?: boolean }

/** 「执行计划 · N 步」 */
export interface ShellPlan { kind: 'plan'; steps: string[] }

/** 清单里的一条,在壳内按出现顺序占一行 */
export interface ShellTodo { kind: 'todo'; segment: TodoSegment }

/**
 * 生图行(组件 12)。**D3 的唯一例外**:调用还没回来也要落行 ——
 * 要出几张是从命令里数出来的(`media generate` 出现几次就是几张),
 * 所以在结果回来之前就知道该摆几个格子,「出一张落一张」才成立。
 *
 * 三种样子由这几个数决定(D34):
 *   还没出完(pending 或 done+failed < total)  球 + 「N/M」+ 一排大格
 *   全出完了、没失败                            收成一行 + 小缩略图条 + 耗时
 *   出完了但有失败                              仍是大格,失败的那格给「重试」,不收行
 *
 * 合并粒度是 **S19 未决项**:现在按「连续调用合并成一行」算(与模拟器一致),
 * 隔着别的工具调用就另起一行。
 */
export interface ImageRow {
  kind: 'image';
  id: string;
  /** 文案是固定的「生成配套插图」,由组件层翻译 —— 这一层不放人话 */
  total: number;
  done: number;
  failed: number;
  /** 出好的图,按完成顺序 */
  thumbs: string[];
  /** 还有调用没回来 */
  pending: boolean;
  elapsedMs: number | null;
}

export type ShellItem = ToolRow | ShellText | ShellPlan | ShellTodo | ImageRow;

/* ── 任务分段 ───────────────────────────────────────────────── */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'stopped';

export interface TodoSegment {
  /** content 即身份:跨轮召回、清单更新都靠它做交集判定(D17) */
  content: string;
  status: TodoStatus;
  /** 来自更早的轮次 —— 只控制划线,不参与 expandable(D25) */
  recalled: boolean;
  /** 被重新规划作废:沿用完成态 + 划线(D14 / D16) */
  abandoned: boolean;
  /**
   * 清单里一条 in_progress 都没有时,第一条未完成的被当作进行中(D36)。
   * codex 原生清单只有做完 / 没做完两档,没有这条规则它整轮的工具落不进任何 todo。
   */
  implicit: boolean;
  items: ShellItem[];
  elapsedMs: number | null;
}

/** 本轮有没有这条 todo 的内容 —— 展开与否的唯一判据(D25 / D35) */
export function isExpandable(segment: TodoSegment): boolean {
  return segment.items.length > 0;
}

/**
 * 划线 = 「**这一条不是本轮新开的活**」。三种情况彼此独立:
 *   ① 来自更早的轮次(`recalled`)
 *   ② 被重新规划作废(`abandoned`)
 *   ③ 本轮开出来但一次都没干过(已关闭且名下无内容,D35)
 *
 * ⚠️ 这里曾经写着「划线 = 这一条在本轮没有内容」—— **说反了**,它只描述了第 ③ 条。
 * 规格 `chat-panel-next.md:274-283` 那张表把三种召回态的划线列**全部**写成 ✓,
 * 包括「召回 · 本轮继续做的」和「召回 · 本轮继续做并做完的」。
 *
 * 也就是说 **「划线 + 可展开」是合法形态**:线说的是「这是旧账」,
 * 展开看到的是本轮新增的那部分。划线与可展开**解耦** ——
 * 能不能展开只看本轮有没有内容(D25),见 `isExpandable`。
 */
export function isStruck(segment: TodoSegment): boolean {
  if (segment.abandoned || segment.recalled) return true;
  const closed = segment.status !== 'in_progress' && segment.status !== 'pending';
  return closed && segment.items.length === 0;
}

/* ── 执行记录(壳)───────────────────────────────────────────── */

/**
 * 只有三态。手动停止**不是第四态**,是壳上的旗标:状态词仍是「进行中」、秒数停住,
 * 「已手动停止」是下方回合状态行的词(设计稿 2626/2643 行,W4)。
 */
export type ShellStatus = 'running' | 'done' | 'failed';

export interface ExecutionShell {
  kind: 'shell';
  id: string;
  status: ShellStatus;
  stopped: boolean;
  /**
   * 收到过 thinking 且还没开口 / 动手 —— 壳头从「进行中」换成「思考中」(W11)。
   * 必须由事件驱动:claude 的 thinking_delta 全是空串,靠文字判断永远等不到(S21)。
   */
  thinking: boolean;
  elapsedMs: number | null;
  items: ShellItem[];
  /** 这张壳知道的全部 todo(用于「执行计划 · N 步」与进度) */
  segments: TodoSegment[];
}

/** 壳【外】的普通文本 = 这一轮的结论(D43) */
export interface ProseBlock { kind: 'prose'; text: string }

export type TurnBlock = ExecutionShell | ProseBlock;

/* ── 入口 ───────────────────────────────────────────────────── */

export interface BuildTurnInput {
  events: PersistedAgentEvent[];
  /** run 终止态;终止即收起,不依赖 agent 发 done(D18) */
  runStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  /** 上一轮的清单,用于召回判定(D17) */
  previousTodos?: Pick<TodoSegment, 'content' | 'status'>[];
  /** 壳头「进行中 · 31s」的当前时刻;不传则运行中不显示秒数 */
  nowMs?: number;
}
