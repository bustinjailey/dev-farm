#!/bin/bash
set -e

# Set UTF-8 locale for proper emoji and unicode rendering
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
export LANGUAGE=en_US:en

# Disable core dumps to prevent large core.* files in workspace
ulimit -c 0

### Ensure workspace directory exists and is owned by coder
echo "Preparing workspace directory..."
mkdir -p /home/coder/workspace || true
sudo chown -R coder:coder /home/coder/workspace 2>/dev/null || true

# Create .gitignore for workspace to exclude core dumps and other unwanted files
cat > /home/coder/workspace/.gitignore <<'GITIGNORE'
# Core dumps and debug files
core.*
*.core
vgcore.*

# OS files
.DS_Store
Thumbs.db
GITIGNORE

# Log helper - store in workspace for easy access
LOG_FILE="/home/coder/workspace/.terminal.log"
{
    echo "==== Terminal Environment startup $(date -Is) ===="
} >> "$LOG_FILE" 2>/dev/null || true

# Setup GitHub authentication if token is provided
if [ -n "${GITHUB_TOKEN}" ]; then
    echo "Setting up GitHub authentication..."
    
    # Configure git with username from environment or default
    GITHUB_USERNAME="${GITHUB_USERNAME:-bustinjailey}"
    GITHUB_EMAIL="${GITHUB_EMAIL:-${GITHUB_USERNAME}@users.noreply.github.com}"
    
    git config --global user.name "${GITHUB_USERNAME}"
    git config --global user.email "${GITHUB_EMAIL}"
    
    # Login to GitHub CLI
    echo "${GITHUB_TOKEN}" | gh auth login --with-token --hostname github.com >/dev/null 2>&1 || {
        echo "Note: GitHub CLI authentication configured via GITHUB_TOKEN environment variable"
    }
    
    # Setup git credential helper
    gh auth setup-git >/dev/null 2>&1 || true
    
    echo "GitHub authentication completed successfully for ${GITHUB_USERNAME}!"
elif [ -f "/data/.github_token" ]; then
    # Try to read token from shared storage file
    echo "Loading GitHub token from shared storage..."
    export GITHUB_TOKEN=$(cat /data/.github_token)
    
    if [ -n "${GITHUB_TOKEN}" ]; then
        GITHUB_USERNAME="${GITHUB_USERNAME:-bustinjailey}"
        GITHUB_EMAIL="${GITHUB_EMAIL:-${GITHUB_USERNAME}@users.noreply.github.com}"
        
        git config --global user.name "${GITHUB_USERNAME}"
        git config --global user.email "${GITHUB_EMAIL}"
        
        echo "${GITHUB_TOKEN}" | gh auth login --with-token --hostname github.com >/dev/null 2>&1 || {
            echo "Note: GitHub CLI authentication configured via shared token"
        }
        
        gh auth setup-git >/dev/null 2>&1 || true
        
        echo "GitHub authentication completed from shared storage for ${GITHUB_USERNAME}!"
    else
        echo "Warning: Shared GitHub token file is empty."
    fi
else
    echo "Warning: GITHUB_TOKEN not set and no shared token found. Skipping GitHub authentication."
    echo "You'll need to authenticate manually or use the dashboard to connect GitHub."
fi

# ============================================================================
# Install GitHub Copilot CLI (new standalone tool)
# ============================================================================

echo "Installing GitHub Copilot CLI..." | tee -a "$LOG_FILE"

# Ensure pnpm global bin is in PATH
export PNPM_HOME=/home/coder/.local/share/pnpm
mkdir -p "$PNPM_HOME"
export PATH="$PNPM_HOME:$PATH"

# Add to shell profiles for persistence
for shell_rc in /home/coder/.zshrc /home/coder/.bashrc; do
    if [ -f "$shell_rc" ]; then
        if ! grep -q 'NPM_CONFIG_PREFIX' "$shell_rc"; then
            echo 'export PNPM_HOME=/home/coder/.local/share/pnpm' >> "$shell_rc"
            echo 'export PATH="$PNPM_HOME:$PATH"' >> "$shell_rc"
        fi
    fi
done

