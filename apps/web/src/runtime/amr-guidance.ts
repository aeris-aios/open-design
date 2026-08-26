// Shared logic that maps a failed run's error code + agent into the failure
// UI: which contextual button the gray error card shows, whether to override
// the error text, and whether to show the AMR promotion card below. Kept in
// its own module so ChatPane / ProjectView / AssistantMessage can import it
// without a circular dependency.
import {
  isModelWindowLimitFailure,
  readModelWindowResetAt,
} from '@open-design/contracts';

// AMR model-gateway console (account, balance, top-up, plans).
// `source=open_design` tags the landing page_view so vela analytics can
// attribute the visit to OpenDesign (per-product revenue/traffic attribution).
//
// The console's dashboard — not a wallet page — is the account surface every
// entry here targets. A wallet route still answers on B's side, but it is no
// longer part of the product's information architecture: balance, manual
// top-up and the auto-recharge policy were all rehomed onto the dashboard
// (vela #1055), so sending a user to /wallet would drop them on a surface the
// product no longer navigates to.
export const AMR_CONSOLE_URL =
  'https://open-design.ai/amr/dashboard?source=open_design';
export const DEFAULT_AMR_RECHARGE_URL = AMR_CONSOLE_URL;
export const AMR_RECHARGE_URL = DEFAULT_AMR_RECHARGE_URL;

// Path + attribution the console is always reached through, so a runtime
// origin only has to carry the host.
const AMR_CONSOLE_PATH = '/dashboard?source=open_design';

/**
 * The console's `billing=<intent>` value that means "open the upgrade surface
 * that matches THIS workspace".
 *
 * B's dashboard resolves it against the workspace's own subscription state
 * rather than trusting the caller: a personal owner gets the personal plan
 * modal (the same one the console's 「升级订阅」 hero button opens), a team
 * that never subscribed gets first-checkout, and a subscribed team gets
 * change-plan. That is why this client links one intent for every state
 * instead of guessing a per-state parameter — a wrong guess used to open
 * nothing at all (recvpSQKna0LwR).
 */
export const AMR_CONSOLE_UPGRADE_INTENT = 'plan';

const AMR_CONSOLE_URL_BY_PROFILE: Record<string, string> = {
  prod: DEFAULT_AMR_RECHARGE_URL,
  test: 'https://vela.powerformer.net/dashboard?source=open_design',
  local: 'http://localhost:5173/dashboard?source=open_design',
};

// Every AMR profile the packaged runtime can be built with (mirrors the daemon's
// resolveAmrProfile allowlist). Anything else is treated as prod.
const KNOWN_AMR_PROFILES: ReadonlySet<string> = new Set([
  'prod',
  'test',
  'feature-test',
  'local',
]);

// Console origin the daemon reported for THIS runtime (GET
// /api/integrations/vela/status -> consoleOrigin, sourced from OD_VELA_WEB_URL).
//
// The web bundle ships publicly, so the hostnames of internal (non-public) AMR
// environments are not literals in this source tree: packaging injects the
// origin from a CI secret and the daemon hands it to the client at runtime.
// Kept module-level rather than threaded through every caller because it is a
// property of the runtime, not of any one call site, and it is written once per
// status fetch (see setRuntimeAmrConsoleOrigin's single caller in
// providers/daemon.ts).
let runtimeAmrConsoleOrigin: string | null = null;

/**
 * Record the vela console origin the daemon reported, or clear it with a blank
 * value. Normalizes away a trailing slash so callers can append console paths.
 */
export function setRuntimeAmrConsoleOrigin(origin: string | null | undefined): void {
  const normalized = origin?.trim().replace(/\/$/, '') ?? '';
  runtimeAmrConsoleOrigin = normalized.length > 0 ? normalized : null;
}

export function amrConsoleUrlForProfile(
  profile: string | null | undefined,
  consoleOrigin?: string | null,
): string {
  const normalized = profile?.trim() || 'prod';
  // prod's console is the public product URL and stays pinned to it: a runtime
  // origin must never be able to redirect a production user's account, plan, or
  // upgrade links somewhere else. Unrecognized profiles are treated as prod for
  // the same reason.
  if (normalized === 'prod' || !KNOWN_AMR_PROFILES.has(normalized)) {
    return DEFAULT_AMR_RECHARGE_URL;
  }
  const statusOrigin = consoleOrigin?.trim().replace(/\/$/, '') ?? '';
  if (statusOrigin) return `${statusOrigin}${AMR_CONSOLE_PATH}`;
  if (runtimeAmrConsoleOrigin) return `${runtimeAmrConsoleOrigin}${AMR_CONSOLE_PATH}`;
  return AMR_CONSOLE_URL_BY_PROFILE[normalized] ?? DEFAULT_AMR_RECHARGE_URL;
}

