#!/bin/bash
# Background process to monitor copilot authentication status
# This script runs in the background and checks if the user has completed
# GitHub device flow authentication for Copilot CLI

set -e

DEVICE_AUTH_FILE="/root/workspace/.copilot-device-auth.json"
AUTH_STATUS_FILE="/root/workspace/.copilot-auth-status"
LOG_FILE="/root/workspace/.terminal.log"
CHECK_INTERVAL=5
MAX_WAIT=300  # 5 minutes

# Check if already authenticated - don't start monitor if so
if [ -f "$AUTH_STATUS_FILE" ] && grep -q "authenticated" "$AUTH_STATUS_FILE" 2>/dev/null; then
    echo "ℹ️  Copilot already authenticated - monitor not needed" | tee -a "$LOG_FILE"
    exit 0
fi

echo "Starting Copilot authentication monitor..." | tee -a "$LOG_FILE"

# Initialize status as pending
echo "pending" > "$AUTH_STATUS_FILE"

start_time=$(date +%s)

while true; do
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    
    # Check for timeout
    if [ $elapsed -gt $MAX_WAIT ]; then
        echo "timeout" > "$AUTH_STATUS_FILE"
        echo "⏱️  Authentication timeout after ${MAX_WAIT} seconds" | tee -a "$LOG_FILE"
        break
    fi
    
    # Test if copilot is authenticated
    export PNPM_HOME=/root/.local/share/pnpm
    export PATH="$PNPM_HOME:/root/.npm-global/bin:$PATH"
    
    if command -v copilot >/dev/null 2>&1; then
        # Check if the main dev-farm session shows copilot is authenticated
        if tmux has-session -t dev-farm 2>/dev/null; then
            # Capture the session output
            OUTPUT=$(tmux capture-pane -t dev-farm -p -S -30 2>/dev/null || echo "")
            
            # Check for token storage prompt (appears after successful authentication)
            if echo "$OUTPUT" | grep -q "store the token in the plain text config file"; then
                echo "✓ Detected token storage prompt - accepting plain text storage" | tee -a "$LOG_FILE"
                tmux send-keys -t dev-farm "1"
                sleep 2
                OUTPUT=$(tmux capture-pane -t dev-farm -p -S -30 2>/dev/null || echo "")
            fi
            
            # Check if authentication completed (user sees actual prompt, not just welcome banner)
            # Look for success message or interactive prompt
            if echo "$OUTPUT" | grep -qE "Signed in successfully|How can I help|What can I do|Enter @ to mention files"; then
                if ! echo "$OUTPUT" | grep -qE "Please use /login|github.com/login/device|Waiting for authorization"; then
                    echo "✅ Copilot authentication completed!" | tee -a "$LOG_FILE"
                    
                    # Mark as authenticated
                    echo "authenticated" > "$AUTH_STATUS_FILE"
                    
                    # Remove device auth file to signal completion
                    rm -f "$DEVICE_AUTH_FILE"
                    
                    echo "🤖 Copilot CLI is ready to use" | tee -a "$LOG_FILE"
                    break
                fi
            fi
        else
            # Session doesn't exist, try testing with a simple command
            if timeout 10s echo "test" | copilot --allow-all-tools 2>&1 | grep -qE "How can I help|What can I do"; then
                # Successfully authenticated!
                echo "authenticated" > "$AUTH_STATUS_FILE"
                
                # Remove device auth file to signal completion
                rm -f "$DEVICE_AUTH_FILE"
                
                echo "✅ Copilot authentication completed!" | tee -a "$LOG_FILE"
                echo "🤖 Copilot CLI is ready to use" | tee -a "$LOG_FILE"
                break
            fi
        fi
    fi
    
    # Log progress every 30 seconds
    if [ $((elapsed % 30)) -eq 0 ]; then
        echo "⏳ Still waiting for authentication... (${elapsed}s elapsed)" >> "$LOG_FILE"
    fi
    
    sleep $CHECK_INTERVAL
done

echo "Copilot authentication monitor stopped" | tee -a "$LOG_FILE"