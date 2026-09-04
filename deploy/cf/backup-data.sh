#!/usr/bin/env bash
# Nightly backup of the Design Studio data volume.
#
# Everything staff create lives in the `open_design_data` volume: the SQLite
# database, project files, generated artifacts, and the media-provider config.
# DigitalOcean's droplet backups cover losing the whole box; this covers the
# far more likely case of needing yesterday's copy of one project back.
#
# Installed as a root cron entry:
#   15 12 * * *  /opt/open-design/deploy/cf/backup-data.sh
#
# 12:15 UTC (05:15 Arizona) deliberately sits outside DigitalOcean's own daily
# backup window for this droplet (00:00-04:00 UTC): the two shouldn't contend
# for I/O, and spacing them apart means a bad state isn't captured by both.
set -euo pipefail

VOLUME="open-design_open_design_data"
DEST="${OD_BACKUP_DIR:-/var/backups/open-design}"
KEEP_DAYS="${OD_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$DEST/od-data-$STAMP.tar.gz"

mkdir -p "$DEST"

# Read the volume through a throwaway container: the daemon keeps SQLite in WAL
# mode, so copying the files while it writes can capture a torn database. Pause
# the container for the seconds the copy takes, and always unpause, even if the
# copy fails.
cleanup() { docker unpause open-design >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker pause open-design >/dev/null 2>&1 || true

docker run --rm \
  -v "$VOLUME":/data:ro \
  -v "$DEST":/backup \
  alpine:latest \
  tar czf "/backup/$(basename "$ARCHIVE")" -C /data .

cleanup
trap - EXIT

# A zero-length or unreadable archive is worse than no archive, because it looks
# like a backup. Verify before pruning anything older.
if ! tar tzf "$ARCHIVE" >/dev/null 2>&1; then
  echo "[backup] FAILED: $ARCHIVE is not a readable archive" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "[backup] ok $ARCHIVE ($SIZE)"

find "$DEST" -name 'od-data-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -delete
echo "[backup] retained: $(find "$DEST" -name 'od-data-*.tar.gz' | wc -l | tr -d ' ') archives"
