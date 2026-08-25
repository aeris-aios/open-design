// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoPlanSunsetDialog,
  isGoPlanSunsetDemo,
  resolveGoPlanSunsetCampaigns,
  shouldShowWhatsNewPopup,
} from '../../src/components/GoPlanSunsetDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GoPlanSunsetDialog', () => {
  it('enables only the dedicated demo query value', () => {
    expect(isGoPlanSunsetDemo('?demo=go-plan-sunset')).toBe(true);
    expect(isGoPlanSunsetDemo('?demo=other')).toBe(false);
    expect(isGoPlanSunsetDemo('?campaign=go-plan-sunset')).toBe(false);
  });

  it('suppresses existing Home campaigns only while the sunset demo is active', () => {
    expect(resolveGoPlanSunsetCampaigns(true, 'unpaid', 'go')).toEqual({
      homeCampaignModalAudience: 'unknown',
      topRightCampaignKind: null,
    });
    expect(resolveGoPlanSunsetCampaigns(false, 'paid', 'deepseek')).toEqual({
      homeCampaignModalAudience: 'paid',
      topRightCampaignKind: 'deepseek',
    });
  });

  it('lets the sunset demo own the Home modal slot', () => {
    expect(shouldShowWhatsNewPopup(true, true)).toBe(false);
    expect(shouldShowWhatsNewPopup(true, false)).toBe(true);
    expect(shouldShowWhatsNewPopup(false, false)).toBe(false);
  });

  it('shows the announcement on an active Home demo and dismisses it', () => {
    render(<GoPlanSunsetDialog active />);

    expect(
      screen.getByRole('heading', { name: '关于停售 Go 订阅的说明' }),
    ).toBeInTheDocument();
    expect(screen.getByText('即日起停售 Go 新订阅')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看其他订阅' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the subscription catalog from the secondary action', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<GoPlanSunsetDialog active />);

    fireEvent.click(screen.getByRole('button', { name: '查看其他订阅' }));

    expect(open).toHaveBeenCalledWith(
      'https://open-design.ai/amr/dashboard?source=open_design&billing=plan',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('keeps an explicit dismissal for the rest of the mounted session', () => {
    const { rerender } = render(<GoPlanSunsetDialog active />);

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    rerender(<GoPlanSunsetDialog active={false} />);
    rerender(<GoPlanSunsetDialog active />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('focuses the modal, isolates the background, and restores focus on close', () => {
    const backgroundButton = document.createElement('button');
    document.body.appendChild(backgroundButton);
    backgroundButton.focus();

    render(<GoPlanSunsetDialog active />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveFocus();
    expect(backgroundButton).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));

    expect(backgroundButton).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    expect(backgroundButton).toHaveFocus();
    backgroundButton.remove();
  });

  it('does not render outside the active Home view', () => {
    render(<GoPlanSunsetDialog active={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
