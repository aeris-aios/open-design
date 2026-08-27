/**
 * 产物卡上那两枚胶囊(发布 / 导出)点开的浮层。
 *
 * 设计稿组件 14 只画到胶囊本身;点开之后的样子由产品 2026-08-27 定:
 * 「html 的导出和发布的弹窗,都直接显示在卡片导出发布的按钮附近,动态根据
 *   上下空间判断是显示在按钮上面还是下面」。
 *
 * 两枚共用这一副壳:内容不同(导出是格式,发布是目的地),但「贴着按钮开、
 * 上下自适应、选完即关」是同一件事,分两份写迟早会分叉 —— 上一轮收口消掉的
 * 就是这种两份。
 *
 * **portal 到 body**:卡的动作行是 `position:absolute; z-index:2`,自成一个
 * 层叠上下文,浮层留在里面就永远压不过同样 portal 出去的提示层(见
 * `useAnchoredPopover` 的说明)。坐标因此要自己算。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '../../i18n';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import type { Dict } from '../../i18n/types';
import { Icon, type IconName } from '../Icon';
import styles from './ArtifactActionPopover.module.css';

export interface ArtifactActionItem<T extends string> {
  id: T;
  labelKey: keyof Dict;
  icon: IconName;
}

export function ArtifactActionPopover<T extends string>({
  items,
  onPick,
  triggerTestId,
  popoverTestId,
  itemTestIdPrefix,
  triggerClassName,
  triggerLabel,
  children,
}: {
  items: readonly ArtifactActionItem<T>[];
  onPick: (id: T) => void;
  triggerTestId: string;
  popoverTestId: string;
  itemTestIdPrefix: string;
  triggerClassName: string;
  /** 给读屏用的动作名 —— 触发键本身的可见文字由 `children` 提供。 */
  triggerLabel: string;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { placement, style } = useAnchoredPopover(open, triggerRef, panelRef, {
    // 一行 ~32px + 上下 4px 内边距;只用来定第一帧和翻面,挂上之后按实测走。
    estimatedHeight: items.length * 32 + 8,
    estimatedWidth: 200,
  });

  /*
   * 不能用 `useDismissOnOutsideInteraction` —— 它自己的 docblock 写死了前提:
   * 「Only for popovers whose panel is a DOM descendant of `containerRef`」。
   * 这里面板 portal 出去了,`contains` 会把面板内部的每一次按压都判成「外面」,
   * 于是点自己的菜单项就先把菜单关掉。所以按 `CustomSelect` 的写法:触发键
   * **或**面板里都算内部。
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = useCallback(
    (id: T) => {
      setOpen(false);
      onPick(id);
    },
    [onPick],
  );

  return (
    <span className={`${styles.anchor} artifact-card-act-anchor`}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((value) => !value)}
        data-testid={triggerTestId}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className={styles.popover}
              role="menu"
              aria-label={triggerLabel}
              style={style}
              data-placement={placement}
              data-testid={popoverTestId}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => pick(item.id)}
                  data-testid={`${itemTestIdPrefix}${item.id}`}
                >
                  <span className={styles.icon} aria-hidden>
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
