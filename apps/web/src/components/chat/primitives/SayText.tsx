/**
 * 壳【内】的纯文字:thinking 落下的段落、`done` 之前的过程叙述(D43)、作废理由(D15)。
 *
 * 壳【外】的结论不走这个组件 —— 那是消息层的 markdown。
 *
 * 没有「流式光标」这个 prop:8/20 21:02 版设计稿把 `.caret` 整个删了,
 * 流式期间没有任何视觉标记,逐字化开由消息层的 reveal 负责(W9)。
 */
import { useRef, type ReactElement } from 'react';
import { useCharReveal } from '../useCharReveal';
import styles from './record.module.css';

export interface SayTextProps {
  text: string;
  /**
   * 这一段是**这一刻还在往里写的那一段**吗。为真时新到的字逐字化开(W9)。
   *
   * 挂在**最后一段** `<p>` 上,不是整块:新字总是落在最后一段的末尾,而
   * `useCharReveal` 按元素记状态 —— 新起一段时那只 `<p>` 是全新的元素,
   * 于是它自己那一段从头化开,不必在段与段之间交接。
   *
   * 思考流那边**不传这个** —— 那一格已经在整只 body 上挂了一次(`ThoughtsRow`),
   * 两处都挂就成了同一段字被拆两遍。
   */
  live?: boolean;
}

/**
 * 空行分段。稿子里推理是**一段一段**的(`.think + .think` 之间留 0.75em),
 * 而我们收到的是一路拼起来的 delta —— 段落边界就在文本里的空行上。
 * 不按空行拆的话,几段推理会粘成一大坨,思考流里尤其明显。
 */
export function SayText({ text, live }: SayTextProps): ReactElement | null {
  // hook 必须无条件调用 —— 空文本的提前返回放在它后面
  const lastRef = useRef<HTMLParagraphElement>(null);
  useCharReveal(lastRef, Boolean(live));

  if (!text.trim()) return null;
  const paragraphs = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return <p ref={lastRef} className={styles.think}>{text.trim()}</p>;
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} ref={i === paragraphs.length - 1 ? lastRef : undefined} className={styles.think}>{p}</p>
      ))}
    </>
  );
}
