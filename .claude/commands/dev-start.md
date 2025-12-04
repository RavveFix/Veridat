---
description: Start all Britta development services (Frontend, Python API, Supabase)
allowed-tools: Bash
---

# /dev-start

Starts all local development services in the correct order.

## Services Started

1. **Python API** (port 8080) - VAT calculations
2. **Supabase** (port 54321/54323) - Edge Functions & Database
3. **Frontend** (port 5173) - Vite dev server

## Usage

```bash
/dev-start
```

## Implementation

```bash
#!/bin/bash
set -e

PROJECT_DIR="/Users/ravonstrawder/Desktop/Britta"
cd "$PROJECT_DIR"

echo "🚀 Starting Britta Development Environment..."
echo ""

# Check prerequisites
check_prerequisites() {
    echo "📋 Checking prerequisites..."
    command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3 required"; exit 1; }
    command -v npm >/dev/null 2>&1 || { echo "❌ npm required"; exit 1; }
    command -v supabase >/dev/null 2>&1 || { echo "❌ Supabase CLI required"; exit 1; }
    echo "✅ All prerequisites found"
    echo ""
}

# Start Python API
start_python_api() {
    echo "🐍 [1/3] Starting Python API on :8080..."
    cd "$PROJECT_DIR/python-api"

    # Create venv if not exists
    if [ ! -d "venv" ]; then
        echo "   Creating Python virtual environment..."
        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt --quiet
    else
        source venv/bin/activate
    fi

    # Start in background
    uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload &
    PYTHON_PID=$!
    echo "   PID: $PYTHON_PID"

    cd "$PROJECT_DIR"
    sleep 2

    # Health check
    if curl -s http://localhost:8080/health >/dev/null 2>&1; then
        echo "✅ Python API started successfully"
    else
        echo "⏳ Python API starting (may take a few seconds)..."
    fi
    echo ""
}

# Start Supabase
start_supabase() {
    echo "🗄️  [2/3] Starting Supabase services..."

    # Check if already running
    if supabase status >/dev/null 2>&1; then
        echo "✅ Supabase already running"
    else
        npm run supabase:start
        echo "✅ Supabase started"
    fi
    echo ""
}

# Start Frontend
start_frontend() {
    echo "🌐 [3/3] Starting Vite frontend on :5173..."
    cd "$PROJECT_DIR"
    npm run dev &
    FRONTEND_PID=$!
    echo "   PID: $FRONTEND_PID"
    echo "✅ Frontend starting..."
    echo ""
}

# Main execution
check_prerequisites
start_python_api
start_supabase
start_frontend

echo "=========================================="
echo "🎉 All services started!"
echo ""
echo "📍 URLs:"
echo "   Frontend:        http://localhost:5173"
echo "   Python API:      http://localhost:8080"
echo "   Supabase Studio: http://localhost:54323"
echo ""
echo "💡 Commands:"
echo "   /dev-status  - Check service status"
echo "   /dev-stop    - Stop all services"
echo "=========================================="
```

## Notes

- Python API starts in background with hot-reload enabled
- Supabase checks if already running before starting
- Frontend runs with Vite hot module replacement
- Use `/dev-stop` to gracefully stop all services
