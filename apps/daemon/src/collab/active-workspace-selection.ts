import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

interface ActiveWorkspaceSelectionFile {
  workspaceId?: unknown;
}

export interface ActiveWorkspaceSelectionStore {
  get(): string | null;
  snapshot(): { workspaceId: string | null; generation: number };
  set(workspaceId: string): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: (workspaceId: string | null) => void): () => void;
}

interface AuthorizationWorkspaceContextSnapshot {
  context: {
    workspaceId: string;
    teamId?: string | undefined;
    workspaceMemberId: string;
    workspaceType: string;
    memberStatus: string;
    lifecycleState: string;
  } | null;
  generation: number;
}

export function resolveAuthorizedActiveTeamWorkspaceSnapshot(
  selection: { workspaceId: string | null; generation: number },
  observed: AuthorizationWorkspaceContextSnapshot,
): { workspaceId: string | null; generation: number } {
  const context = observed.context;
  const activeTeamWorkspaceId =
    context?.workspaceType === 'team' &&
    context.memberStatus === 'active' &&
    context.lifecycleState === 'active' &&
    Boolean(context.teamId?.trim()) &&
    Boolean(context.workspaceMemberId.trim())
      ? context.workspaceId
      : null;
  const pinMatches =
    selection.workspaceId == null ||
    selection.workspaceId === activeTeamWorkspaceId;
  return {
    workspaceId: pinMatches ? activeTeamWorkspaceId : null,
    generation: selection.generation + observed.generation,
  };
}

export function createActiveWorkspaceSelectionStore(
  dataDir: string,
): ActiveWorkspaceSelectionStore {
  const filePath = path.join(dataDir, 'workspace-selection.json');
  let cached: string | null | undefined;
  let generation = 0;
  const listeners = new Set<(workspaceId: string | null) => void>();

  const read = (): string | null => {
    if (cached !== undefined) return cached;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as ActiveWorkspaceSelectionFile;
      cached = typeof parsed.workspaceId === 'string' && parsed.workspaceId.trim()
        ? parsed.workspaceId.trim()
        : null;
    } catch {
      cached = null;
    }
    return cached;
  };

  const notify = (workspaceId: string | null) => {
    for (const listener of listeners) {
      try {
        listener(workspaceId);
      } catch {
        // Selection persistence must not fail because one observer did.
      }
    }
  };

  return {
    get: read,
    snapshot() {
      return { workspaceId: read(), generation };
    },
    async set(workspaceId: string) {
      const next = workspaceId.trim();
      if (!next) throw new Error('workspaceId is required');
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(
          tempPath,
          JSON.stringify({ workspaceId: next }, null, 2),
          'utf8',
        );
        await fs.promises.rename(tempPath, filePath);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      cached = next;
      generation += 1;
      notify(next);
    },
    async clear() {
      await fs.promises.rm(filePath, { force: true });
      cached = null;
      generation += 1;
      notify(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
