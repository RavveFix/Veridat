#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[dashboard-agent] Startar lokal Supabase..."
npm run supabase:start

echo "[dashboard-agent] Säkrar lokal env (.env.local)..."
npm run supabase:setup

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.local"
  set +a
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "[dashboard-agent] SUPABASE_SERVICE_ROLE_KEY saknas i .env.local."
  echo "[dashboard-agent] Kör: npm run supabase:setup"
  exit 1
fi

echo "[dashboard-agent] Bygger frontend..."
npm run build

PORT="${PLAYWRIGHT_PORT:-5175}"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}"
export MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}"

echo "[dashboard-agent] Startar preview-server på ${PLAYWRIGHT_BASE_URL}..."
npm run preview -- --port "$PORT" --host 127.0.0.1 --strictPort >/tmp/veridat-dashboard-agent-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  if ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[dashboard-agent] Väntar på preview-server..."
for _ in {1..40}; do
  if curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
    echo "[dashboard-agent] Preview-server är redo."
    break
  fi
  sleep 1
done

if ! curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
  echo "[dashboard-agent] Preview-server svarade inte. Se /tmp/veridat-dashboard-agent-preview.log"
  exit 1
fi

echo "[dashboard-agent] Kör Playwright test-agent..."
npm run test:e2e -- tests/e2e/dashboard-sync-agent.spec.ts

echo "[dashboard-agent] Klar."
