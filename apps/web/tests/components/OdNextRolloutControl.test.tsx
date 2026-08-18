// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OdNextRolloutControl } from '../../src/components/OdNextRolloutControl';
import { I18nProvider } from '../../src/i18n';

const latchedStatus = {
  strategyId: 'od-next-strategy' as const,
  scope: 'daemon_instance' as const,
  requestedMode: 'active' as const,
  effectiveMode: 'off' as const,
  latch: {
    mode: 'off' as const,
    reasonCode: 'route_mode_drift' as const,
    latchedAt: 1,
    updatedAt: 2,
  },
  revision: 7,
  lastEvent: {
    action: 'latched' as const,
    reasonCode: 'route_mode_drift' as const,
    at: 2,
  },
  resetAllowed: true,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OdNextRolloutControl', () => {
  it('shows the instance latch and resets the inspected revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: latchedStatus }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: {
          ...latchedStatus,
          effectiveMode: 'active',
          latch: null,
          revision: 8,
          lastEvent: { action: 'cleared', reasonCode: 'operator_reset', at: 3 },
          resetAllowed: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    render(
      <I18nProvider initial="en">
        <OdNextRolloutControl />
      </I18nProvider>,
    );

    expect(await screen.findByText('off · route_mode_drift')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset safety latch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/strategies/od-next/rollout/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 7 }),
      }),
    ]);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reset safety latch' })).toBeNull();
      expect(screen.getAllByText('active')).toHaveLength(2);
    });
  });
});
