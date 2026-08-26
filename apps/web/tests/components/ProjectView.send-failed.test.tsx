// @vitest-environment jsdom
/**
 * B13「发送失败态」—— 消息**根本没发出去**的那一档(稿子第 49 / 50 格)。
 *
 * 要钉住的是一条二选一的规矩:
 *
 *  - **从来没建出 run** → 收回到用户气泡上:气泡盖 `sendFailed`(落库),
 *    助手占位从内存和 daemon 库里一起撤掉。屏幕上只有**一个**重试入口。
 *  - **run 建出来之后才失败** → 一个字都不改:助手侧报错卡照旧,用户消息
 *    不盖 `sendFailed`。
 *  - **没建出 run,但报错卡上挂着别的出路**(AMR 切换卡 / 去登录 / 去充值)
 *    → 也保持原样。收掉等于把唯一的出口删了。
 *
 * 判据是 `latestAssistantMsg.runId`,不是 `currentRunId` —— 后者只在 daemon
 * 分支里赋值,api/BYOK 那条漏了,拿它判会让 BYOK 下每一次运行失败都被误判成
 * 「根本没发出去」。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import { streamViaDaemon } from '../../src/providers/daemon';
import type { DaemonStreamOptions } from '../../src/providers/daemon';
import {
  fetchProjectFilePreview,
  fetchProjectFileText,
  fetchProjectFiles,
} from '../../src/providers/registry';
import { deleteMessage, listMessages, saveMessage } from '../../src/state/projects';
import type {
  AgentInfo,
  AppConfig,
  ChatAttachment,
  ChatCommentAttachment,
  ChatMessage,
  Conversation,
  DesignSystemSummary,
  Project,
  SkillSummary,
} from '../../src/types';

vi.mock('../../src/router', () => ({ navigate: vi.fn() }));

vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));

vi.mock('../../src/providers/daemon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/daemon')>();
  return {
    ...actual,
    fetchChatRunStatus: vi.fn(),
    listActiveChatRuns: vi.fn().mockResolvedValue([]),
    listProjectRuns: vi.fn().mockResolvedValue([]),
    publishDaemonRunFinishedEvent: vi.fn(),
    reattachDaemonRun: vi.fn(),
    streamViaDaemon: vi.fn(),
  };
});

vi.mock('../../src/providers/project-events', () => ({
  useProjectFileEvents: vi.fn(),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    deletePreviewComment: vi.fn(),
    fetchDesignSystem: vi.fn().mockResolvedValue(null),
    fetchLiveArtifacts: vi.fn().mockResolvedValue([]),
    fetchPreviewComments: vi.fn().mockResolvedValue([]),
    fetchProjectFilePreview: vi.fn().mockResolvedValue(null),
    fetchProjectFileText: vi.fn().mockResolvedValue(null),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchSkill: vi.fn().mockResolvedValue(null),
    patchPreviewCommentStatus: vi.fn(),
    upsertPreviewComment: vi.fn(),
    writeProjectTextFile: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  const mockConversation = (projectId: string): Conversation => ({
    id: `conv-${projectId}`,
    projectId,
    title: null,
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    ...actual,
    createConversation: vi
      .fn()
      .mockImplementation(async (projectId: string) => mockConversation(projectId)),
    deleteConversation: vi.fn(),
    deleteMessage: vi.fn().mockResolvedValue(true),
    getTemplate: vi.fn().mockResolvedValue(null),
    listConversations: vi
      .fn()
      .mockImplementation(async (projectId: string) => [mockConversation(projectId)]),
    listMessages: vi.fn().mockResolvedValue([]),
    loadTabs: vi.fn().mockResolvedValue({ tabs: [], active: null }),
    patchConversation: vi.fn(),
    patchProject: vi.fn(),
    saveMessage: vi.fn().mockResolvedValue(undefined),
    saveTabs: vi.fn(),
  };
});

vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));

vi.mock('../../src/components/AvatarMenu', () => ({ AvatarMenu: () => null }));

vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: () => <div data-testid="file-workspace" />,
}));

vi.mock('../../src/components/Loading', () => ({
  CenteredLoader: () => <div data-testid="loader" />,
}));

// A deliberately dumb ChatPane: it exposes exactly the props this spec drives
// (send, resend, "send now" on a queued item) and renders each message's
// send-failed / run-status latch so the assertions read off the product's own
// state rather than a component-internal detail.
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({
    messages,
    onSend,
    onResend,
    onSendQueuedNow,
    queuedItems,
    error,
  }: {
    messages: ChatMessage[];
    onSend: (
      prompt: string,
      attachments: ChatAttachment[],
      commentAttachments: ChatCommentAttachment[],
    ) => unknown;
    onResend?: (message: ChatMessage) => void;
    onSendQueuedNow?: (id: string) => void;
    queuedItems?: Array<{ id: string }>;
    error?: string | null;
  }) => (
    <div>
      {error ? <div data-testid="pane-error">{error}</div> : null}
      <button type="button" data-testid="send-a" onClick={() => onSend('turn A', [], [])}>
        send A
      </button>
      <button type="button" data-testid="send-b" onClick={() => onSend('turn B', [], [])}>
        send B
      </button>
      {(queuedItems ?? []).map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`queued-now-${item.id}`}
          onClick={() => onSendQueuedNow?.(item.id)}
        >
          send now
        </button>
      ))}
      {messages.map((message) => (
        <article
          key={message.id}
          data-testid={`message-${message.role}`}
          data-message-id={message.id}
          data-send-failed={message.sendFailed ? 'yes' : 'no'}
          data-run-status={message.runStatus ?? 'none'}
        >
          <span>{message.content}</span>
          {(message.events ?? []).map((event, index) => (
            <span key={index} data-testid="message-event">
              {event.kind === 'status' ? `${event.label}:${event.code ?? ''}` : ''}
            </span>
          ))}
          {message.role === 'user' && message.sendFailed ? (
            <button
              type="button"
              data-testid={`resend-${message.id}`}
              onClick={() => onResend?.(message)}
            >
              resend
            </button>
          ) : null}
        </article>
      ))}
    </div>
  ),
}));

const mockedStreamViaDaemon = vi.mocked(streamViaDaemon);
const mockedDeleteMessage = vi.mocked(deleteMessage);
const mockedSaveMessage = vi.mocked(saveMessage);
const mockedListMessages = vi.mocked(listMessages);

const config: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: 'agent-1',
  agentModels: {},
  skillId: null,
  designSystemId: null,
  notifications: {
    soundEnabled: false,
    successSoundId: 'success-sound',
    failureSoundId: 'failure-sound',
    desktopEnabled: false,
  },
};

const project: Project = {
  id: 'project-1',
  name: 'Project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

/**
 * BYOK/api 走的是另一条分支:那里的助手占位 `runStatus` 是 undefined,
 * 不被 `isPhantomDaemonRunMessage` 拦,**发送的那一刻就落库了** —— 这条
 * spec 里「删占位不许追尾保存」那一格要的就是这个形态。
 */
