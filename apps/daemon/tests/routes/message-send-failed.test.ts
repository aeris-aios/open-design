/**
 * B13「发送失败态」的落库半边。
 *
 * 两件事必须落到库里,否则刷新一次就全白做:
 *
 *  1. **用户气泡的 `sendFailed`**。契约上早就有这个字段,但 `messages` 表没有对应
 *     的列 —— `upsertMessage` 是显式列名写入,PUT 上来的字段被整个丢掉(和
 *     `forked_into_json` 当初一模一样的坑)。红色「重试」只有在刷新之后还在,
 *     才算数。
 *
 *  2. **撤掉助手占位要真的撤掉**。`POST /api/runs` 失败时 web 侧会先收到一条
 *     `emitRunStatus('failed')`,那条 terminal 状态**不在** `isPhantomDaemonRunMessage`
 *     的拦截范围内(它只挡 queued/running),于是助手占位已经落库了。内存里撤掉
 *     没用 —— 刷新会把它捞回来,屏幕上同时出现红色「重试」和一张报错卡。
 *     daemon 之前**没有任何删消息端点**,这里补上。
 */
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../../src/server.js';

describe('message send-failed persistence', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function makeConversation(prefix: string): Promise<{
    projectId: string;
    conversationId: string;
  }> {
    const projectId = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const createProjectResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Send-failed fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createProjectResp.status).toBe(200);
    const convResp = await fetch(`${baseUrl}/api/projects/${projectId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Send failed', sessionMode: 'chat' }),
    });
    expect(convResp.status).toBe(200);
    const conversationId = ((await convResp.json()) as {
      conversation: { id: string };
    }).conversation.id;
    return { conversationId, projectId };
  }

  function messageUrl(projectId: string, conversationId: string, messageId: string): string {
    return `${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages/${messageId}`;
  }

  async function listMessages(projectId: string, conversationId: string) {
    const resp = await fetch(
      `${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages`,
    );
    expect(resp.status).toBe(200);
    return ((await resp.json()) as {
      messages: Array<{ id: string; role: string; sendFailed?: boolean }>;
    }).messages;
  }

  it('round-trips sendFailed on a user message so the retry survives a reload', async () => {
    const { conversationId, projectId } = await makeConversation('send-failed-roundtrip');
    const messageId = 'user-send-failed-1';

    const saveResp = await fetch(messageUrl(projectId, conversationId, messageId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        role: 'user',
        content: '等一下,价格行的字号先别动',
        sendFailed: true,
      }),
    });
    expect(saveResp.status).toBe(200);
    expect(
      ((await saveResp.json()) as { message: { sendFailed?: boolean } }).message.sendFailed,
    ).toBe(true);

    const stored = await listMessages(projectId, conversationId);
    expect(stored.find((m) => m.id === messageId)?.sendFailed).toBe(true);

    // 重发成功之后这一条要恢复成普通消息 —— 后来的快照不带这个字段就必须清掉,
    // 否则「已经发出去了」的消息上永远挂着一枚红色重试。
    const clearResp = await fetch(messageUrl(projectId, conversationId, messageId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        role: 'user',
        content: '等一下,价格行的字号先别动',
      }),
    });
    expect(clearResp.status).toBe(200);
    expect(
      ((await clearResp.json()) as { message: { sendFailed?: boolean } }).message.sendFailed,
    ).toBeUndefined();
    expect(
      (await listMessages(projectId, conversationId)).find((m) => m.id === messageId)?.sendFailed,
    ).toBeUndefined();
  });

  it('deletes a withdrawn assistant placeholder so a reload cannot resurrect it', async () => {
    const { conversationId, projectId } = await makeConversation('send-failed-delete');
    const userId = 'user-withdrawn-1';
    const assistantId = 'assistant-withdrawn-1';

    for (const message of [
      { content: '照这两张图把商品列表页做出来', id: userId, role: 'user' },
      // 这正是 POST /api/runs 失败时落库的那一条:terminal 状态、没有 runId。
      { content: '', id: assistantId, role: 'assistant', runStatus: 'failed' },
    ]) {
      const resp = await fetch(messageUrl(projectId, conversationId, message.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      expect(resp.status).toBe(200);
    }
    expect((await listMessages(projectId, conversationId)).map((m) => m.id)).toEqual([
      userId,
      assistantId,
    ]);

    const deleteResp = await fetch(messageUrl(projectId, conversationId, assistantId), {
      method: 'DELETE',
    });
    expect(deleteResp.status).toBe(200);
    expect(await deleteResp.json()).toMatchObject({ deleted: true, ok: true });

    expect((await listMessages(projectId, conversationId)).map((m) => m.id)).toEqual([userId]);
  });

  it('is idempotent for an already-withdrawn placeholder', async () => {
    // 撤占位是尽力而为的清理:网络重试、双 tab、刷新之后再撤一次都可能发生。
    // 第二次删必须是无事发生,不能变成一个要处理的错误。
    const { conversationId, projectId } = await makeConversation('send-failed-idempotent');
    const resp = await fetch(messageUrl(projectId, conversationId, 'never-existed'), {
      method: 'DELETE',
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ deleted: false, ok: true });
  });

  it('refuses to delete a message that belongs to another conversation', async () => {
    // 与 PUT 同一条边界(#6418):id 撞到别的会话时宁可 404,也不许顺着路由把
    // 另一间屋子里的消息删掉。
    const a = await makeConversation('send-failed-scope-a');
    const b = await makeConversation('send-failed-scope-b');
    const messageId = 'scoped-assistant-1';

    const saveResp = await fetch(messageUrl(a.projectId, a.conversationId, messageId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: messageId, role: 'assistant', content: 'answer' }),
    });
    expect(saveResp.status).toBe(200);

    const crossResp = await fetch(messageUrl(b.projectId, b.conversationId, messageId), {
      method: 'DELETE',
    });
    expect(crossResp.status).toBe(404);
    expect((await listMessages(a.projectId, a.conversationId)).map((m) => m.id)).toEqual([
      messageId,
    ]);
  });
});
