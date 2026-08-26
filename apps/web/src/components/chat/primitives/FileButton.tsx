/**
 * 文件名做成可点的按钮 —— 非主产物的文件不另立卡片,**文件名本身就是打开它的入口**
 * (设计稿原话:顺手生成的 csv、md、组件文件都不是这一轮交出去的东西)。
 *
 * 省略规则:主名可以省,**后缀永远可见**,截法在 `runtime/chat/format` 的
 * `elideFileName` 里(纯函数,能单测)。原来这里只写着「等设计答复再加」,
 * 结果长名字被 CSS 的 text-overflow 整块吃掉 —— 行里只剩一个「…」,
 * 后缀没了,同一行的耗时还被顶到行尾。
 *
 * 读屏和 tooltip 给**全名**:省略是给眼睛省地方,不是把信息删掉。
 */
import type { ReactElement } from 'react';
import { elideFileName } from '../../../runtime/chat/format';
import type { FileButtonProps } from './contract';
import styles from './record.module.css';

export function FileButton({ path, label, onOpen, elide }: FileButtonProps): ReactElement {
  /*
   * 只有**文件名**能省略。命令行、grep 模式这些也走这个按钮,但它们不是文件名 ——
   * 拿文件名那套「保后缀 + 中间省略」去截命令,会把 `wc -l a.md transcript.html`
   * 截成 `wc -l a.md tr….html`,读起来像另一条命令。默认不省,由调用方按语义开。
   */
  const shown = elide ? elideFileName(label) : label;
  return (
    <button
      type="button"
      className={styles.file}
      aria-label={`打开 ${label}`}
      title={shown === label ? undefined : label}
      onClick={onOpen ? () => onOpen(path) : undefined}
    >
      <code>{shown}</code>
    </button>
  );
}
