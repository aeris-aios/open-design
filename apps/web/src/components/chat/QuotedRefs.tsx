/**
 * 引用芯片(设计稿组件 23 · 第 67 / 68 / 69 格)。
 *
 * 一枚芯片装**所有**引用,写着「N 条注释」—— 稿子第 69 格的意义就是证明
 * 「一条和五条一样高」:条数只改数字,不改高度。全文在 hover 的浮层里按序号列出来。
 */
import type { ReactElement } from 'react';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import type { ChatQuote } from '../../runtime/chat/quote-selection';
import styles from './QuotedRefs.module.css';

export interface QuotedRefsProps {
  quotes: ChatQuote[];
  onClear: () => void;
}

export function QuotedRefs({ quotes, onClear }: QuotedRefsProps): ReactElement | null {
  const t = useT();
  if (quotes.length === 0) return null;
  return (
    <span className={styles.refs} data-testid="chat-quoted-refs">
      {/* 稿子 `.refs .ic` 是**描边的对话气泡**,不是实心引号。
          原来这里画的是 ❝ —— 用户第一眼就问「注释的样式怎么是这样的??」。
          气泡说的是「这是从对话里摘出来的一段」,引号说的是「这是引文」;
          稿子选的是前者,而这一族的其它记号(浮条、芯片)也都是描边的。 */}
      <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M20 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h12a2 2 0 012 2z" />
      </svg>
      <span>{t('chat.quote.count', { count: quotes.length })}</span>
      <button
        type="button"
        className={styles.remove}
        onClick={onClear}
        aria-label={t('chat.quote.removeAria')}
        title={t('chat.quote.removeAria')}
      >
        {/* 稿子 `.del svg { width: 10px; height: 10px }` */}
        <Icon name="close" size={10} />
      </button>
      <span className={styles.pop}>
        <ol>
          {quotes.map((q) => (
            <li key={q.id}>
              <span>{q.text}</span>
            </li>
          ))}
        </ol>
      </span>
    </span>
  );
}
