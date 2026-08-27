// @vitest-environment jsdom
/**
 * 队列行底下那一排**计数芯片**(`QueuedSendMetaChips`)的文案。
 *
 * 这排芯片是「所见即所发」的信任面 —— 它告诉人这条排队的话会带着几个附件、
 * 几处标记、几个插件 / 技能 / MCP / 连接器 / 上下文一起发出去。既然是给人看的字,
 * 它就得跟界面其余部分说同一种语言。
 *
 * 原来它是在组件里现拼的英文,而且复数靠 `word + 's'` 手搓:
 *
 *     const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
 *
 * 两处坏:
 *   1. 中文界面里会蹦出「1 workspace context」这种半句英文;
 *   2. 加 `s` 这条规则在 19 个语言里大多数是错的 —— 中日韩根本没有复数形态,
 *      俄语 / 波兰语 / 乌克兰语 / 阿拉伯语有好几档复数。
 *
 * 所以这几条用例守三件事:
 *   · 字必须从词典里取(用生产的 `tForLanguageTag` 解析,不跟硬编码字面量比);
 *   · 单复数是**词典挑 key**(One / Many 两条),不是代码拼 `s`;
 *   · 七种上下文该出的还得出、顺序和数字都不能变(否则「什么都不渲染」也能骗过前两条)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider, tForLanguageTag } from '../../../src/i18n';
import { QueuedSendStrip } from '../../../src/components/ChatPane';
import type { Locale } from '../../../src/i18n/types';

type StripProps = Parameters<typeof QueuedSendStrip>[0];
type QueuedItem = StripProps['items'][number];

// 这个配置没开自动 cleanup(同 queue-steer.test.tsx),不清的话上一条用例的 DOM 还挂着。
afterEach(cleanup);

function translatorFor(locale: Locale) {
  const t = tForLanguageTag(locale);
  expect(t, `拿不到 ${locale} 的翻译器`).not.toBeNull();
  return t!;
}

function mark(id: string) {
  return {
    id,
    order: 1,
    filePath: 'index.html',
    elementId: 'hero-title',
    selector: '[data-od-id="hero-title"]',
    label: 'h1.hero-title',
    comment: '标题短一点',
    currentText: '一个很长的标题',
    pagePosition: { x: 12, y: 44, width: 500, height: 60 },
    htmlHint: '<h1 data-od-id="hero-title">',
  };
}

/** 七种上下文一次全带上,数量各不相同,好把「顺序」和「单复数」一起照出来。 */
function richItem(): QueuedItem {
  return {
    id: 'q1',
    prompt: '把首屏文案改短一点',
    attachments: [
      { path: 'a.png', name: 'a.png', kind: 'image' },
      { path: 'b.png', name: 'b.png', kind: 'image' },
    ],
    commentAttachments: [mark('c1')],
    meta: {
      context: {
        pluginIds: ['plugin-1'],
        skillIds: ['skill-1', 'skill-2'],
        mcpServerIds: ['mcp-1'],
        connectorIds: ['conn-1', 'conn-2'],
        workspaceItems: [{ id: 'w1', kind: 'design-files', label: 'Design files' }],
      },
    },
  } as QueuedItem;
}

function chipsFor(item: QueuedItem, locale: Locale): string[] {
  const { container } = render(
    <I18nProvider initial={locale}>
      <QueuedSendStrip items={[item]} />
    </I18nProvider>,
  );
  return Array.from(container.querySelectorAll('.chat-queued-send-chip')).map(
    (el) => (el.textContent ?? '').trim(),
  );
}

