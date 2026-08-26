// @vitest-environment jsdom
/**
 * 红测:BYOK / api 那条分支的 `onRunCreated` **漏了把 runId 记进 `currentRunId`**
 * (daemon 分支有,它没有)。
 *
 * `currentRunId` 是这一轮的重连登记簿钥匙:onError 里几乎所有断线善后都锁在
 * `if (currentRunId) { ... }` 里 —— 通用断线的重试计数、次数用尽后去 daemon
 * 问一次终态、以及把这条 run 封进 `completedReattachRunsRef` 不再重连。变量一直
 * 是 undefined 的话,BYOK 下这些**一次都不会跑**:断线次数永远不累计,次数用尽的
 * 那次终态探测永远不发生,于是一条其实已经在 daemon 上跑成功的 run,在 BYOK 里
 * 只会停在「失败」上。
 *
 * 这条 spec 量的是最外面那个可观测点:通用断线累计到上限时,必须去 daemon 问一次
 * 这条 run 的真实终态。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectView } from '../../src/components/ProjectView';
import {
  createGenericDaemonDisconnectError,
  fetchChatRunStatus,
  streamViaDaemon,
} from '../../src/providers/daemon';
import type { DaemonStreamOptions } from '../../src/providers/daemon';
import {
  fetchProjectFilePreview,
  fetchProjectFileText,
  fetchProjectFiles,
} from '../../src/providers/registry';
import { listMessages } from '../../src/state/projects';
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
    fetchChatRunStatus: vi.fn().mockResolvedValue(null),
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

vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({
    onSend,
  }: {
    messages: ChatMessage[];
    onSend: (
      prompt: string,
      attachments: ChatAttachment[],
      commentAttachments: ChatCommentAttachment[],
    ) => unknown;
  }) => (
    <button type="button" data-testid="send" onClick={() => onSend('make a landing page', [], [])}>
      send
    </button>
  ),
}));

const mockedStreamViaDaemon = vi.mocked(streamViaDaemon);
const mockedFetchChatRunStatus = vi.mocked(fetchChatRunStatus);

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

const project: Project = {
  id: 'project-1',
  name: 'Project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const agents: AgentInfo[] = [
  { id: 'byok-opencode', name: 'BYOK OpenCode', bin: 'opencode', available: true, models: [] },
];

function renderProjectView() {
  return render(
    <ProjectView
      project={project}
      routeFileName={null}
      config={byokConfig}
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

beforeEach(() => {
  mockedStreamViaDaemon.mockReset();
  mockedFetchChatRunStatus.mockReset();
  mockedFetchChatRunStatus.mockResolvedValue(null);
  vi.mocked(listMessages).mockResolvedValue([]);
  vi.mocked(fetchProjectFiles).mockResolvedValue([]);
  vi.mocked(fetchProjectFilePreview).mockResolvedValue(null);
  vi.mocked(fetchProjectFileText).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BYOK run-id bookkeeping', () => {
  it('通用断线累计到上限时,去 daemon 问一次这条 run 的真实终态', async () => {
    // MAX_TRANSIENT_RETRIES = 2:第二次通用断线就该发探测。
    mockedStreamViaDaemon.mockImplementation(async (options: DaemonStreamOptions) => {
      options.onRunCreated?.('run-byok-1');
      await options.handlers.onError(createGenericDaemonDisconnectError());
      await options.handlers.onError(createGenericDaemonDisconnectError());
    });
    renderProjectView();

    await waitFor(() => expect(screen.getByTestId('send')).toBeTruthy());
    fireEvent.click(screen.getByTestId('send'));

    await waitFor(() => {
      expect(mockedFetchChatRunStatus).toHaveBeenCalledWith('run-byok-1', null);
    });
  });
});
