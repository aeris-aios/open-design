/**
 * 一轮助手消息的事件流 → 界面上的块序列。
 *
 * 这是本次重构的核心。规则密集,每一条都对应一个拍过板的决策,改之前先读:
 *
 *  · D10  执行记录**永远出现**,不等 agent 任何信号;还没内容时是空态
 *  · D11  壳是通用容器,没有类型:有清单就分段,没有就平铺
 *  · D29  ① 第一张壳钉在本轮正文上方  ② 发清单 → 多出第二张,出现在当前位置
 *         ③ 清单期间的输出(工具 / thinking / 正文)收进当前进行中的 todo
 *         ④ todo 全关后工具接在后面,正文回壳外  ⑤ 第一张还空着就来清单 → 它本身变清单卡
 *  · D42  位置维持 ①(评审提过「先正文后工具」,拍板不改位置,靠 D43 解决)
 *  · D43  `done` 之前的正文是**过程叙述**,收进壳里;之后的是**结论**,留在壳外。
 *         done 走正文里的自闭合标记(通道 ②),兜底:清单全关算 done / run 结束提最后一段
 *  · D36  清单里没有 in_progress 时,第一条未完成的当作进行中(codex 全靠这条)
 *  · D26  同一份清单的更新原地改,不新开壳
 *  · D14  不重叠的新清单 = 重新规划:旧的全划线转完成态,仍不新开壳
 *  · D24  每轮只装本轮内容;D25 能不能展开只看本轮有没有内容
 *  · D3   工具调用没有「执行中」档,跑完才落行
 *
 * 一条贯穿始终的约束:**流式下位置不能回溯挪动**。一段话先显示在壳外、后来又挪进壳里,
 * 用户会看到文字跳一下 —— 候选 E 就是因为这个代价被否的。所以所有落点都要「一次到位」,
 * 只有 run 结束那一刻允许有一次重排(liftConclusion)。
 */
import type { PersistedAgentEvent } from '@open-design/contracts';
import type {
  BuildTurnInput,
  ExecutionShell,
  ProseBlock,
  ShellItem,
  ShellText,
  TodoSegment,
  ToolRow,
  ImageRow,
  TurnBlock,
} from './contract';
import { computeSkipRanges, rangeContains } from '../../artifacts/markdown-context';
import { UNKNOWN_ELAPSED_BELOW_MS, diffStat } from './format';
import {
  commandFile,
  commandOf,
  fileOf,
  isCommandTool,
  isRawCommandTitle,
  searchPattern,
  toolKind,
  toolTitle,
} from './tool-kind';

/**
 * done 标记(草案字样,产品定稿前只认这一个)。自闭合而不是把结论包起来:
 * 包起来要等闭合标签到了才能显示,结论会整段憋住,不符合流式。
 */
const DONE_RE = /<done\s*\/?>/i;
/** 意图澄清表单和产物块算**隐式 done** —— 它们是交给用户看的东西,不是过程叙述 */
const IMPLICIT_DONE_RE = /<(?:question-form|artifact)\b/i;
const OPEN_TAGS = ['<done', '<question-form', '<artifact'];

/** 各家 todo 工具在 daemon 归一后都叫 TodoWrite;这里仍放宽匹配,兼容 MCP 注入的 `mcp__*__todo_write` */
const TODO_NAME_RE = /^(TodoWrite|todowrite|todo_write|update_plan)$|(^|__)todo_?write$/i;
const ABANDON_NAME_RE = /(^|__)todo_abandon$/i;

interface RawTodo { content: string; status: string }

function readTodoList(input: unknown): RawTodo[] {
  const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const raw = rec.todos ?? rec.plan ?? rec.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const r = t && typeof t === 'object' ? (t as Record<string, unknown>) : {};
      const content = String(r.content ?? r.step ?? r.text ?? '').trim();
      const status = String(r.status ?? (r.completed === true ? 'completed' : 'pending'));
      return { content, status };
    })
    .filter((t) => t.content);
}

function normalizeStatus(status: string): TodoSegment['status'] {
  if (status === 'in_progress' || status === 'completed' || status === 'stopped') return status;
  if (status === 'complete' || status === 'done') return 'completed';
  if (status === 'doing' || status === 'active') return 'in_progress';
  return 'pending';
}

