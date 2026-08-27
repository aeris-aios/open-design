/**
 * 卡上那份「发到哪儿」的名单,和仓库里唯一那份部署商名单钉在一起。
 *
 * 预览区的分享面板照 `DEPLOY_PROVIDER_IDS` 排,卡上的浮层也照它排 —— 加一家
 * 部署商时两处一起长出来。哪天有人只在一边加,这里当场红。
 */
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_LINK_TARGET,
  artifactPublishTargetLabelKey,
  artifactPublishTargets,
} from '../../../src/runtime/chat/artifact-publish';
import { DEPLOY_PROVIDER_IDS } from '../../../src/providers/registry';

describe('产物卡的发布目的地', () => {
  it('部署商那一段就是 DEPLOY_PROVIDER_IDS,顺序也一样', () => {
    const targets = artifactPublishTargets({ canPublishPublicLink: true });
    expect(targets.filter((t) => t !== PUBLIC_LINK_TARGET)).toEqual([...DEPLOY_PROVIDER_IDS]);
  });

  it('有工作区身份才给 OD 公开链接那一条', () => {
    expect(artifactPublishTargets({ canPublishPublicLink: true })).toContain(PUBLIC_LINK_TARGET);
    // 反向对照:去掉之后**只**少这一条,部署商还在 —— 不许整份名单一起消失
    const without = artifactPublishTargets({ canPublishPublicLink: false });
    expect(without).not.toContain(PUBLIC_LINK_TARGET);
    expect(without).toEqual([...DEPLOY_PROVIDER_IDS]);
  });

  it('每个目的地都有文案 key,而且复用预览区已有的那几个', () => {
    for (const target of artifactPublishTargets({ canPublishPublicLink: true })) {
      const key = artifactPublishTargetLabelKey(target);
      expect(key, `${target} 没有文案 key`).toBeTruthy();
      // 全部落在 fileViewer.* —— 同一件事不该有两套说法,也不必新开 19 个语言的键
      expect(key.startsWith('fileViewer.')).toBe(true);
    }
  });
});
