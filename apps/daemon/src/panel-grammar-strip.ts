/**
 * 评审剧场(Critique Theater)通信语法的**兜底剥离**。
 *
 * 为什么需要它:评审剧场已经在总闸上关掉了(`critique/rollout.ts`),而且它跑起来时
 * 子进程 stdout 会被整个改道给编排器 —— 按结构说,这套语法到不了聊天正文。
 * 但用户在真实客户端里**连着撞到四次** `<CRITIQUE_RUN>` / `<PANELIST role="Critic" score="9.0">`
 * 原样打在回答里。最可能的路径是:某一轮漏出来之后,它进了对话历史,
 * 模型看见自己上一轮的输出就跟着模仿 —— 一旦开始就会自我延续。
 *
 * 所以不去赌「注入源已经堵住」:凡是这套语法,一律不进正文。
 *
 * 两条硬要求(都来自用户):
 *  1. **不能闪**:标记被 SSE 切成两半时,半截字符一个都不许出现在屏幕上;
 *  2. **不吞用户的字**:攒着的半截如果最终不是标记,`flush()` 要原样吐回去。
 */

import { CRITIQUE_GRAMMAR_TAGS, critiqueGrammarTagPattern } from '@open-design/contracts';

/*
 * 语法本身住在 `@open-design/contracts`(`critique.ts`)—— 那是**唯一出处**。
 * 这个文件只负责流式那一半:半截标记的缓冲与吐回。
 * web 侧用同一份语法剥**历史**(已经落库的旧对话,这道来不及了)。
 */
const ALL_TAGS = CRITIQUE_GRAMMAR_TAGS;

/**
 * 一条完整标记。只喂给 `String.replace` —— 全局正则走完 `replace` 会自己把
 * `lastIndex` 归零,所以模块级复用一个实例是安全的;换成 `test()` / `exec()`
 * 就必须改成每次现造。
 */
const TAG_RE = critiqueGrammarTagPattern();

/** 攒着的半截最多留这么长 —— 正文里孤立的 `<` 不该把输出一直憋住 */
const MAX_HOLD = 96;

/** 尾巴有没有可能是**还没写完**的标记开头 */
function pendingTail(text: string): number {
  const lt = text.lastIndexOf('<');
  if (lt === -1) return 0;
  const tail = text.slice(lt);
  if (tail.length > MAX_HOLD) return 0;
  // 已经闭合了就不是半截
  if (tail.includes('>')) return 0;
  const name = tail.replace(/^<\/?/, '').toUpperCase();
  // 空的 `<` 也要扣住:下一帧可能就是标签名
  if (name.length === 0) return tail.length;
  return ALL_TAGS.some((t) => t.startsWith(name)) ? tail.length : 0;
}

export interface PanelGrammarStripper {
  strip(delta: string): string;
  /** 流结束时把攒着的半截原样吐回去 —— 它终究不是标记 */
  flush(): string;
}

export function createPanelGrammarStripper(): PanelGrammarStripper {
  let held = '';
  return {
    strip(delta: string): string {
      const buffer = held + String(delta ?? '');
      const hold = pendingTail(buffer);
      const usable = hold > 0 ? buffer.slice(0, buffer.length - hold) : buffer;
      held = hold > 0 ? buffer.slice(buffer.length - hold) : '';
      return usable.replace(TAG_RE, '');
    },
    flush(): string {
      const rest = held;
      held = '';
      return rest;
    },
  };
}