export function amrRechargeUrlForProfile(profile: string | null | undefined): string {
  return amrConsoleUrlForProfile(profile);
}

function amrWorkspaceUrl(
  profile: string | null | undefined,
  workspaceId: string | null | undefined,
  intent?: 'plans',
): string | null {
  const normalizedWorkspaceId = workspaceId?.trim();
  if (!normalizedWorkspaceId) return null;
  const url = new URL(amrConsoleUrlForProfile(profile));
  url.searchParams.set('workspaceId', normalizedWorkspaceId);
  if (intent === 'plans') url.searchParams.set('billing', AMR_CONSOLE_UPGRADE_INTENT);
  return url.toString();
}

export function amrConsoleUrlForWorkspace(
  profile: string | null | undefined,
  workspaceId: string | null | undefined,
): string | null {
  return amrWorkspaceUrl(profile, workspaceId);
}

export function amrPlansUrlForWorkspace(
  profile: string | null | undefined,
  workspaceId: string | null | undefined,
): string | null {
  return amrWorkspaceUrl(profile, workspaceId, 'plans');
}

// Console dashboard deep-linked to open the subscription/plans modal, used by
// the "Upgrade" affordances next to the plan tier.
export function amrPlansUrlForProfile(profile: string | null | undefined): string {
  const base = amrConsoleUrlForProfile(profile);
  const intent = `billing=${AMR_CONSOLE_UPGRADE_INTENT}`;
  return base.includes('?') ? `${base}&${intent}` : `${base}?${intent}`;
}

export function amrProfileBadgeLabel(profile: string | null | undefined): string | null {
  if (profile === 'test') return 'TEST';
  if (profile === 'feature-test') return 'FEATURE TEST';
  if (profile === 'local') return 'LOCAL';
  return null;
}

// Codes that mean a non-AMR agent hit "the model service rejected or could not
// serve the run" — auth missing/invalid, quota/rate exhausted, or the upstream
// model endpoint was unavailable. These are the failures worth promoting AMR
// for. Generic process failures (AGENT_EXECUTION_FAILED) and missing binaries
// (AGENT_UNAVAILABLE) are excluded.
const PROMOTE_AMR_CODES = new Set<string>([
  'AGENT_AUTH_REQUIRED',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
]);

// Primary action offered in the gray error card.
//   - retry:                       re-run with the current agent.
//   - authorize:                   AMR sign-in/authorize flow, then auto-retry on success.
//   - recharge:                    open the AMR console (manual retry afterwards).
//   - upgrade:                     open the AMR plan modal (manual retry afterwards).
//   - launch-terminal-auth:        Antigravity-specific. agy's `-p`
//                                  print mode cannot complete Google
//                                  Sign-In on its own (no input field
//                                  for the auth code), so OD spawns a
//                                  system Terminal running `agy` and
//                                  the user finishes OAuth there.
//   - switch-model:                the selected model is gone/disabled, so a
//                                  retry reproduces the same answer. Opens the
//                                  model picker (Settings → Execution) instead
//                                  of offering a dead Retry. Design principle
//                                  4: a retry button only appears where a retry
//                                  can actually work.
//   - launch-terminal-switch-model: Antigravity-specific. agy has no
//                                  `--model` flag (upstream #35), so
//                                  switching to a model with available
//                                  quota means opening agy's TUI and
//                                  using its Switch Model picker. The
//                                  daemon spawns the same terminal as
//                                  launch-terminal-auth — the button
//                                  label is the only thing that changes.
//   - switch-to-cloud:             ladder rung 3. This local path cannot work at
//                                  all (nothing installed, nothing signed in,
//                                  the provider's quota is spent) and none of
//                                  the fixes are in our hands, so the forward
//                                  path is the hosted alternative. The card
//                                  itself draws no button — the AMR switch card
//                                  rendered underneath IS the primary action.
//   - contact-support:             ladder rung 4. Retrying is futile and we have
//                                  no other way out, so the always-present
//                                  secondary 〔Contact support〕 is promoted to
//                                  primary rather than leaving a dead-end card.
// Both terminal-launch actions pair with `secondaryRetry: true` so the
// user has a Retry button after the external step completes (OAuth /
// switching models happens out-of-band; we can't auto-retry from the
// daemon side).
export type RunFailurePrimaryAction =
  | 'retry'
  | 'authorize'
  | 'recharge'
  | 'upgrade'
  | 'switch-model'
  | 'launch-terminal-auth'
  | 'launch-terminal-switch-model'
  | 'switch-to-cloud'
  | 'contact-support';

