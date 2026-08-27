/**
 * 还在想的时候,那段推理自己一行一行往上走(设计稿组件 3-1,D46 用户 2026-08-25 拍板要做)。
 *
 * 为什么不是「滚到底」:它不是日志。读者只需要感到「它还在想」,所以走法是
 * **走一步、停住让人读完、再走一步**,到底了回到顶重来。
 *
 * 四件必须做对的事(都从稿子里抄的,不是我加的):
 *  · 行高按当前那段字**实测**,不写死 —— 字号一改这里自动跟上
 *  · 掉帧要**补步**而不是慢放:切回标签页时按流逝时间补,但单帧最多算 100ms,免得一下跳一大截
 *  · 收起 / 滚出视口 / 切走标签页都停;收起再展开**从头读**,不接着上次的位置
 *  · 关了动效就完全不动(CSS 那边同时把限高放开,让人自己读)
 *
 * ── 节奏从**定值**降级成**上界**(2026-08-27 用户裁决,§F-16)────────────────
 *
 * 这里原来是 `STEP_MS = 2000` / `MOVE_MS = 550` 两个写死的常量,一字不差抄自交付稿的
 * `stream()`。用户原话:「而且滚动速度是不是要动态一下啊, 现在固定的感觉不太对,
 * ds-v4-flash thinking 输出的非常快的..」
 *
 * **那两个数并没有写错。** 稿子自己的注释就说了它是演示:「它是【演示】:真实的
 * Thinking 是模型边吐边把内容顶上去,不会回到顶重来。稿子里没有真的在吐字的模型,
 * 只能拿一段写死的推理循环滚」。2000 是配着一段**不再增长**的死文本挑的节奏;
 * 真机上文字一直在长,节奏就得跟着到达速率走,否则窗口永远落在几十行之外。
 *
 * 所以 2000 现在是**最慢的那一档**(慢的时候一步不差地还是交付稿的样子),
 * 快起来时按「一行要多久才被顶出窗口」反推节奏,并保住稿子那个 550/2000 的
 * 走停比 —— 变的是快慢,不是「走一下停一下」这个形态。
 */
import { useEffect, type RefObject } from 'react';

/** 最慢的一档,= 交付稿的 `STEP_MS`。**上界**:再没有新字进来也不会比它更慢 */
export const STEP_MS = 2000;
/**
 * 最快的一档。
 *
 * 不是随手挑的圆整数:一步里「走」的那一段是 `MOVE_RATIO` 倍,300ms × 0.275 ≈ 83ms
 * ≈ 60fps 下的 5 帧 —— 再短就不是「滑过去」而是「跳一下」,稿子那句
 * 「起步快、落位慢,停下来的那一下不硬」就没了。剩下的 217ms 是让一行字站定被读到的下限。
 *
 * (先试过 500:1 行/秒 到 3 行/秒 这一段全被夹平成同一个值,而那正好是
 * ds-v4-flash 所在的区间 —— 夹平等于没做动态。`thinking-stream-tempo.test.ts`
 * 里那条「随速率连续变」的反向对照就是钉这件事的。)
 */
export const MIN_STEP_MS = 300;
/** 走停比,= 交付稿的 550 / 2000。每一档速度都保持它 */
export const MOVE_RATIO = 550 / 2000;
/**
 * 一步最多走几行。
 *
 * 到了 `MIN_STEP_MS` 还追不上,就只能一步走远一点。上限 3 行是因为窗口只有 96px(≈5 行)——
 * 稿子拒绝「按段走」的理由是「一跳半屏就没了连续感」,3/5 已经贴着那条线。
 */
export const MAX_STEP_LINES = 3;
/** 量不到行高时的兜底(12px × 1.55),与交付稿一致 */
const FALLBACK_LINE = 18.6;
/** 到达速率的平滑窗口:比一步还长,免得单帧的一个大 delta 把节奏抖成锯齿 */
const RATE_TAU_MS = 1200;

/** ease-out cubic:起步快、落位慢,停下来的那一下不硬(交付稿原值) */
const ease = (t: number): number => 1 - (1 - t) ** 3;

export interface StepPlan {
  /** 这一步整个占多久(走 + 停) */
  stepMs: number;
  /** 其中「走」占多久,剩下的停住 */
  moveMs: number;
  /** 这一步走几行 */
  lines: number;
}

/**
 * 按「文字以多快的速度把窗口顶上去」定这一步的节奏。
 *
 * @param growthPxPerSec 内容高度的增长速率(px/s)。0 = 没有新字进来
 * @param linePx         当前那段字的行高(px)
 */
export function planStep(growthPxPerSec: number, linePx: number): StepPlan {
  const line = linePx > 0 ? linePx : FALLBACK_LINE;
  const rate = Number.isFinite(growthPxPerSec) && growthPxPerSec > 0 ? growthPxPerSec : 0;
  // 一行被顶出窗口需要多久 —— 想不落后,一步就得在这个时间内走完
  const needed = rate > 0 ? (line / rate) * 1000 : Number.POSITIVE_INFINITY;
  const stepMs = Math.round(Math.min(STEP_MS, Math.max(MIN_STEP_MS, needed)));
  // 夹到下界之后还追不上的部分,用「一步走几行」补回来
  const perStep = (rate * stepMs) / 1000;
  const lines = Math.min(MAX_STEP_LINES, Math.max(1, Math.ceil(perStep / line)));
  return { stepMs, moveMs: Math.round(stepMs * MOVE_RATIO), lines };
}

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
    /** 平滑过的内容增长速率(px/s) */
    let rate = 0;
    let lastHeight = 0;
    let plan: StepPlan = planStep(0, FALLBACK_LINE);

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

      // 到达速率:内容长高了多少 / 过了多久,再做一次指数平滑。
      // 单帧的瞬时值不能直接用 —— delta 是一阵一阵来的,不平滑会抖成锯齿。
      const height = box.scrollHeight;
      if (dt > 0 && lastHeight > 0) {
        const inst = Math.max(0, (height - lastHeight) / dt) * 1000;
        rate += (inst - rate) * (1 - Math.exp(-dt / RATE_TAU_MS));
      }
      lastHeight = height;

      const max = height - box.clientHeight;
      if (max > 0) {
        const step = lineOf();
        elapsed += dt;
        while (elapsed >= plan.stepMs) {                 // 掉过一整步就补上,不是慢放
          elapsed -= plan.stepMs;
          from += step * plan.lines;
          if (from >= max) from = 0;                     // 到底回到顶重来
          // 节奏只在**步与步之间**换档:步进行到一半改 stepMs,缓动会当场跳一下
          plan = planStep(rate, step);
        }
        const target = from + step * plan.lines;
        const to = target >= max ? max : target;
        box.scrollTop = from + (to - from) * ease(Math.min(1, elapsed / plan.moveMs));
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
