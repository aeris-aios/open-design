// The experience survey is api-mode: PostHog stores the responses but never
// sees the UI, so nothing on the PostHog side validates that the client sent
// the right question ids. A wrong or stale id does not error — it silently
// files answers under a question nobody is reading, and the loss is only
// visible weeks later when the analysis comes up empty. These tests pin the
// wire shape.
import { describe, expect, it, vi } from 'vitest';

import {
  trackExperienceSurveyDismissed,
  trackExperienceSurveySent,
  trackExperienceSurveyShown,
} from '../src/analytics/events';
import {
  EXPERIENCE_SURVEY_ID,
  EXPERIENCE_SURVEY_IMPROVEMENT_CHOICES,
  EXPERIENCE_SURVEY_QUESTION_IDS,
} from '../src/analytics/experience-survey-contract';

const ids = EXPERIENCE_SURVEY_QUESTION_IDS;

function capture() {
  const track = vi.fn();
  return {
    track,
    event: () => track.mock.calls[0]?.[0] as string,
    props: () => track.mock.calls[0]?.[1] as Record<string, unknown>,
  };
}

describe('experience survey response reporting', () => {
  it('sends every answer under its own question id', () => {
    const t = capture();
    trackExperienceSurveySent(t.track, {
      satisfaction: 4,
      recommendation: 9,
      improvement: 0,
      comment: '导出后几乎不用返工',
    });

    expect(t.event()).toBe('survey sent');
    expect(t.props()).toMatchObject({
      $survey_id: EXPERIENCE_SURVEY_ID,
      [`$survey_response_${ids.satisfaction}`]: 4,
      [`$survey_response_${ids.recommendation}`]: 9,
      [`$survey_response_${ids.improvement}`]: EXPERIENCE_SURVEY_IMPROVEMENT_CHOICES[0],
      [`$survey_response_${ids.comment}`]: '导出后几乎不用返工',
    });
  });

  it('reports the improvement choice as its canonical English label', () => {
    // The card renders a localized label; sending that would split one answer
    // into nineteen buckets, one per locale.
    const t = capture();
    trackExperienceSurveySent(t.track, { satisfaction: 3, improvement: 4 });

    expect(t.props()[`$survey_response_${ids.improvement}`]).toBe('Gets stuck or fails');
  });

  it('omits skipped questions instead of sending null', () => {
    // Per-question response counts have to stay honest about how many people
    // actually answered each question.
    const t = capture();
    trackExperienceSurveySent(t.track, { satisfaction: 5 });

    const props = t.props();
    expect(props[`$survey_response_${ids.satisfaction}`]).toBe(5);
    expect(props).not.toHaveProperty(`$survey_response_${ids.recommendation}`);
    expect(props).not.toHaveProperty(`$survey_response_${ids.improvement}`);
    expect(props).not.toHaveProperty(`$survey_response_${ids.comment}`);
    expect(props.$survey_questions).toHaveLength(1);
  });

  it('drops an empty comment rather than filing a blank answer', () => {
    const t = capture();
    trackExperienceSurveySent(t.track, { satisfaction: 2, comment: '' });

    expect(t.props()).not.toHaveProperty(`$survey_response_${ids.comment}`);
  });

  it('carries the question text so the event is readable without a join', () => {
    const t = capture();
    trackExperienceSurveySent(t.track, { satisfaction: 1, recommendation: 0 });

    expect(t.props().$survey_questions).toEqual([
      { id: ids.satisfaction, question: expect.stringContaining('satisfied'), response: 1 },
      { id: ids.recommendation, question: expect.stringContaining('recommend'), response: 0 },
    ]);
  });

  it('reports a zero score rather than treating it as unanswered', () => {
    // 0 on the 0–10 scale is a detractor, the most valuable answer we get.
    const t = capture();
    trackExperienceSurveySent(t.track, { satisfaction: 1, recommendation: 0, improvement: 0 });

    const props = t.props();
    expect(props[`$survey_response_${ids.recommendation}`]).toBe(0);
    expect(props[`$survey_response_${ids.improvement}`]).toBe(
      EXPERIENCE_SURVEY_IMPROVEMENT_CHOICES[0],
    );
  });

  it('uses the reserved event names PostHog survey analytics reads', () => {
    const shown = capture();
    trackExperienceSurveyShown(shown.track);
    expect(shown.event()).toBe('survey shown');
    expect(shown.props()).toEqual({ $survey_id: EXPERIENCE_SURVEY_ID });

    const dismissed = capture();
    trackExperienceSurveyDismissed(dismissed.track);
    expect(dismissed.event()).toBe('survey dismissed');
    expect(dismissed.props()).toEqual({ $survey_id: EXPERIENCE_SURVEY_ID });
  });
});
