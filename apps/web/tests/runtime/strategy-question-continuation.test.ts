import { describe, expect, it, vi } from 'vitest';
import type { ChatRunStatusResponse } from '@open-design/contracts';
import { resolveQuestionFormStrategyTaskExecutionId } from '../../src/runtime/strategy-question-continuation';

describe('question-form strategy continuation handle recovery', () => {
  it('recovers the task handle from status during the same-render projection race', async () => {
    const fetchRunStatus = vi.fn(async () => ({
      strategyTask: { taskExecutionId: 'task-1' },
    } as ChatRunStatusResponse));

    await expect(resolveQuestionFormStrategyTaskExecutionId({
      sourceRunId: 'run-1',
      fetchRunStatus,
    })).resolves.toBe('task-1');
    expect(fetchRunStatus).toHaveBeenCalledWith('run-1');
  });

  it('keeps an ordinary question form ordinary when status has no task', async () => {
    const fetchRunStatus = vi.fn(async () => ({ status: 'succeeded' } as ChatRunStatusResponse));

    await expect(resolveQuestionFormStrategyTaskExecutionId({
      sourceRunId: 'run-ordinary',
      fetchRunStatus,
    })).resolves.toBeUndefined();
  });

  it('does not reject or block submission when status recovery fails', async () => {
    const fetchRunStatus = vi.fn(async () => {
      throw new Error('daemon unavailable');
    });
    const submit = vi.fn();

    const taskExecutionId = await resolveQuestionFormStrategyTaskExecutionId({
      sourceRunId: 'run-unavailable',
      fetchRunStatus,
    });
    submit(taskExecutionId);

    expect(taskExecutionId).toBeUndefined();
    expect(submit).toHaveBeenCalledWith(undefined);
  });
});
