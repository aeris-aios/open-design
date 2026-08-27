/**
 * 思考流的滚动速度跟着**文字到达速率**走(用户 2026-08-27)。
 *
 * 用户原话:「而且滚动速度是不是要动态一下啊, 现在固定的感觉不太对,
 *            ds-v4-flash thinking 输出的非常快的..」
 *
 * 原来是 `STEP_MS = 2000` / `MOVE_MS = 550` 两个写死的常量,一字不差抄自交付稿的
 * `stream()`。**这两个数不是错的**,它们是「没有真模型在吐字」的演示稿里的节奏;
 * 稿子自己的注释就写着:「它是【演示】:真实的 Thinking 是模型边吐边把内容顶上去」。
 * 用户要的是真机上跟得上,所以 2000 从**定值**降级成**上界**。
 *
 * 裁决记在 `specs/current/chat-panel-feedback.md` §F-16。
 */
import { describe, expect, it } from 'vitest';
import {
  planStep, STEP_MS, MIN_STEP_MS, MOVE_RATIO, MAX_STEP_LINES,
} from '../../../src/components/chat/primitives/useThinkingStream';

const LINE = 18.6;   // 稿子的兜底行高(12px × 1.55)

describe('planStep:一步走多久、走多远', () => {
  it('没有新字进来时,就是交付稿那一档 —— 2s 一行', () => {
    const plan = planStep(0, LINE);
    expect(plan.stepMs).toBe(STEP_MS);
    expect(plan.lines).toBe(1);
    expect(plan.moveMs).toBe(Math.round(STEP_MS * MOVE_RATIO));
    expect(plan.moveMs).toBe(550);        // 交付稿的 MOVE_MS,一字不差
  });

  it('慢到跟不上时**不会比交付稿更慢** —— 2000 是上界不是可以被超过的值', () => {
    for (const rate of [0, 0.1, 1, LINE / 4]) {
      expect(planStep(rate, LINE).stepMs).toBeLessThanOrEqual(STEP_MS);
    }
  });

  it('字来得快就走得快 —— ds-v4-flash 那一档明显比 2s 短', () => {
    const slow = planStep(LINE * 0.5, LINE);     // 半行/秒
    const fast = planStep(LINE * 6, LINE);       // 六行/秒
    expect(fast.stepMs).toBeLessThan(slow.stepMs);
    expect(fast.stepMs).toBeLessThan(STEP_MS);
  });

  it('反向对照:速度**不是**单调写死的一个新常量,它随速率连续变', () => {
    const a = planStep(LINE * 1, LINE).stepMs;
    const b = planStep(LINE * 2, LINE).stepMs;
    const c = planStep(LINE * 3, LINE).stepMs;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('再快也不会快过下界 —— 下界之后改用「一步走几行」补速度', () => {
    const insane = planStep(LINE * 40, LINE);
    expect(insane.stepMs).toBeGreaterThanOrEqual(MIN_STEP_MS);
    expect(insane.lines).toBeGreaterThan(1);
    expect(insane.lines).toBeLessThanOrEqual(MAX_STEP_LINES);
  });

  it('走的那一下和停住的那一下,比例在每一档速度上都保持交付稿的 550/2000', () => {
    for (const rate of [0, LINE, LINE * 3, LINE * 40]) {
      const p = planStep(rate, LINE);
      expect(p.moveMs / p.stepMs).toBeCloseTo(MOVE_RATIO, 2);
      expect(p.moveMs).toBeLessThan(p.stepMs);       // 停顿是这条动画的一半内容
    }
  });

  it('行高变了,同一个到达速率算出来的节奏跟着变(不是按字数写死的)', () => {
    const small = planStep(LINE * 2, LINE);
    const big = planStep(LINE * 2, LINE * 2);        // 行更高 ⇒ 一步能吞掉更多,可以更慢
    expect(big.stepMs).toBeGreaterThan(small.stepMs);
  });
});
