#!/usr/bin/env bash
# Seed the daemon-side defaults so no browser ever runs first-run setup and
# every design runs on the pinned top-tier model.
#
# These live in <OD_DATA_DIR>/app-config.json. The web client ratchets a daemon
# `onboardingCompleted: true` over every browser's local copy, so seeding once
# fixes it for all staff - including brand-new browsers and private windows.
# Re-run after any deploy that starts from a fresh data volume.
#
#   cd deploy/cf && ./seed-defaults.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "deploy/cf/.env not found" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a
: "${OD_API_TOKEN:?OD_API_TOKEN missing from .env}"

# The daemon validates same-origin on the Host header and rejects requests
# without an Origin unless Sec-Fetch-Site says same-origin, so mimic a browser.
HOST="${STUDIO_HOST:-studio.commercefountain.com}"

docker compose -f docker-compose.cf.yml exec -T \
  -e SEED_HOST="$HOST" open-design node -e '
const token = process.env.OD_API_TOKEN;
const host = process.env.SEED_HOST;
const body = {
  onboardingCompleted: true,
  agentId: "claude",
  // Top tier. The alias keeps tracking the newest release, so this needs no
  // maintenance when new models ship.
  agentModels: { claude: { model: "fable" } },
};
const res = await fetch("http://127.0.0.1:7456/api/app-config", {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    host,
    "sec-fetch-site": "same-origin",
  },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) { console.error(`seed failed ${res.status}: ${text}`); process.exit(1); }
console.log("seeded:", text.slice(0, 300));
' 2>&1

echo "Design Studio defaults seeded."
