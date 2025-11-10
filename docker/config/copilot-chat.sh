#!/bin/bash
# Wrapper script to interact with GitHub Copilot CLI programmatically
# This enables dashboard integration with the interactive copilot command
# Updated to work with device flow authentication

set -e

# Ensure npm global bin and pnpm home are in PATH
export PNPM_HOME=/home/coder/.local/share/pnpm
export PATH="$PNPM_HOME:/home/coder/.npm-global/bin:$PATH"

# Check if copilot is installed
if ! command -v copilot >/dev/null 2>&1; then
    echo "Error: copilot command not found. Install with: npm install -g @github/copilot" >&2
    exit 1
fi

# Check authentication status
AUTH_STATUS_FILE="/home/coder/workspace/.copilot-auth-status"
DEVICE_AUTH_FILE="/home/coder/workspace/.copilot-device-auth.json"

# Check authentication status
if [ -f "$AUTH_STATUS_FILE" ]; then
    AUTH_STATUS=$(cat "$AUTH_STATUS_FILE")
    
    if [ "$AUTH_STATUS" = "pending" ] && [ -f "$DEVICE_AUTH_FILE" ]; then
        # Still waiting for authentication
        DEVICE_CODE=$(jq -r '.code // ""' "$DEVICE_AUTH_FILE" 2>/dev/null)
        DEVICE_URL=$(jq -r '.url // ""' "$DEVICE_AUTH_FILE" 2>/dev/null)
        
        echo "⚠️  Copilot authentication in progress"
        echo "📱 Visit: $DEVICE_URL"
        echo "🔑 Code: $DEVICE_CODE"
        echo ""
        echo "Waiting for you to complete authentication on GitHub..."
        exit 1
    elif [ "$AUTH_STATUS" = "timeout" ]; then
        echo "❌ Authentication timeout. Please restart the environment."
        exit 1
    fi
    # If "authenticated", proceed with chat
fi

# Main execution
if [ $# -eq 0 ]; then
    echo "Usage: $0 <message>" >&2
    echo "Example: $0 'Create a Python web server'" >&2
    exit 1
fi

# Use session manager for persistent session
/home/coder/copilot-session-manager.sh send "$1"
