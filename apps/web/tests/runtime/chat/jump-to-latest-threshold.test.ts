/**
 * 红测:「回到最新」不该有事没事就冒出来。
 *
 * 用户 2026-08-27 指认:「这个总是有事没事就出现,能不能加一些阈值啊,
 * 只有在很上面时才出现不行吗」。原来的判据是**写死的 120px** —— 半屏字都不到,
 * 随手滚一下就弹出来,而且它就浮在回合状态行上方,挡住〔继续剩余任务〕那一排。
 *
 * 两条:
 *  · 阈值跟着**视口高度**走,「很上面」在大屏小屏都得是同一件事;
 *  · 出和收用**两个**阈值(迟滞),否则在临界点上下微动会闪。
 */
import { describe, expect, it } from 'vitest';

import { shouldShowJumpToLatest } from '../../../src/runtime/chat/jump-to-latest';

describe('回到最新的出现阈值', () => {
  const H = 600;

  it('stays hidden for the small scrolls that used to trigger it', () => {
    // 120px 正是旧判据的门槛 —— 现在这个距离必须还是不出现
    expect(shouldShowJumpToLatest({ distance: 120, clientHeight: H, shown: false })).toBe(false);
    expect(shouldShowJumpToLatest({ distance: 300, clientHeight: H, shown: false })).toBe(false);
  });

  it('appears once the reader is genuinely far up', () => {
    expect(shouldShowJumpToLatest({ distance: 900, clientHeight: H, shown: false })).toBe(true);
  });

  it('scales with the pane instead of pinning a pixel count', () => {
    // 同一个绝对距离,在矮面板里算「很上面」,在高面板里不算
    const distance = 500;
    expect(shouldShowJumpToLatest({ distance, clientHeight: 400, shown: false })).toBe(true);
    expect(shouldShowJumpToLatest({ distance, clientHeight: 1200, shown: false })).toBe(false);
  });

  it('has hysteresis so it does not flicker on the boundary', () => {
    // 已经显示着的时候,门槛更低 —— 往下滚一点不会立刻消失
    const onBoundary = { distance: 380, clientHeight: H };
    expect(shouldShowJumpToLatest({ ...onBoundary, shown: false })).toBe(false);
    expect(shouldShowJumpToLatest({ ...onBoundary, shown: true })).toBe(true);
  });

  it('always disappears once the reader is back at the bottom', () => {
    expect(shouldShowJumpToLatest({ distance: 0, clientHeight: H, shown: true })).toBe(false);
    expect(shouldShowJumpToLatest({ distance: 40, clientHeight: H, shown: true })).toBe(false);
  });

  it('never demands more than a sane ceiling on very tall panes', () => {
    // 面板特别高时不该要求滚过好几屏才给入口
    expect(shouldShowJumpToLatest({ distance: 1400, clientHeight: 4000, shown: false })).toBe(true);
  });
});