/** 结尾这几个字符会不会是某个标记的开头?是就先扣住不渲染,免得半截 `<do` 闪一下 */
function pendingTagTail(text: string): number {
  for (let k = Math.min(14, text.length); k > 0; k -= 1) {
    const tail = text.slice(text.length - k).toLowerCase();
    if (tail[0] !== '<') continue;
    if (OPEN_TAGS.some((tag) => tag.startsWith(tail))) return k;
  }
  return 0;
}

/**
 * 标记在**代码里**时不算信号。
 *
 * 围栏代码块和行内代码是 agent 展示标记本身的地方 —— 「这个标记写作 `<done/>`」、
 * 「例子:```html <artifact …> ```」。把它们当信号,后面的正文会被整段甩到壳外,
 * 而正文本来该跟着当前那条 todo 走。
 *
 * 用的是产物剥离器一直在用的那套跳过区间(`artifacts/markdown-context`),
 * 不另写一份 —— 两处要跳过的东西是同一批,规则分家迟早对不上。
 */
function findMarkerOutsideCode(re: RegExp, text: string): RegExpExecArray | null {
  const { ranges } = computeSkipRanges(text);
  const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = scan.exec(text)) !== null) {
    if (!rangeContains(ranges, m.index)) return m;
    if (m.index === scan.lastIndex) scan.lastIndex += 1;
  }
  return null;
}

function findDoneCut(text: string): { index: number; length: number } | null {
  const explicit = findMarkerOutsideCode(DONE_RE, text);
  const implicit = findMarkerOutsideCode(IMPLICIT_DONE_RE, text);
  if (explicit && (!implicit || explicit.index <= implicit.index)) {
    return { index: explicit.index, length: explicit[0].length };
  }
  // 隐式:标签本身要留给后面的正文,由消息层去剥成卡片,所以长度记 0
  if (implicit) return { index: implicit.index, length: 0 };
  return null;
}

/**
 * 壳 id 只在**本轮内**递增(`shell-1`、`shell-2`)。
 *
 * 用模块级的全局计数器会让同一张壳每次重算都换一个 id —— 消费方拿它当 React key,
 * 换 id 就是重新挂载:用户手点开的折叠态每一帧被拨回去(`Foldable` 的注释里记着这条),
 * 流式期间正好每个 delta 都重算一次。
 */
function makeShell(seq: number): ExecutionShell {
  return {
    kind: 'shell',
    id: `shell-${seq}`,
    status: 'running',
    stopped: false,
    thinking: false,
    elapsedMs: null,
    items: [],
    segments: [],
  };
}

function makeSegment(todo: RawTodo, recalled: boolean): TodoSegment {
  return {
    content: todo.content,
    status: normalizeStatus(todo.status),
    recalled,
    abandoned: false,
    implicit: false,
    items: [],
    elapsedMs: null,
  };
}

