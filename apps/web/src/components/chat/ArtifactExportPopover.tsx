/**
 * 产物卡上〔导出〕的格式浮层(设计稿组件 14 · D28 的下游)。
 *
 * 设计稿只画到「右上角两枚胶囊:发布 / 导出」,没画点下去之后的样子。产品
 * 2026-08-27 补了两条:
 *
 *  1. **贴着按钮开**,不是居中弹窗 —— 上下由剩余空间决定;
 *  2. **只有一种格式的产物直接下载**,压根不到这里来。
 *
 * 第 2 条由 `artifactExportNeedsFormatChoice` 在调用方判掉,所以这个组件只处理
 * 「确实要选」的那一档:今天等价于 HTML 产物(唯一有格式菜单的一支,见
 * `runtime/chat/artifact-export.ts` 的事实源说明)。
 *
 * 文案复用预览区导出菜单的既有 key(`fileViewer.exportPdf` 一族)—— 同一件事
 * 在两处出现,不该有两套说法,也不必为此新开 19 个语言的键。
 */
import { useCallback, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { useDismissOnOutsideInteraction } from '../../hooks/useDismissOnOutsideInteraction';
import { useAnchoredPlacement } from '../../hooks/useAnchoredPlacement';
import {
  artifactExportFormats,
  type ArtifactExportFormat,
} from '../../runtime/chat/artifact-export';
import type { Dict } from '../../i18n/types';
import { Icon, type IconName } from '../Icon';
import styles from './ArtifactExportPopover.module.css';

const FORMAT_LABEL_KEY: Record<ArtifactExportFormat, keyof Dict> = {
  pdf: 'fileViewer.exportPdf',
  image: 'fileViewer.exportImage',
  zip: 'fileViewer.exportZip',
  html: 'fileViewer.exportHtml',
};

const FORMAT_ICON: Record<ArtifactExportFormat, IconName> = {
  pdf: 'file',
  image: 'image',
  zip: 'download',
  html: 'file-code',
};

/** 一行 44px 上下取整,四条 + 上下 padding ≈ 这个数;只用来判上/下,不必精确。 */
const ESTIMATED_POPOVER_HEIGHT = 148;

export function ArtifactExportPopover({
  name,
  onExport,
  testId,
  className,
  children,
}: {
  name: string;
  onExport: (name: string, format: ArtifactExportFormat) => void;
  /** 触发按钮的 testid —— 与直接下载那一档共用同一个,调用方不必分支。 */
  testId: string;
  className: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const placement = useAnchoredPlacement(open, triggerRef, {
    estimatedHeight: ESTIMATED_POPOVER_HEIGHT,
  });
  // 浮层是 `.anchor` 的 DOM 后代,所以这个 hook 的「容器内即算内部」前提成立
  // (它自己的 docblock 交代过:portal 出去的面板不能用它)。
  useDismissOnOutsideInteraction(open, anchorRef, () => setOpen(false));

  const pick = useCallback(
    (format: ArtifactExportFormat) => {
      setOpen(false);
      onExport(name, format);
    },
    [name, onExport],
  );

  const formats = artifactExportFormats(name);

  return (
    <span className={`${styles.anchor} artifact-card-act-anchor`} ref={anchorRef}>
      <button
        type="button"
        ref={triggerRef}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid={testId}
      >
        {children}
      </button>
      {open ? (
        <div
          className={styles.popover}
          role="menu"
          data-placement={placement}
          data-testid="artifact-export-popover"
        >
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => pick(format)}
              data-testid={`artifact-export-format-${format}`}
            >
              <span className={styles.icon} aria-hidden>
                <Icon name={FORMAT_ICON[format]} size={14} />
              </span>
              <span>{t(FORMAT_LABEL_KEY[format])}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