// i18n keys for the gray-card text override (null = show the raw error).
// Keys ending in a value with `{agent}` are interpolated at render time via
// t(key, { agent }) (see ChatPane displayError).
export type RunFailureMessageKey =
  | 'chat.amrError.authMessage'
  | 'chat.amrError.balanceMessage'
  | 'chat.connectionDropped'
  | 'chat.runError.signInMessage.amr'
  | 'chat.runError.signInMessage.other'
  | 'chat.runError.cliMissingMessage'
  | 'chat.runError.promptTooLargeMessage'
  | 'chat.runError.modelUnavailableMessage'
  | 'chat.runError.rateLimitedMessage'
  | 'chat.runError.modelWindowLimitMessage'
  | 'chat.runError.modelWindowLimitMessageNoTime'
  | 'chat.runError.upstreamUnavailableMessage'
  | 'chat.runError.toolLoopMessage'
  | 'chat.runError.outputInvalidMessage'
  | 'chat.runError.runtimeConfigMessage'
  | 'chat.runError.quotaExhaustedMessage'
  | 'chat.runError.workspaceCreditsMessage'
  | 'chat.runError.timedOutMessage'
  | 'chat.runError.inactivityTimeoutMessage'
  | 'chat.runError.emptyOutputMessage'
  | 'chat.runError.sessionExpiredMessage'
  | 'chat.runError.gitBashMissingMessage'
  | 'chat.runError.cpuUnsupportedMessage'
  | 'chat.runError.agentCrashedMessage'
  | 'chat.runError.accountSuspendedMessage'
  | 'chat.runError.fallbackMessage'
  | null;

/**
 * The one sentence a failure card falls back to when its mapping carries no
 * copy of its own.
 *
 * Before this existed the card rendered `rawError` — the upstream string, in
 * English, sometimes a slab of stderr — straight onto the card face, which is
 * design principle 5 ("say it in plain words") inverted. The raw text is still
 * reachable: it stays in the collapsible diagnostic area, which is where the
 * engineering-facing copy belongs.
 */
export const RUN_FAILURE_FALLBACK_MESSAGE_KEY =
  'chat.runError.fallbackMessage' as const;

// i18n keys for the unified error card's TITLE (the "error type" line above the
// detail message). Frontend-only mapping from error code → human-readable type;
// the daemon does not yet emit a type name (the raw status label is just the
// word "error"). A full backend type ⇄ frontend pairing is a later effort.
export type RunFailureTitleKey =
  | 'chat.runError.title.authRequired'
  | 'chat.runError.title.balance'
  | 'chat.runError.title.connectionDropped'
  | 'chat.runError.title.signInRequired'
  | 'chat.runError.title.rateLimited'
  | 'chat.runError.title.modelWindowLimit'
  | 'chat.amrBalanceGate.title'
  | 'chat.runError.title.cliMissing'
  | 'chat.runError.title.promptTooLarge'
  | 'chat.runError.title.modelUnavailable'
  | 'chat.runError.title.upstreamUnavailable'
  | 'chat.runError.title.toolLoop'
  | 'chat.runError.title.outputInvalid'
  | 'chat.runError.title.runtimeConfig'
  | 'chat.runError.title.quotaExhausted'
  | 'chat.runError.title.timedOut'
  | 'chat.runError.title.emptyOutput'
  | 'chat.runError.title.sessionExpired'
  | 'chat.runError.title.gitBashMissing'
  | 'chat.runError.title.artifactMissing'
  | 'chat.runError.title.cpuUnsupported'
  | 'chat.runError.title.agentCrashed'
  | 'chat.runError.title.accountSuspended'
  | 'chat.runError.title.generic';

export interface RunFailureUi {
  primaryAction: RunFailurePrimaryAction;
  // Title shown above the detail message — names the failure type.
  titleKey: RunFailureTitleKey;
  // Override the gray error card's text (e.g. AMR auth / balance get a clearer
  // explanation than the raw upstream string).
  messageKey: RunFailureMessageKey;
  // Interpolation values for `messageKey`, for the cases whose copy names
  // something the daemon read off the failure (e.g. when a rolling model window
  // reopens). Absent for every message that is a fixed sentence.
  messageVars?: Record<string, string>;
  // Show a secondary plain "retry" button alongside the primary action (used
  // by the recharge case, where retry is manual after topping up).
  secondaryRetry: boolean;
  // Show the AMR promotion card under the gray error card.
  showSwitchCard: boolean;
}

/**
 * The two window-limit message keys, narrowed away from `RunFailureMessageKey`
 * (which includes `null` for the cases that keep the raw upstream string) so
 * callers can hand the result straight to `t()` without a non-null assertion.
 */
export type ModelWindowLimitMessageKey =
  | 'chat.runError.modelWindowLimitMessage'
  | 'chat.runError.modelWindowLimitMessageNoTime';