export function buildTurnBlocks(input: BuildTurnInput): TurnBlock[] {
  const events = input.events ?? [];
  const blocks: TurnBlock[] = [];
  const previous = new Set((input.previousTodos ?? []).map((t) => t.content));

  let shellSeq = 0;
  const nextShell = (): ExecutionShell => {
    shellSeq += 1;
    return makeShell(shellSeq);
  };

  let top: ExecutionShell | null = null;
  let todoCard: ExecutionShell | null = null;
  let current: TodoSegment | null = null;
  let started = false;
  /** 壳内正在累积的那段文字(thinking 或过程叙述)—— 连续的 delta 合并成一段 */
  let openText: ShellText | null = null;
  /** 壳外正在累积的结论 */
  let openProse: ProseBlock | null = null;
  let doneSeen = false;
  let markerBuf = '';
  let firstStartedAt: number | null = null;
  let lastEndedAt: number | null = null;
  /**
   * **每张壳自己的**起止时刻。
   *
   * 原来耗时是按**轮次**算的:一个 `running` 标志喂给所有壳,于是一轮里两张壳
   * (前半截散活 + 后半截清单)会显示**同一个数并同步递增** —— 上面明明写着
   * 「已完成」,秒数还在往前跑。跑完的壳必须定死在它自己结束的那一刻。
   */
  const shellSpan = new Map<ExecutionShell, { from: number; to: number }>();
  /**
   * **每条 todo 自己的**起止时刻 —— 稿子每条抽屉右侧都挂着它自己的耗时(`18.2s`)。
   * `TodoRow` 早就写了 `formatElapsed(segment.elapsedMs)` 的分支,但这个字段
   * 从来没被算出来过,那一档永远是 null(用户 2026-08-26 真机指认)。
   */
  const segSpan = new Map<TodoSegment, { from: number; to: number }>();
  const widen = <K,>(map: Map<K, { from: number; to: number }>, key: K | null, at: number): void => {
    if (!key) return;
    const span = map.get(key);
    if (!span) { map.set(key, { from: at, to: at }); return; }
    if (at < span.from) span.from = at;
    if (at > span.to) span.to = at;
  };
  const stampShell = (at?: number): void => {
    if (at == null) return;
    widen(shellSpan, activeShell(), at);
    // 事件发生时哪条 todo 在跑,这段时间就算在它头上
    widen(segSpan, current, at);
  };

  const results = new Map<string, Extract<PersistedAgentEvent, { kind: 'tool_result' }>>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);

  const activeShell = (): ExecutionShell | null => todoCard ?? top;
  /** 内容落点:进行中的 todo → 它的 items;有清单卡但 todo 都关了 → 卡片层;否则 → 第一张壳 */
  const sink = (): ShellItem[] => {
    if (current) return current.items;
    const shell = activeShell();
    return shell ? shell.items : [];
  };

  const stamp = (at?: number): void => {
    if (at == null) return;
    if (firstStartedAt == null || at < firstStartedAt) firstStartedAt = at;
    if (lastEndedAt == null || at > lastEndedAt) lastEndedAt = at;
    stampShell(at);
  };

  /** D10:收到本轮第一条事件就开壳,空态先出来,不等任何 agent 信号 */
  const ensureShell = (): void => {
    if (started) return;
    started = true;
    top = nextShell();
    blocks.push(top);
  };

  const pushInside = (text: string): void => {
    const arr = sink();
    const last = arr[arr.length - 1];
    if (openText && last === openText) {
      openText.text += text;
      return;
    }
    if (!text.trim()) return;
    openText = { kind: 'text', text: text.replace(/^\s+/, '') };
    arr.push(openText);
  };

  const pushProse = (text: string): void => {
    if (openProse && blocks[blocks.length - 1] === openProse) {
      openProse.text += text;
      return;
    }
    if (!text.trim()) return;
    openProse = { kind: 'prose', text: text.replace(/^\s+/, '') };
    blocks.push(openProse);
  };
  /**
   * done 之前的**正文**往哪落 —— 2026-08-26 产品裁决:
   *
   *   · **还没有 todo** → 落在**壳外**。这一阶段壳里只装工具调用和 thinking;
   *     一段还没被任何 todo 认领的叙述,收进壳里就等于把它藏进一个默认收起的抽屉。
   *   · **已经有 todo** → 落进**当前正在进行的那条 todo**(和工具调用同一个 sink)。
   *
   * 这条收紧了 D43(原来一律进壳)。thinking 不受影响,它任何阶段都在壳里 ——
   * thinking 本来就是「过程」,而正文是说给人听的。
   */
  const routeInside = (text: string): void => {
    if (!todoCard) {
      pushProse(text);
      return;
    }
    const arr = sink();
    if (!text.trim() && !(openText && arr[arr.length - 1] === openText)) return;
    const merging = openText && arr[arr.length - 1] === openText;
    pushInside(merging ? text : text.replace(/^\s+/, ''));
  };


  for (const event of events) {
    if (event.kind === 'tool_result' || event.kind === 'raw' || event.kind === 'diagnostic') continue;
    if (event.kind === 'conversation_title' || event.kind === 'plugin_candidate') continue;
    if (event.kind === 'usage') continue;

    ensureShell();

    if (event.kind === 'status') {
      // status 只用来开壳(D10)与在轮末决定 run 状态,自身不落行
      continue;
    }

    if (event.kind === 'live_artifact' || event.kind === 'live_artifact_refresh') {
      // 产物卡由消息层渲染,不属于执行记录
      continue;
    }

    if (event.kind === 'thinking') {
      /**
       * claude 经 daemon 送出的 thinking 全是空串(真实录制 1167/1167):
       * 只有「在思考」这个事实,没有文字。空串不成段,但要让壳知道模型在想 ——
       * 否则设计稿的「思考中」头永远出不来(S21 / W11)。
       */
      const shell = activeShell();
      if (shell) shell.thinking = true;
      const text = event.text ?? '';
      const arr = sink();
      if (!text.trim() && !(openText && arr[arr.length - 1] === openText)) continue;
      pushInside(text);
      continue;
    }

    if (event.kind === 'text') {
      const shell = activeShell();
      if (shell) shell.thinking = false; // 开口说话就不再是「思考中」
      let text = event.text ?? '';

      if (!doneSeen) {
        text = markerBuf + text;
        markerBuf = '';
        const cut = findDoneCut(text);
        if (cut) {
          const head = text.slice(0, cut.index);
          if (head) routeInside(head);
          doneSeen = true;
          openText = null;
          openProse = null;
          /*
           * done 一到就**结束当前 todo 的收集**。
           *
           * 不这么做的话,agent 只要没关掉最后一条 todo,结论就会被塞进那条 todo 里 ——
           * 折叠起来之后**用户看不到这一轮的回答**。真实运行时照出来的就是这个
           * (D43 与 D29 ③ 在「done 来时清单还开着」这一点上打架,D43 是后定的,以它为准)。
           *
           * 下面那条 `if (current)` 管的是**另一种情况**:done 之后又来一份新清单
           * (重新规划),那时 `current` 会被重新设上,正文该回到 todo 里 —— 那条仍然成立。
           */
          current = null;
          text = text.slice(cut.index + cut.length);
          if (!text) continue;
        } else {
          const hold = pendingTagTail(text);
          if (hold) {
            markerBuf = text.slice(text.length - hold);
            text = text.slice(0, text.length - hold);
          }
          if (text) routeInside(text);
          continue;
        }
      }

      if (current) {
        // done 之后又回到 todo 里(重新规划):正文仍收进那条 todo
        routeInside(text);
        continue;
      }
      pushProse(text);
      continue;
    }

    if (event.kind !== 'tool_use') continue;

    const shell = activeShell();
    if (shell) shell.thinking = false; // 动手了就不再是「思考中」
    stamp(event.startedAt);

    if (ABANDON_NAME_RE.test(event.name)) {
      /** D14 / D15 / D16:作废理由按壳内纯文本渲染,旧清单全划线转完成态,不新开壳 */
      const target = activeShell();
      if (target) {
        for (const seg of target.segments) {
          if (seg.status === 'in_progress') seg.status = 'completed';
          seg.abandoned = true;
        }
        const rec = event.input && typeof event.input === 'object'
          ? (event.input as Record<string, unknown>) : {};
        const reason = typeof rec.reason === 'string' ? rec.reason : '';
        if (reason) {
          openText = null;
          target.items.push({ kind: 'text', text: reason });
        }
      }
      current = null;
      continue;
    }

    if (TODO_NAME_RE.test(event.name)) {
      const list = readTodoList(event.input);
      if (!list.length) continue;
      applyTodoList(list);
      openText = null;
      continue;
    }

    const shot = readImageCall(event, results.get(event.id));
    if (shot) {
      ensureShell();
      stamp(event.startedAt);
      const done = results.get(event.id)?.completedAt;
      stamp(done);
      const arr = sink();
      const last = arr[arr.length - 1];
      // S19:连续的生图调用合并成一行 —— 一次生图动作出 N 张,这是组件 12 的前提。
      // 中间隔了别的工具调用就另起一行(隔开的两组是两件事)。
      if (last && last.kind === 'image') {
        last.total += shot.total;
        last.done += shot.done;
        last.failed += shot.failed;
        last.thumbs.push(...shot.thumbs);
        last.pending = last.pending || shot.pending;
        if (shot.elapsedMs != null) last.elapsedMs = (last.elapsedMs ?? 0) + shot.elapsedMs;
      } else {
        arr.push(shot);
      }
      openText = null;
      continue;
    }

    const row = buildToolRow(event, results.get(event.id));
    if (!row) continue;
    if (row.elapsedMs != null && event.startedAt != null) stamp(event.startedAt + row.elapsedMs);
    openText = null;
    sink().push(row);
  }

  finishTurn();
  return blocks;

  /* ── 清单 ─────────────────────────────────────────────────── */

  function applyTodoList(list: RawTodo[]): void {
    if (!todoCard) {
      /*
       * 第二张壳只在**清单之前说过话**时才出现(T34,用户 2026-08-25 裁决:
       * 「如果创建 todo 时,上面有文案,那就在文案下面新创建一个卡片,里面包裹那些 todo」)。
       *
       * 反过来说:光干活没说话就不分张 —— agent 先跑三十几次工具、后补清单是常事,
       * 按旧判据(「第一张壳空着才复用」)那种轮次会分出两张壳,两张都写「已完成」、
       * 耗时还都是同一个数,读起来像同一件事说了两遍。
       *
       * 判据 = **第一张壳里有没有东西**(2026-08-26 裁决之后)。
       *
       * 原来问的是「壳里有没有 text」,因为那时正文也落在壳里(D43)。
       * 裁决把「还没有 todo 时的正文」挪到了壳外,壳里只剩工具调用和 thinking ——
       * 再问 text 就永远是「没说话」,于是一张壳装两段人生:
       * 上半截是没有清单的散活,下半截是清单。用户看到的两张卡就该是这么来的。
       *
       * 空壳仍然复用:agent 一上来就发清单是常事,分张只会多出一张空卡。
       */
      const firstShellUsed = !!top && top.items.length > 0;
      if (top && !firstShellUsed) {
        todoCard = top;
      } else {
        if (top && top.status === 'running') top.status = 'done';
        todoCard = nextShell();
        blocks.push(todoCard);
      }
      addPlan(list);
      pickCurrent();
      return;
    }

    const overlap = todoCard.segments.some((a) => list.some((b) => b.content === a.content));
    if (!overlap) {
      // D14:内容完全不重叠 = 重新规划。旧的全部划线转完成态,仍然不新开壳
      for (const seg of todoCard.segments) {
        if (seg.status === 'in_progress') seg.status = 'completed';
        seg.abandoned = true;
      }
      todoCard.segments = [];
      addPlan(list);
      pickCurrent();
      return;
    }

    // D26:同一份清单的状态推进 —— 原地更新,不新开卡
    for (const todo of list) {
      const seg = todoCard.segments.find((a) => a.content === todo.content);
      const incoming = normalizeStatus(todo.status);
      if (!seg) {
        const created = makeSegment(todo, previous.has(todo.content));
        todoCard.segments.push(created);
        /*
         * **还没开始的那几条也要出行**。
         *
         * 原来这里写着「`status !== 'pending'` 才推成行」,于是清单说「5 步」、
         * 壳里却只看得见正在跑的那 1 条 —— 用户真机指认「下面不是有 5 步吗?
         * 怎么后四步没显示?」。没开始的那几条有它自己的样子(虚线圈 + 不可展开),
         * 「说好几步」和「看得见几步」必须是同一个数。
         */
        todoCard.items.push({ kind: 'todo', segment: created });
        continue;
      }
      // 被隐式点亮的那条,后续清单里仍写 pending 也不退回去(D36)
      const next = incoming === 'pending' && seg.implicit && seg.status === 'in_progress'
        ? 'in_progress'
        : incoming;
      if (seg.status === 'pending' && next !== 'pending') {
        seg.status = next;
        todoCard.items.push({ kind: 'todo', segment: seg });
      } else {
        seg.status = next;
      }
    }
    const plan = todoCard.items.find((x): x is Extract<ShellItem, { kind: 'plan' }> => x.kind === 'plan');
    if (plan) plan.steps = list.map((t) => t.content);
    pickCurrent();
  }

  function addPlan(list: RawTodo[]): void {
    if (!todoCard) return;
    todoCard.items.push({ kind: 'plan', steps: list.map((t) => t.content) });
    for (const todo of list) {
      const seg = makeSegment(todo, previous.has(todo.content));
      todoCard.segments.push(seg);
      // 还没开始的那几条也出行 —— 「说好几步」和「看得见几步」必须是同一个数(见下方同类注释)
      todoCard.items.push({ kind: 'todo', segment: seg });
    }
  }

  function pickCurrent(): void {
    if (!todoCard) return;
    current = todoCard.segments.find((s) => s.status === 'in_progress') ?? null;
    if (!current) {
      /**
       * D36 隐式进行中:清单里一条 in_progress 都没有 → 第一条未完成的就是当前。
       * codex 原生清单只有做完 / 没做完两档(daemon 把没做完映射成 pending),
       * 没有这条规则,codex 整轮的工具都落不进任何 todo。
       */
      const first = todoCard.segments.find((s) => s.status === 'pending' && !s.abandoned);
      if (first) {
        first.status = 'in_progress';
        first.implicit = true;
        todoCard.items.push({ kind: 'todo', segment: first });
        current = first;
      }
    }
    if (!current && todoCard.segments.length) {
      // 兜底(a):清单全部关掉 = 这一轮的活干完了,后面说的就是结论(D43 ④)
      doneSeen = true;
      openText = null;
    }
  }

  /* ── 收尾 ─────────────────────────────────────────────────── */

  /**
   * 兜底(c):整轮没发过 done —— 在 run 结束、壳收起的**那一刻**把最后一段过程叙述
   * 提出来当结论。只动这一次,不在流式中途挪动(中途挪动正是候选 E 的代价)。
   */
  function liftConclusion(): void {
    if (doneSeen) return;
    const shell = todoCard ?? top;
    if (!shell) return;
    const arr = current ? current.items : shell.items;
    const last = arr[arr.length - 1];
    if (!last || last.kind !== 'text' || !last.text.trim()) return;
    arr.pop();
    blocks.push({ kind: 'prose', text: last.text });
  }

  function finishTurn(): void {
    const status = input.runStatus ?? 'running';
    const running = status === 'running' || status === 'queued';

    /* 每条 todo 落自己的耗时(稿子每条抽屉右侧那个 `18.2s`) */
    for (const [seg, span] of segSpan) {
      const ms = span.to - span.from;
      seg.elapsedMs = ms > 0 ? ms : null;
    }

    for (const shell of [top, todoCard]) {
      if (!shell) continue;
      // 只有**还在跑的那张**跟着 now 走;先结束的那张定在自己的最后一刻
      const live = running && shell === activeShell();
      shell.elapsedMs = shellElapsed(live, shell);
    }

    if (running || !started) return;

    liftConclusion();

    if (status === 'canceled') {
      // 手动停止:壳保持「进行中」,只挂旗标(B7 / W4)
      for (const shell of [top, todoCard]) {
        if (!shell) continue;
        shell.stopped = true;
        closeRunningSegments(shell);
      }
      return;
    }

    for (const shell of [top, todoCard]) {
      if (!shell) continue;
      if (status === 'failed' && shell === (todoCard ?? top)) shell.status = 'failed';
      else if (shell.status === 'running') shell.status = 'done';
      closeRunningSegments(shell);
    }
  }

  function shellElapsed(running: boolean, shell?: ExecutionShell): number | null {
    // 有自己的跨度就用自己的;没有(比如壳里一件带时刻的事都没有)再退回轮次跨度
    const span = shell ? shellSpan.get(shell) : undefined;
    const from = span ? span.from : firstStartedAt;
    const last = span ? span.to : lastEndedAt;
    if (from == null) return null;
    const end = running ? Math.max(input.nowMs ?? 0, last ?? 0) : (last ?? 0);
    const ms = end - from;
    return ms > 0 ? ms : null;
  }
}

