// Wire contract between the in-app experience survey and its PostHog record.
//
// The survey is `type: api` in PostHog: PostHog stores and analyses the
// responses, but renders nothing — `ExperienceSurvey` owns the UI so the card
// follows the app's material, theme and all 19 locales. That split means the
// client is responsible for emitting the survey events in the shape PostHog's
// survey analytics expects, which is what this module encodes.
//
// The ids below are the PostHog survey's own. They are stable once created, so
// hard-coding them keeps the client free of a fetch-before-render round trip.
//
//   Survey: https://us.posthog.com/project/420348/surveys/01a00fd1-ed7e-0000-d38e-63bce21fb816
//
// EDITING THE QUESTIONS IN POSTHOG REGENERATES NOTHING HERE. If a question is
// added, removed or reordered there, update this file in the same change or
// responses will land under the wrong question id.

export const EXPERIENCE_SURVEY_ID = '01a00fd1-ed7e-0000-d38e-63bce21fb816';

export const EXPERIENCE_SURVEY_QUESTION_IDS = {
  satisfaction: 'a51c0f1e-7ed2-462f-89bf-823d85a5c8e3',
  recommendation: '146fefc0-9c11-4003-9869-1fd81be1650f',
  improvement: 'e487f41a-8111-4a87-8795-1358c9a11b55',
  comment: '48181098-939d-4b93-9c47-d97cc6b1e88c',
} as const;

/**
 * The question text as PostHog stores it. Sent alongside each response so the
 * `$survey_questions` payload is self-describing in the events table — a reader
 * should not have to join against the survey definition to know what was asked.
 */
export const EXPERIENCE_SURVEY_QUESTION_TEXT = {
  satisfaction: 'Overall, how satisfied are you with Open Design?',
  recommendation: 'How likely are you to recommend Open Design to a colleague or friend?',
  improvement: 'Which one should we improve first?',
  comment: 'What is the single biggest reason for your rating?',
} as const;

/**
 * Improvement choices in the order the card renders them. The card shows the
 * localized label but reports the canonical English choice, so responses stay
 * comparable across all 19 locales instead of splitting into 19 buckets.
 */
export const EXPERIENCE_SURVEY_IMPROVEMENT_CHOICES = [
  'Output quality',
  'Speed',
  'Export and handoff',
  'Collaboration and Workspace',
  'Models and quota',
  'Stability',
] as const;
