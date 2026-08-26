import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { OdNextRolloutControlResponse, OdNextRolloutMode } from '@open-design/contracts';

import { trackLabsItemToggled } from '../analytics/events';
import { useAnalytics } from '../analytics/provider';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './LabsSection.module.css';

/**
 * Why this component reads and writes on its own instead of going through
 * `cfg` / `setCfg` like the other Settings sections:
 *
 * `apps/web/src/types.ts`'s `AppConfig` is a web-local projection that does
 * not carry `odNextStrategyMode`, and `syncConfigToDaemon` serialises an
 * explicit allow-list of fields. Threading this switch through that pipeline
 * means three edits, and forgetting the allow-list one fails silently — the
 * toggle would look saved and never reach the daemon. A self-contained read
 * and a single-field PUT avoid the whole class of bug, and keep the Labs
 * surface deletable in one piece when the experiment converges.
 */

type SwitchLock = 'latched' | 'env' | 'unreadable';

interface LabsHarnessState {
  on: boolean;
  lock: SwitchLock | null;
}

const LOADING: LabsHarnessState | null = null;

/** `PUT /api/app-config` merges per key, so a single-field body is safe. */
async function writeHarnessMode(mode: OdNextRolloutMode): Promise<void> {
  const response = await fetch('/api/app-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ odNextStrategyMode: mode }),
  });
  if (!response.ok) throw new Error(`app-config write failed (${response.status})`);
}

/**
 * Project the daemon's three-valued rollout mode onto the switch.
 *
 * `observe` reads as off because it does not run the new harness — but the
 * switch never rewrites it on its own: it is a developer-set diagnostic mode,
 * and silently clearing it would break someone's debugging session. The user's
 * next deliberate toggle resolves it to `active` / `off` naturally.
 *
 * The lock order matters. A latch is the safety valve — it overrides the saved
 * mode in `readOdNextRolloutControlStatus` — so it wins over the environment
 * note, which in turn wins over a plain saved value.
 */
export function harnessStateFromStatus(
  status: OdNextRolloutControlResponse['status'],
): LabsHarnessState {
  const on = status.requestedMode === 'active';
  if (status.latch) return { on, lock: 'latched' };
  if (status.requestedModeSource === 'env') return { on, lock: 'env' };
  return { on, lock: null };
}

function LabsTooltip({ label, body, scope }: { label: string; body: string; scope: string }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  return (
    <span className={styles.tooltipHost}>
      <button
        type="button"
        className={styles.tooltipTrigger}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // The trigger explains, it does not act. Swallow the click so it
        // cannot reach the row and flip the switch by accident.
        onClick={(event) => event.preventDefault()}
      >
        <Icon name="help-circle" size={14} aria-hidden />
      </button>
      {open ? (
        <span className={styles.tooltip} role="tooltip" id={tooltipId}>
          <span className={styles.tooltipBody}>{body}</span>
          <span className={styles.tooltipScope}>{scope}</span>
        </span>
      ) : null}
    </span>
  );
}

export interface LabsSectionProps {
  /**
   * Drives the dialog-level autosave pill. This switch writes immediately
   * rather than through the dialog's debounced autosave, so it reports its own
   * outcome on the same surface every other Settings edit uses.
   */
  onAutosaveStatus?: (status: 'saving' | 'saved' | 'error') => void;
}

export function LabsSection({ onAutosaveStatus }: LabsSectionProps) {
  const t = useT();
  const analytics = useAnalytics();
  const [state, setState] = useState<LabsHarnessState | null>(LOADING);
  const [busy, setBusy] = useState(false);
  const noticeId = useId();
  // Guards against a slow earlier write re-applying UI after a later toggle,
  // and against setState landing on an unmounted section.
  const writeTokenRef = useRef(0);
  const mountedRef = useRef(true);
  // `busy` drives the disabled styling, but it cannot gate re-entry: a second
  // click in the same tick reads the pre-render closure, where `busy` is still
  // false and `state.on` is still the old value, so it would start a second
  // write from a stale baseline. The ref flips synchronously and is what the
  // guard actually reads.
  const writeInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/strategies/od-next/rollout');
        if (!response.ok) throw new Error(`rollout status failed (${response.status})`);
        const body = (await response.json()) as OdNextRolloutControlResponse;
        if (cancelled) return;
        setState(harnessStateFromStatus(body.status));
      } catch {
        if (cancelled) return;
        // An unreachable daemon must not blank the page: show the row, locked,
        // with the reason spelled out.
        setState({ on: false, lock: 'unreadable' });
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const toggle = useCallback(() => {
    if (!state || state.lock || writeInFlightRef.current) return;
    const next = !state.on;
    const previous = state.on;
    const token = ++writeTokenRef.current;
    writeInFlightRef.current = true;
    setState({ ...state, on: next });
    setBusy(true);
    onAutosaveStatus?.('saving');
    void (async () => {
      try {
        // `'off'` rather than clearing the key: an absent value reads as
        // "never touched", and the two are worth telling apart later.
        await writeHarnessMode(next ? 'active' : 'off');
        if (token !== writeTokenRef.current || !mountedRef.current) return;
        // After the write, not on click: a failed write rolls the switch back,
        // and an event for a preference the machine does not hold is worse
        // than a missing one.
        trackLabsItemToggled(analytics.track, {
          item_id: 'design_harness',
          to: next ? 'on' : 'off',
          source: 'settings',
        });
        onAutosaveStatus?.('saved');
      } catch {
        if (token !== writeTokenRef.current || !mountedRef.current) return;
        setState((current) => (current ? { ...current, on: previous } : current));
        onAutosaveStatus?.('error');
      } finally {
        if (token === writeTokenRef.current) {
          writeInFlightRef.current = false;
          if (mountedRef.current) setBusy(false);
        }
      }
    })();
  }, [analytics.track, onAutosaveStatus, state]);

  const lockNoticeKey = state?.lock === 'latched'
    ? 'labs.latchedNotice'
    : state?.lock === 'env'
      ? 'labs.envOverrideNotice'
      : state?.lock === 'unreadable'
        ? 'labs.loadFailedNotice'
        : null;

  const on = state?.on ?? false;
  // A section that has not resolved yet is not operable either — treating the
  // pending read as locked keeps the switch from accepting a click it would
  // immediately overwrite.
  const locked = state == null || state.lock != null;

  return (
    <section className="settings-section">
      <p className={styles.pageDesc}>{t('labs.pageDesc')}</p>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>
            <span className={styles.rowName}>{t('labs.harnessName')}</span>
            <LabsTooltip
              label={t('labs.itemAbout', { name: t('labs.harnessName') })}
              body={t('labs.harnessTooltip')}
              scope={t('labs.harnessScope')}
            />
          </span>
          <span className={styles.rowHint}>{t('labs.harnessHint')}</span>
          {lockNoticeKey ? (
            <span className={styles.rowNotice} role="status" id={noticeId}>
              <Icon name="info" size={12} aria-hidden />
              {t(lockNoticeKey)}
            </span>
          ) : null}
        </div>
        {/* `aria-disabled` rather than `disabled`: a disabled button leaves the
            tab order, so a screen-reader user never reaches the sentence that
            explains why the switch will not move. `toggle` refuses the click
            on its own. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t('labs.harnessName')}
          aria-disabled={locked || busy}
          aria-describedby={lockNoticeKey ? noticeId : undefined}
          className={`${styles.switch}${on ? ` ${styles.switchOn}` : ''}`}
          onClick={toggle}
          data-testid="labs-harness-switch"
        >
          <span className={styles.switchKnob} aria-hidden />
        </button>
      </div>
    </section>
  );
}
