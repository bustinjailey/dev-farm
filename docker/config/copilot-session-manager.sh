#!/bin/bash
# Manages a persistent copilot session for dashboard chat
# This avoids creating new sessions for each message, improving efficiency

SESSION_NAME="copilot-dashboard"
LOG_FILE="/home/coder/workspace/.terminal.log"

# Ensure npm global bin is in PATH
export PATH="/home/coder/.npm-global/bin:$PATH"

# Function to check if session exists and is responsive
session_exists() {
    tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

# Function to ensure session is ready
ensure_session() {
    if session_exists; then
        echo "Session already exists"
        return 0
    fi
    
    echo "Creating new copilot session..." | tee -a "$LOG_FILE"
    
    # Create detached tmux session with copilot
    if ! tmux new-session -d -s "$SESSION_NAME" -c /home/coder/workspace copilot 2>/dev/null; then
        echo "Error: Failed to create copilot session" | tee -a "$LOG_FILE"
        return 1
    fi
    
    # Wait for copilot to initialize
    sleep 3
    
    # Check if copilot is ready by capturing output
    local ready=false
    for i in {1..10}; do
        OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p -S -10 2>/dev/null || echo "")
        if echo "$OUTPUT" | grep -qE "Welcome|How can I help|What can I do"; then
            ready=true
            echo "✓ Copilot session ready" | tee -a "$LOG_FILE"
            break
        fi
        sleep 1
    done
    
    if [ "$ready" = "true" ]; then
        return 0
    else
        echo "⚠ Copilot session created but may not be fully initialized" | tee -a "$LOG_FILE"
        return 1
    fi
}

# Function to send message and capture response
send_message() {
    local message="$1"
    
    if [ -z "$message" ]; then
        echo "Error: No message provided"
        return 1
    fi
    
    # Ensure session exists
    if ! ensure_session; then
        echo "Error: Could not ensure copilot session"
        return 1
    fi
    
    # Clear screen for clean capture (optional)
    # tmux send-keys -t "$SESSION_NAME" "C-l" 2>/dev/null
    # sleep 0.5
    
    # Send the message
    tmux send-keys -t "$SESSION_NAME" "$message" C-m 2>/dev/null
    
    # Determine timeout based on message complexity
    local timeout=15
    if echo "$message" | grep -qiE "explain|analyze|refactor|debug|create|build|write"; then
        timeout=30
    fi
    
    # Wait for response
    sleep "$timeout"
    
    # Capture response (last 100 lines should be enough)
    tmux capture-pane -t "$SESSION_NAME" -p -S -100 2>/dev/null || echo "Error: Could not capture response"
}

# Function to check session health
check_health() {
    if ! session_exists; then
        echo "Session does not exist"
        return 1
    fi
    
    # Try to capture pane
    OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p -S -5 2>/dev/null || echo "")
    
    if [ -n "$OUTPUT" ]; then
        echo "Session is healthy"
        return 0
    else
        echo "Session exists but may be unresponsive"
        return 1
    fi
}

# Function to kill session
kill_session() {
    if session_exists; then
        echo "Killing copilot session..." | tee -a "$LOG_FILE"
        tmux kill-session -t "$SESSION_NAME" 2>/dev/null
        echo "✓ Session killed" | tee -a "$LOG_FILE"
    else
        echo "No session to kill"
    fi
}

# Function to restart session
restart_session() {
    echo "Restarting copilot session..." | tee -a "$LOG_FILE"
    kill_session
    ensure_session
}

# Main command handling
case "$1" in
    ensure)
        ensure_session
        ;;
    send)
        if [ -z "$2" ]; then
            echo "Usage: $0 send <message>"
            exit 1
        fi
        send_message "$2"
        ;;
    health)
        check_health
        ;;
    kill)
        kill_session
        ;;
    restart)
        restart_session
        ;;
    *)
        echo "Usage: $0 {ensure|send <message>|health|kill|restart}"
        echo ""
        echo "Commands:"
        echo "  ensure         Ensure copilot session exists and is ready"
        echo "  send <msg>     Send message to copilot and capture response"
        echo "  health         Check if session is healthy"
        echo "  kill           Kill the copilot session"
        echo "  restart        Restart the copilot session"
        exit 1
        ;;
esac