// @vitest-environment jsdom
/**
 * 红测(W2):音频产出要能进产物卡,用设计稿组件 24 那条胶囊画。
 *
 * 之前记在 `chat-panel-feedback.md` 里的理由是**错的** —— 那条写着「卡在数据层:
 * 契约里没有波形与时长,要产品+后端立项」。可 `AudioArtifact` 从建起来那天就
 * **不依赖契约**:`durationSec` 拿不到就等 `loadedmetadata`,`samples` 没有就按
 * 时长生成一条稳定的伪采样 —— 这两条都写在它自己的 docblock 里。
 *
 * 真正卡住的只有一处准入:`artifactCardKind()` 对 `.mp3` 返回 null,音频根本进不了
 * 产物列表。组件自己的注释也是这么说的:「要让它出现在产物列表里,还要放开那个
 * 准入判断」。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileOpsSummary, artifactCardKind } from '../../src/components/FileOpsSummary';
import type { FileOpEntry } from '../../src/runtime/file-ops';

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (k: string) => k }),
  useT: () => ((k: string) => k),
}));

afterEach(() => cleanup());

const entry = (path: string): FileOpEntry =>
  ({ path, ops: ['write'], status: 'done' } as unknown as FileOpEntry);

describe('W2 · 音频产出进得了产物卡', () => {
  it('admits the audio suffixes', () => {
    expect(artifactCardKind('theme.mp3')).toBe('audio');
    expect(artifactCardKind('voice.wav')).toBe('audio');
    expect(artifactCardKind('note.m4a')).toBe('audio');
    // 反向:别把不认识的后缀也放进来。`artifactCardKind` 这条窄门对 md 返回 null
    // ——「本轮产出」那块更宽的门(`producedArtifactCardKind`)才把它兜成 doc。
    expect(artifactCardKind('readme.md')).toBeNull();
  });

  it('renders the audio capsule rather than a blank thumbnail', () => {
    const { container } = render(
      <FileOpsSummary
        entries={[entry('theme.mp3')]}
        projectId="proj-1"
        onRequestOpenFile={vi.fn()}
      />,
    );
    const card = container.querySelector('[data-testid="artifact-card-theme.mp3"]');
    expect(card, '音频压根没进产物卡').toBeTruthy();
    expect(card?.getAttribute('data-kind')).toBe('audio');
    expect(
      card?.querySelector('audio'),
      '进来了却没用组件 24 那条胶囊画 —— 卡面会是一块空的',
    ).toBeTruthy();
  });
});