const byokConfig: AppConfig = {
  mode: 'api',
  apiProtocol: 'openai',
  apiKey: 'byok-test-key',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  agentId: null,
  skillId: null,
  designSystemId: null,
  notifications: {
    soundEnabled: false,
    successSoundId: 'success-sound',
    failureSoundId: 'failure-sound',
    desktopEnabled: false,
  },
};

const agents: AgentInfo[] = [
  { id: 'agent-1', name: 'OpenCode', bin: 'opencode', available: true, models: [] },
  { id: 'byok-opencode', name: 'BYOK OpenCode', bin: 'opencode', available: true, models: [] },
];

function renderProjectView(renderConfig: AppConfig = config) {
  return render(
    <ProjectView
      project={project}
      routeFileName={null}
      config={renderConfig}
      agents={agents}
      skills={[] as SkillSummary[]}
      designTemplates={[] as SkillSummary[]}
      designSystems={[] as DesignSystemSummary[]}
      daemonLive
      onModeChange={vi.fn()}
      onAgentChange={vi.fn()}
      onAgentModelChange={vi.fn()}
      onRefreshAgents={vi.fn()}
      onOpenSettings={vi.fn()}
      onBack={vi.fn()}
      onClearPendingPrompt={vi.fn()}
      onTouchProject={vi.fn()}
      onProjectChange={vi.fn()}
      onProjectsRefresh={vi.fn()}
    />,
  );
}

function runCreateError(message: string, code?: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  if (code) error.code = code;
  return error;
}

/**
 * `POST /api/runs` 失败时 provider 的真实顺序:**先**发一条 terminal
 * `failed` 状态,**再**抛 onError,而且 `onRunCreated` 从头到尾没响过。
 * 那条 terminal 状态正是把助手占位写进库里的元凶 —— 顺序必须照抄,否则
 * 这条 spec 测不到「撤占位」到底有没有真的落库。
 */
function neverCreatedRun(error: Error) {
  return async (options: DaemonStreamOptions) => {
    options.onRunStatus?.('failed');
    await options.handlers.onError(error);
  };
}

function createdThenFailedRun(error: Error, runId = 'run-1') {
  return async (options: DaemonStreamOptions) => {
    options.onRunCreated?.(runId);
    options.onRunStatus?.('queued');
    options.onRunStatus?.('failed');
    await options.handlers.onError(error);
  };
}

