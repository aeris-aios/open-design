/**
 * 「回到最新」那颗浮标什么时候该在。
 *
 * 为什么单独拿出来:同一个判据原来**在 `ChatPane` 里写死了四遍**(`distance > 120`),
 * 滚动、切回会话、恢复滚动位置、导航到某一轮各写一处 —— 改一个门槛要同时改四处,
 * 漏一处就自相矛盾。这里给一份,四处都调它。
 *
 * 门槛按**视口高度**算,不钉像素:用户 2026-08-27 说「总是有事没事就出现,
 * 只有在很上面时才出现不行吗」。而「很上面」在 400px 的窄面板和 1200px 的宽面板上
 * 本来就不是同一个像素数 —— 钉死 120px 的结果是,随手滚半屏它就浮出来压在
 * 回合状态行上。
 *
 * 出和收用两个门槛(迟滞):只有一个门槛时,停在临界点附近的轻微滚动会让它反复闪。
 */

/** 要滚过视口的这个比例才算「很上面」。 */
const SHOW_RATIO = 0.75;
/** 收起时放宽到这个比例 —— 差出来的这一段就是迟滞。 */
const HIDE_RATIO = 0.5;
/** 面板再矮也得滚过这么多才给入口,免得小窗口里它又变得很敏感。 */
const MIN_SHOW_PX = 320;
/** 面板再高也不该要求滚过好几屏 —— 超过这个距离一律算「很上面」。 */
const MAX_SHOW_PX = 1200;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export interface JumpToLatestInput {
  /** 离底部还有多远(`scrollHeight - scrollTop - clientHeight`)。 */
  distance: number;
  /** 滚动容器的可视高度。 */
  clientHeight: number;
  /** 此刻是不是已经显示着 —— 迟滞要用。 */
  shown: boolean;
}

export function shouldShowJumpToLatest({
  distance,
  clientHeight,
  shown,
}: JumpToLatestInput): boolean {
  const height = Number.isFinite(clientHeight) && clientHeight > 0 ? clientHeight : 0;
  const showAt = clamp(height * SHOW_RATIO, MIN_SHOW_PX, MAX_SHOW_PX);
  if (!shown) return distance > showAt;
  // 已经在显示:门槛放低,往下滚一点不会立刻消失。
  const hideAt = clamp(height * HIDE_RATIO, MIN_SHOW_PX / 2, MAX_SHOW_PX);
  return distance > hideAt;
}
