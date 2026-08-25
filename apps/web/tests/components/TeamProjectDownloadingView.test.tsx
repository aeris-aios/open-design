// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../../src/i18n';
import { TeamProjectDownloadingView } from '../../src/components/TeamProjectDownloadingView';

// Pixel-layer half of the OPEND-2095 red spec (the decision half lives in
// tests/App.test.ts as `projectRouteSurfaceState`). A member's first open of a
// team-shared project spends its longest stretch on the project route BEFORE
// ProjectView — and therefore every download indicator ProjectView owns — can
// mount. That stretch used to render the shell's generic "Loading workspace…"
// spinner, which is indistinguishable from a hang.

afterEach(cleanup);

describe('TeamProjectDownloadingView', () => {
  it('states that the team files are downloading instead of showing a bare spinner', () => {
    render(
      <I18nProvider initial="en">
        <TeamProjectDownloadingView />
      </I18nProvider>,
    );

    const surface = screen.getByTestId('project-route-team-downloading');
    expect(screen.getByRole('status').textContent).toContain('Syncing files from the team');
    // The animated download badge, not the neutral app spinner: the two are
    // what tell a member "content is arriving" vs "something is loading".
    expect(surface.querySelector('svg')).not.toBeNull();
    expect(surface.querySelector('.loading-spinner')).toBeNull();
  });

  it('announces itself to assistive tech, since the badge alone is decorative', () => {
    render(
      <I18nProvider initial="en">
        <TeamProjectDownloadingView />
      </I18nProvider>,
    );

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Syncing files from the team');
  });

  it('reuses the exact sentence ProjectView shows once it mounts', () => {
    // The hand-off from this surface to ProjectView must read as one
    // continuous download. Two different sentences for the same wait made the
    // first open look like two unrelated stalls.
    render(
      <I18nProvider initial="en">
        <TeamProjectDownloadingView />
      </I18nProvider>,
    );

    // Read the label element, not the container: the badge inlines its own
    // <style> keyframes, so the container's textContent carries CSS too.
    expect(screen.getByRole('status').textContent?.trim())
      .toBe('Syncing files from the team…');
  });
});
