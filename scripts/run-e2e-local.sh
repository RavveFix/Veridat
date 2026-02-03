#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.local"
  set +a
fi

export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:5175}"
export MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}"

cd "$ROOT_DIR"

npm run test:e2e
