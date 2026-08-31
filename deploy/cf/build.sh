#!/usr/bin/env bash
# Build the Commerce Fountain Design Studio image in two layers:
#   1. open-design-themed - the fork's own deploy/Dockerfile (daemon + the
#      CF-themed web export)
#   2. open-design-cf     - + the Claude Code CLI runtime layer
# Run from the repo root or deploy/cf; then bring the stack up:
#   cd deploy && docker compose -f cf/docker-compose.cf.yml up -d --build
set -euo pipefail
cd "$(dirname "$0")/../.."

docker build -t open-design-themed -f deploy/Dockerfile .
docker build -t open-design-cf --build-arg BASE_IMAGE=open-design-themed -f deploy/Dockerfile.cf .
echo "Built open-design-cf."