describe('队列行的计数芯片', () => {
  it('英文下七种上下文各出一枚,顺序和数字都对得上', () => {
    const t = translatorFor('en');
    // 顺序就是稿子里这一排的读法:先「带了什么东西」,再「挂了什么能力」。
    expect(chipsFor(richItem(), 'en')).toEqual([
      t('chat.queuedChipFilesMany', { n: 2 }),
      t('chat.queuedChipMarksOne', { n: 1 }),
      t('chat.queuedChipPluginsOne', { n: 1 }),
      t('chat.queuedChipSkillsMany', { n: 2 }),
      t('chat.queuedChipMcpOne', { n: 1 }),
      t('chat.queuedChipConnectorsMany', { n: 2 }),
      t('chat.queuedChipContextOne', { n: 1 }),
    ]);
  });

  it('中文下整排都走词典,一个英文词都不许漏出来', () => {
    const t = translatorFor('zh-CN');
    const chips = chipsFor(richItem(), 'zh-CN');

    expect(chips).toEqual([
      t('chat.queuedChipFilesMany', { n: 2 }),
      t('chat.queuedChipMarksOne', { n: 1 }),
      t('chat.queuedChipPluginsOne', { n: 1 }),
      t('chat.queuedChipSkillsMany', { n: 2 }),
      t('chat.queuedChipMcpOne', { n: 1 }),
      t('chat.queuedChipConnectorsMany', { n: 2 }),
      t('chat.queuedChipContextOne', { n: 1 }),
    ]);

    // 上面那条只证明「组件和词典对上了」;这条才证明词典里装的不是英文。
    // MCP 是产品名,中文里照样写 MCP,所以单独放行。
    const english = /\b(files?|marks?|plugins?|skills?|connectors?|workspace|context)\b/i;
    for (const chip of chips) {
      const withoutProductName = chip.replace(/MCP/g, '');
      expect(withoutProductName, `中文界面里漏出了英文:「${chip}」`).not.toMatch(english);
    }
    // 最扎眼的那一枚:`workspaceItems` 是内部字段名,绝不能原样端给用户。
    expect(chips[6]).not.toBe('1 workspace context');
  });

  it('单复数由词典挑 key,不是代码里拼 s', () => {
    const one = { id: 'q1', prompt: '改短', attachments: [{ path: 'a.png', name: 'a.png', kind: 'image' }] } as QueuedItem;
    const two = {
      id: 'q2',
      prompt: '改短',
      attachments: [
        { path: 'a.png', name: 'a.png', kind: 'image' },
        { path: 'b.png', name: 'b.png', kind: 'image' },
      ],
    } as QueuedItem;

    const tEn = translatorFor('en');
    expect(chipsFor(one, 'en')).toEqual([tEn('chat.queuedChipFilesOne', { n: 1 })]);
    expect(chipsFor(two, 'en')).toEqual([tEn('chat.queuedChipFilesMany', { n: 2 })]);
    // 英文这两条本来就该长得不一样,否则 One / Many 分家就没意义。
    expect(tEn('chat.queuedChipFilesOne', { n: 1 })).not.toBe(tEn('chat.queuedChipFilesMany', { n: 1 }));

    // 中文没有复数形态:1 和 2 只该差在数字上,名词一个字都不该变。
    // 手搓 `+ 's'` 永远做不到这一点 —— 这是这条用例真正的抓手。
    const [zhOne] = chipsFor(one, 'zh-CN');
    const [zhTwo] = chipsFor(two, 'zh-CN');
    expect(zhOne?.replace('1', '#')).toBe(zhTwo?.replace('2', '#'));

    // 俄语反过来:单复数是两个不同的词,加 s 也永远做不到。
    const tRu = translatorFor('ru');
    expect(chipsFor(one, 'ru')).toEqual([tRu('chat.queuedChipFilesOne', { n: 1 })]);
    expect(chipsFor(two, 'ru')).toEqual([tRu('chat.queuedChipFilesMany', { n: 2 })]);
  });

  it('什么都没带的那一行不渲染这一排', () => {
    const { container } = render(
      <I18nProvider initial="zh-CN">
        <QueuedSendStrip items={[{ id: 'plain', prompt: '再紧凑一点' }]} />
      </I18nProvider>,
    );
    expect(container.querySelector('.chat-queued-send-chips')).toBeNull();
    expect(container.querySelectorAll('.chat-queued-send-chip')).toHaveLength(0);
    // 但这一行本身还在 —— 别把「不渲染芯片」做成「不渲染队列」。
    expect(container.querySelectorAll('[data-testid="chat-queued-send-row"]')).toHaveLength(1);
  });

  it('插件快照那条路也算一个插件', () => {
    const t = translatorFor('en');
    const snapshot = {
      id: 'q3',
      prompt: '按这个插件来',
      meta: { appliedPluginSnapshot: { pluginId: 'p1', snapshotId: 's1' } },
    } as QueuedItem;
    expect(chipsFor(snapshot, 'en')).toEqual([t('chat.queuedChipPluginsOne', { n: 1 })]);
  });
});
