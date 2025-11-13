#!/bin/bash
# Manages a persistent copilot session for dashboard chat
# This avoids creating new sessions for each message, improving efficiency

SESSION_NAME="dev-farm"
LOG_FILE="/root/workspace/.terminal.log"

# Ensure npm global bin and pnpm home are in PATH
export PNPM_HOME=/root/.local/share/pnpm
export PATH="$PNPM_HOME:/root/.npm-global/bin:$PATH"

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
    
    # The dev-farm session should already exist (created by startup.sh)
    # It has workspace trust automation and device auth handling
    # We should NOT create a new session here, as it would require manual trust confirmation
    echo "⚠ dev-farm session does not exist - may not be initialized yet" | tee -a "$LOG_FILE"
    echo "⚠ This session is created by startup.sh with automation" | tee -a "$LOG_FILE"
    return 1
    
    # LEGACY CODE (disabled - we now use the pre-created copilot-auth session):
    # echo "Creating new copilot session..." | tee -a "$LOG_FILE"
    # if ! tmux new-session -d -s "$SESSION_NAME" -c /root/workspace "copilot --allow-all-tools" 2>/dev/null; then
    #     echo "Error: Failed to create copilot session" | tee -a "$LOG_FILE"
    #     return 1
    # fi
    # sleep 2
    
    # Check if copilot is ready by capturing output
    local ready=false
    local max_attempts=15
    for i in $(seq 1 $max_attempts); do
        OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p -S -20 2>/dev/null || echo "")
        
        # Check for ready state (welcome message or prompt)
        if echo "$OUTPUT" | grep -qE "Welcome|How can I help|What can I do|^>"; then
            ready=true
            echo "✓ Copilot session ready" | tee -a "$LOG_FILE"
            break
        fi
        
        # Check if authentication is needed
        if echo "$OUTPUT" | grep -qE "github.com/login/device|Enter one time code"; then
            echo "⚠ Copilot needs authentication. Please complete GitHub device auth." | tee -a "$LOG_FILE"
            return 1
        fi
        
        sleep 1
    done
    
    if [ "$ready" = "true" ]; then
        return 0
    else
        echo "⚠ Copilot session created but may not be fully initialized" | tee -a "$LOG_FILE"
        echo "⚠ Last output: $OUTPUT" | tee -a "$LOG_FILE"
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
    
    # Capture current pane content before sending (to establish baseline)
    local before_lines=$(tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | wc -l)
    
    # Send the message
    tmux send-keys -t "$SESSION_NAME" "$message" C-m 2>/dev/null
    
    # Give initial time for copilot to start processing
    sleep 1
    
    # Determine timeout based on message complexity
    local timeout=20
    if echo "$message" | grep -qiE "explain|analyze|refactor|debug|create|build|write|code|function|class"; then
        timeout=35
    fi
    
    # Wait for response with polling
    local elapsed=0
    local check_interval=1
    local max_wait=$timeout
    local response_complete=false
    local last_line_count=0
    local stable_count=0
    
    while [ $elapsed -lt $max_wait ]; do
        sleep $check_interval
        elapsed=$((elapsed + check_interval))
        
        # Capture current state
        local current_output=$(tmux capture-pane -t "$SESSION_NAME" -p -S -50 2>/dev/null)
        local current_line_count=$(echo "$current_output" | wc -l)
        
        # Check if we see a prompt indicator (copilot is ready for next input)
        # The copilot CLI shows ">" at the start of a line when ready
        if echo "$current_output" | tail -n 2 | grep -qE "^>"; then
            response_complete=true
            break
        fi
        
        # Also check if output has stabilized (no new lines for 3 checks)
        if [ "$current_line_count" -eq "$last_line_count" ]; then
            stable_count=$((stable_count + 1))
            if [ $stable_count -ge 3 ]; then
                # Output has stabilized, likely done
                response_complete=true
                break
            fi
        else
            stable_count=0
        fi
        
        last_line_count=$current_line_count
    done
    
    # Capture final response
    local full_output=$(tmux capture-pane -t "$SESSION_NAME" -p -S -100 2>/dev/null)
    
    # Parse output to extract only Copilot's response (not the echoed input)
    # The copilot CLI shows responses in a specific format
    # We need to extract only the actual AI response, not the echoed user input
    
    # Strategy: Find the last occurrence of the user's message, then capture everything after it
    # until we hit the prompt marker (">")
    
    # Use a Python one-liner for more reliable text parsing
    echo "$full_output" | python3 -c "
import sys
import re

full_text = sys.stdin.read()
message = '''$message'''

# Split by lines for processing
lines = full_text.split('\n')

# Find the LAST occurrence of the user message (it may appear multiple times due to echo)
last_msg_idx = -1
for i in range(len(lines) - 1, -1, -1):
    if message.strip() in lines[i]:
        last_msg_idx = i
        break

if last_msg_idx == -1:
    # Message not found, try to extract any copilot response
    # Look for lines that don't start with '>' and aren't empty
    response_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith('>'):
            response_lines.append(line)
    
    if response_lines:
        print('\n'.join(response_lines))
    else:
        print('No response from Copilot')
    sys.exit(0)

# Start capturing from the line AFTER the last message occurrence
response_lines = []
capturing = False

for i in range(last_msg_idx + 1, len(lines)):
    line = lines[i]
    stripped = line.strip()
    
    # Skip empty lines immediately after the message
    if not capturing and not stripped:
        continue
    
    # Stop if we hit a prompt indicator (but only after capturing started)
    if stripped == '>' and capturing:
        break
    
    # Start capturing non-empty content (removed substring filter to fix echo bug)
    if stripped:
        capturing = True
        response_lines.append(line.rstrip())

# Output the response
if response_lines:
    print('\n'.join(response_lines))
else:
    print('Copilot is processing your request...')
"
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