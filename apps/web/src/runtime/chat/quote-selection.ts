/**
 * 正文取词(设计稿组件 23)的**纯判据**。
 *
 * 放在这一层是为了能脱离 DOM 测:浮条翻不翻面、选中的字要不要收、
 * 多段选择怎么合并计数 —— 这些都是规则,不是画法。
 */

/** 一条被「添加到对话」的引用 */
export interface ChatQuote {
  id: string;
  /** 选中的原文(已折叠空白) */
  text: string;
  /** 出自哪条助手消息 —— 之后要回跳定位就靠它 */
  messageId: string;
}

/**
 * 浮条摆在选区上方还是下方。
 *
 * 稿子第 23-2 格:「选区贴着面板顶边 · 浮条翻到下方」。
 * 判据是**上方放不下就翻**,不是「离顶多少像素」这种拍脑袋的阈值 ——
 * 浮条自己的高度 + 和选区之间那 7px 缝(稿子 `.selbar { bottom: calc(100% + 7px) }`)
 * 就是它需要的空间。
 */
export function quoteBarPlacement(input: {
  /** 选区矩形的上边(视口坐标) */
  selectionTop: number;
  /** 聊天面板可视区的上边(视口坐标) */
  panelTop: number;
  /** 浮条高度,默认按稿子的 3px 内距 + 28px 按钮算 */
  barHeight?: number;
  /** 浮条与选区之间的缝,稿子是 7px */
  gap?: number;
}): 'above' | 'below' {
  const bar = input.barHeight ?? 34;
  const gap = input.gap ?? 7;
  return input.selectionTop - input.panelTop < bar + gap ? 'below' : 'above';
}

/**
 * 选中的文字规整成一条引用的正文。
 *
 * 跨行选择会带进换行和缩进,原样塞进输入框既难读也难比对;
 * 折成单行、掐掉首尾空白就够 —— 全文在 hover 的浮层里能看到(稿子第 23-4 格)。
 */
export function normalizeQuoteText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** 值得添加吗:空白、或者只选中了一两个字符,都不值得占一枚芯片 */
export function isQuotable(raw: string): boolean {
  return normalizeQuoteText(raw).length >= 2;
}

/**
 * 同一段话被选两次不重复入列 —— 判据是**规整之后的正文**,
 * 不是选区对象(同一句话第二次选,DOM Range 是新的,文字是同一句)。
 */
export function appendQuote(quotes: ChatQuote[], next: ChatQuote): ChatQuote[] {
  const key = normalizeQuoteText(next.text);
  if (quotes.some((q) => normalizeQuoteText(q.text) === key)) return quotes;
  return [...quotes, next];
}
