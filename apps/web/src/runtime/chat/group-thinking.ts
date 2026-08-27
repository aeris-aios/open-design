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
 * 只在**思考已经结束**时分组。还在思考的那一刻不分组:那一段归 96px 的流式窗管,
 * 折叠一个正在往上走的东西没有意义(设计稿状态 1,`ExecutionShell` 的 `streaming`)。
 *
 * 「连续」是硬判据:中间隔了工具行就是两段推理,分别成格。合并会把两次不相干的
 * 思考拼成一段,读起来像它想了很久一件事。
 */
import type { ShellItem } from './contract';

/** 收拢后的一格:折叠头写「思考过程」,展开是原样的几段 */
export interface ThoughtsGroup {
  kind: 'thoughts';
  texts: string[];
}

export type GroupedShellItem = ShellItem | ThoughtsGroup;

const isThinking = (item: ShellItem): boolean =>
  item.kind === 'text' && item.thinking === true && item.text.trim().length > 0;

/**
 * @param items 壳内原始条目
 * @param streaming 还在思考(壳 body 挂着流式窗)—— 此时原样返回,不分组
 */
export function groupThinking(items: ShellItem[], streaming: boolean): GroupedShellItem[] {
  if (streaming) return items;
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
  return out;
}
