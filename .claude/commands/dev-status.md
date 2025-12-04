---
description: Check status of all Britta development services
allowed-tools: Bash
---

# /dev-status

Checks the status of all local development services.

## Usage

```bash
/dev-status
```

## Implementation

```bash
#!/bin/bash

PROJECT_DIR="/Users/ravonstrawder/Desktop/Britta"
cd "$PROJECT_DIR"

echo "📊 Britta Development Environment Status"
echo "=========================================="
echo ""

# Check Python API
check_python_api() {
    echo "🐍 Python API (port 8080)"
    echo "   ─────────────────────"

    if curl -s http://localhost:8080/health >/dev/null 2>&1; then
        PID=$(ps aux | grep "[u]vicorn app.main:app" | awk '{print $2}' | head -1)
        echo "   Status: ✅ RUNNING"
        echo "   PID:    $PID"
        echo "   URL:    http://localhost:8080"

        # Show health response
        HEALTH=$(curl -s http://localhost:8080/health 2>/dev/null)
        if [ -n "$HEALTH" ]; then
            echo "   Health: $HEALTH"
        fi
    else
        echo "   Status: ❌ STOPPED"
    fi
    echo ""
}

# Check Supabase
check_supabase() {
    echo "🗄️  Supabase"
    echo "   ─────────────────────"

    if supabase status >/dev/null 2>&1; then
        echo "   Status: ✅ RUNNING"
        echo "   API:    http://localhost:54321"
        echo "   Studio: http://localhost:54323"
        echo "   DB:     postgresql://localhost:54322"
    else
        echo "   Status: ❌ STOPPED"
    fi
    echo ""
}

# Check Frontend
check_frontend() {
    echo "🌐 Frontend (port 5173)"
    echo "   ─────────────────────"

    if curl -s http://localhost:5173 >/dev/null 2>&1; then
        PID=$(ps aux | grep -E "[v]ite|[n]pm.*dev" | awk '{print $2}' | head -1)
        echo "   Status: ✅ RUNNING"
        echo "   PID:    $PID"
        echo "   URL:    http://localhost:5173"
    else
        echo "   Status: ❌ STOPPED"
    fi
    echo ""
}

# Execute checks
check_python_api
check_supabase
check_frontend

echo "=========================================="
echo ""
echo "💡 Commands:"
echo "   /dev-start  - Start all services"
echo "   /dev-stop   - Stop all services"
echo ""
```

## Output Example

```
📊 Britta Development Environment Status
==========================================

🐍 Python API (port 8080)
   ─────────────────────
   Status: ✅ RUNNING
   PID:    12345
   URL:    http://localhost:8080
   Health: {"status": "healthy"}

🗄️  Supabase
   ─────────────────────
   Status: ✅ RUNNING
   API:    http://localhost:54321
   Studio: http://localhost:54323
   DB:     postgresql://localhost:54322

🌐 Frontend (port 5173)
   ─────────────────────
   Status: ✅ RUNNING
   PID:    12346
   URL:    http://localhost:5173

==========================================

💡 Commands:
   /dev-start  - Start all services
   /dev-stop   - Stop all services
```

## Notes

- Shows status, PID, and URL for each service
- Includes health check response for Python API
- Quick overview of what's running