/**
 * The copy a rolling model-window rejection should render, or null when the
 * text is some other failure.
 *
 * Two surfaces need this and they arrive from opposite directions: the chat
 * card already knows the daemon's `model_window_limit` classification and only
 * wants the instant, while the Home composer fails before a run exists and has
 * nothing but the raw upstream sentence. Sharing one reader keeps them from
 * disagreeing about what counts as a window limit.
 */
export function modelWindowLimitCopy(
  rawMessage: string | null | undefined,
): { messageKey: ModelWindowLimitMessageKey; retryAt?: string } | null {
  if (!isModelWindowLimitFailure(rawMessage)) return null;
  const parsed = readModelWindowResetAt(rawMessage);
  // Shape-valid but not a real instant (`2026-13-45T…`) counts as unreadable,
  // so the message key and the variable can never disagree about whether a
  // time exists — the card would otherwise render "Invalid Date".
  const retryAt = parsed && Number.isFinite(Date.parse(parsed)) ? parsed : null;
  return retryAt
    ? { messageKey: 'chat.runError.modelWindowLimitMessage', retryAt }
    // Promising a time we could not read is worse than not naming one.
    : { messageKey: 'chat.runError.modelWindowLimitMessageNoTime' };
}

/**
 * The instant a model window reopens, rendered for a reader in `locale`.
 *
 * The gateway reports UTC; a user waiting on a clock needs their own. Date and
 * time are both shown because the wait can cross midnight, and the year is left
 * off because a rolling window never reaches one.
 *
 * Returns the input untouched if it cannot be formatted, so the copy degrades
 * to a machine-readable instant rather than to a gap.
 */
export function formatModelWindowRetryAt(retryAt: string, locale: string): string {
  const parsed = new Date(retryAt);
  if (!Number.isFinite(parsed.getTime())) return retryAt;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return retryAt;
  }
}

/**
 * The rung-1 actions: the things we can do FOR the user in one click.
 *
 * Narrowed out of `RunFailurePrimaryAction` so a mapping cannot accidentally
 * declare "we have a direct fix" and then name `retry` (rung 2) or
 * `contact-support` (rung 4) as that fix.
 */
export type RunFailureDirectFix = Extract<
  RunFailurePrimaryAction,
  | 'authorize'
  | 'recharge'
  | 'upgrade'
  | 'switch-model'
  | 'launch-terminal-auth'
  | 'launch-terminal-switch-model'
>;

/**
 * What KIND of failure this is — the only thing a mapping has to declare.
 *
 * Every field is a question about the failure itself, not about the button we
 * want. The button is derived (`primaryActionForFailure`), which is the whole
 * point: adding a new failure code means answering three questions, not picking
 * a CTA by hand and hoping it stays consistent with the sixteen picked before it.
 */
export interface RunFailureNature {
  /** Rung 1 — we have a one-click action that actually resolves this. */
  directFix?: RunFailureDirectFix;
  /** Rung 2 — running it again can plausibly succeed (possibly after the user does something). */
  transient?: boolean;
  /** Rung 3 — this local path cannot work at all and the fix isn't in our hands. */
  localDeadEnd?: boolean;
}

/**
 * The primary-button ladder (`specs/current/run-error-catalog.md` §6.Z),
 * top-down; the first rung that matches wins.
 *
 *   1. We have an action that directly solves it   → that action
 *   2. The failure is transient                    → retry from where it failed
 *   3. This local path cannot work at all          → switch to Cloud
 *   4. None of the above                           → contact support (promoted
 *                                                     from the standing secondary)
 *
 * One ladder covers both environments: a run that is ALREADY on Cloud never
 * trips rung 3, so it degrades to the Cloud answer on its own — no second table.
 *
 * Rung 1 outranks rung 3 deliberately (user's words): someone paying for their
 * own CLI/BYOK who hits a "just switch models" problem must not be told to buy
 * a second product instead — that puts marketing ahead of solving the problem.
 *
 * Rung 4 is what makes design principle 4 hold structurally rather than by
 * vigilance: a failure that declares neither a direct fix nor transience can no
 * longer end up with a Retry button, because nothing in this function can
 * produce one.
 *
 * §6.T maps the rungs onto the F0–F10 flow table: rung 1 = F4/F5/F6/F7/F8,
 * rung 2 = F1/F2/F3/F9, rung 3 has no F-row (it is new in the ladder),
 * rung 4 = F10.
 */
export function primaryActionForFailure(
  nature: RunFailureNature,
): RunFailurePrimaryAction {
  if (nature.directFix) return nature.directFix;
  if (nature.transient) return 'retry';
  if (nature.localDeadEnd) return 'switch-to-cloud';
  return 'contact-support';
}

