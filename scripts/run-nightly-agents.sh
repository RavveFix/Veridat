#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cleanup_supabase_artifacts() {
  echo "[nightly-agents] Städar upp lokala Supabase-artefakter..."
  supabase stop --all --yes >/dev/null 2>&1 || true

  if ! command -v docker >/dev/null 2>&1; then
    return
  fi

  local container_id
  while IFS= read -r container_id; do
    [[ -z "$container_id" ]] && continue
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  done < <(docker ps -aq --filter "name=supabase_" 2>/dev/null || true)

  local network_name
  while IFS= read -r network_name; do
    [[ -z "$network_name" ]] && continue
    docker network rm "$network_name" >/dev/null 2>&1 || true
  done < <(docker network ls --format '{{.Name}}' 2>/dev/null | grep '^supabase_network_' || true)
}

start_supabase_with_retry() {
  local max_attempts=3
  local attempt=1

  while (( attempt <= max_attempts )); do
    echo "[nightly-agents] Startar lokal Supabase (försök ${attempt}/${max_attempts})..."
    if npm run supabase:start; then
      return 0
    fi

    if (( attempt == max_attempts )); then
      break
    fi

    echo "[nightly-agents] Supabase start misslyckades, försöker igen..."
    cleanup_supabase_artifacts
    attempt=$((attempt + 1))
    sleep 2
  done

  echo "[nightly-agents] Kunde inte starta lokal Supabase efter ${max_attempts} försök."
  return 1
}

start_supabase_with_retry

echo "[nightly-agents] Säkrar lokal env (.env.local)..."
npm run supabase:setup

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.local"
  set +a
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "[nightly-agents] SUPABASE_SERVICE_ROLE_KEY saknas i .env.local."
  echo "[nightly-agents] Kör: npm run supabase:setup"
  exit 1
fi

echo "[nightly-agents] Väntar på Supabase auth-health..."
for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:54321/auth/v1/health" >/dev/null 2>&1; then
    echo "[nightly-agents] Supabase auth är redo."
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:54321/auth/v1/health" >/dev/null 2>&1; then
  echo "[nightly-agents] Supabase auth svarar inte."
  exit 1
fi

echo "[nightly-agents] Bygger frontend..."
npm run build

PORT="${PLAYWRIGHT_PORT:-5176}"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}"
export MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}"

# Aktivera sandbox-körning för Fortnox-panel-agent om nightly vill köra live.
export FORTNOX_SANDBOX_MODE="${FORTNOX_SANDBOX_MODE:-false}"

echo "[nightly-agents] Startar preview-server på ${PLAYWRIGHT_BASE_URL}..."
npm run preview -- --port "$PORT" --host 127.0.0.1 --strictPort >/tmp/veridat-nightly-agent-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  if ps -p "$PREVIEW_PID" >/dev/null 2>&1; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

echo "[nightly-agents] Väntar på preview-server..."
for _ in {1..50}; do
  if curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
    echo "[nightly-agents] Preview-server är redo."
    break
  fi
  sleep 1
done

if ! curl -fsS "${PLAYWRIGHT_BASE_URL}/login" >/dev/null 2>&1; then
  echo "[nightly-agents] Preview-server svarade inte. Se /tmp/veridat-nightly-agent-preview.log"
  exit 1
fi

echo "[nightly-agents] Kör Playwright nightly-agent suite..."
npm run test:e2e -- \
  tests/e2e/fortnox-panel-sandbox-agent.spec.ts \
  tests/e2e/bookkeeping-rules-agent.spec.ts \
  tests/e2e/agency-switch-agent.spec.ts \
  tests/e2e/admin-billing-agent.spec.ts \
  tests/e2e/guardian-alert-agent.spec.ts \
  tests/e2e/rate-limit-agent.spec.ts \
  tests/e2e/skills-hub-workflow-agent.spec.ts

echo "[nightly-agents] Klar."
