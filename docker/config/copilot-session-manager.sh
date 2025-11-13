#!/bin/bash
# Manages a persistent copilot session for dashboard chat
# This avoids creating new sessions for each message, improving efficiency
# Uses the same dev-farm session so users see the conversation in their terminal

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
        return 0
    fi
    
    # The dev-farm session should already exist (created by startup.sh)
    # If it doesn't exist, something went wrong during startup
    echo "⚠ dev-farm session does not exist - startup may have failed" | tee -a "$LOG_FILE"
    return 1
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
    
    # Ensure we're in the input prompt by pressing Escape first (exits any mode)
    # then clear any existing input
    tmux send-keys -t "$SESSION_NAME" Escape C-u 2>/dev/null
    sleep 0.2
    
    # Type the message character by character to ensure it's properly entered
    # This is more reliable than sending the whole string at once
    tmux send-keys -t "$SESSION_NAME" -l "$message" 2>/dev/null
    sleep 0.2
    
    # Send Enter key to submit
    tmux send-keys -t "$SESSION_NAME" Enter 2>/dev/null
    
    # Give initial time for copilot to start processing
    sleep 1
    
    # Determine timeout based on message complexity
    local timeout=15
    if echo "$message" | grep -qiE "explain|analyze|refactor|debug|create|build|write|code|function|class"; then
        timeout=25
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
    
    # Capture final response with smaller buffer to reduce noise
    local full_output=$(tmux capture-pane -t "$SESSION_NAME" -p -S -30 2>/dev/null)
    
    # Parse output to extract only Copilot's response (not the echoed input)
    # Strategy: Skip lines until we find content after the user's message,
    # then capture until we see the prompt (">") or output stabilizes
    
    # Use Python for reliable text parsing (no command filtering - user wants to see everything)
    echo "$full_output" | python3 -c "
import sys

full_text = sys.stdin.read()
message = '''$message'''

# Split by lines
lines = full_text.split('\n')

# Find where user message appears (look from end to get most recent)
last_msg_idx = -1
for i in range(len(lines) - 1, -1, -1):
    # Look for exact message match (not substring)
    if lines[i].strip() == message.strip():
        last_msg_idx = i
        break

if last_msg_idx == -1:
    # If exact match not found, extract content after any Copilot prompt
    response_lines = []
    found_content = False
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Skip empty lines and prompt markers
        if not stripped or stripped == '>':
            continue
            
        # Skip the user's message if it appears anywhere
        if message.strip() in stripped:
            continue
        
        # Capture non-empty content
        response_lines.append(line.rstrip())
        found_content = True
    
    if found_content:
        print('\n'.join(response_lines))
    else:
        print('Waiting for response...')
    sys.exit(0)

# Found the message - capture everything after it
response_lines = []
for i in range(last_msg_idx + 1, len(lines)):
    stripped = lines[i].strip()
    
    # Stop at next prompt
    if stripped == '>':
        break
    
    # Skip empty lines at start
    if not response_lines and not stripped:
        continue
    
    # Capture content
    if stripped:
        response_lines.append(lines[i].rstrip())

# Output the response
if response_lines:
    print('\n'.join(response_lines))
else:
    print('Processing...')
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