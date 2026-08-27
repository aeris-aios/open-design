/**
 * 「这份产物能发到哪儿去」—— 产物卡上那枚〔发布〕的浮层内容。
 *
 * ## 稿子没规定这一层
 *
 * 全稿 24 个组件里,「发布」**只**在组件 14 的卡上出现过一次,散文只交代了它
 * 是什么意思:「『导出』下载到本地」「『发布』说的是"送出去"」。点下去长什么样、
 * 里面有几条,稿子一个字都没写。
 *
 * 所以这一层的规格来自两处:
 *  1. 产品 2026-08-27:「html 的导出和发布的弹窗,都直接显示在卡片导出发布的
 *     按钮附近,动态根据上下空间判断是显示在按钮上面还是下面」——**位置**;
 *  2. 稿子撤掉卡上「⋯」时给的那条理由:「这张卡上要做的事本来就只有两件」
 *     ——**分量**。卡是一张 16:10 的小图,不该挂一块和预览区一样大的面板。
 *
 * ## 于是卡上只给「去哪儿发」
 *
 * 预览区那块分享面板里还有:工作区可见性(私有 / 成员)、已发布链接的复制与
 * 撤销、分享页的复制与打开、社交分享、存为模板。这些**不是**「送出去」,是
 * 链接管理和项目设置;而且它们全都要 `filePublished` / `sharePageUrl` /
 * `deploymentsByProvider` 这类只有文件打开之后才存在的 viewer 状态。卡上给不了,
 * 也不该给 —— 那会变成第二份分享面板,正是这次收口要消掉的东西。
 *
 * 卡上留下的就是目的地本身:OD 公开链接、以及部署商。
 *
 * ## 不另抄一份部署商名单
 *
 * `DEPLOY_PROVIDER_IDS` 是仓库里那份名单的出处(`providers/registry.ts`),
 * 预览区的 `DEPLOY_PROVIDER_OPTIONS` 也是照它排的。这里直接引它 —— 加一家
 * 部署商时两处一起长出来,不会有一边多一条的那种漂移。
 */
import {
  DEPLOY_PROVIDER_IDS,
  type WebDeployProviderId,
} from '../../providers/registry';
import type { Dict } from '../../i18n/types';

/** OD 托管的单文件公开链接 —— 不是部署商,单独一档。 */
export const PUBLIC_LINK_TARGET = 'public-link';

export type ArtifactPublishTarget = typeof PUBLIC_LINK_TARGET | WebDeployProviderId;

/** 目的地的名字用预览区已有的 key,同一件事不该有两套说法。 */
const DEPLOY_PROVIDER_LABEL_KEY: Record<WebDeployProviderId, keyof Dict> = {
  'vercel-self': 'fileViewer.vercelProvider',
  'cloudflare-pages': 'fileViewer.cloudflarePagesProvider',
};

export function artifactPublishTargetLabelKey(
  target: ArtifactPublishTarget,
): keyof Dict {
  return target === PUBLIC_LINK_TARGET
    ? 'fileViewer.publishSingleFileTitle'
    : DEPLOY_PROVIDER_LABEL_KEY[target];
}

/**
 * 这张卡能发到哪儿。
 *
 * `canPublishPublicLink` 由调用方用 `canPublishPublicFile(workspaceContext)`
 * 算出来 —— 个人本地项目没有工作区身份,发不出 OD 公开链接,那一条就不出;
 * 部署商永远在(要不要配 token 是弹窗里的事,不是这一层的事)。
 */
export function artifactPublishTargets(opts: {
  canPublishPublicLink: boolean;
}): readonly ArtifactPublishTarget[] {
  return [
    ...(opts.canPublishPublicLink ? [PUBLIC_LINK_TARGET as ArtifactPublishTarget] : []),
    ...DEPLOY_PROVIDER_IDS,
  ];
}
