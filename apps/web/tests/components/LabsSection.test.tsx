// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OdNextRolloutControlStatus,
  OdNextRolloutLatchStatus,
  OdNextRolloutMode,
  OdNextRolloutModeSource,
} from '@open-design/contracts';

import { LabsSection } from '../../src/components/LabsSection';
import { I18nProvider } from '../../src/i18n';

function status(overrides: {
  requestedMode?: OdNextRolloutMode;
  requestedModeSource?: OdNextRolloutModeSource;
  latch?: OdNextRolloutLatchStatus | null;
} = {}): OdNextRolloutControlStatus {
  const requestedMode = overrides.requestedMode ?? 'off';
  return {
    strategyId: 'od-next-strategy',
    scope: 'daemon_instance',
    requestedMode,
    requestedModeSource: overrides.requestedModeSource ?? 'default',
    effectiveMode: requestedMode,
    latch: overrides.latch ?? null,
    revision: 0,
    updatedAt: null,
    lastEvent: null,
    resetAllowed: false,
  };
}

interface Stub {
  rolloutStatus?: OdNextRolloutControlStatus;
  rolloutFails?: boolean;
  writeFails?: boolean;
}

function stubFetch(options: Stub = {}) {
  const writes: unknown[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === '/api/strategies/od-next/rollout') {
      if (options.rolloutFails) return new Response('{}', { status: 500 });
      return new Response(
        JSON.stringify({ status: options.rolloutStatus ?? status() }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === '/api/app-config') {
      writes.push(JSON.parse(String(init?.body ?? '{}')));
      if (options.writeFails) return new Response('{}', { status: 500 });
      return new Response('{"config":{}}', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { writes, fetchMock };
}

function renderSection(onAutosaveStatus?: (s: 'saving' | 'saved' | 'error') => void) {
  return render(
    <I18nProvider initial="en">
      <LabsSection onAutosaveStatus={onAutosaveStatus} />
    </I18nProvider>,
  );
}

function switchEl(): HTMLButtonElement {
  return screen.getByTestId('labs-harness-switch') as HTMLButtonElement;
}

describe('LabsSection', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the harness row off and operable on a machine that never configured it', async () => {
    stubFetch();
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('false'));
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Design Harness')).toBeTruthy();
    expect(
      screen.getByText('Applies to your next generation · Existing work is untouched'),
    ).toBeTruthy();
  });

  it('renders on when the installation saved active', async () => {
    stubFetch({ rolloutStatus: status({ requestedMode: 'active', requestedModeSource: 'app_config' }) });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-checked')).toBe('true'));
    expect(switchEl().getAttribute('aria-disabled')).toBe('false');
  });

  it('shows observe as off without rewriting it', async () => {
    const { writes } = stubFetch({
      rolloutStatus: status({ requestedMode: 'observe', requestedModeSource: 'app_config' }),
    });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('false'));
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
    expect(writes).toEqual([]);
  });

  it('writes active on the first turn-on and reports it on the autosave surface', async () => {
    const { writes } = stubFetch();
    const onAutosaveStatus = vi.fn();
    renderSection(onAutosaveStatus);
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('false'));

    fireEvent.click(switchEl());

    await waitFor(() => expect(writes).toEqual([{ odNextStrategyMode: 'active' }]));
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(onAutosaveStatus.mock.calls.map((c) => c[0])).toEqual(['saving', 'saved']));
  });

  it('writes an explicit off rather than clearing the key', async () => {
    const { writes } = stubFetch({
      rolloutStatus: status({ requestedMode: 'active', requestedModeSource: 'app_config' }),
    });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-checked')).toBe('true'));

    fireEvent.click(switchEl());

    await waitFor(() => expect(writes).toEqual([{ odNextStrategyMode: 'off' }]));
  });

  it('rolls the switch back and reports an error when the write fails', async () => {
    stubFetch({ writeFails: true });
    const onAutosaveStatus = vi.fn();
    renderSection(onAutosaveStatus);
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('false'));

    fireEvent.click(switchEl());

    await waitFor(() => expect(onAutosaveStatus).toHaveBeenCalledWith('error'));
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
    expect(switchEl().getAttribute('aria-disabled')).toBe('false');
  });

  it('locks the switch and explains when an environment variable owns the mode', async () => {
    stubFetch({
      rolloutStatus: status({ requestedMode: 'active', requestedModeSource: 'env' }),
    });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('true'));
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText('An environment variable is controlling this setting, so it cannot be changed here.'),
    ).toBeTruthy();
  });

  it('locks the switch and explains when the local safety latch has tripped', async () => {
    stubFetch({
      rolloutStatus: status({
        requestedMode: 'active',
        requestedModeSource: 'app_config',
        latch: { mode: 'observe', reasonCode: 'quality_regression', latchedAt: 1 },
      }),
    });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('true'));
    expect(
      screen.getByText('Paused automatically after a problem was detected. Generation is using the original approach.'),
    ).toBeTruthy();
  });

  it('reports the latch, not the environment, when both would lock the switch', async () => {
    stubFetch({
      rolloutStatus: status({
        requestedMode: 'active',
        requestedModeSource: 'env',
        latch: { mode: 'off', reasonCode: 'machine_contract_leak', latchedAt: 1 },
      }),
    });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('true'));
    expect(
      screen.getByText('Paused automatically after a problem was detected. Generation is using the original approach.'),
    ).toBeTruthy();
    expect(
      screen.queryByText('An environment variable is controlling this setting, so it cannot be changed here.'),
    ).toBeNull();
  });

  it('keeps the page usable when the daemon cannot be reached', async () => {
    const { writes } = stubFetch({ rolloutFails: true });
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('true'));
    expect(screen.getByText('Design Harness')).toBeTruthy();
    expect(
      screen.getByText('Could not read this setting. Check that the local daemon is running.'),
    ).toBeTruthy();

    fireEvent.click(switchEl());
    expect(writes).toEqual([]);
  });

  it('reveals the explanation on hover and on keyboard focus, and never toggles from it', async () => {
    const { writes } = stubFetch();
    renderSection();
    await waitFor(() => expect(switchEl().getAttribute('aria-disabled')).toBe('false'));

    const trigger = screen.getByLabelText('About Design Harness');
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip').textContent).toContain('agent harness');
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').textContent).toContain('Hyperframes');
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(trigger);
    expect(writes).toEqual([]);
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
  });
});