/**
 * Does THIS card draw a control that can push the failed run forward?
 *
 * Rung 3 and rung 4 both answer no: rung 3's button lives on the switch card
 * rendered underneath, and "contact support" opens a conversation, not a
 * recovery. Callers use it to decide whether to offer the generic local-CLI
 * escape hatch alongside.
 */
export function hasSelfContainedRecovery(ui: RunFailureUi | null | undefined): boolean {
  if (!ui) return false;
  if (ui.secondaryRetry) return true;
  return ui.primaryAction !== 'switch-to-cloud' && ui.primaryAction !== 'contact-support';
}

/**
 * Build a failure card from the nature of the failure. Callers never name a
 * primary action — they describe the failure and the ladder answers.
 */
function failureCard(
  nature: RunFailureNature,
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
  extra: Partial<Pick<RunFailureUi, 'secondaryRetry' | 'showSwitchCard' | 'messageVars'>> = {},
): RunFailureUi {
  return {
    primaryAction: primaryActionForFailure(nature),
    titleKey,
    messageKey,
    secondaryRetry: extra.secondaryRetry ?? false,
    // Rung 3 says the way out is the hosted alternative, so the switch card is
    // that rung's button and is always on. Any other rung may still promote AMR
    // for its own reasons, but has to ask for it.
    showSwitchCard: extra.showSwitchCard ?? Boolean(nature.localDeadEnd),
    ...(extra.messageVars ? { messageVars: extra.messageVars } : {}),
  };
}

// Named failure type + actionable copy, recovered by re-running once the user
// has followed the instruction (ladder rung 2). No AMR promotion — these root
// causes aren't "switch to hosted model" cases.
function retryWithGuidance(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({ transient: true }, titleKey, messageKey);
}

/**
 * The selected model cannot serve this run at all — it is missing, disabled, or
 * no longer in the catalogue. Retrying re-picks the same model and reproduces
 * the same answer, so the card offers the one thing that changes the outcome:
 * picking a different model (ladder rung 1).
 */
function switchModelWithGuidance(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({ directFix: 'switch-model' }, titleKey, messageKey);
}

/**
 * Nothing on this card can move the run forward and retrying is futile
 * (ladder rung 4). 〔Contact support〕 — a standing secondary on every failure
 * card — is promoted to primary so the card is never a dead end.
 */
function contactSupportOnly(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({}, titleKey, messageKey);
}

// Agent-agnostic failure codes that carry a clear root cause and a concrete
// fix, mapped the same way regardless of which agent produced them. The daemon
// already classifies these into failure_category / user_action
// (apps/daemon/src/run-failure-classification.ts); this is the user-facing half
// of that taxonomy — a human-readable type name plus a one-line instruction,
// with the raw upstream string preserved in the card's collapsible source area.
const AGENT_AGNOSTIC_FAILURE_UI: Record<string, RunFailureUi> = {
  // The run completed but did not leave a deliverable file. Name the actual
  // missing outcome in the compact card and keep the raw reason in details.
  ARTIFACT_NOT_FOUND: retryWithGuidance(
    'chat.runError.title.artifactMissing',
    null,
  ),
  // CLI binary not found on PATH (user_action: install_cli).
  AGENT_UNAVAILABLE: retryWithGuidance(
    'chat.runError.title.cliMissing',
    'chat.runError.cliMissingMessage',
  ),
  // Input exceeded the model context window (user_action: reduce_context).
  AGENT_PROMPT_TOO_LARGE: retryWithGuidance(
    'chat.runError.title.promptTooLarge',
    'chat.runError.promptTooLargeMessage',
  ),
  // Selected model is missing/disabled (user_action: switch_model). The daemon
  // already names the fix — offer it as the button instead of a Retry that is
  // guaranteed to fail the same way.
  AMR_MODEL_UNAVAILABLE: switchModelWithGuidance(
    'chat.runError.title.modelUnavailable',
    'chat.runError.modelUnavailableMessage',
  ),
  // Guard halted a repeating, non-progressing tool loop (user_action: retry
  // after checking the real target).
  TOOL_LOOP_DETECTED: retryWithGuidance(
    'chat.runError.title.toolLoop',
    'chat.runError.toolLoopMessage',
  ),
  // Model emitted a fabricated role marker and was aborted; a plain retry
  // usually recovers.
  ROLE_MARKER_HALLUCINATION: retryWithGuidance(
    'chat.runError.title.outputInvalid',
    'chat.runError.outputInvalidMessage',
  ),
  // Checked-in runtime def failed strict validation (user_action: fix_config).
  // Ladder rung 4 (catalogue R-031: flow F10, "retryable: no"): the user cannot
  // self-repair and a new run re-reads the same invalid definition, so the
  // button now matches what the copy has always said — talk to us.
  AGENT_RUNTIME_DEF_INVALID: contactSupportOnly(
    'chat.runError.title.runtimeConfig',
    'chat.runError.runtimeConfigMessage',
  ),
};

