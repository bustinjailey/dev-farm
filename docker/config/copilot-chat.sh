#!/bin/bash
# Wrapper script to interact with GitHub Copilot CLI programmatically
# This enables dashboard integration with the interactive copilot command

set -e

# Ensure npm global bin is in PATH
export PATH="/home/coder/.npm-global/bin:$PATH"

# Check if copilot is installed
if ! command -v copilot >/dev/null 2>&1; then
    echo "Error: copilot command not found. Install with: npm install -g @github/copilot" >&2
    exit 1
fi

# Function to send a message to copilot and get response
# This uses script command to create a PTY for the interactive copilot CLI
copilot_chat() {
    local message="$1"
    local session_file="/tmp/copilot_session_$$.txt"
    
    # Create a script that feeds input to copilot
    cat > /tmp/copilot_input_$$.sh << 'INPUT_SCRIPT'
#!/bin/bash
sleep 1
echo "$MESSAGE"
sleep 5
echo "/exit"
sleep 1
INPUT_SCRIPT
    
    chmod +x /tmp/copilot_input_$$.sh
    
    # Use script command to create a PTY and run copilot
    # Feed the message and capture output
    MESSAGE="$message" timeout 30s script -qfc "bash -c 'export MESSAGE=\"$message\"; (sleep 1; echo \"\$MESSAGE\"; sleep 8; echo \"/exit\") | copilot 2>&1'" /dev/null 2>&1 || true
    
    # Clean up
    rm -f /tmp/copilot_input_$$.sh /tmp/copilot_session_$$.txt
}

# Alternative: Use tmux to manage copilot session
copilot_chat_tmux() {
    local message="$1"
    local session_name="copilot-api-$$"
    
    # Create a new tmux session with copilot
    tmux new-session -d -s "$session_name" "copilot" 2>/dev/null || {
        echo "Failed to start copilot session" >&2
        return 1
    }
    
    # Wait for copilot to start
    sleep 2
    
    # Send the message
    tmux send-keys -t "$session_name" "$message" C-m
    
    # Wait for response
    sleep 6
    
    # Capture the pane content
    tmux capture-pane -t "$session_name" -p -S -100
    
    # Exit copilot
    tmux send-keys -t "$session_name" "/exit" C-m
    sleep 1
    
    # Kill the session
    tmux kill-session -t "$session_name" 2>/dev/null || true
}

# Main execution
if [ $# -eq 0 ]; then
    echo "Usage: $0 <message>" >&2
    echo "Example: $0 'Create a Python web server'" >&2
    exit 1
fi

# Use tmux-based approach (more reliable)
copilot_chat_tmux "$1"
