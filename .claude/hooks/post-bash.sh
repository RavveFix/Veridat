#!/bin/bash
# Post-bash logging hook for Veridat
# Logs commands and tracks errors for debugging

PROJECT_DIR="/Users/ravonstrawder/Desktop/Britta"
LOG_FILE="$PROJECT_DIR/.claude/CLAUDE.local.md"
ERROR_LOG="$PROJECT_DIR/.claude/errors.log"
DEPLOY_LOG="$PROJECT_DIR/.claude/deployment.log"

# Get command info from environment
COMMAND="${CLAUDE_COMMAND:-$1}"
EXIT_CODE="${CLAUDE_EXIT_CODE:-$?}"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

# Skip if no command
if [ -z "$COMMAND" ]; then
    exit 0
fi

# Create log files if they don't exist
touch "$LOG_FILE" 2>/dev/null
touch "$ERROR_LOG" 2>/dev/null
touch "$DEPLOY_LOG" 2>/dev/null

# Append to CLAUDE.local.md
append_to_local() {
    {
        echo ""
        echo "### $TIMESTAMP"
        echo '```bash'
        echo "$COMMAND"
        echo '```'
        if [ "$EXIT_CODE" -ne 0 ]; then
            echo "**Exit code:** $EXIT_CODE (ERROR)"
        fi
    } >> "$LOG_FILE"
}

# Track deployment commands
track_deployment() {
    if [[ "$COMMAND" =~ (deploy|push|functions|vercel|railway) ]]; then
        echo "[$TIMESTAMP] $COMMAND (exit: $EXIT_CODE)" >> "$DEPLOY_LOG"
    fi
}

# Track errors
track_error() {
    if [ "$EXIT_CODE" -ne 0 ]; then
        {
            echo "[$TIMESTAMP] ERROR (exit: $EXIT_CODE)"
            echo "Command: $COMMAND"
            echo "---"
        } >> "$ERROR_LOG"
    fi
}

# Execute logging
append_to_local
track_deployment
track_error

# Don't block the original command
exit "$EXIT_CODE"