# Install the new @github/copilot package globally using pnpm
if pnpm add -g @github/copilot 2>&1 | tee -a "$LOG_FILE"; then
    # Verify installation
    if command -v copilot >/dev/null 2>&1; then
        echo "✓ Copilot CLI installed" | tee -a "$LOG_FILE"
        
        # Create state files for device auth info
        DEVICE_AUTH_FILE="/home/coder/workspace/.copilot-device-auth.json"
        AUTH_STATUS_FILE="/home/coder/workspace/.copilot-auth-status"
        
        # Set initial status
        echo "📝 Configuring Copilot automation..." | tee -a "$LOG_FILE"
        echo "configuring" > "$AUTH_STATUS_FILE"
        
        # Create tmux session for automation
        if tmux new-session -d -s dev-farm -c /home/coder/workspace 2>/dev/null; then
            # Start copilot with --allow-all-tools flag
            tmux send-keys -t dev-farm "export PATH=$PNPM_HOME:\$PATH" C-m
            sleep 2
            tmux send-keys -t dev-farm "copilot --allow-all-tools" C-m
            sleep 5
            
            # Capture output to check for workspace trust prompt
            OUTPUT=$(tmux capture-pane -t dev-farm -p -S -50)
            
            # Check if we need to confirm workspace trust
            if echo "$OUTPUT" | grep -q "Confirm folder trust"; then
                echo "✓ Workspace trust prompt detected - sending option 2" | tee -a "$LOG_FILE"
                echo "workspace-trust" > "$AUTH_STATUS_FILE"
                tmux send-keys -t dev-farm "2"
                
                # Wait for login prompt with retries (can take several seconds after trust)
                for i in {1..10}; do
                    sleep 2
                    OUTPUT=$(tmux capture-pane -t dev-farm -p -S -50)
                    if echo "$OUTPUT" | grep -qE "Please use /login|github.com/login/device|How can I help"; then
                        echo "✓ Workspace trust processed (attempt $i)" | tee -a "$LOG_FILE"
                        # Wait extra time for CLI to fully initialize before sending commands
                        sleep 3
                        break
                    fi
                done
            fi
            
            # Check if we need to run /login (use same flexible pattern as polling)
            if echo "$OUTPUT" | grep -q "Please use /login"; then
                echo "✓ Login prompt detected - sending /login command" | tee -a "$LOG_FILE"
                echo "login" > "$AUTH_STATUS_FILE"
                # Send command and Enter separately (Copilot CLI requires this)
                tmux send-keys -t dev-farm "/login"
                sleep 0.5
                tmux send-keys -t dev-farm C-m
                sleep 3
                OUTPUT=$(tmux capture-pane -t dev-farm -p -S -50)
                
                # After /login, check for account selection
                if echo "$OUTPUT" | grep -q "What account do you want to log into?"; then
                    echo "✓ Account selection prompt detected - selecting GitHub.com" | tee -a "$LOG_FILE"
                    echo "account-selection" > "$AUTH_STATUS_FILE"
                    tmux send-keys -t dev-farm "1"
                    sleep 3
                    OUTPUT=$(tmux capture-pane -t dev-farm -p -S -50)
                fi
            fi
            
            # Check final state
            OUTPUT=$(tmux capture-pane -t dev-farm -p -S -50)
            
            # Parse device code if present
            if echo "$OUTPUT" | grep -q "github.com/login/device"; then
                DEVICE_CODE=$(echo "$OUTPUT" | grep -oP "Enter one-time code: \K[A-Z0-9]{4}-[A-Z0-9]{4}" || \
                              echo "$OUTPUT" | grep -oP "Enter one time code: \K[A-Z0-9]{4}-[A-Z0-9]{4}" || \
                              echo "$OUTPUT" | grep -oP "code: \K[A-Z0-9]{4}-[A-Z0-9]{4}" || \
                              echo "$OUTPUT" | grep -oP "\b[A-Z0-9]{4}-[A-Z0-9]{4}\b" | head -1 || echo "")
                DEVICE_URL=$(echo "$OUTPUT" | grep -oP "https://github\.com/login/device[^\s]*" || echo "https://github.com/login/device")
                
                if [ -n "$DEVICE_CODE" ]; then
                    echo "✓ Device code obtained: $DEVICE_CODE" | tee -a "$LOG_FILE"
                    echo "awaiting-auth" > "$AUTH_STATUS_FILE"
                    cat > "$DEVICE_AUTH_FILE" <<EOF
{
  "code": "$DEVICE_CODE",
  "url": "$DEVICE_URL",
  "timestamp": "$(date -Iseconds)"
}
EOF
                    # Start background auth monitor
                    nohup /home/coder/copilot-auth-monitor.sh >> "$LOG_FILE" 2>&1 &
                fi
            elif echo "$OUTPUT" | grep -q "Please use /login"; then
                # Still showing login prompt, not authenticated yet
                echo "⚠ Still showing login prompt" | tee -a "$LOG_FILE"
                echo "awaiting-auth" > "$AUTH_STATUS_FILE"
            elif echo "$OUTPUT" | grep -qE "How can I help|What can I do"; then
                # Only consider authenticated if we see the actual prompt, not just Welcome banner
                # AND we don't see any auth prompts
                if ! echo "$OUTPUT" | grep -qE "Please use /login|github.com/login/device"; then
                    echo "✓ Copilot CLI authenticated and ready!" | tee -a "$LOG_FILE"
                    echo "authenticated" > "$AUTH_STATUS_FILE"
                else
                    echo "awaiting-auth" > "$AUTH_STATUS_FILE"
                fi
            else
                # Unknown state - assume needs auth
                echo "awaiting-auth" > "$AUTH_STATUS_FILE"
            fi
        else
            echo "⚠ Failed to create tmux session" | tee -a "$LOG_FILE"
            echo "error" > "$AUTH_STATUS_FILE"
        fi
    else
        echo "⚠ Copilot installed but not found in PATH" | tee -a "$LOG_FILE"
        echo "  Try: export PATH=$PNPM_HOME:\$PATH" | tee -a "$LOG_FILE"
    fi