// Ladder rung 3: this local path cannot work at all — the provider's quota is
// spent, and topping it up / changing keys isn't something we can do for the
// user. The hosted alternative is the way out, so the switch card below is the
// primary action and the card itself draws no button.
function switchToCloud(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return failureCard({ localDeadEnd: true }, titleKey, messageKey);
}

// Failure causes keyed by the daemon's fine-grained `failure_detail`, for the
// cases where the coarse `error_code` alone is wrong or too vague. This layer
// can OVERRIDE a code mapping — e.g. `hard_quota` and a transient 429 share
// `error_code: RATE_LIMITED`, but only the transient one should offer Retry.
// Applied after AMR/Antigravity agent-specific handling (which own their own
// quota/auth flows) and before the generic code branches.
const DETAIL_FAILURE_UI: Record<string, RunFailureUi> = {
  // Provider quota / billing hard-stop: retrying reproduces the failure, so
  // drop Retry and steer to the hosted-AMR switch card.
  hard_quota: switchToCloud(
    'chat.runError.title.quotaExhausted',
    'chat.runError.quotaExhaustedMessage',
  ),
  workspace_credits_exhausted: switchToCloud(
    'chat.runError.title.quotaExhausted',
    'chat.runError.workspaceCreditsMessage',
  ),
  // CLI binary missing detected only from text (leaks in as the opaque
  // AGENT_EXECUTION_FAILED code, not AGENT_UNAVAILABLE) — reuse the same
  // "install the CLI, then retry" card the code path already renders.
  cli_not_installed: retryWithGuidance(
    'chat.runError.title.cliMissing',
    'chat.runError.cliMissingMessage',
  ),
};

// Agent-agnostic failure causes keyed by the daemon's `failure_detail`, resolved
// BEFORE the AMR/Antigravity agent branches (unlike DETAIL_FAILURE_UI above).
// These are engine-neutral run outcomes — a timeout, an empty result, a stale
// resumed session, a missing Git Bash — that carry the same named type + fix for
// every agent, including AMR. They leak in under the opaque AGENT_EXECUTION_FAILED
// / process-exit codes, so without this the card would only show the raw stderr.
const AGENT_AGNOSTIC_DETAIL_FAILURE_UI: Record<string, RunFailureUi> = {
  // Hard wall-clock timeout for the run (daemon user_action: retry). A plain
  // retry — optionally with a smaller task — usually gets through.
  timeout: retryWithGuidance(
    'chat.runError.title.timedOut',
    'chat.runError.timedOutMessage',
  ),
  // The agent stalled (no new output for too long) and was cut off as a
  // timeout. Distinct copy from a hard timeout, same retry recovery.
  inactivity_timeout: retryWithGuidance(
    'chat.runError.title.timedOut',
    'chat.runError.inactivityTimeoutMessage',
  ),
  // Run terminated without producing any output (daemon user_action: retry);
  // usually transient, so name it and offer a straight retry.
  empty_output: retryWithGuidance(
    'chat.runError.title.emptyOutput',
    'chat.runError.emptyOutputMessage',
  ),
  // A resumed agent session id went stale; the daemon already cleared it so the
  // next run starts fresh (#3408). Name it as recoverable and offer Retry.
  session_resume_expired: retryWithGuidance(
    'chat.runError.title.sessionExpired',
    'chat.runError.sessionExpiredMessage',
  ),
  // Windows: the agent needs Git Bash to spawn and it isn't installed
  // (daemon user_action: install_cli). Point at installing Git for Windows,
  // then retry — same "install the dependency, then re-run" shape as cli_missing.
  git_bash_missing: retryWithGuidance(
    'chat.runError.title.gitBashMissing',
    'chat.runError.gitBashMissingMessage',
  ),
  // The bundled agent binary needs a CPU instruction set (AVX2) this device
  // doesn't have, so it crashes on launch — retrying reproduces the crash and
  // switching hosted models doesn't help (the runtime binary is the problem).
  // The fix is updating OpenDesign to a build that bundles a compatible
  // (baseline) runtime, so show guidance copy without a dead Retry button.
  // Ladder rung 4. §6.Z names this one explicitly under principle 4 ("quota
  // spent, account suspended, CPU unsupported — these three get no Retry").
  // Rung 3 is not available either: the binary that cannot start IS the hosted
  // runtime, so "switch to Cloud" would point at the thing that just crashed.
  cpu_unsupported: contactSupportOnly(
    'chat.runError.title.cpuUnsupported',
    'chat.runError.cpuUnsupportedMessage',
  ),
  // S19 · the agent exited and did not say why. 20,868 runs/month, 16.3% of all
  // failures, 3,869 devices — the second-largest bucket, and until now it had no
  // row in any of the three tables, so every one of those runs rendered "task
  // failed" plus whatever stderr happened to be attached (catalogue R-070 /
  // R-071 / R-072 / R-079).
  //
  // Design copy verbatim (`error-ux-design.md:212-217`): "{agent} exited
  // unexpectedly — it didn't say why. Retrying usually recovers; if it keeps
  // happening, send us the logs. 〔Retry | Export logs〕". 〔Export logs〕 is a
  // standing secondary on every card (§6.Z), so the mapping only has to declare
  // that a retry is worth offering — ladder rung 2.
  //
  // Causes we CAN name resolve earlier (cli missing, Git Bash, timeouts, stale
  // session, CPU): these six are the residue where the exit carries no reason.
  process_crashed: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  signal_killed: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  terminated_unknown: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  exit_code: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  exit_nonzero: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  execution_failed: retryWithGuidance(
    'chat.runError.title.agentCrashed',
    'chat.runError.agentCrashedMessage',
  ),
  // S18 · risk control suspended the account (catalogue R-064: "card — contact
  // support, no Retry"). Resolved here, ahead of the AMR branch, because the
  // suspension is the ACCOUNT's and the AMR catch-all below would otherwise
  // render it as "task failed" with a Retry that can only fail the same way.
  // Ladder rung 4, and deliberately no switch card: a suspended account has the
  // same problem on the hosted path.
  account_suspended: contactSupportOnly(
    'chat.runError.title.accountSuspended',
    'chat.runError.accountSuspendedMessage',
  ),
};

