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
npm run preview -- --port 5175 --host 127.0.0.1 >/tmp/veridat-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  if ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

wait_for_preview() {
  local url="http://127.0.0.1:5175/login"
  local max_wait=30
  local waited=0

  while [[ "$waited" -lt "$max_wait" ]]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[ops:smoke] Preview server is ready."
      return 0
    fi
    if ! ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
      echo "[ops:smoke] Preview server exited early. See /tmp/veridat-preview.log"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  echo "[ops:smoke] Preview server did not respond within ${max_wait}s. See /tmp/veridat-preview.log"
  return 1
}

wait_for_preview

echo "[ops:smoke] Running Playwright..."
./scripts/run-e2e-local.sh
