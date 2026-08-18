import { useCallback, useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type {
  OdNextRolloutControlResponse,
  OdNextRolloutControlStatus,
} from '@open-design/contracts';

import { useI18n } from '../i18n';
import styles from './OdNextRolloutControl.module.css';

export function OdNextRolloutControl() {
  const { t } = useI18n();
  const [status, setStatus] = useState<OdNextRolloutControlStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/strategies/od-next/rollout', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as OdNextRolloutControlResponse;
      setStatus(body.status);
    } catch {
      setError(t('settings.odNextRolloutLoadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reset = async () => {
    if (!status || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/strategies/od-next/rollout/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: status.revision }),
      });
      const body = await response.json() as OdNextRolloutControlResponse & {
        error?: { message?: string };
      };
      if (!response.ok) {
        if (response.status === 409 && body.status) setStatus(body.status);
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      setStatus(body.status);
      setConfirming(false);
    } catch {
      setError(t('settings.odNextRolloutResetFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root} data-testid="od-next-rollout-control">
      <div className={styles.heading}>
        <div>
          <h4>{t('settings.odNextRolloutTitle')}</h4>
          <p>{t('settings.odNextRolloutHint')}</p>
        </div>
        <Button disabled={busy} onClick={() => void refresh()}>
          {t('settings.odNextRolloutRefresh')}
        </Button>
      </div>
      {status ? (
        <dl className={styles.status} aria-live="polite">
          <div><dt>{t('settings.odNextRolloutScope')}</dt><dd>{status.scope}</dd></div>
          <div><dt>{t('settings.odNextRolloutRequested')}</dt><dd>{status.requestedMode}</dd></div>
          <div><dt>{t('settings.odNextRolloutEffective')}</dt><dd>{status.effectiveMode}</dd></div>
          <div>
            <dt>{t('settings.odNextRolloutLatch')}</dt>
            <dd>{status.latch ? `${status.latch.mode} · ${status.latch.reasonCode}` : 'none'}</dd>
          </div>
        </dl>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {status?.resetAllowed ? (
        <div className={styles.actions}>
          {confirming ? (
            <>
              <Button disabled={busy} onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void reset()}>
                {busy
                  ? t('settings.odNextRolloutResetting')
                  : t('settings.odNextRolloutResetConfirm')}
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)}>
              {t('settings.odNextRolloutReset')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
