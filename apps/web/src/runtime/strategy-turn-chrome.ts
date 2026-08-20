import type { AppliedPluginSnapshot, ChatSessionMode } from '@open-design/contracts';

/**
 * An applied snapshot carries `strategy` only when the daemon bound an internal
 * strategy package to the turn — `AppliedPluginSnapshotSchema.strategy` stays
 * unset for every ordinary plugin apply. The user never picked that package, so
 * its title and version are implementation detail rather than context they
 * attached to the message, and the chat must not surface either.
 */
export function isInternalStrategySnapshot(
  snapshot: Pick<AppliedPluginSnapshot, 'strategy'> | null | undefined,
): boolean {
  return Boolean(snapshot?.strategy);
}

/**
 * Whether the session-mode chip still tells the user something the turn has not
 * already told them. `Ask` and `Plan` are per-turn opt-outs whose behaviour the
 * user chose, so they stay labelled everywhere. `Design Agent` is the default a
 * strategy-owned turn already implies, which makes the chip pure chrome above
 * the prompt.
 */
export function shouldShowSessionModeChip(input: {
  sessionMode: ChatSessionMode | undefined;
  snapshot: Pick<AppliedPluginSnapshot, 'strategy'> | null | undefined;
}): boolean {
  if (!input.sessionMode) return false;
  if (input.sessionMode !== 'design') return true;
  return !isInternalStrategySnapshot(input.snapshot);
}