/**
 * 轮次一旦终止,壳里不能再有东西「正在跑」。
 *
 * agent 收尾时忘了发最后一次清单是常事(有的干脆整轮只发一次),
 * 于是壳头写着「已完成」,里面那条 todo 还顶着进行中 —— 一颗永远转下去的球。
 *
 * 收成 `stopped` 而不是 `completed`:我们只知道它**没跑完就结束了**,不知道它成没成。
 * 标成完成是替 agent 说了它没说过的话;`stopped` 画出来是中性灰,红留给真的错误。
 * 手动停止走的也是这一条 —— 对那条 todo 来说,两种结局是同一件事。
 */
function closeRunningSegments(shell: ExecutionShell): void {
  for (const seg of shell.segments) {
    if (seg.status === 'in_progress') seg.status = 'stopped';
  }
}

/* ── 生图行(组件 12)─────────────────────────────────────────── */

/** 查用法不算生图 */
const MEDIA_GENERATE_RE = /media\s+generate/;

/**
 * 认出一次生图调用,并把结果读成「出了几张 / 砸了几张 / 图在哪」。
 *
 * `od media generate` 的输出是**每行一个 JSON**(失败行里还嵌着 error 对象),
 * 所以逐行 parse,parse 不动的行退回正则抠 `status`。
 * 一条状态都读不出来时分两种:命令本身报错 → 整组算失败;否则说明这压根不是一次
 * 真正的生图(比如在查参数),回落成普通命令行,别硬画成图。
 */
