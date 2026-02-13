#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[core-agents-soft] Startar lokal Supabase..."
npm run supabase:start

echo "[core-agents-soft] Säkrar lokal env (.env.local)..."
npm run supabase:setup

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.local"
  set +a
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "[core-agents-soft] SUPABASE_SERVICE_ROLE_KEY saknas i .env.local."
  echo "[core-agents-soft] Kör: npm run supabase:setup"
  exit 1
fi

echo "[core-agents-soft] Bygger frontend..."
npm run build

PORT="${PLAYWRIGHT_PORT:-5175}"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}"
export MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}"

echo "[core-agents-soft] Startar preview-server på ${PLAYWRIGHT_BASE_URL}..."
npm run preview -- --port "$PORT" --host 127.0.0.1 --strictPort >/tmp/veridat-core-soft-agent-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  if ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[core-agents-soft] Väntar på preview-server..."
for _ in {1..40}; do
  if curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
    echo "[core-agents-soft] Preview-server är redo."
    break
  fi
  sleep 1
done

if ! curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
  echo "[core-agents-soft] Preview-server svarade inte. Se /tmp/veridat-core-soft-agent-preview.log"
  exit 1
fi

echo "[core-agents-soft] Kör Playwright soft core-suite (utan dashboard + bank + invoice/vat)..."
npm run test:e2e -- \
  tests/e2e/search-modal-agent.spec.ts \
  tests/e2e/auth-legal-consent-agent.spec.ts \
  tests/e2e/fortnox-plan-gating-agent.spec.ts

echo "[core-agents-soft] Klar."
