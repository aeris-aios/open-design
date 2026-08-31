import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import type { RunProgressStep } from '../../runtime/run-progress';
import { SpaceBackground } from '../workspace/SpaceBackground';
import styles from './DesignFilesEmptyState.module.css';

interface Props {
  /** The user's most recent chat prompt, echoed back while the agent works. */
  latestUserPrompt?: string | null;
  /** True while the chat agent is generating. */
  running?: boolean;
  /** The running turn's tool calls, newest first (see `runtime/run-progress`). */
  steps?: RunProgressStep[];
}

/** The verb naming each tool family. Categories the map does not name fall
 *  back to "Calling <tool>", which is the only honest line for a tool this
 *  build has never seen. */
const VERB_KEY: Partial<Record<RunProgressStep['category'], keyof Dict>> = {
  write: 'assistant.verbWriting',
  edit: 'assistant.verbEditing',
  read: 'assistant.verbReading',
  run: 'assistant.verbRunning',
  search: 'assistant.verbSearching',
  fetch: 'assistant.verbFetching',
};

function stepLabel(step: RunProgressStep, t: ReturnType<typeof useT>): string {
  const verbKey = VERB_KEY[step.category];
  if (!verbKey) return `${t('assistant.verbCalling')} ${step.toolName}`;
  return step.target ? `${t(verbKey)} ${step.target}` : t(verbKey);
}

/**
 * Design Files with nothing in it yet. Instead of a card of creation CTAs
 * (those all live in the tab strip's "+" launcher), the pane shows the
 * orbiting particle field with the conversation's current state at its center:
 * what the user asked for, and whether the agent is working on it. An empty
 * project generating its first file therefore gets feedback on both sides of
 * the split, not just in the chat column.
 *
 * While a run streams, the status line under the prompt names the CURRENT step
 * ("Editing index.html") rather than a static "Thinking", and the steps behind
 * it stack underneath — newest first, fading out — so the pane reads as
 * progress instead of a spinner with words.
 */
export function DesignFilesEmptyState({
  latestUserPrompt,
  running = false,
  steps = [],
}: Props) {
  const t = useT();
  // The trail belongs to the run: an idle pane showing the last turn's tool
  // calls would be claiming work that already finished.
  const [current, ...trail] = running ? steps : [];
  const status = running
    ? current
      ? stepLabel(current, t)
      : // Nothing has been called yet — the turn really is just thinking.
        t('assistant.thinking')
    : t('designFiles.empty');
  return (
    <>
      {/* A smaller field than the component's default (per product): the ring
          and the spread around it are both driven by `ringRadius`, and the
          count follows its area so the field keeps its density instead of
          reading as the same orbit with holes in it. */}
      <SpaceBackground className={styles.field} ringRadius={105} particleCount={210} />
      <div className={styles.center} data-testid="design-files-empty-chat">
        {latestUserPrompt ? <p className={styles.prompt}>{latestUserPrompt}</p> : null}
        <p className={styles.status} data-running={running ? 'true' : 'false'}>
          {status}
        </p>
        {trail.length > 0 ? (
          // Newest first, so the line under the status is always the step just
          // before it and the list needs no scrolling of its own — which it
          // could not do anyway: the center block stays click-through so the
          // drop target underneath keeps working (see `.center`).
          <ul className={styles.trail} data-testid="design-files-empty-trail">
            {trail.map((step) => (
              <li key={step.id} className={styles.trailItem}>
                {stepLabel(step, t)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