function readImageCall(
  event: Extract<PersistedAgentEvent, { kind: 'tool_use' }>,
  result: Extract<PersistedAgentEvent, { kind: 'tool_result' }> | undefined,
): ImageRow | null {
  if (!isCommandTool(event.name)) return null;
  const command = commandOf(event.input);
  if (!MEDIA_GENERATE_RE.test(command) || /--help\b/.test(command)) return null;

  // 一条命令里可以串好几次生成,数出来就是这一行要摆几个格子
  const total = Math.max(1, (command.match(/media\s+generate/g) ?? []).length);
  let done = 0;
  let failed = 0;
  const thumbs: string[] = [];

  if (result?.content) {
    for (const line of result.content.split('\n')) {
      const text = line.trim();
      if (!text.startsWith('{')) continue;
      let status: string | null = null;
      let path: string | null = null;
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Record<string, unknown>;
          if (typeof rec.status === 'string') status = rec.status;
          for (const key of ['path', 'file', 'outputPath', 'url']) {
            const v = rec[key];
            if (typeof v === 'string' && v) { path = v; break; }
          }
        }
      } catch {
        status = /"status"\s*:\s*"(\w+)"/.exec(text)?.[1] ?? null;
      }
      if (!status) continue;
      if (status === 'failed' || status === 'error') failed += 1;
      else if (/succeeded|done|completed|ok/.test(status)) {
        done += 1;
        if (path) thumbs.push(path);
      }
    }
  }

  if (result && done + failed === 0) {
    const looksBroken = result.isError || /failed|error|required|unknown|not found/i.test(result.content ?? '');
    if (!looksBroken) return null;      // 不是生图,交给普通工具行
    failed = total;
  }

  let elapsedMs: number | null = null;
  if (event.startedAt != null && result?.completedAt != null) {
    const d = result.completedAt - event.startedAt;
    if (d >= UNKNOWN_ELAPSED_BELOW_MS) elapsedMs = d;
  }

  return {
    kind: 'image',
    id: event.id,
    total,
    done,
    failed,
    thumbs,
    pending: !result,
    elapsedMs,
  };
}

