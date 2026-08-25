// Durable local handoff for AMR terminal outcomes. Delivery is intentionally
// deferred to the separately owned runner; this store only preserves the first
// terminal outcome so a late child callback cannot rewrite what will be sent.

interface SqliteRunResult {
  changes: number;
}

interface SqliteStatement {
  run(...values: unknown[]): SqliteRunResult;
  all(...values: unknown[]): unknown[];
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

export type AmrTerminalReportOutcome = 'failed' | 'canceled';

export interface PendingAmrTerminalReport {
  runId: string;
  outcome: AmrTerminalReportOutcome;
  terminalAt: number;
}

export interface AmrTerminalReportOutboxStore {
  enqueue(report: PendingAmrTerminalReport): void;
  listPending(): PendingAmrTerminalReport[];
}

export interface AmrTerminalReportRun {
  id: string;
  agentId?: string | null;
  errorCode?: string | null;
  failureAction?: string | null;
  status?: string | null;
}

export function isBillingTerminalAmrRun(
  run: AmrTerminalReportRun,
  status = run.status,
): status is AmrTerminalReportOutcome {
  if (run.agentId !== 'amr') return false;
  if (status !== 'failed' && status !== 'canceled') return false;
  if (status === 'canceled') return true;
  return run.failureAction !== 'recharge'
    && run.errorCode !== 'AMR_INSUFFICIENT_BALANCE';
}

export function migrateAmrTerminalReportOutbox(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS amr_terminal_report_outbox (
      run_id TEXT PRIMARY KEY,
      outcome TEXT NOT NULL CHECK (outcome IN ('failed', 'canceled')),
      terminal_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_amr_terminal_report_outbox_terminal_at
      ON amr_terminal_report_outbox(terminal_at, run_id);
  `);
}

export function createAmrTerminalReportOutboxStore(
  db: SqliteDb,
): AmrTerminalReportOutboxStore {
  const enqueueRow = db.prepare(`
    INSERT INTO amr_terminal_report_outbox (run_id, outcome, terminal_at)
    VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `);
  const listRows = db.prepare(`
    SELECT run_id AS runId, outcome, terminal_at AS terminalAt
      FROM amr_terminal_report_outbox
     ORDER BY terminal_at ASC, run_id ASC
  `);

  return {
    enqueue(report) {
      enqueueRow.run(report.runId, report.outcome, report.terminalAt);
    },
    listPending() {
      return listRows.all() as PendingAmrTerminalReport[];
    },
  };
}

/**
 * Run-service terminal callback. It has no delivery dependency: finalization
 * synchronously persists only billing-terminal local handoffs before the
 * terminal SSE event is published.
 */
export function createAmrTerminalReportFinalizer(
  outbox: AmrTerminalReportOutboxStore,
): (run: AmrTerminalReportRun, status: string, terminalAt: number) => void {
  return (run, status, terminalAt) => {
    if (!isBillingTerminalAmrRun(run, status)) return;
    outbox.enqueue({ runId: run.id, outcome: status, terminalAt });
  };
}