async function sendTurnA() {
  await waitFor(() => expect(screen.getByTestId('send-a')).toBeTruthy());
  fireEvent.click(screen.getByTestId('send-a'));
}

function userRows(): HTMLElement[] {
  return screen.queryAllByTestId('message-user');
}

function assistantRows(): HTMLElement[] {
  return screen.queryAllByTestId('message-assistant');
}

beforeEach(() => {
  mockedStreamViaDaemon.mockReset();
  mockedDeleteMessage.mockReset();
  mockedDeleteMessage.mockResolvedValue(true);
  mockedSaveMessage.mockReset();
  mockedSaveMessage.mockResolvedValue(undefined);
  mockedListMessages.mockClear();
  mockedListMessages.mockResolvedValue([]);
  vi.mocked(fetchProjectFiles).mockResolvedValue([]);
  vi.mocked(fetchProjectFilePreview).mockResolvedValue(null);
  vi.mocked(fetchProjectFileText).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('B13 · 没建出 run 的那一轮收回到用户气泡上', () => {
  it('把用户消息标成发送失败,并把助手占位从内存和库里一起撤掉', async () => {
    mockedStreamViaDaemon.mockImplementation(
      neverCreatedRun(runCreateError('conversation not found for project', 'CONVERSATION_NOT_FOUND')),
    );
    renderProjectView();
    await sendTurnA();

    // 气泡转失败态,并且屏幕上不再有那条空的助手占位。
    await waitFor(() => {
      expect(userRows()[0]?.getAttribute('data-send-failed')).toBe('yes');
    });
    expect(assistantRows()).toHaveLength(0);

    // 落库:红色重试刷新之后还要在。
    await waitFor(() => {
      expect(
        mockedSaveMessage.mock.calls.some(([, , message]) => {
          const saved = message as ChatMessage;
          return saved.role === 'user' && saved.sendFailed === true;
        }),
      ).toBe(true);
    });

    // 撤占位要真的落库撤掉 —— 否则刷新一次它就诈尸。
    const assistantId = mockedStreamViaDaemon.mock.calls[0]![0].assistantMessageId;
    await waitFor(() => {
      expect(mockedDeleteMessage).toHaveBeenCalledWith(
        'project-1',
        'conv-project-1',
        assistantId,
        null,
      );
    });
  });

  it('删占位排在它自己那条保存后面 —— 反过来的话旧的 PUT 会把它写回去', async () => {
    // `onRunStatus('failed')` 先把占位 PUT 上去,`onError` 紧接着要删它。
    // 两条都是 fire-and-forget 的 fetch:如果 DELETE 先到,daemon 那边什么都
    // 没有可删,随后落地的 PUT 会把占位重新建出来,而这件事只有刷新才看得见。
    let resolveSave: (() => void) | null = null;
    const savedAssistantIds: string[] = [];
    mockedSaveMessage.mockImplementation(async (_p, _c, message) => {
      if ((message as ChatMessage).role !== 'assistant') return;
      savedAssistantIds.push((message as ChatMessage).id);
      await new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
    });
    mockedStreamViaDaemon.mockImplementation(
      neverCreatedRun(runCreateError('daemon 400: bad request', 'BAD_REQUEST')),
    );
    renderProjectView(byokConfig);
    await sendTurnA();

    await waitFor(() => expect(savedAssistantIds.length).toBeGreaterThan(0));
    // 保存还挂在半空 —— 这个窗口里一次删都不许发出去。
    expect(mockedDeleteMessage).not.toHaveBeenCalled();

    resolveSave!();
    await waitFor(() => expect(mockedDeleteMessage).toHaveBeenCalledTimes(1));
  });

  it('run 建出来之后才失败的那一轮,一个字都不改', async () => {
    mockedStreamViaDaemon.mockImplementation(
      createdThenFailedRun(runCreateError('agent exited with code 1', 'AGENT_EXECUTION_FAILED')),
    );
    renderProjectView();
    await sendTurnA();

    await waitFor(() => {
      expect(assistantRows()[0]?.getAttribute('data-run-status')).toBe('failed');
    });
    expect(userRows()[0]?.getAttribute('data-send-failed')).toBe('no');
    expect(mockedDeleteMessage).not.toHaveBeenCalled();
    // 报错卡靠这条 error 事件活着。
    expect(
      screen.getAllByTestId('message-event').some((node) => node.textContent?.startsWith('error:')),
    ).toBe(true);
  });

  it.each([
    ['UPSTREAM_UNAVAILABLE', 'the model service is unavailable'],
    ['UNAUTHORIZED', 'workspace authorization failed'],
    ['AGENT_AUTH_REQUIRED', 'sign in to continue'],
    ['RATE_LIMITED', 'too many requests'],
  ])('没建出 run,但 %s 的报错卡上挂着别的出路 —— 保持原样', async (code, text) => {
    // 这几档今天会出 AMR 切换卡 / 去登录。把这一轮收掉等于删掉唯一的出口,
    // 人只剩一颗会以同样理由再失败一次的「重试」。
    mockedStreamViaDaemon.mockImplementation(neverCreatedRun(runCreateError(text, code)));
    renderProjectView();
    await sendTurnA();

    await waitFor(() => {
      expect(assistantRows()[0]?.getAttribute('data-run-status')).toBe('failed');
    });
    expect(userRows()[0]?.getAttribute('data-send-failed')).toBe('no');
    expect(assistantRows()).toHaveLength(1);
    expect(mockedDeleteMessage).not.toHaveBeenCalled();
    expect(
      screen.getAllByTestId('message-event').some((node) => node.textContent === `error:${code}`),
    ).toBe(true);
  });

  it('压根没上线的配置类拦截(没选 agent)保持原样 —— 那句话本身就是「去做什么」', async () => {
    // 这一类根本没碰网络:报错卡上那句话就是唯一的说明。收成气泡上一颗
    // 「重试」等于把说明删掉,再教人去点一颗确定会同样失败的按钮。
    renderProjectView({ ...config, agentId: null });
    await sendTurnA();

    await waitFor(() => expect(screen.getByTestId('pane-error')).toBeTruthy());
    expect(screen.getByTestId('pane-error').textContent).toMatch(/local agent/i);
    expect(userRows()[0]?.getAttribute('data-send-failed')).toBe('no');
    expect(assistantRows()).toHaveLength(1);
    expect(mockedStreamViaDaemon).not.toHaveBeenCalled();
    expect(mockedDeleteMessage).not.toHaveBeenCalled();
  });

  it('被「立刻发送」打断的旧 run 迟到的报错,不许去动新的那一轮', async () => {
    const pending: DaemonStreamOptions[] = [];
    mockedStreamViaDaemon.mockImplementation(async (options: DaemonStreamOptions) => {
      pending.push(options);
      // 两轮都挂着不收尾,由这条 spec 自己决定谁什么时候失败。
      await new Promise<void>(() => {});
    });
    renderProjectView();
    await sendTurnA();
    await waitFor(() => expect(pending).toHaveLength(1));

    // 第二条在第一条还在跑时发出去 —— 会被排队。
    fireEvent.click(screen.getByTestId('send-b'));
    const queuedButton = await screen.findByTestId(/^queued-now-/);
    fireEvent.click(queuedButton);
    await waitFor(() => expect(pending).toHaveLength(2));

    // 现在旧 run 迟到一条「根本没建出 run」的错误。
    await pending[0]!.handlers.onError(
      runCreateError('conversation not found for project', 'CONVERSATION_NOT_FOUND'),
    );

    // 新一轮的用户消息不许被盖章,占位也不许被撤。
    await waitFor(() => expect(userRows().length).toBeGreaterThan(0));
    expect(userRows().every((row) => row.getAttribute('data-send-failed') === 'no')).toBe(true);
    expect(mockedDeleteMessage).not.toHaveBeenCalled();
  });

  it('重发原地再建一次 run,不会多出一条一模一样的用户消息', async () => {
    mockedStreamViaDaemon.mockImplementationOnce(
      neverCreatedRun(runCreateError('conversation not found for project', 'CONVERSATION_NOT_FOUND')),
    );
    mockedStreamViaDaemon.mockImplementation(async () => {});
    renderProjectView();
    await sendTurnA();

    const failedRow = await waitFor(() => {
      const row = userRows()[0];
      expect(row?.getAttribute('data-send-failed')).toBe('yes');
      return row!;
    });
    const userMessageId = failedRow.getAttribute('data-message-id');

    fireEvent.click(screen.getByTestId(`resend-${userMessageId}`));

    await waitFor(() => expect(mockedStreamViaDaemon).toHaveBeenCalledTimes(2));
    const resent = mockedStreamViaDaemon.mock.calls[1]![0];
    // 同一条消息再发一次 —— id 沿用,历史里只有它自己一条。
    expect(resent.userMessageId).toBe(userMessageId);
    expect(resent.history.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(resent.history.at(-1)?.content).toBe('turn A');
    await waitFor(() => expect(userRows()).toHaveLength(1));
    expect(userRows()[0]?.getAttribute('data-send-failed')).toBe('no');
  });
});
