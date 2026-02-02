#!/bin/bash
# Pre-deployment validation for Veridat
# Validates everything before production deployment
set -e

PROJECT_DIR="/Users/ravonstrawder/Desktop/Britta"
cd "$PROJECT_DIR"

echo "🚀 Pre-Deployment Validation"
echo "=========================================="
echo ""

ERRORS=0
WARNINGS=0

# 1. Check git status
echo "[1/7] Checking git status..."
check_git() {
    if [ -n "$(git status --porcelain)" ]; then
        echo "   ❌ ERROR: Uncommitted changes detected!"
        git status --short
        ERRORS=$((ERRORS + 1))
        return 1
    fi
    echo "   ✅ Working directory clean"
    return 0
}

# 2. Run unit tests
echo "[2/7] Running unit tests..."
run_tests() {
    cd "$PROJECT_DIR/python-api"
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi

    if pytest tests/ -v --tb=short 2>&1; then
        echo "   ✅ All tests passed"
    else
        echo "   ❌ ERROR: Tests failed!"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
    cd "$PROJECT_DIR"
    return 0
}

# 3. Verify Python API
echo "[3/7] Verifying Python API..."
verify_api() {
    cd "$PROJECT_DIR/python-api"

    # Check if local server is running
    if curl -s http://localhost:8080/health >/dev/null 2>&1; then
        if python3 verify_api.py 2>&1; then
            echo "   ✅ API verification passed"
        else
            echo "   ❌ ERROR: API verification failed!"
            ERRORS=$((ERRORS + 1))
            return 1
        fi
    else
        echo "   ⚠️  WARNING: Local Python API not running, skipping verification"
        WARNINGS=$((WARNINGS + 1))
    fi

    cd "$PROJECT_DIR"
    return 0
}

# 4. Build frontend
echo "[4/7] Building frontend..."
build_frontend() {
    if npm run build 2>&1; then
        echo "   ✅ Frontend build successful"
    else
        echo "   ❌ ERROR: Frontend build failed!"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
    return 0
}

# 5. Check Supabase secrets
echo "[5/7] Checking Supabase secrets..."
check_secrets() {
    REQUIRED_SECRETS=(
        "GEMINI_API_KEY"
        "PYTHON_API_URL"
    )

    OPTIONAL_SECRETS=(
        "PYTHON_API_KEY"
        "FORTNOX_CLIENT_ID"
        "FORTNOX_CLIENT_SECRET"
    )

    # Get current secrets
    SECRETS_LIST=$(supabase secrets list 2>/dev/null || echo "")

    for secret in "${REQUIRED_SECRETS[@]}"; do
        if ! echo "$SECRETS_LIST" | grep -q "$secret"; then
            echo "   ❌ ERROR: Missing required secret: $secret"
            ERRORS=$((ERRORS + 1))
        fi
    done

    for secret in "${OPTIONAL_SECRETS[@]}"; do
        if ! echo "$SECRETS_LIST" | grep -q "$secret"; then
            echo "   ⚠️  WARNING: Missing optional secret: $secret"
            WARNINGS=$((WARNINGS + 1))
        fi
    done

    if [ $ERRORS -eq 0 ]; then
        echo "   ✅ Required secrets present"
    fi
    return 0
}

# 6. Check Railway environment (manual reminder)
echo "[6/7] Railway environment check..."
check_railway() {
    echo "   ⚠️  Manual verification required:"
    echo "      - ENV=production"
    echo "      - DEBUG=false"
    echo "      - ALLOWED_ORIGINS set correctly"
    echo "      - PYTHON_API_KEY matches Supabase secret"
    WARNINGS=$((WARNINGS + 1))
    return 0
}

# 7. Pre-commit checks
echo "[7/7] Running pre-commit checks..."
run_precommit() {
    if [ -f "$PROJECT_DIR/.claude/hooks/pre-commit.sh" ]; then
        if bash "$PROJECT_DIR/.claude/hooks/pre-commit.sh" 2>&1; then
            echo "   ✅ Pre-commit checks passed"
        else
            echo "   ❌ ERROR: Pre-commit checks failed!"
            ERRORS=$((ERRORS + 1))
            return 1
        fi
    else
        echo "   ⚪ Pre-commit hook not found, skipping"
    fi
    return 0
}

# Execute all checks
check_git
run_tests
verify_api
build_frontend
check_secrets
check_railway
run_precommit

echo ""
echo "=========================================="
if [ $ERRORS -gt 0 ]; then
    echo "❌ Pre-deployment validation FAILED"
    echo "   $ERRORS error(s), $WARNINGS warning(s)"
    echo ""
    echo "Fix the errors before deploying."
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo "⚠️  Pre-deployment validation PASSED with warnings"
    echo "   $WARNINGS warning(s)"
    echo ""
    echo "Review warnings before proceeding."
    echo ""
    read -p "Continue with deployment? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled."
        exit 1
    fi
    exit 0
else
    echo "✅ Pre-deployment validation PASSED"
    echo ""
    echo "Ready to deploy!"
    exit 0
fi
