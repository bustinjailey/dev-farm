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
    # We'll try to run copilot --version and then test a simple command
    export PATH="/home/coder/.npm-global/bin:$PATH"
    
    if command -v copilot >/dev/null 2>&1; then
        # Copilot is installed, test if it's authenticated
        # Try to start copilot in non-interactive mode and check response
        if timeout 10s echo "test" | copilot 2>&1 | grep -qE "Welcome|How can I help|What can I do"; then
            # Successfully authenticated!
            echo "authenticated" > "$AUTH_STATUS_FILE"
            
            # Remove device auth file to signal completion
            rm -f "$DEVICE_AUTH_FILE"
            
            echo "✅ Copilot authentication completed successfully!" | tee -a "$LOG_FILE"
            echo "🤖 Copilot CLI is ready to use" | tee -a "$LOG_FILE"
            break
        fi
    fi
    
    # Log progress every 30 seconds
    if [ $((elapsed % 30)) -eq 0 ]; then
        echo "⏳ Still waiting for authentication... (${elapsed}s elapsed)" >> "$LOG_FILE"
    fi
    
    sleep $CHECK_INTERVAL
done

echo "Copilot authentication monitor stopped" | tee -a "$LOG_FILE"