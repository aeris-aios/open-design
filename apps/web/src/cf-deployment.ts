// CF self-hosted deployment - upstream cloud account UI hidden.
//
// This private single-team server has no OpenDesign Cloud account, so the
// cloud sign-in surfaces (onboarding step, rail callout) and the share-usage
// telemetry consent prompt are suppressed behind this single switch. Kept in
// its own module so downstream diffs against upstream stay one-line imports.
// Typed as `boolean` (not the literal `true`) so call sites stay free of
// unreachable-code narrowing and the flag can be flipped without type churn.
export const CLOUD_DISABLED: boolean = true;
