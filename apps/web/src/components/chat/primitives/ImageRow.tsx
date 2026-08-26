/**
 * 生图行 —— 组件 12。执行记录里唯一「没跑完也要显形」的一行(D3 的例外)。
 *
 * 为什么它能例外:要出几张是从命令里数出来的(`media generate` 出现几次就是几张),
 * 所以第一张还没出来的时候就知道该摆几个格子,「出一张落一张」才成立。
 * 别的工具调用没有这种先验,只能等结果回来才落行。
 *
 * 三种样子的切换时机是设计同学定的(D34):
 *   还没出完      球 + 「N/M」+ 一排大格,没出的格是占位
 *   全出完、没失败 收成一行 + 小缩略图条 + 耗时
 *   出完了有失败   仍是大格,失败那格给「重试」,**不收行** —— 收了就没地方放重试
 */
import type { ReactElement } from 'react';
import { useT } from '../../../i18n';
import type { ImageRow as ImageRowData } from '../../../runtime/chat/contract';
import { formatElapsed } from '../../../runtime/chat/format';
import { ImageIcon, RetryIcon } from './icons';
import { Orb } from './Orb';
import styles from './record.module.css';

export interface ImageRowProps {
  row: ImageRowData;
  /** 重试第 n 张(从 0 数)。不给就只画不点 —— 与工具行的「失败」按钮同一条约定 */
  onRetry?: (row: ImageRowData, index: number) => void;
  /** 点缩略图看大图 */
  onOpenImage?: (path: string, index: number) => void;
}

export function ImageRow({ row, onRetry, onOpenImage }: ImageRowProps): ReactElement {
  const t = useT();
  const settled = !row.pending && row.done + row.failed >= row.total;

  /* 全出完且一张没砸:收成一行 */
  if (settled && row.failed === 0) {
    return (
      <div className={styles.tool}>
        <span className={styles.icon}><ImageIcon /></span>
        <span className={styles.name}>
          {t('chat.record.imageBatch')} · {t('chat.record.imageCount', { count: row.total })}
        </span>
        <span className={styles.strip}>
          {Array.from({ length: row.total }, (_, i) => {
            const path = row.thumbs[i];
            const label = t('chat.record.viewImage', { index: i + 1 });
            return (
              <button
                key={i}
                type="button"
                className={styles.th}
                aria-label={label}
                onClick={path && onOpenImage ? () => onOpenImage(path, i) : undefined}
              >
                <span className={styles.mini} />
              </button>
            );
          })}
        </span>
        {formatElapsed(row.elapsedMs) ? <span className={styles.meta}>{formatElapsed(row.elapsedMs)}</span> : null}
      </div>
    );
  }

  /* 还在出,或者出完了有失败:大格形态 */
  return (
    <>
      <div className={styles.tool}>
        {row.pending
          ? <Orb state="solving" box={15} label={t('chat.record.running')} className={styles.mark} />
          : <span className={styles.icon}><ImageIcon /></span>}
        <span className={styles.name}>{t('chat.record.imageBatch')}</span>
        <span className={`${styles.meta} ${styles.num}`}>{row.done}/{row.total}</span>
      </div>
      <div className={styles.imgs}>
        {Array.from({ length: row.total }, (_, i) => {
          if (i < row.done) return <span key={i} className={styles.shot}><span className={styles.mini} /></span>;
          if (i < row.done + row.failed) {
            const inner = <><RetryIcon />{t('chat.record.retry')}</>;
            return (
              <span key={i} className={`${styles.shot} ${styles.fail}`}>
                {onRetry
                  ? <button type="button" className={styles.retry} onClick={() => onRetry(row, i)}>{inner}</button>
                  : <span className={styles.retry}>{inner}</span>}
              </span>
            );
          }
          // 还没出来的格子。设计稿这里是「像素液体」动效(pixel-liquid.js),尚未接入
          return <span key={i} className={`${styles.shot} ${styles.load}`} />;
        })}
      </div>
    </>
  );
}