/* ── 工具行 ─────────────────────────────────────────────────── */

function buildToolRow(
  event: Extract<PersistedAgentEvent, { kind: 'tool_use' }>,
  result: Extract<PersistedAgentEvent, { kind: 'tool_result' }> | undefined,
): ToolRow | null {
  /** D3:调用没回来就不落行 —— 界面上没有「执行中」这一档 */
  if (!result) return null;

  const kind = toolKind(event.name, event.input);
  const command = isCommandTool(event.name) ? commandOf(event.input) : '';
  const file = fileOf(event.input) ?? (kind === 'read' && command ? commandFile(command) : null);
  const failed = Boolean(result.isError);
  const hits = kind === 'search' && !failed && result.content
    ? result.content.split('\n').filter((l) => l.trim()).length
    : null;

  /**
   * 耗时:两端都拿得到才算。codex 的 `tool_use` 在 `item.completed` 才发出,
   * 与 `tool_result` 同时到达 —— 差值接近 0 表示「不知道」,不是「跑得快」(§2.2b / W10)。
   */
  let elapsedMs: number | null = null;
  if (event.startedAt != null && result.completedAt != null) {
    const d = result.completedAt - event.startedAt;
    if (d >= UNKNOWN_ELAPSED_BELOW_MS) elapsedMs = d;
  }

  return {
    kind: 'tool',
    id: event.id,
    tool: kind,
    name: event.name,
    title: toolTitle(event.name, event.input),
    rawTitle: isRawCommandTitle(event.name, event.input),
    file,
    pattern: kind === 'search' ? searchPattern(event.name, event.input) : null,
    hits,
    delta: diffStat(event.name, event.input),
    elapsedMs,
    failed,
    failReason: null,
    command: command ? command : null,
    terminal: command && result.content ? result.content : null,
  };
}
