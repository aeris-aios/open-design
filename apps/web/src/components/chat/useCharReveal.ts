/**
 * 壳外正文的「逐字化开」(设计稿组件 4 / 13,规格 W9 / W13)。
 *
 * 稿子把流式光标整个删了 —— 流式期间没有任何标记,**新到的字自己化开**就是流式的样子:
 * 单字 0.4s、从模糊到清晰,字与字之间错开 10ms,所以一大段一起到也是从左到右、
 * 一行接一行地显出来,不会整段并排冒出来(设计与产品 2026-08-21 的原话)。
 *
 * ## 为什么不能照抄参考实现
 *
 * 模拟器的 `player.js` 是每帧把整段 HTML 重画,然后把文本节点**替换**成一串 span。
 * 那是它自己的 DOM,想怎么换都行。这里不行:这段正文是 React 渲染的,**React 还握着
 * 那些文本节点的引用**,下一帧它会往里写新文字。把节点换掉之后,React 写进的是一个
 * 已经脱离文档的节点 —— 表现是**流式正文中途某一段就不再更新了**(有测试钉住:
 * `char-reveal.test.tsx` 里那条嵌套结构的用例,改回替换写法立刻转红)。
 *
 * 所以这里的做法是:**永远不动 React 建的节点**。只把它的内容截短到「已经显示完的那一段」,
 * 把还在化开的几个字拆成 span **追加在它后面**。节点身份没变,React 照常能更新它;
 * 下一帧我们先把自己加的 span 收走,再重新算。
 *
 * ## 三个曾让「已经显示的字」整块一起闪的坑(评审视频里看得很清楚)
 *
 *  ① **不能按这一帧 delta 的长度判断新字**。delta 可能整条落在被藏起来的
 *     `<question-form>` / `<artifact>` 里,可见文本一个字没变,却把段尾几个字当成新字重放。
 *     → 只看**可见文本**前后两帧的差异。
 *  ② **每帧要先把上一帧加的 span 收走**,否则越堆越多,每堆一层动画重放一次。
 *  ③ **不能用前缀比较判断新字**。markdown 一闭合(`**` → `<b>`)可见文字会变短,
 *     前缀对不上就把整段当成新字。→ 前缀对不上时只把**真的变长的那几个字**算作新字。
 */
import { useLayoutEffect, type RefObject } from 'react';

/** 字间错开 10ms(稿子的 `--i * 0.01s`) */
const STAGGER_MS = 10;
/** 单字 0.4s,与稿子一致;留一点余量再判定「开完了」 */
const CHAR_MS = 400;
const OWNED = 'data-char-reveal';

interface RevealState {
  /** 上一帧动过的那个文本节点 */
  node: Text | null;
  /** 我们知道的它的完整内容(截短之前) */
  full: string;
  /** 我们留在节点里的那一段 —— 用它判断 React 有没有重写过 */
  prefix: string;
  /** 已经开完的字数 */
  settled: number;
  last: number | null;
}

const states = new WeakMap<HTMLElement, RevealState>();

export function useCharReveal(ref: RefObject<HTMLElement | null>, streaming: boolean): void {
  // 用 layout effect:DOM 改完到浏览器画之前做掉,不会闪
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;

    if (!streaming) { restore(host); states.delete(host); return; }
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const prev = states.get(host) ?? { node: null, full: '', prefix: '', settled: 0, last: null };
    restore(host);                                     // ② 先把上一帧加的 span 收走

    const node = lastTextNode(host);
    if (!node) { states.delete(host); return; }

    /*
     * 这个节点现在的完整内容。React 若重写过它,`nodeValue` 就是新的;
     * 若没重写(这一帧变的是别处),留在里面的还是我们上一帧截短的那一段,
     * 这时要拿我们自己记着的完整值,否则会把已经显示的字吞掉。
     */
    const sameNode = prev.node === node;
    const full = sameNode && node.nodeValue === prev.prefix ? prev.full : (node.nodeValue ?? '');
    const total = full.length;
    const old = sameNode ? prev.full : '';

    let p = 0;
    const pmax = Math.min(old.length, total);
    while (p < pmax && old[p] === full[p]) p += 1;      // ① 可见文本的公共前缀

    const grew = total - old.length;
    // ③ 前缀对不上时,只把真的变长的那几个字算新字;第一次见到这一段不化开(整段一起闪更糟)
    const added = !sameNode ? 0 : grew <= 0 ? 0 : p === old.length ? grew : Math.min(grew, total - p);
    const settled = Math.min(sameNode ? Math.max(prev.settled, total - added) : total, total);

    const now = performance.now();
    let last = prev.last ?? now - STAGGER_MS;
    const starts: number[] = [];
    for (let i = settled; i < total; i += 1) {
      if (!(full[i] ?? '').trim()) { starts.push(now); continue; }   // 空白不排队
      last = Math.max(now, last + STAGGER_MS);
      starts.push(last);
    }

    if (settled >= total) {
      states.set(host, { node, full, prefix: full, settled: total, last });
      return;
    }

    host.setAttribute('data-reveal', '');
    node.nodeValue = full.slice(0, settled);            // 只截短,**不换节点**
    const frag = document.createDocumentFragment();
    for (let i = settled; i < total; i += 1) {
      const span = document.createElement('span');
      span.className = 'rv';
      span.setAttribute(OWNED, '');
      span.style.animationDelay = `${Math.round((starts[i - settled] ?? now) - now)}ms`;
      span.textContent = full[i] ?? '';
      frag.append(span);
    }
    node.after(frag);

    // 开完的字下一帧并回节点里,span 不会越堆越多
    const doneBy = now + (starts.at(-1) ?? now) - now + CHAR_MS;
    states.set(host, { node, full, prefix: full.slice(0, settled), settled: doneBy <= now ? total : settled, last });
  });
}

/** 把我们加过的 span 全收走,并把节点内容还原成完整值 */
function restore(host: HTMLElement): void {
  const state = states.get(host);
  for (const span of [...host.querySelectorAll(`[${OWNED}]`)]) span.remove();
  if (state?.node && state.node.isConnected && state.node.nodeValue === state.prefix) {
    state.node.nodeValue = state.full;
  }
  host.removeAttribute('data-reveal');
}

function lastTextNode(host: HTMLElement): Text | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let found: Text | null = null;
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue ?? '').length > 0) found = node as Text;
    node = walker.nextNode();
  }
  return found;
}
