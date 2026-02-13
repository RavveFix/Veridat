#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="/tmp/veridat-supabase-functions.pid"
LOG_FILE="/tmp/veridat-supabase-functions.log"
HEALTH_URL_INTERNAL="http://127.0.0.1:54321/functions/v1/_internal/health"
HEALTH_URL_FALLBACK="http://127.0.0.1:54321/functions/v1/gemini-chat"

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

http_code() {
    local method="$1"
    local url="$2"
    local code
    code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' -X "$method" "$url" 2>/dev/null || true)"
    if [ -z "$code" ]; then
        code="000"
    fi
    echo "$code"
}

is_runtime_reachable() {
    local code

    code="$(http_code GET "$HEALTH_URL_INTERNAL")"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
        return 0
    fi

    code="$(http_code OPTIONS "$HEALTH_URL_INTERNAL")"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
        return 0
    fi

    # Fallback for environments where internal health endpoint may differ.
    code="$(http_code OPTIONS "$HEALTH_URL_FALLBACK")"
    if [ "$code" != "000" ] && [[ ! "$code" =~ ^5[0-9][0-9]$ ]]; then
        return 0
    fi

    return 1
}

wait_for_runtime() {
    local timeout_seconds="$1"
    local elapsed=0
    while [ "$elapsed" -lt "$timeout_seconds" ]; do
        if is_runtime_reachable; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    return 1
}

start_runtime() {
    nohup supabase functions serve --env-file "$ROOT_DIR/.env.local" >"$LOG_FILE" 2>&1 &
    echo "$!" >"$PID_FILE"
    echo "Started local Edge Functions runtime (pid $(cat "$PID_FILE"))."
}

stop_runtime() {
    local running_pid=""
    if [ -f "$PID_FILE" ]; then
        running_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    fi
    if [ -n "$running_pid" ] && ps -p "$running_pid" >/dev/null 2>&1; then
        kill "$running_pid" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
    pkill -f "supabase functions serve --env-file" >/dev/null 2>&1 || true
}

if is_runtime_reachable; then
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
    start_runtime
fi

if wait_for_runtime 45; then
    echo "Local Edge Functions runtime is reachable."
    exit 0
fi

echo "Local Edge Functions runtime not reachable after initial wait. Restarting once..."
stop_runtime
start_runtime

if wait_for_runtime 75; then
    echo "Local Edge Functions runtime is reachable after restart."
    exit 0
fi

echo "Local Edge Functions runtime did not become reachable in time."
echo "Check logs: $LOG_FILE"
if [ -f "$LOG_FILE" ]; then
    echo "---- Last log lines ----"
    tail -n 80 "$LOG_FILE" || true
    echo "------------------------"
fi
exit 1