// Resolve the failure UI for a failed run:
//   - agent-agnostic root cause (cli missing, prompt too large, model
//     unavailable, tool loop, bad output, bad runtime def) → named type + fix
//   - agent-agnostic failure_detail (timeout, empty output, stale resumed
//     session, missing Git Bash) → named type + retry, for every agent
//   - AMR agent, auth required      → authorize-and-retry button, clearer copy
//   - AMR agent, insufficient funds → recharge button + manual retry, clearer copy
//   - AMR agent, tier entitlement   → upgrade button + manual retry
//   - AMR agent, anything else      → plain retry
//   - fine-grained failure_detail (hard quota, workspace credits, text-detected
//     cli-missing) → named type + fix, overriding a too-coarse code
//   - non-AMR agent, model/auth/quota error → plain retry + promotion card
//   - non-AMR agent, generic failure        → plain retry
export function resolveRunFailureUi(
  code: string | null | undefined,
  detail: string | null | undefined,
  agentId: string | null | undefined,
  rawMessage?: string | null,
): RunFailureUi {
  // Agent-agnostic codes resolve first so an AMR/Antigravity run that hits one
  // of them still gets the specific guidance instead of the generic fallback.
  const agnostic = typeof code === 'string' ? AGENT_AGNOSTIC_FAILURE_UI[code] : undefined;
  if (agnostic) return agnostic;
  // A rolling per-model window (the hosted gateway's `model_limit_exceeded`)
  // resolves before every agent branch. It has to: the window is the gateway's,
  // not the agent's, and the AMR branch below ends in a catch-all that would
  // otherwise render it as "task failed" with the raw English sentence as the
  // body. The reset instant is read from the same upstream text the card
  // already displays, through the shared contracts reader.
  if (detail === 'model_window_limit') {
    // The daemon already decided this IS a window limit, so read the instant
    // directly rather than re-deciding from the text — an upstream rewording
    // that the daemon still classified must not silently lose the card.
    const parsed = readModelWindowResetAt(rawMessage);
    const retryAt = parsed && Number.isFinite(Date.parse(parsed)) ? parsed : null;
    // The window rolls over on its own — as transient as a failure gets (rung 2).
    return failureCard(
      { transient: true },
      'chat.runError.title.modelWindowLimit',
      retryAt
        ? 'chat.runError.modelWindowLimitMessage'
        : 'chat.runError.modelWindowLimitMessageNoTime',
      retryAt ? { messageVars: { retryAt } } : {},
    );
  }
  // Engine-neutral failure_detail (timeout, empty output, stale resumed session,
  // missing Git Bash) resolves before the agent branches so it applies to every
  // agent — including AMR, whose branch below otherwise returns a generic retry.
  const agnosticDetail =
    typeof detail === 'string' ? AGENT_AGNOSTIC_DETAIL_FAILURE_UI[detail] : undefined;
  if (agnosticDetail) return agnosticDetail;
  if (agentId === 'amr') {
    if (code === 'AMR_AUTH_REQUIRED') {
      // Rung 1: we can sign the user in from inside the card. PRD「需要登录」type
      // — shared title with the non-AMR sign-in case. No AMR promotion (the
      // agent already IS AMR); the authorize action reuses the inline
      // AmrLoginPill (sign-in + auto-retry on success).
      return failureCard(
        { directFix: 'authorize' },
        'chat.runError.title.signInRequired',
        'chat.runError.signInMessage.amr',
      );
    }
    if (code === 'AMR_INSUFFICIENT_BALANCE') {
      // Rung 1: topping up IS the fix and we can open the console. Retry stays
      // as a secondary because the top-up lands out-of-band.
      return failureCard(
        { directFix: 'recharge' },
        'chat.runError.title.balance',
        'chat.amrError.balanceMessage',
        { secondaryRetry: true },
      );
    }
    if (code === 'AMR_TIER_UPGRADE_REQUIRED') {
      return failureCard(
        { directFix: 'upgrade' },
        'chat.amrBalanceGate.title',
        null,
        { secondaryRetry: true },
      );
    }
    return failureCard({ transient: true }, 'chat.runError.title.generic', null);
  }
  // Antigravity's auth flow is terminal-only — see the
  // `launch-terminal-auth` action comment for why. Without this branch
  // the user sees the daemon-emitted guidance text and would have to
  // open a terminal themselves; with it they get a one-click button
  // that opens Terminal.app / x-terminal-emulator / cmd with `agy`
  // running, and a Retry button to redo the chat after OAuth completes.
  if (agentId === 'antigravity') {
    if (code === 'AGENT_AUTH_REQUIRED') {
      return failureCard(
        { directFix: 'launch-terminal-auth' },
        'chat.runError.title.signInRequired',
        null,
        { secondaryRetry: true },
      );
    }
    // Quota: each Antigravity model has its own quota, so the action
    // is "open agy, switch model" rather than "sign in." Same handler
    // spawns the same terminal; only the label changes.
    if (code === 'RATE_LIMITED') {
      return failureCard(
        { directFix: 'launch-terminal-switch-model' },
        'chat.runError.title.rateLimited',
        null,
        { secondaryRetry: true },
      );
    }
  }
  // Fine-grained daemon classification overrides a too-coarse code (e.g.
  // hard_quota vs a transient 429 both arriving as RATE_LIMITED). Placed after
  // the AMR/Antigravity agent branches so their bespoke quota/auth flows still
  // win, and before the generic code branches so it can correct them.
  const detailUi = typeof detail === 'string' ? DETAIL_FAILURE_UI[detail] : undefined;
  if (detailUi) return detailUi;
  // Agent-neutral: a mid-response connection drop (any agent) gets a clear,
  // localized "lost connection — retry" message instead of the raw SDK string.
  // Not an AMR-promotable case: the break is the user's own network path, which
  // switching model service wouldn't fix.
  if (code === 'AGENT_CONNECTION_DROPPED') {
    return retryWithGuidance(
      'chat.runError.title.connectionDropped',
      'chat.connectionDropped',
    );
  }
  // Non-AMR sign-in required (any non-amr, non-antigravity agent — those two are
  // handled above). The agent's login lives in the user's own terminal, so Open
  // Design can't sign in for them: surface a "{agent} 尚未登录，请本地检查登录状态"
  // message, offer Retry as the primary action (re-run after they log in
  // locally), and promote AMR as the steadier alternative via the switch card.
  if (code === 'AGENT_AUTH_REQUIRED' || code === 'UNAUTHORIZED') {
    return failureCard(
      { transient: true },
      'chat.runError.title.signInRequired',
      'chat.runError.signInMessage.other',
      { showSwitchCard: true },
    );
  }
  // Non-antigravity rate limit / upstream outage: name the type and explain the
  // recovery (wait & retry / switch service), and still promote AMR as the
  // steadier hosted alternative. Antigravity's own RATE_LIMITED was handled
  // above (per-model quota → switch model in terminal).
  if (code === 'RATE_LIMITED') {
    return failureCard(
      { transient: true },
      'chat.runError.title.rateLimited',
      'chat.runError.rateLimitedMessage',
      { showSwitchCard: true },
    );
  }
  if (code === 'UPSTREAM_UNAVAILABLE') {
    return failureCard(
      { transient: true },
      'chat.runError.title.upstreamUnavailable',
      'chat.runError.upstreamUnavailableMessage',
      { showSwitchCard: true },
    );
  }
  const promote = typeof code === 'string' && PROMOTE_AMR_CODES.has(code);
  // Nothing named this failure. It still gets a retry (rung 2) because an
  // unclassified failure is usually a one-off — but its copy now comes from
  // RUN_FAILURE_FALLBACK_MESSAGE_KEY at render time, not from the upstream
  // string, which stays in the collapsible diagnostic area.
  return failureCard({ transient: true }, 'chat.runError.title.generic', null, {
    showSwitchCard: promote,
  });
}
