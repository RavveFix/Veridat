#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="/tmp/veridat-supabase-functions.pid"
LOG_FILE="/tmp/veridat-supabase-functions.log"
HEALTH_URL="http://127.0.0.1:54321/functions/v1/finance-agent"

if ! command -v supabase >/dev/null 2>&1; then
    echo "Supabase CLI not found. Install with: npm i -g supabase"
    exit 1
fi

if ! supabase status >/dev/null 2>&1; then
    echo "Local Supabase is not running. Start with: npm run supabase:start"
    exit 1
fi

if [ ! -f "$ROOT_DIR/.env.local" ]; then
    echo ".env.local not found. Run: npm run supabase:setup"
    exit 1
fi

if curl -fsS -X OPTIONS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Local Edge Functions runtime is already reachable."
    exit 0
fi

if [ -f "$PID_FILE" ]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && ps -p "$existing_pid" >/dev/null 2>&1; then
        echo "Local Edge Functions runtime already started (pid $existing_pid). Waiting for readiness..."
    else
        rm -f "$PID_FILE"
    fi
fi

if [ ! -f "$PID_FILE" ]; then
    nohup supabase functions serve --env-file "$ROOT_DIR/.env.local" >"$LOG_FILE" 2>&1 &
    echo "$!" >"$PID_FILE"
    echo "Started local Edge Functions runtime (pid $(cat "$PID_FILE"))."
fi

for _ in {1..60}; do
    if curl -fsS -X OPTIONS "$HEALTH_URL" >/dev/null 2>&1; then
        echo "Local Edge Functions runtime is reachable."
        exit 0
    fi
    sleep 1
done

echo "Local Edge Functions runtime did not become reachable in time."
echo "Check logs: $LOG_FILE"
exit 1
