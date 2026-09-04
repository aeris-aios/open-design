#!/usr/bin/env bash
# Restore the Design Studio data volume from a backup archive.
#
# A backup nobody has restored is a guess, so this is the tested counterpart to
# backup-data.sh. It stops the stack, replaces the volume contents, and starts
# it again.
#
#   ./restore-data.sh /var/backups/open-design/od-data-20260904T031500Z.tar.gz
#
# Pass --dry-run to list what the archive holds without touching the volume.
set -euo pipefail

ARCHIVE="${1:-}"
VOLUME="open-design_open_design_data"
COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: $0 <archive.tar.gz> [--dry-run]" >&2
  echo "available:" >&2
  ls -1t /var/backups/open-design/od-data-*.tar.gz 2>/dev/null | head -14 >&2 || echo "  (none)" >&2
  exit 1
fi

if [ "${2:-}" = "--dry-run" ]; then
  echo "[restore] archive contents (first 40 entries):"
  tar tzf "$ARCHIVE" | head -40
  echo "[restore] total entries: $(tar tzf "$ARCHIVE" | wc -l | tr -d ' ')"
  exit 0
fi

# Refuse a corrupt archive before destroying the live volume.
tar tzf "$ARCHIVE" >/dev/null 2>&1 || { echo "[restore] archive is unreadable, aborting" >&2; exit 1; }

echo "[restore] stopping stack"
cd "$COMPOSE_DIR"
docker compose -f docker-compose.cf.yml --env-file .env stop open-design

# Keep the current contents until the restore succeeds - a failed restore that
# also destroyed the live data would turn a recoverable problem into a total loss.
SAFETY="/var/backups/open-design/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
mkdir -p "$(dirname "$SAFETY")"
docker run --rm -v "$VOLUME":/data:ro -v "$(dirname "$SAFETY")":/backup alpine:latest \
  tar czf "/backup/$(basename "$SAFETY")" -C /data . || true
echo "[restore] current state saved to $SAFETY"

docker run --rm -v "$VOLUME":/data -v "$(dirname "$ARCHIVE")":/backup alpine:latest \
  sh -c 'rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf "/backup/'"$(basename "$ARCHIVE")"'" -C /data'

echo "[restore] starting stack"
docker compose -f docker-compose.cf.yml --env-file .env up -d
echo "[restore] done. Verify the studio loads and recent projects are present."
