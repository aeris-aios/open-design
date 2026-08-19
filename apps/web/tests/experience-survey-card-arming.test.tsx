// @vitest-environment jsdom

// The card's arming rule is the whole product decision of this survey: ask
// after a delivered artifact, but never on top of someone writing their next
// prompt. Neither half is visible in the trigger module — the delay, the
// typing bail-out and the consent gate all live in the component — so they are
// pinned here.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

import { ExperienceSurvey } from '../src/components/ExperienceSurvey';
import {
  SURVEY_DELAY_MS,
  notifyArtifactDelivered,
} from '../src/components/experience-survey-trigger';

/** Puts the user one delivery short of qualifying, then delivers. */
function deliverUntilArmed() {
  act(() => {
    notifyArtifactDelivered();
    notifyArtifactDelivered();
  });
}

function typeSomething() {
  act(() => {
    document.body.dispatchEvent(new Event('beforeinput', { bubbles: true }));
  });
}

function passTheDelay() {
  act(() => {
    vi.advanceTimersByTime(SURVEY_DELAY_MS + 50);
  });
}

const card = () => screen.queryByText('experienceSurvey.recommendation');

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('experience survey card arming', () => {
  it('shows the card once a second delivery survives the delay', () => {
    render(<ExperienceSurvey metricsConsent />);

    deliverUntilArmed();
    // Still nothing: the delay exists so the user gets a beat with the
    // artifact before the card asks for attention.
    expect(card()).toBeNull();

    passTheDelay();
    expect(card()).not.toBeNull();
  });

  it('drops the chance when the user starts typing during the delay', () => {
    render(<ExperienceSurvey metricsConsent />);

    deliverUntilArmed();
    typeSomething();
    passTheDelay();

    expect(card()).toBeNull();
  });

  it('takes the next delivery after a dropped one', () => {
    render(<ExperienceSurvey metricsConsent />);

    deliverUntilArmed();
    typeSomething();
    passTheDelay();
    expect(card()).toBeNull();

    // The user stopped typing and ran one more turn. A dropped chance must not
    // be a permanent one, or an iterating user is never asked at all.
    act(() => { notifyArtifactDelivered(); });
    passTheDelay();
    expect(card()).not.toBeNull();
  });

  it('never arms without metrics consent', () => {
    render(<ExperienceSurvey metricsConsent={false} />);

    deliverUntilArmed();
    passTheDelay();

    expect(card()).toBeNull();
  });
});
