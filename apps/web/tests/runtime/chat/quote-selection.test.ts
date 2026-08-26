/**
 * 正文取词的纯判据。这一层不碰 DOM,所以能把规则一条条钉死。
 */
import { describe, expect, it } from 'vitest';
import {
  appendQuote,
  isQuotable,
  normalizeQuoteText,
  quoteBarPlacement,
} from '../../../src/runtime/chat/quote-selection';

describe('浮条翻面(稿子 23-1 / 23-2)', () => {
  it('上方放得下就摆上方', () => {
    expect(quoteBarPlacement({ selectionTop: 400, panelTop: 100 })).toBe('above');
  });

  it('选区贴着面板顶边,上方放不下,翻到下方', () => {
    expect(quoteBarPlacement({ selectionTop: 110, panelTop: 100 })).toBe('below');
  });

  it('判据是「浮条高度 + 那道缝」,不是拍脑袋的阈值', () => {
    // 正好差一像素放不下 → 翻
    expect(quoteBarPlacement({ selectionTop: 140, panelTop: 100, barHeight: 34, gap: 7 })).toBe('below');
    // 正好放得下 → 不翻
    expect(quoteBarPlacement({ selectionTop: 141, panelTop: 100, barHeight: 34, gap: 7 })).toBe('above');
  });
});

describe('选中的文字', () => {
  it('跨行选择折成单行', () => {
    expect(normalizeQuoteText('商品卡已经\n  抽成共享组件 ')).toBe('商品卡已经 抽成共享组件');
  });

  it('空白和一两个字符不值得占一枚芯片', () => {
    expect(isQuotable('   ')).toBe(false);
    expect(isQuotable('好')).toBe(false);
    expect(isQuotable('好的')).toBe(true);
  });
});

describe('入列', () => {
  const q = (id: string, text: string) => ({ id, text, messageId: 'm1' });

  it('同一段话选两次只进一条 —— 判据是规整后的正文,不是 Range 对象', () => {
    const once = appendQuote([], q('a', '商品卡已经抽成共享组件'));
    const twice = appendQuote(once, q('b', '  商品卡已经抽成共享组件 '));
    expect(twice).toHaveLength(1);
    expect(twice[0]?.id).toBe('a');
  });

  it('不同的段落各占一条(稿子 23-5:只是数字变)', () => {
    let list = appendQuote([], q('a', '第一段'));
    list = appendQuote(list, q('b', '第二段'));
    list = appendQuote(list, q('c', '第三段'));
    expect(list).toHaveLength(3);
  });
});
