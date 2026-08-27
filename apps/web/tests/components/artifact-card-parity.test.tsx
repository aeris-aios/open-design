// @vitest-environment jsdom

/**
 * 产物卡的**两条渲染路径必须长一样**,而且要长成设计稿的样子。
 *
 * `AssistantMessage` 有两条互斥的产物面板:
 *  · 这一轮有 write/edit 工具行 → `FileOpsSummary`
 *  · 没有工具行但有产出/找回的文件 → `ProducedFiles`
 * 它们在 P0 `recvqaerXd82bE` 之后变成了「不同时出」,但**没有变成一致** ——
 * 卡面形状、按钮集合、导出行为各写了一份。
 *
 * 权威是 `docs/design/chat-panel-next.html` 组件 14(修订 `1bbdce0b06`,
 * md5 `28ea4c65…`),它的 `.cmp-ops` 散文和 `components.css` 注释就是规格:
 *  · 动作明摆在**右上角**,两枚:发布 / 导出。不收进菜单,不看第几轮。
 *  · **发布只有 HTML 产物有**;md / csv / 图片 / 视频那类右上角只剩一枚「导出」。
 *  · 「发布」是**纯文字**,只有「导出」带那枚圈中向下箭头 —— 稿子原话:
 *    「两个方向相反的动作并排,给其中一个加上方向,那一排就不必逐字读了」。
 *  · 没有「预览」,没有「⋯」。
 *
 * 稿子里**没有任何**「只有最后一轮才给动作」的说法。
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssistantMessage } from '../../src/components/AssistantMessage';
import { FileOpsSummary } from '../../src/components/FileOpsSummary';
import { CollabProvider } from '../../src/collab/collab-context';
import type { ChatMessage, ProjectFile } from '../../src/types';
import type { FileOpEntry } from '../../src/runtime/file-ops';
import { workspaceContextFixture } from '../helpers/workspace-context';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const PROJECT_ID = 'c7e3b234-2fb3-4f6e-8aae-a3a00697c476';

function projectCollabValue() {
  return {
    workspaceContext: workspaceContextFixture({
      workspaceId: 'workspace-a',
      workspaceMemberId: 'member-a',
    }),
    workspaceContextLoading: false,
    enabled: false,
    member: null,
    present: [],
    publishedVersion: null,
    syncState: null,
    viewerOnly: false,
    writerAuthority: 'allowed' as const,
    isOwner: false,
    isEffectiveOwner: true,
    isSharedNonOwner: false,
    ownerDisplayName: null,
    ownerRole: null,
    downloadPending: false,
    reportChange: vi.fn(),
    requestPublish: vi.fn(),
    refreshPresence: vi.fn(),
    checkStatusNow: vi.fn(),
  };
}

const RUN_STARTED_AT = 1787794097356;
const RUN_ENDED_AT = 1787794110470;

/**
 * 夹具照抄真机 `produced_files_json`(见
 * `AssistantMessage.produced-card-turn-scope.test.tsx` 的同一条注释):
 * `producedFiles` 的元素是 **`ProjectFile` 对象**,不是字符串 —— 塞字符串会在
 * `f.name.toLowerCase()` 上把整个会话视图炸掉。
 */
function projectFile(name: string, overrides: Partial<ProjectFile> = {}): ProjectFile {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const kind =
    ext === 'html' ? 'html'
    : ext === 'png' || ext === 'jpg' ? 'image'
    : ext === 'mp4' ? 'video'
    : ext === 'mp3' || ext === 'wav' ? 'audio'
    : 'text';
  return {
    name,
    path: name,
    localPath: `/Users/elian/.od/projects/${PROJECT_ID}/${name}`,
    type: 'file',
    size: 8961,
    mtime: RUN_STARTED_AT + 2_000,
    kind,
    mime: 'application/octet-stream',
    ...overrides,
  } as ProjectFile;
}

function fileOpEntry(path: string): FileOpEntry {
  return {
    path,
    fullPath: `/repo/${path}`,
    ops: ['write'],
    opCounts: { read: 0, write: 1, edit: 0, delete: 0 },
    total: 1,
    status: 'done',
  };
}

