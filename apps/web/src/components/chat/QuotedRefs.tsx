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
      <svg className={styles.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M4.58341 17.3211C3.55316 16.2274 3 15 3 13.0104C3 9.51092 5.45651 6.37372 9.03059 4.82324L9.92328 6.20073C6.58804 8.00532 5.93618 10.3459 5.67564 11.8202C6.21263 11.5433 6.91558 11.4463 7.60471 11.5102C9.40908 11.6776 10.8312 13.1591 10.8312 15C10.8312 16.933 9.26416 18.5 7.33116 18.5C6.2581 18.5 5.23196 18.0095 4.58341 17.3211ZM14.5834 17.3211C13.5532 16.2274 13 15 13 13.0104C13 9.51092 15.4565 6.37372 19.0306 4.82324L19.9233 6.20073C16.588 8.00532 15.9362 10.3459 15.6756 11.8202C16.2126 11.5433 16.9156 11.4463 17.6047 11.5102C19.4091 11.6776 20.8312 13.1591 20.8312 15C20.8312 16.933 19.2642 18.5 17.3312 18.5C16.2581 18.5 15.232 18.0095 14.5834 17.3211Z" />
      </svg>
      <span>{t('chat.quote.count', { count: quotes.length })}</span>
      <button
        type="button"
        className={styles.remove}
        onClick={onClear}
        aria-label={t('chat.quote.removeAria')}
        title={t('chat.quote.removeAria')}
      >
        <Icon name="close" size={11} />
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
