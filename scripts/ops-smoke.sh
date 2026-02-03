#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[ops:smoke] Starting local Supabase..."
npm run supabase:start

echo "[ops:smoke] Generating local env overrides..."
npm run supabase:setup

echo "[ops:smoke] Building frontend..."
npm run build

if [[ "${SKIP_E2E:-}" == "1" ]]; then
  echo "[ops:smoke] SKIP_E2E=1 set, skipping Playwright."
  exit 0
fi

echo "[ops:smoke] Starting preview server on port 5175..."
npm run preview -- --port 5175 >/tmp/veridat-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  if ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[ops:smoke] Running Playwright..."
./scripts/run-e2e-local.sh
