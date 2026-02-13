#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/veridat-supabase-functions.pid"

if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
        kill "$pid" >/dev/null 2>&1 || true
        echo "Stopped local Edge Functions runtime (pid $pid)."
    fi
    rm -f "$PID_FILE"
fi

pkill -f "supabase functions serve --env-file" >/dev/null 2>&1 || true
