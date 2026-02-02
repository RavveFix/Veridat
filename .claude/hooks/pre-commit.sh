#!/bin/bash
# Pre-commit validation hook for Veridat
# Validates code before commits (secrets, linting, JSON)

set -e

PROJECT_DIR="/Users/ravonstrawder/Desktop/Britta"
cd "$PROJECT_DIR"

echo "🔍 Running pre-commit checks..."
echo ""

ERRORS=0

# 1. Secrets Detection
echo "[1/5] Scanning for secrets..."
detect_secrets() {
    # Common secret patterns
    PATTERNS=(
        'api[_-]?key\s*=\s*["\047][^"\047]{20,}'
        'secret\s*=\s*["\047][^"\047]{20,}'
        'password\s*=\s*["\047][^"\047]{8,}'
        'GEMINI_API_KEY\s*=\s*["\047]'
        'PYTHON_API_KEY\s*=\s*["\047]'
        'FORTNOX_CLIENT_SECRET\s*=\s*["\047]'
        'Bearer [A-Za-z0-9-._~+/]{20,}'
    )

    for pattern in "${PATTERNS[@]}"; do
        if git diff --cached | grep -iE "$pattern" >/dev/null 2>&1; then
            echo "   ❌ ERROR: Potential secret detected!"
            echo "   Pattern: $pattern"
            ERRORS=$((ERRORS + 1))
            return 1
        fi
    done
    echo "   ✅ No secrets detected"
    return 0
}

# 2. Check for .env files
echo "[2/5] Checking for .env files..."
check_env_files() {
    if git diff --cached --name-only | grep -E "\.env" >/dev/null 2>&1; then
        echo "   ❌ ERROR: .env file staged for commit!"
        echo "   Remove with: git reset HEAD <file>"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
    echo "   ✅ No .env files staged"
    return 0
}

# 3. JSON Validation
echo "[3/5] Validating JSON files..."
validate_json() {
    for file in $(git diff --cached --name-only | grep '\.json$'); do
        if [ -f "$file" ]; then
            if ! python3 -m json.tool "$file" >/dev/null 2>&1; then
                echo "   ❌ ERROR: Invalid JSON in $file"
                ERRORS=$((ERRORS + 1))
                return 1
            fi
        fi
    done
    echo "   ✅ JSON files valid"
    return 0
}

# 4. Python Syntax Check
echo "[4/5] Checking Python syntax..."
check_python() {
    PYTHON_FILES=$(git diff --cached --name-only | grep '\.py$' || true)
    if [ -n "$PYTHON_FILES" ]; then
        for file in $PYTHON_FILES; do
            if [ -f "$file" ]; then
                if ! python3 -m py_compile "$file" 2>/dev/null; then
                    echo "   ❌ ERROR: Python syntax error in $file"
                    ERRORS=$((ERRORS + 1))
                    return 1
                fi
            fi
        done
    fi
    echo "   ✅ Python syntax OK"
    return 0
}

# 5. TypeScript Build Check (if TS files changed)
echo "[5/5] Checking TypeScript..."
check_typescript() {
    TS_FILES=$(git diff --cached --name-only | grep '\.ts$' || true)
    if [ -n "$TS_FILES" ]; then
        # Quick type check without full build
        if command -v npx >/dev/null 2>&1; then
            if ! npx tsc --noEmit --skipLibCheck 2>/dev/null; then
                echo "   ⚠️  WARNING: TypeScript errors detected"
                # Don't block on TS errors, just warn
            else
                echo "   ✅ TypeScript OK"
            fi
        else
            echo "   ⚪ TypeScript check skipped (npx not found)"
        fi
    else
        echo "   ⚪ No TypeScript files changed"
    fi
    return 0
}

# Execute all checks
detect_secrets
check_env_files
validate_json
check_python
check_typescript

echo ""
if [ $ERRORS -gt 0 ]; then
    echo "=========================================="
    echo "❌ Pre-commit validation FAILED"
    echo "   $ERRORS error(s) found"
    echo ""
    echo "Fix the errors and try again."
    echo "To bypass (not recommended): git commit --no-verify"
    echo "=========================================="
    exit 1
else
    echo "=========================================="
    echo "✅ Pre-commit validation PASSED"
    echo "=========================================="
    exit 0
fi
