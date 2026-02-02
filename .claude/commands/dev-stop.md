---
description: Stop all Veridat development services gracefully
allowed-tools: Bash
---

# /dev-stop

Gracefully stops all local development services.

## Services Stopped

1. **Frontend** (Vite)
2. **Python API** (uvicorn)
3. **Supabase** (all containers)

## Usage

```bash
/dev-stop
```

## Implementation

```bash
#!/bin/bash

PROJECT_DIR="/Users/ravonstrawder/Desktop/Britta"
cd "$PROJECT_DIR"

echo "🛑 Stopping Veridat Development Environment..."
echo ""

# Stop Frontend (Vite)
stop_frontend() {
    echo "🌐 [1/3] Stopping Frontend..."
    PIDS=$(ps aux | grep -E "[v]ite|[n]pm.*dev" | grep -v grep | awk '{print $2}')
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill 2>/dev/null
        echo "✅ Frontend stopped"
    else
        echo "⚪ Frontend not running"
    fi
}

# Stop Python API
stop_python_api() {
    echo "🐍 [2/3] Stopping Python API..."
    PIDS=$(ps aux | grep "[u]vicorn app.main:app" | grep -v grep | awk '{print $2}')
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill 2>/dev/null
        echo "✅ Python API stopped"
    else
        echo "⚪ Python API not running"
    fi
}

# Stop Supabase
stop_supabase() {
    echo "🗄️  [3/3] Stopping Supabase..."
    if supabase status >/dev/null 2>&1; then
        npm run supabase:stop
        echo "✅ Supabase stopped"
    else
        echo "⚪ Supabase not running"
    fi
}

# Execute in reverse order
stop_frontend
stop_python_api
stop_supabase

echo ""
echo "=========================================="
echo "✅ All services stopped"
echo ""
echo "💡 To restart: /dev-start"
echo "=========================================="
```

## Notes

- Stops services in reverse order of startup
- Uses SIGTERM for graceful shutdown
- Safe to run even if services aren't running
