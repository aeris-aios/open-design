import type { ChatRunStatusResponse } from '@open-design/contracts';

type FetchRunStatus = (runId: string) => Promise<ChatRunStatusResponse | null>;

/**
 * Recover the daemon-issued strategy task handle when the question form and
 * the run-created React projection become visible in the same render. Status
 * lookup is best-effort: an ordinary form, a missing Run, or a transport
 * failure must still submit as an ordinary next user turn.
 */
export async function resolveQuestionFormStrategyTaskExecutionId(input: {
  persistedTaskExecutionId?: string;
  sourceRunId?: string;
  fetchRunStatus: FetchRunStatus;
}): Promise<string | undefined> {
  if (input.persistedTaskExecutionId) return input.persistedTaskExecutionId;
  if (!input.sourceRunId) return undefined;

  try {
    const status = await input.fetchRunStatus(input.sourceRunId);
    return status?.strategyTask?.taskExecutionId;
  } catch {
    return undefined;
  }
}
