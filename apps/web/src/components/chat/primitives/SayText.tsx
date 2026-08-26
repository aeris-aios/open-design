/**
 * 壳【内】的纯文字:thinking 落下的段落、`done` 之前的过程叙述(D43)、作废理由(D15)。
 *
 * 壳【外】的结论不走这个组件 —— 那是消息层的 markdown。
 *
 * 没有「流式光标」这个 prop:8/20 21:02 版设计稿把 `.caret` 整个删了,
 * 流式期间没有任何视觉标记,逐字化开由消息层的 reveal 负责(W9)。
 */
import type { ReactElement } from 'react';
import styles from './record.module.css';

export interface SayTextProps { text: string }

/**
 * 空行分段。稿子里推理是**一段一段**的(`.think + .think` 之间留 0.75em),
 * 而我们收到的是一路拼起来的 delta —— 段落边界就在文本里的空行上。
 * 不按空行拆的话,几段推理会粘成一大坨,思考流里尤其明显。
 */
export function SayText({ text }: SayTextProps): ReactElement | null {
  if (!text.trim()) return null;
  const paragraphs = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return <p className={styles.think}>{text.trim()}</p>;
  return (
    <>
      {paragraphs.map((p, i) => <p key={i} className={styles.think}>{p}</p>)}
    </>
  );
}
