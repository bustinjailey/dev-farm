#!/bin/bash
# Manages a persistent copilot session for dashboard chat
# This avoids creating new sessions for each message, improving efficiency

SESSION_NAME="copilot-dashboard"
LOG_FILE="/home/coder/workspace/.terminal.log"

# Ensure npm global bin and pnpm home are in PATH
export PNPM_HOME=/home/coder/.local/share/pnpm
export PATH="$PNPM_HOME:/home/coder/.npm-global/bin:$PATH"

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
    
    # Create detached tmux session with copilot using --allow-all-tools flag
    if ! tmux new-session -d -s "$SESSION_NAME" -c /home/coder/workspace "copilot --allow-all-tools" 2>/dev/null; then
        echo "Error: Failed to create copilot session" | tee -a "$LOG_FILE"
        return 1
    fi
    
    # Wait for copilot to initialize
    sleep 2
    
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
    # The copilot CLI echoes the input and then provides a response
    # We need to skip the echo and extract only the actual response
    echo "$full_output" | awk -v msg="$message" '
        BEGIN { 
            found_message=0
            skip_lines=0
            capturing=0
            response=""
            line_count=0
        }
        # Find the line with our sent message
        !found_message && $0 ~ msg {
            found_message=1
            skip_lines=2  # Skip the message line and next line (usually empty)
            next
        }
        # Skip lines immediately after the message
        found_message && skip_lines > 0 {
            skip_lines--
            # Also skip if this line is just the message echo again
            if ($0 ~ msg || length($0) == 0 || $0 ~ /^[[:space:]]*$/) {
                next
            }
            # If we hit actual content, start capturing
            capturing=1
        }
        # After finding message and skip period, start capturing
        found_message && skip_lines == 0 && !capturing {
            # Skip empty lines
            if (length($0) == 0 || $0 ~ /^[[:space:]]*$/) {
                next
            }
            # Skip if it looks like the echoed message
            if ($0 ~ msg) {
                next
            }
            # Start capturing when we hit non-empty content
            capturing=1
        }
        # Capture response lines
        capturing {
            # Stop if we hit the next prompt (line starting with >)
            if ($0 ~ /^>[[:space:]]*$/ || $0 ~ /^> $/) {
                exit
            }
            # Skip if this looks like the user message being echoed
            if ($0 ~ msg && line_count < 3) {
                next
            }
            # Add line to response
            if (line_count > 0) {
                response = response "\n" $0
            } else {
                response = $0
            }
            line_count++
        }
        END {
            # Clean up trailing whitespace
            gsub(/[[:space:]]+$/, "", response)
            # Also remove leading whitespace
            gsub(/^[[:space:]]+/, "", response)
            if (length(response) > 0) {
                print response
            } else {
                print "No response received from Copilot. Please try again."
            }
        }
    '
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