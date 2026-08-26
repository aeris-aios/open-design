import type { AgentEvent } from '../types';

import { isSnapshotTool } from './chat/tool-kind';

/**
 * 同一次 `tool_use` 被送两遍时只留第一条 —— SSE 重放会这样。
 *
 * **快照型工具除外**(`isSnapshotTool`):它们每次调用都是把整份状态替换一遍,
 * 有的 agent 干脆把「计划」建模成一个反复改写的条目,五次推进共用同一个 tool id。
 * 按 id 去重会把除第一次以外的状态推进全部丢掉 —— 真机撞到过:一轮跑完了,
 * 四条 todo 还全是虚线圈的「未开始」,第一条同时挂着 35.1s 的耗时和「未开始」的记号。
 * 重复的快照多留一份没有代价:落块是原地更新,同一份状态应用两次结果一样。
 */
export function dedupeToolUsesById(events: AgentEvent[] | undefined): AgentEvent[] {
  if (!events || events.length === 0) return [];

  const seen = new Set<string>();
  let deduped: AgentEvent[] | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.kind === 'tool_use' && !isSnapshotTool(event.name)) {
      if (seen.has(event.id)) {
        if (!deduped) deduped = events.slice(0, i);
        continue;
      }
      seen.add(event.id);
    }
    if (deduped) deduped.push(event);
  }

  return deduped ?? events;
}
