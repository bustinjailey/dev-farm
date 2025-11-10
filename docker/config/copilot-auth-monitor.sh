#!/bin/bash
# Background process to monitor copilot authentication status
# This script runs in the background and checks if the user has completed
# GitHub device flow authentication for Copilot CLI

set -e

DEVICE_AUTH_FILE="/home/coder/workspace/.copilot-device-auth.json"
AUTH_STATUS_FILE="/home/coder/workspace/.copilot-auth-status"
LOG_FILE="/home/coder/workspace/.terminal.log"
CHECK_INTERVAL=5
MAX_WAIT=300  # 5 minutes

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
    export PNPM_HOME=/home/coder/.local/share/pnpm
    export PATH="$PNPM_HOME:/home/coder/.npm-global/bin:$PATH"
    
    if command -v copilot >/dev/null 2>&1; then
        # Check if the auth session exists and see if user completed auth
        if tmux has-session -t copilot-auth 2>/dev/null; then
            # Capture the session output
            OUTPUT=$(tmux capture-pane -t copilot-auth -p -S -30 2>/dev/null || echo "")
            
            # Check if authentication completed (user sees welcome or prompt)
            if echo "$OUTPUT" | grep -qE "Welcome|How can I help|What can I do|Authentication successful"; then
                echo "✅ Copilot authentication detected!" | tee -a "$LOG_FILE"
                
                # Send /login command to complete the flow automatically
                echo "✓ Completing authentication flow..." | tee -a "$LOG_FILE"
                tmux send-keys -t copilot-auth "/login" C-m
                sleep 2
                
                # Mark as authenticated
                echo "authenticated" > "$AUTH_STATUS_FILE"
                
                # Remove device auth file to signal completion
                rm -f "$DEVICE_AUTH_FILE"
                
                # Kill the auth session since we're done
                tmux kill-session -t copilot-auth 2>/dev/null || true
                
                echo "✅ Copilot authentication completed successfully!" | tee -a "$LOG_FILE"
                echo "🤖 Copilot CLI is ready to use" | tee -a "$LOG_FILE"
                break
            fi
        else
            # Auth session doesn't exist, try testing with a simple command
            if timeout 10s echo "test" | copilot --allow-all-tools 2>&1 | grep -qE "Welcome|How can I help|What can I do"; then
                # Successfully authenticated!
                echo "authenticated" > "$AUTH_STATUS_FILE"
                
                # Remove device auth file to signal completion
                rm -f "$DEVICE_AUTH_FILE"
                
                echo "✅ Copilot authentication completed successfully!" | tee -a "$LOG_FILE"
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