#!/bin/bash
# Wrapper script to interact with GitHub Copilot CLI programmatically
# This enables dashboard integration with the interactive copilot command
# Updated to work with device flow authentication

set -e

# Ensure npm global bin is in PATH
export PATH="/home/coder/.npm-global/bin:$PATH"

# Check if copilot is installed
if ! command -v copilot >/dev/null 2>&1; then
    echo "Error: copilot command not found. Install with: npm install -g @github/copilot" >&2
    exit 1
fi

# Check if authentication is needed
DEVICE_AUTH_FILE="/home/coder/workspace/.copilot-device-auth.json"
if [ -f "$DEVICE_AUTH_FILE" ]; then
    # Device auth file exists - authentication is pending
    eval $(jq -r '@sh "DEVICE_CODE=\(.code // \"\") DEVICE_URL=\(.url // \"\")"' "$DEVICE_AUTH_FILE" 2>/dev/null || echo 'DEVICE_CODE="" DEVICE_URL=""')
    
    if [ -n "$DEVICE_CODE" ]; then
        echo "⚠️  Copilot authentication required!"
        echo "📱 Visit: $DEVICE_URL"
        echo "🔑 Enter code: $DEVICE_CODE"
        echo ""
        echo "Once authenticated, try your message again."
        exit 1
    fi
fi

# Function to send a message to copilot and get response using tmux
copilot_chat_tmux() {
    local message="$1"
    local session_name="copilot-dashboard-$$"
    local timeout=15
    
    # Create a new detached tmux session with copilot
    if ! tmux new-session -d -s "$session_name" "copilot" 2>/dev/null; then
        echo "Error: Failed to start copilot session" >&2
        echo "This may be due to authentication issues. Check if you need to authenticate." >&2
        return 1
    fi
    
    # Wait for copilot to initialize
    sleep 2
    
    # Authentication is checked via device auth file above - no need for output grep
    
    # Send the message
    tmux send-keys -t "$session_name" "$message" C-m
    
    # Wait for response (increase timeout for complex queries)
    sleep $timeout
    
    # Capture the full pane content
    OUTPUT=$(tmux capture-pane -t "$session_name" -p -S -200 2>/dev/null || echo "No output captured")
    
    # Exit copilot gracefully
    tmux send-keys -t "$session_name" "/exit" C-m
    sleep 1
    
    # Kill the session
    tmux kill-session -t "$session_name" 2>/dev/null || true
    
    # Output the captured text
    echo "$OUTPUT"
}

# Main execution
if [ $# -eq 0 ]; then
    echo "Usage: $0 <message>" >&2
    echo "Example: $0 'Create a Python web server'" >&2
    exit 1
fi

# Use tmux-based approach with authentication checking
copilot_chat_tmux "$1"
