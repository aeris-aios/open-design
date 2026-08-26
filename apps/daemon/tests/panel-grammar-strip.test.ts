import assert from 'node:assert/strict';
import { test } from 'vitest';

import { createPanelGrammarStripper } from '../src/panel-grammar-strip.js';

/**
 * 红测:评审剧场的通信语法**永远不许进可见正文**。
 *
 * 用户在真实客户端里连着撞到四次 `<CRITIQUE_RUN>` / `<PANELIST role="Critic" score="9.0">`
 * / `<ROUND_END …/>` 原样打在回答里。总闸已经关掉(`critique/rollout.ts`),但那只挡住
 * 「我们主动注入」这一条路 —— 注入源至今没查清,所以可见文本路径上必须有兜底。
 *
 * 同时要满足用户的另一条硬要求:**不能先闪出半截 `<PANEL` 再突然消失**。
 */
function make() {
  const s = createPanelGrammarStripper();
  return s;
}

test('整块协议被吃掉,只留下人话', () => {
  const s = make();
  const out = s.strip('<CRITIQUE_RUN>\n<ROUND index="1">\n<PANELIST role="Designer">已完成初稿。</PANELIST>\n</ROUND>\n</CRITIQUE_RUN>\n收工。');
  assert.equal(out.includes('<CRITIQUE_RUN>'), false);
  assert.equal(out.includes('<PANELIST'), false);
  assert.equal(out.includes('</ROUND>'), false);
  assert.equal(out.includes('已完成初稿。'), true);
  assert.equal(out.includes('收工。'), true);
});

test('自闭合的 ROUND_END 也吃掉', () => {
  const s = make();
  assert.equal(s.strip('<ROUND_END decision="revise" composite="8.88"/>后续。').trim(), '后续。');
});

test('MUSTFIX / RESOLVED 这类内联标记只脱壳,留住里面的话', () => {
  const s = make();
  const out = s.strip('<PANELIST role="Critic" score="8.4"><MUSTFIX id="R1-C1">移除强制换行。</MUSTFIX></PANELIST>');
  assert.equal(out.includes('<MUSTFIX'), false);
  assert.equal(out.includes('移除强制换行。'), true);
});

test('被流式切成两半:半截标签一个字都不许露出来', () => {
  const s = make();
  assert.equal(s.strip('先说一句。<PANE'), '先说一句。');
  assert.equal(s.strip('LIST role="Critic">很好。</PANELIST>'), '很好。');
  assert.equal(s.flush(), '');
});

test('长得像但不是的东西不动它', () => {
  const s = make();
  const text = '这是 <PANELISTS> 和 <ROUNDABOUT> 还有普通的 <div>。';
  assert.equal(s.strip(text), text);
});

test('flush 会把攒着的半截原样吐出来 —— 不吞用户的字', () => {
  const s = make();
  // 只扣住那个可能是标记开头的 `<`,它前面的字立刻放行(不必要的憋住也是一种闪)
  assert.equal(s.strip('结尾就一个 <'), '结尾就一个 ');
  assert.equal(s.flush(), '<');
});

test('攒着的半截最终不是标记时,原样接回去', () => {
  const s = make();
  assert.equal(s.strip('看这个 <PANE'), '看这个 ');
  // 下一帧证明它不是标记
  assert.equal(s.strip('L 是什么?'), '<PANEL 是什么?');
  assert.equal(s.flush(), '');
});
