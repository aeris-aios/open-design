/**
 * 跑完之后,把壳里**连续的几段推理**收成一格可展开的「思考过程」。
 *
 * ⚠️ 这条是**用户裁决,覆盖设计稿**(2026-08-27)。
 * 设计稿组件 3 状态 3 写的是「跑完 · 收进 7·任务进度里,是几段纯文字,**不再自带折叠**」;
 * 用户要的是「thinking 完成后就变成普通工具调用的状态,可以下拉展开看思考细节」。
 * 冲突已当面对齐并留档:`specs/current/chat-panel-feedback.md` §F-11。
 *
 * 修的是哪个画面:`shell.thinking` 一旦置 false(第一段正文或第一个工具落下来),
 * 壳 body 就从 `.stream`(限高 96px 的推理窗)换成 `.stack`(高度 auto),
 * 于是刚才那十几段推理**原地全部展开** —— 用户原话「怎么一结束全部释放出来了」。
 *
 * **一直分组,思考中也分**(2026-08-27 第二次裁决)。旧版在思考期间原样返回,
 * 由 `ExecutionShell` 把 96px 流式窗套在**整个壳 body** 上 —— 壳里原有的工具行和清单
 * 被一起塞进那只窗里滚走,用户原话「这个思考中的怎么把原本的进行中卡片给顶掉了」。
 * 现在思考自己就是一格:还在写的那一格标 `live`,窗子挂在它自己身上,壳 body 不动。
 *
 * 「连续」是硬判据:中间隔了工具行就是两段推理,分别成格。合并会把两次不相干的
 * 思考拼成一段,读起来像它想了很久一件事。
 */
import type { ShellItem } from './contract';

/** 收拢后的一格:折叠头写「思考过程」,展开是原样的几段 */
export interface ThoughtsGroup {
  kind: 'thoughts';
  texts: string[];
  /**
   * 还在往下写的**那一段**。只有它挂 96px 限高滚动窗(D46'),
   * 别的几格都是跑完收起来的普通条目。
   *
   * ⚠️ 这个标记**只落在一格上**,不是「整张壳在思考」的同义词 ——
   * 后者会把限高窗套回壳 body,正是用户 2026-08-27 指认的那个坏画面。
   */
  live?: boolean;
}

export type GroupedShellItem = ShellItem | ThoughtsGroup;

const isThinking = (item: ShellItem): boolean =>
  item.kind === 'text' && item.thinking === true && item.text.trim().length > 0;

/**
 * @param items 壳内原始条目
 * @param live 这一摞**就是模型此刻正在写的地方**(壳里没有进行中的 todo 时是壳自己,
 *             有的话是那条 todo)。为真时结尾那一格标成 `live`;结尾不是推理就补一格
 *             空的 —— claude 的 thinking 全是空串,一段推理都落不下,但「它在想」
 *             这件事仍然要在壳里有一行(真实数据:本机 14 条 claude 共 1786 帧全空)。
 */
export function groupThinking(items: ShellItem[], live: boolean): GroupedShellItem[] {
  const out: GroupedShellItem[] = [];
  let run: string[] | null = null;
  const flush = (): void => {
    if (run && run.length) out.push({ kind: 'thoughts', texts: run });
    run = null;
  };
  for (const item of items) {
    if (isThinking(item)) {
      // 空白段落不占一格,但也不该把前后两段推理**切断**,所以过滤在 isThinking 里
      (run ??= []).push((item as { text: string }).text);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  if (live) {
    const tail = out[out.length - 1];
    if (tail && tail.kind === 'thoughts') tail.live = true;
    else out.push({ kind: 'thoughts', texts: [], live: true });
  }
  return out;
}
