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

/**
 * 样本逐字取自真实录制 `.od/runs/81e03cea-…/events.jsonl` 的一条 `text_delta`。
 *
 * 之前这条测试写的是 `<MUSTFIX>`(没有下划线)—— 那个拼法在真实数据里
 * **一次都没出现过**,它是照着 `CRITIQUE_INLINE_TAGS` 里的笔误写的,
 * 于是测试和实现一起错,红不起来。真实语法是 `MUST_FIX`:
 * prompt 在 `src/prompts/panel.ts`,解析器在 `src/critique/parsers/v1.ts`
 * (`MUST_FIX_RE`),fixtures 也全是 `MUST_FIX`。
 */
const REAL_DELTA = '<PANELIST role="Critic" score="8.4"><MUST_FIX id="R1-C1">移除标题与引语的强制换行，避免窄屏孤行。</MUST_FIX></PANELIST>';

test('MUST_FIX / RESOLVED 这类内联标记只脱壳,留住里面的话', () => {
  const s = make();
  const out = s.strip(REAL_DELTA);
  assert.equal(out.includes('<MUST_FIX'), false);
  assert.equal(out.includes('</MUST_FIX'), false);
  // 属性碎片也不许剩
  assert.equal(out.includes('id="R1-C1"'), false);
  assert.equal(out.includes('移除标题与引语的强制换行'), true);
});

test('MUST_FIX 被流式切成两半:既不闪半截,也要剥干净', () => {
  const s = make();
  // 切在标签名中间 —— 下划线正好落在第二片里
  const first = s.strip('先说一句。<MUST');
  assert.equal(first, '先说一句。');
  assert.equal(first.includes('<MUST'), false);

  const second = s.strip('_FIX id="R1-C1">移除强制换行。</MUST_FIX>收工。');
  assert.equal(second.includes('<MUST_FIX'), false);
  assert.equal(second.includes('MUST'), false);
  assert.equal(second.includes('移除强制换行。'), true);
  assert.equal(second.includes('收工。'), true);
  assert.equal(s.flush(), '');
});

test('被流式切成两半:半截标签一个字都不许露出来', () => {
  const s = make();
  assert.equal(s.strip('先说一句。<PANE'), '先说一句。');
  assert.equal(s.strip('LIST role="Critic">很好。</PANELIST>'), '很好。');
  assert.equal(s.flush(), '');
});

/*
 * 正面对照 —— 防的是「凡是尖括号一律删掉」这种糊弄式修法。
 * 少了这一条,把 TAG_RE 换成 `/<[^>]*>/g` 也能让上面那几条变绿。
 */
test('长得像但不是的东西不动它', () => {
  const s = make();
  const text = '这是 <PANELISTS> 和 <ROUNDABOUT> 还有 <MUST_FIXED> 以及普通的 <div>。'
    + '正文里裸写 MUST_FIX 这个词(没有尖括号)也要留着,还有 a<b、5 < 7。';
  assert.equal(s.strip(text), text);
  assert.equal(s.flush(), '');
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