/** 有工具行的那一轮 —— 走 `FileOpsSummary`。 */
function toolOpTurn(names: string[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  const events: unknown[] = [{ kind: 'status', label: 'starting', detail: 'claude' }];
  for (const [index, name] of names.entries()) {
    events.push({
      kind: 'tool_use',
      id: `toolu_${index}`,
      name: 'Write',
      input: { file_path: `/Users/elian/.od/projects/${PROJECT_ID}/${name}`, content: 'x' },
    });
    events.push({ kind: 'tool_result', id: `toolu_${index}`, content: 'ok' });
  }
  events.push({ kind: 'text', text: '做完了。' });
  return {
    id: 'msg-tool-ops',
    role: 'assistant',
    content: '做完了。',
    runStatus: 'succeeded',
    startedAt: RUN_STARTED_AT,
    endedAt: RUN_ENDED_AT,
    createdAt: RUN_STARTED_AT,
    events: events as ChatMessage['events'],
    producedFiles: names.map((name) => projectFile(name)),
    ...overrides,
  } as ChatMessage;
}

/** 没有工具行、只有产出的那一轮 —— 走 `ProducedFiles` 那条回退支。 */
function producedOnlyTurn(names: string[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-produced-only',
    role: 'assistant',
    content: '做完了。',
    runStatus: 'succeeded',
    startedAt: RUN_STARTED_AT,
    endedAt: RUN_ENDED_AT,
    createdAt: RUN_STARTED_AT,
    events: [
      { kind: 'status', label: 'starting', detail: 'claude' },
      { kind: 'text', text: '做完了。' },
    ] as ChatMessage['events'],
    producedFiles: names.map((name) => projectFile(name)),
    ...overrides,
  } as ChatMessage;
}

function renderTurn(message: ChatMessage, extra: Record<string, unknown> = {}) {
  return render(
    <CollabProvider value={projectCollabValue()}>
      <AssistantMessage
        message={message}
        streaming={false}
        projectId={PROJECT_ID}
        projectFiles={(message.producedFiles ?? []) as ProjectFile[]}
        isLast
        {...extra}
      />
    </CollabProvider>,
  );
}

/** 一张卡上的动作按钮 id,按渲染顺序 —— 两条路径要给出同一串。 */
function actionIdsOn(card: HTMLElement): string[] {
  return Array.from(card.querySelectorAll('.artifact-card-act')).map(
    (node) => node.getAttribute('data-testid') ?? '?',
  );
}

/** 这次渲染里所有产物卡的「文件名 → 动作列表」快照。 */
function cardSnapshot(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const card of Array.from(
    document.querySelectorAll<HTMLElement>('[data-artifact-card]'),
  )) {
    const id = card.getAttribute('data-testid') ?? '?';
    out[id.replace(/^artifact-card-/, '')] = actionIdsOn(card);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1 · 动作不看第几轮(设计稿里没有 isLast 这一档)
 * ------------------------------------------------------------------ */
describe('产物卡的动作不按轮次发放', () => {
  it('把发布 / 导出留在**历史轮次**的 HTML 卡上', () => {
    const onArtifactShare = vi.fn();
    const onArtifactDownload = vi.fn();
    renderTurn(producedOnlyTurn(['landing.html']), {
      isLast: false,
      onArtifactShare,
      onArtifactDownload,
    });

    // 先证明这条消息真的渲染出了卡 —— 否则下面两条断言是空过的
    const card = screen.getByTestId('artifact-card-landing.html');
    expect(card).toBeTruthy();

    expect(
      within(card).queryByTestId('artifact-card-publish-landing.html'),
      '历史轮次的 HTML 卡丢了「发布」—— 稿子里没有 isLast 这一档',
    ).toBeTruthy();
    expect(
      within(card).queryByTestId('artifact-card-export-landing.html'),
      '历史轮次的卡丢了「导出」',
    ).toBeTruthy();
  });

  it('最后一轮当然也还在(反向对照:不许靠「一律不发」蒙混)', () => {
    renderTurn(producedOnlyTurn(['landing.html']), {
      onArtifactShare: vi.fn(),
      onArtifactDownload: vi.fn(),
    });
    const card = screen.getByTestId('artifact-card-landing.html');
    expect(within(card).queryByTestId('artifact-card-publish-landing.html')).toBeTruthy();
    expect(within(card).queryByTestId('artifact-card-export-landing.html')).toBeTruthy();
  });

  it('非 HTML 卡在任何轮次都只有一枚「导出」(grid 32)', () => {
    renderTurn(producedOnlyTurn(['poster.png']), {
      isLast: false,
      onArtifactShare: vi.fn(),
      onArtifactDownload: vi.fn(),
    });
    const card = screen.getByTestId('artifact-card-poster.png');
    expect(within(card).queryByTestId('artifact-card-publish-poster.png')).toBeNull();
    expect(within(card).queryByTestId('artifact-card-export-poster.png')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * 2 · 两条路径给出同一副卡
 * ------------------------------------------------------------------ */
describe('两条产物面板路径给出同一副卡', () => {
  const NAMES = ['landing.html', 'notes.md', 'poster.png', 'theme.mp3'];

  it('同一批文件,有工具行和没工具行渲染出同样的卡与同样的动作', () => {
    const first = renderTurn(toolOpTurn(NAMES), {
      onArtifactShare: vi.fn(),
      onArtifactDownload: vi.fn(),
    });
    // 走的确实是 `FileOpsSummary` 那条支
    expect(screen.getByTestId('file-ops-summary')).toBeTruthy();
    const viaToolOps = cardSnapshot();
    const audioViaToolOps = !!document.querySelector('[data-testid="file-ops-audio"]');
    first.unmount();

    renderTurn(producedOnlyTurn(NAMES), {
      onArtifactShare: vi.fn(),
      onArtifactDownload: vi.fn(),
    });
    const viaProduced = cardSnapshot();
    const audioViaProduced = !!document.querySelector('[data-testid="file-ops-audio"]');

    // 先证明两边都真的画了东西
    expect(Object.keys(viaToolOps).length, '工具行那条支一张卡都没画').toBeGreaterThan(0);
    expect(Object.keys(viaProduced).length, '产出回退那条支一张卡都没画').toBeGreaterThan(0);

    expect(viaProduced).toEqual(viaToolOps);
    expect(audioViaProduced, '两条支对音频的处理不一致').toBe(audioViaToolOps);
  });
});

/* ------------------------------------------------------------------ *
 * 3 · 音频永远是那条胶囊,不套卡壳
 * ------------------------------------------------------------------ */
describe('音频产物', () => {
  it('在**没有工具行**的那条支上也画成胶囊,不是一张 doc 卡', () => {
    renderTurn(producedOnlyTurn(['theme.mp3']), {
      onArtifactShare: vi.fn(),
      onArtifactDownload: vi.fn(),
    });

    expect(
      document.querySelector('[data-testid="file-ops-audio"] audio'),
      '产出回退那条支没用组件 24 的胶囊画音频',
    ).toBeTruthy();
    expect(
      document.querySelector('[data-artifact-card][data-testid="artifact-card-theme.mp3"]'),
      '又把音频套回大卡片里了',
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 4 · 「发布」是纯文字,方向感只给「导出」
 * ------------------------------------------------------------------ */
describe('动作胶囊的字形', () => {
  it('「发布」不带图标,「导出」带那枚圈中箭头', () => {
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('landing.html')]}
          projectId={PROJECT_ID}
          onPublish={vi.fn()}
          onExport={vi.fn()}
        />
      </CollabProvider>,
    );

    const publish = screen.getByTestId('artifact-card-publish-landing.html');
    const exportAct = screen.getByTestId('artifact-card-export-landing.html');
    // 反向对照:导出**必须**有图标,否则「两枚都没图标」也能过
    expect(exportAct.querySelector('svg'), '「导出」丢了那枚圈中箭头').toBeTruthy();
    expect(
      publish.querySelector('svg'),
      '「发布」多了一枚图标 —— 稿子里它是纯文字,方向感只给「导出」一个',
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 5 · 导出:单格式直接下载,多格式才开浮层
 * ------------------------------------------------------------------ */
describe('导出行为', () => {
  it('单格式产物(md)点「导出」直接下载,不弹任何东西', () => {
    const onExport = vi.fn();
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('notes.md')]}
          projectId={PROJECT_ID}
          onExport={onExport}
        />
      </CollabProvider>,
    );

    const act = screen.getByTestId('artifact-card-export-notes.md');
    expect(act.tagName, 'md 的导出应该就是一条下载链接').toBe('A');
    expect(act.getAttribute('download')).toBe('notes.md');
    fireEvent.click(act);
    expect(screen.queryByTestId('artifact-export-popover'), 'md 不该弹格式浮层').toBeNull();
    expect(onExport, 'md 不该绕道预览区的导出菜单').not.toHaveBeenCalled();
  });

  it('单格式产物(png)同样直接下载', () => {
    const onExport = vi.fn();
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('poster.png')]}
          projectId={PROJECT_ID}
          onExport={onExport}
        />
      </CollabProvider>,
    );

    const act = screen.getByTestId('artifact-card-export-poster.png');
    expect(act.tagName).toBe('A');
    expect(act.getAttribute('download')).toBe('poster.png');
    expect(onExport).not.toHaveBeenCalled();
  });

  it('多格式产物(html)点「导出」开一枚**贴着按钮**的浮层', () => {
    const onExport = vi.fn();
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('landing.html')]}
          projectId={PROJECT_ID}
          onExport={onExport}
        />
      </CollabProvider>,
    );

    const act = screen.getByTestId('artifact-card-export-landing.html');
    expect(act.tagName, 'html 的导出要能开浮层,所以是按钮不是链接').toBe('BUTTON');
    expect(screen.queryByTestId('artifact-export-popover'), '还没点就开着').toBeNull();

    fireEvent.click(act);
    const popover = screen.getByTestId('artifact-export-popover');
    expect(popover).toBeTruthy();
    /*
     * 「贴着按钮」现在由坐标证明,不是由 DOM 父子证明 —— 浮层已经 portal 到
     * body(不 portal 就困在 `.artifact-card-acts` 那个 z=2 的层叠上下文里,
     * 压不过提示层)。父子关系反过来必须是**分开的**。
     * 坐标本身在下面「浮层的坐标」那一组里量。
     */
    expect(act.closest('.artifact-card-act-anchor')?.contains(popover)).toBe(false);
    expect(popover.parentElement).toBe(document.body);
    // 落在按钮的上下由空间决定,所以要有个可判读的落位标记
    expect(['above', 'below']).toContain(popover.getAttribute('data-placement'));

    // 选一种格式才真的走导出
    const pdf = within(popover).getByTestId('artifact-export-format-pdf');
    fireEvent.click(pdf);
    expect(onExport).toHaveBeenCalledWith('landing.html', 'pdf');
    expect(screen.queryByTestId('artifact-export-popover'), '选完没关掉').toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 6 · 发布也贴着按钮开(产品 2026-08-27 第二次口径)
 * ------------------------------------------------------------------ *
 * 「产品期望 html 的导出和发布的弹窗,都直接显示在卡片导出发布的按钮附近,
 *   动态根据上下空间判断是显示在按钮上面还是下面」。
 *
 * 之前只有〔导出〕做了。〔发布〕仍旧把请求甩给预览区,由那边在**视口右上角**
 * 展开自己的分享菜单 —— 实测按钮在 (129, 2287),弹层在 (1436, 94),两者相距
 * 整整一屏。用户原话:「发布按钮的弹窗怎么还是到右上角弹出来的??」
 *
 * 稿子对「发布点下去之后长什么样」**没有任何规定** —— 全稿 24 个组件里
 * 「发布」只在组件 14 的卡上出现过,散文只说了一句「『发布』说的是"送出去"」。
 * 所以这里的规格是产品那条口径 + 稿子那条「这张卡上要做的事本来就只有两件」:
 * 卡上给一枚**窄**浮层(去哪儿发),不是把预览区那整块分享面板搬过来。
 */
describe('发布也贴着按钮开', () => {
  function renderHtmlCard(overrides: Record<string, unknown> = {}) {
    return render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('landing.html')]}
          projectId={PROJECT_ID}
          onPublish={vi.fn()}
          onExport={vi.fn()}
          {...overrides}
        />
      </CollabProvider>,
    );
  }

  it('点〔发布〕开一枚浮层,而不是把请求甩给别处', () => {
    const onPublish = vi.fn();
    renderHtmlCard({ onPublish });

    const act = screen.getByTestId('artifact-card-publish-landing.html');
    expect(act.tagName, '发布要能开浮层,所以是按钮').toBe('BUTTON');
    expect(screen.queryByTestId('artifact-publish-popover'), '还没点就开着').toBeNull();
    // 关键:点一下**不该**立刻把动作甩出去,那正是「跑去右上角弹」的成因
    fireEvent.click(act);
    expect(onPublish, '点按钮本身就把动作甩出去了').not.toHaveBeenCalled();
    expect(screen.getByTestId('artifact-publish-popover')).toBeTruthy();
  });

  it('浮层里是发布目的地,选一个才真的发布', () => {
    const onPublish = vi.fn();
    renderHtmlCard({ onPublish });
    fireEvent.click(screen.getByTestId('artifact-card-publish-landing.html'));

    const popover = screen.getByTestId('artifact-publish-popover');
    // 公开链接 + 两家部署商 —— 与 `DEPLOY_PROVIDER_IDS` 同源,不另抄一份
    expect(within(popover).getByTestId('artifact-publish-target-public-link')).toBeTruthy();
    expect(within(popover).getByTestId('artifact-publish-target-vercel-self')).toBeTruthy();
    expect(within(popover).getByTestId('artifact-publish-target-cloudflare-pages')).toBeTruthy();
    // 预览区那块分享面板里的**链接管理**不搬过来(它们要 viewer 的状态)
    expect(within(popover).queryByTestId('artifact-publish-target-save-template')).toBeNull();

    fireEvent.click(within(popover).getByTestId('artifact-publish-target-vercel-self'));
    expect(onPublish).toHaveBeenCalledWith('landing.html', 'vercel-self');
    expect(screen.queryByTestId('artifact-publish-popover'), '选完没关掉').toBeNull();
  });

  it('两枚浮层都带上下落位标记(空间不够就翻面)', () => {
    renderHtmlCard();
    fireEvent.click(screen.getByTestId('artifact-card-publish-landing.html'));
    expect(['above', 'below']).toContain(
      screen.getByTestId('artifact-publish-popover').getAttribute('data-placement'),
    );
    fireEvent.click(screen.getByTestId('artifact-card-export-landing.html'));
    expect(['above', 'below']).toContain(
      screen.getByTestId('artifact-export-popover').getAttribute('data-placement'),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 7 · 浮层挂在 body 上,不困在卡的层叠上下文里
 * ------------------------------------------------------------------ *
 * `.artifact-card-acts` 是 `position:absolute; z-index:2` —— 它**自己就是一个
 * 层叠上下文**。浮层留在里面的话,不管写多大的 z-index,都只能在这个 z=2 的
 * 盒子里和兄弟比高低,永远压不过 portal 到 body 的提示层(`.od-tooltip-layer`,
 * z-index 4000)。用户截图里那条深色 tooltip 就是这么盖在导出菜单上的。
 *
 * 仓库里已有的同类是 `CustomSelect`:portal 到 body + fixed 坐标 + 滚动/缩放
 * 时重算,菜单类 `.od-select-menu` 落在 9000,**本来就在提示层之上**。
 */
describe('浮层的层位', () => {
  it('导出浮层 portal 到 body,不留在卡里', () => {
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('landing.html')]}
          projectId={PROJECT_ID}
          onExport={vi.fn()}
        />
      </CollabProvider>,
    );
    fireEvent.click(screen.getByTestId('artifact-card-export-landing.html'));
    const popover = screen.getByTestId('artifact-export-popover');
    expect(popover.closest('[data-artifact-card]'), '浮层还困在卡的层叠上下文里').toBeNull();
    expect(popover.parentElement, '没有 portal 到 body').toBe(document.body);
  });

  it('发布浮层同样 portal 到 body', () => {
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('landing.html')]}
          projectId={PROJECT_ID}
          onPublish={vi.fn()}
        />
      </CollabProvider>,
    );
    fireEvent.click(screen.getByTestId('artifact-card-publish-landing.html'));
    const popover = screen.getByTestId('artifact-publish-popover');
    expect(popover.closest('[data-artifact-card]')).toBeNull();
    expect(popover.parentElement).toBe(document.body);
  });
});

/* ------------------------------------------------------------------ *
 * 8 · 坐标真的落在按钮旁边
 * ------------------------------------------------------------------ *
 * portal 之后浮层是 `position: fixed`,坐标要自己算。jsdom 不排版(所有
 * `getBoundingClientRect()` 都是 0),所以这里给**按钮**喂一个真实 rect,
 * 再看组件算出来的 `top` / `left` —— 量的是它的判断,不是浏览器的排版。
 * 真实排版下的坐标另外用 headless Chrome 走 CDP 量,不在这一层冒充。
 */
describe('浮层的坐标', () => {
  const VIEWPORT_H = 768;

  function rect(partial: { top: number; left: number; width?: number; height?: number }): DOMRect {
    const width = partial.width ?? 60;
    const height = partial.height ?? 21;
    const box = {
      x: partial.left,
      y: partial.top,
      left: partial.left,
      top: partial.top,
      right: partial.left + width,
      bottom: partial.top + height,
      width,
      height,
    };
    return { ...box, toJSON: () => box } as DOMRect;
  }

  function openWith(testId: 'publish' | 'export', anchorRect: DOMRect) {
    render(
      <CollabProvider value={projectCollabValue()}>
        <FileOpsSummary
          entries={[fileOpEntry('landing.html')]}
          projectId={PROJECT_ID}
          onPublish={vi.fn()}
          onExport={vi.fn()}
        />
      </CollabProvider>,
    );
    const act = screen.getByTestId(`artifact-card-${testId}-landing.html`);
    act.getBoundingClientRect = () => anchorRect;
    fireEvent.click(act);
    const popover = screen.getByTestId(`artifact-${testId}-popover`) as HTMLElement;
    return { act, popover, top: Number.parseFloat(popover.style.top), left: Number.parseFloat(popover.style.left) };
  }

  it('按钮在视口中间:浮层贴在它正下方', () => {
    const anchor = rect({ top: 300, left: 600 });
    const { popover, top, left } = openWith('export', anchor);
    expect(popover.style.position).toBe('fixed');
    expect(popover.getAttribute('data-placement')).toBe('below');
    // 6px 是 hook 里的 gap —— 贴着下缘,不是随便一个数
    expect(top).toBe(anchor.bottom + 6);
    // 横向不许跑到视口另一头:右缘对齐按钮右缘,再夹回视口内
    expect(left).toBeLessThanOrEqual(anchor.right);
    expect(left).toBeGreaterThanOrEqual(12);
  });

  it('按钮贴着视口下缘:浮层翻到上面', () => {
    const anchor = rect({ top: VIEWPORT_H - 40, left: 600 });
    const { popover, top } = openWith('export', anchor);
    expect(popover.getAttribute('data-placement')).toBe('above');
    expect(top, '翻上去之后应该在按钮上方').toBeLessThan(anchor.top);
    // 一枚三四条的菜单不会有几百像素高 —— 上界兜住「翻上去但飞到屏幕顶上」
    expect(anchor.top - top).toBeLessThan(400);
  });

  it('实测出事的那个位置:按钮在 (129, 2287),浮层不许跑到视口右上角', () => {
    /*
     * 真机实测(2026-08-27):按钮 x=129 y=2287(深在聊天流里),弹层却在
     * x=1436 y=94 —— 视口右上角,离按钮整整一屏。用户原话:「发布按钮的弹窗
     * 怎么还是到右上角弹出来的??」
     */
    const anchor = rect({ top: 2287, left: 129 });
    const { top, left } = openWith('publish', anchor);
    // 按钮远在视口下方之外 → 只能翻到上面;但必须跟着按钮那一列,不是右上角
    expect(left, `浮层横向落在 ${left},按钮在 129`).toBeLessThan(400);
    expect(Number.isFinite(top)).toBe(true);
  });

  it('发布浮层用的是它自己那枚按钮的位置,不是导出那枚的', () => {
    const anchor = rect({ top: 300, left: 600 });
    const { top } = openWith('publish', anchor);
    expect(top).toBe(anchor.bottom + 6);
  });
});
