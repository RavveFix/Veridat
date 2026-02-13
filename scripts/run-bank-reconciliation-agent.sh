#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[bank-agent] Startar lokal Supabase..."
npm run supabase:start

echo "[bank-agent] Säkrar lokal env (.env.local)..."
npm run supabase:setup

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.local"
  set +a
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "[bank-agent] SUPABASE_SERVICE_ROLE_KEY saknas i .env.local."
  echo "[bank-agent] Kör: npm run supabase:setup"
  exit 1
fi

echo "[bank-agent] Bygger frontend..."
npm run build

PORT="${PLAYWRIGHT_PORT:-5175}"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}"
export MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}"

kill_preview_port() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local pids
  pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  kill $pids >/dev/null 2>&1 || true
  sleep 1

  pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill -9 $pids >/dev/null 2>&1 || true
  fi
}

kill_preview_port

echo "[bank-agent] Startar preview-server på ${PLAYWRIGHT_BASE_URL}..."
npm run preview -- --port "$PORT" --host 127.0.0.1 --strictPort >/tmp/veridat-bank-agent-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  if ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
  kill_preview_port
}

trap cleanup EXIT

echo "[bank-agent] Väntar på preview-server..."
for _ in {1..40}; do
  if curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
    echo "[bank-agent] Preview-server är redo."
    break
  fi
  sleep 1
done

if ! curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
  echo "[bank-agent] Preview-server svarade inte. Se /tmp/veridat-bank-agent-preview.log"
  exit 1
fi

echo "[bank-agent] Kör Playwright test-agent..."
npm run test:e2e -- tests/e2e/finance-bank-reconciliation-agent.spec.ts

echo "[bank-agent] Klar."
