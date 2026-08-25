import { useT } from '../i18n';
import { FileSyncBadge } from '../collab/FileSyncBadge';

/**
 * The project route's surface while a member's FIRST open of a team-shared
 * project is still downloading it (`materializing-team-project`).
 *
 * ProjectView owns every existing download indicator — the design-files tab
 * badge, the "syncing" empty state, the composer placeholder — but it is
 * deliberately not mounted until a local project row exists. The stretch
 * before that row lands is the longest part of a first open (shared-owner
 * discovery plus the background content pull), and rendering the shell's
 * generic "Loading workspace…" spinner through it left a member with no way
 * to tell a download from a hang (OPEND-2095).
 *
 * The copy is deliberately the SAME string ProjectView shows once it mounts,
 * so the hand-off reads as one continuous download instead of two unrelated
 * waits. This surface is indeterminate on purpose: `vela resource pull` is
 * awaited as a whole and reports no byte progress, so a percentage here would
 * be invented rather than measured.
 */
export function TeamProjectDownloadingView() {
  const t = useT();
  return (
    <div className="centered-loader" data-testid="project-route-team-downloading">
      <FileSyncBadge state="downloading" size={20} />
      <span className="centered-loader-label" role="status" aria-live="polite">
        {t('designFiles.syncing')}
      </span>
    </div>
  );
}