else
    echo "⚠ Failed to install GitHub Copilot CLI" | tee -a "$LOG_FILE"
fi

# Handle different development modes
DEV_MODE="${DEV_MODE:-workspace}"
echo "Development mode: ${DEV_MODE}"

if [ "${DEV_MODE}" = "git" ]; then
    # Git repository mode - clone the repository into subdirectory
    if [ -n "${GIT_URL}" ]; then
        echo "Cloning repository: ${GIT_URL}"
        REPO_DIR="/home/coder/workspace/repo"
        
        # Create repo directory
        mkdir -p "${REPO_DIR}"
        
        # Clone the repository into the repo subdirectory
        git clone "${GIT_URL}" "${REPO_DIR}"
        
        echo "Repository cloned successfully to ${REPO_DIR}"
        
        # Create info file about the cloned repo
        cat > /home/coder/workspace/REPO_INFO.md <<EOF
# 📦 Git Repository Cloned

Successfully cloned repository from **${GIT_URL}**

## Repository Location
The cloned repository is at: \`repo/\`

Navigate to it: \`cd repo/\`

## Git Operations
- All git commands work normally in the \`repo/\` directory
- Changes are tracked by git
- You can commit and push as usual

Happy coding! 🚀
EOF
    else
        echo "Warning: GIT_URL not set for git mode. Creating empty workspace."
    fi
elif [ "${DEV_MODE}" = "terminal" ]; then
    echo "Terminal-only mode - ready for CLI operations"
fi

# Create minimal welcome message (detailed help available in dashboard)
WELCOME_PATH="/home/coder/workspace/WELCOME.txt"
cat > "$WELCOME_PATH" <<'EOWELCOME'
🚀 Dev Farm Terminal Environment Ready
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Copilot CLI available via dashboard AI chat panel
  • GitHub CLI pre-authenticated
  • tmux session 'dev-farm' (Ctrl+A prefix)
EOWELCOME

# Welcome message is only displayed if Copilot is authenticated
# (see tmux session check below)

# Initialize tmux session
echo "Initializing tmux session..." | tee -a "$LOG_FILE"

# Create tmux configuration
cat > /home/coder/.tmux.conf <<'TMUXCONF'
# Dev Farm tmux configuration
# Set prefix to Ctrl+a (more ergonomic than Ctrl+b)
unbind C-b
set-option -g prefix C-a
bind-key C-a send-prefix

# Enable mouse support
set -g mouse on

# Start window numbering at 1
set -g base-index 1

# Enable 256 color support
set -g default-terminal "screen-256color"

# Status bar customization
set -g status-style bg=blue,fg=white
set -g status-left '[Dev Farm] '
set -g status-right '%Y-%m-%d %H:%M'

# Window status formatting
setw -g window-status-current-style bg=white,fg=blue,bold
TMUXCONF

# Dev-farm session already created during Copilot setup above
# Just verify it exists and is ready
if tmux has-session -t dev-farm 2>/dev/null; then
    echo "✓ Terminal session ready" | tee -a "$LOG_FILE"
    
    # Only display welcome message if Copilot automation completed
    # (Don't interrupt ongoing automation with clear/cat commands)
    if [ -f "$AUTH_STATUS_FILE" ] && grep -q "authenticated" "$AUTH_STATUS_FILE" 2>/dev/null; then
        tmux send-keys -t dev-farm "clear" C-m
        tmux send-keys -t dev-farm "cat /home/coder/workspace/WELCOME.txt" C-m
        tmux send-keys -t dev-farm "echo ''" C-m
    fi
    
    TMUX_READY=true
else
    # Fallback: create session if it somehow doesn't exist
    if tmux new-session -d -s dev-farm -c /home/coder/workspace 2>/dev/null; then
        echo "✓ Created fallback terminal session" | tee -a "$LOG_FILE"
        TMUX_READY=true
    else
        echo "⚠ Failed to create tmux session" | tee -a "$LOG_FILE"
        TMUX_READY=false
    fi
fi

# Start custom terminal server with xterm.js
# This provides better text selection and copy support than ttyd
echo "Starting custom terminal server..." | tee -a "$LOG_FILE"

# Set up terminal server environment
# PORT must be provided by container environment, fail if not set
if [ -z "$PORT" ]; then
    echo "ERROR: PORT environment variable is not set!" | tee -a "$LOG_FILE"
    echo "This should be provided by the dashboard when creating the container." | tee -a "$LOG_FILE"
    echo "Cannot start terminal server without a port assignment." | tee -a "$LOG_FILE"
    exit 1
fi

echo "Terminal server will listen on port: $PORT" | tee -a "$LOG_FILE"
export HOME=/home/coder
export SHELL=/bin/zsh

# Create public directory for terminal server static files
mkdir -p /home/coder/terminal-public
cp /home/coder/terminal.html /home/coder/terminal-public/index.html

# Start terminal server
# The server will spawn tmux session automatically via node-pty
cd /home/coder/terminal-public
exec /usr/bin/node /home/coder/terminal-server.js
