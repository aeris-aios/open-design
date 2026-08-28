import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { sendStructuredRunCreateFailure } from '../../src/routes/runs.js';

describe('Run creation structured failures', () => {
  it('returns a traceable JSON error without exposing the underlying failure', () => {
    const sendApiError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = {} as Response;

    try {
      sendStructuredRunCreateFailure(
        res,
        sendApiError,
        Object.assign(new Error('secret input at C:\\private\\prompt.txt'), { code: 'EPERM' }),
        'request-fixture-123',
      );

      expect(sendApiError).toHaveBeenCalledWith(
        res,
        500,
        'INTERNAL_ERROR',
        'Run preparation failed.',
        { requestId: 'request-fixture-123' },
      );
      expect(consoleError).toHaveBeenCalledWith(
        '[runs] preparation failed request=request-fixture-123 code=EPERM',
      );
      expect(JSON.stringify(sendApiError.mock.calls)).not.toContain('private');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret input');
    } finally {
      consoleError.mockRestore();
    }
  });
});
