/**
 * 还在想的时候,那段推理自己一行一行往上走(设计稿组件 3-1,D46 用户 2026-08-25 拍板要做)。
 *
 * 为什么不是「滚到底」:它不是日志。读者只需要感到「它还在想」,所以走法是
 * **每 2s 挪一行**、用 550ms 缓动挪过去、到底了回到顶重来 —— 与交付稿的
 * `stream()` 一字不差(常量也照抄:STEP / MOVE / 回退行高)。
 *
 * 四件必须做对的事(都从稿子里抄的,不是我加的):
 *  · 行高按当前那段字**实测**,不写死 —— 字号一改这里自动跟上
 *  · 掉帧要**补步**而不是慢放:切回标签页时按流逝时间补,但单帧最多算 100ms,免得一下跳一大截
 *  · 收起 / 滚出视口 / 切走标签页都停;收起再展开**从头读**,不接着上次的位置
 *  · 关了动效就完全不动(CSS 那边同时把限高放开,让人自己读)
 */
import { useEffect, type RefObject } from 'react';

const STEP_MS = 2000;
const MOVE_MS = 550;
const FALLBACK_LINE = 18.6;
const ease = (t: number): number => 1 - (1 - t) ** 3;

export function useThinkingStream(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const box = ref.current;
    if (!box || !active) return;

    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    let raf = 0;
    let last = 0;
    let from = 0;
    let elapsed = 0;
    let running = false;
    let onScreen = true;

    /** 行高按真正那段字量实测:字号改了这里跟着改,不用两处对 */
    const lineOf = (): number => {
      const p = box.querySelector('p, div');
      const lh = p ? Number.parseFloat(getComputedStyle(p).lineHeight) : Number.NaN;
      return lh > 0 ? lh : FALLBACK_LINE;
    };

    const frame = (now: number): void => {
      if (!running) return;
      const dt = last ? Math.min(100, now - last) : 0;   // 切回来时别一下跳一大截
      last = now;
      const max = box.scrollHeight - box.clientHeight;
      if (max > 0) {
        const step = lineOf();
        elapsed += dt;
        while (elapsed >= STEP_MS) {                      // 掉过一整步就补上,不是慢放
          elapsed -= STEP_MS;
          from += step;
          if (from >= max) from = 0;                      // 到底回到顶重来
        }
        const to = from + step >= max ? max : from + step;
        box.scrollTop = from + (to - from) * ease(Math.min(1, elapsed / MOVE_MS));
      }
      raf = requestAnimationFrame(frame);
    };

    const stop = (): void => { running = false; last = 0; cancelAnimationFrame(raf); };
    const play = (): void => {
      if (running || reduce?.matches) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const sync = (): void => {
      if (onScreen && document.visibilityState !== 'hidden') play(); else stop();
    };

    // 收起来就不用滚:内容不在视野里,滚了也没人看;再展开时该从头读
    const fold = box.closest('details');
    const onToggle = (): void => {
      if (fold?.open) { from = 0; elapsed = 0; box.scrollTop = 0; sync(); } else stop();
    };
    fold?.addEventListener('toggle', onToggle);

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        onScreen = entry?.isIntersecting ?? true;
        sync();
      });
      observer.observe(box);
    } else {
      sync();
    }
    document.addEventListener('visibilitychange', sync);
    reduce?.addEventListener('change', sync);

    return () => {
      stop();
      observer?.disconnect();
      fold?.removeEventListener('toggle', onToggle);
      document.removeEventListener('visibilitychange', sync);
      reduce?.removeEventListener('change', sync);
    };
  }, [ref, active]);
}
