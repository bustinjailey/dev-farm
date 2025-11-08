#!/bin/bash
set -e

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

# Ensure npm prefix is set correctly for global installs
export NPM_CONFIG_PREFIX=/home/coder/.npm-global
mkdir -p /home/coder/.npm-global
export PATH=/home/coder/.npm-global/bin:$PATH

# Add to shell profiles for persistence
for shell_rc in /home/coder/.zshrc /home/coder/.bashrc; do
    if [ -f "$shell_rc" ]; then
        if ! grep -q 'NPM_CONFIG_PREFIX' "$shell_rc"; then
            echo 'export NPM_CONFIG_PREFIX=/home/coder/.npm-global' >> "$shell_rc"
            echo 'export PATH=/home/coder/.npm-global/bin:$PATH' >> "$shell_rc"
        fi
    fi
done

# Install the new @github/copilot npm package globally
if npm install -g @github/copilot 2>&1 | tee -a "$LOG_FILE"; then
    # Verify installation
    if command -v copilot >/dev/null 2>&1; then
        echo "✓ GitHub Copilot CLI installed successfully at $(which copilot)" | tee -a "$LOG_FILE"
        
        # Set GITHUB_TOKEN environment variable for automatic authentication
        if [ -n "${GITHUB_TOKEN}" ]; then
            echo "✓ GITHUB_TOKEN configured for Copilot CLI authentication" | tee -a "$LOG_FILE"
        else
            echo "Note: Run 'copilot' and use /login command to authenticate" | tee -a "$LOG_FILE"
        fi
    else
        echo "⚠ Copilot installed but not found in PATH" | tee -a "$LOG_FILE"
        echo "  Try: export PATH=/home/coder/.npm-global/bin:\$PATH" | tee -a "$LOG_FILE"
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

# Create a friendly WELCOME message
WELCOME_PATH="/home/coder/workspace/WELCOME.txt"
cat > "$WELCOME_PATH" <<'EOWELCOME'
╔══════════════════════════════════════════════════════════════╗
║                  🚀 Terminal Environment                      ║
║                      Dev Farm CLI Mode                        ║
╚══════════════════════════════════════════════════════════════╝

Welcome to your terminal-focused development environment!

🤖 GITHUB COPILOT CLI:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Interactive AI coding assistant in your terminal:

  copilot
    Launches interactive chat session with AI coding agent
    First run: Authenticate with /login command
    
  Use natural language to:
    • Build and edit code
    • Debug and refactor
    • Understand codebases
    • Access GitHub repos, issues, and PRs

📁 YOUR WORKSPACE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Git Mode: Your repo is in repo/ directory
  • Terminal Mode: Use workspace/ for your code
  • Git and GitHub CLI are pre-authenticated

💡 TERMINAL TIPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Ctrl+A then C           Create new tmux window
  • Ctrl+A then N           Next tmux window
  • Ctrl+A then P           Previous tmux window
  • Ctrl+A then D           Detach from tmux session
  • Ctrl+A then ?           Show all tmux keybindings
  • ll                      List files (alias for ls -alh)

🚀 QUICK START:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  copilot
    Launch the interactive AI assistant
    
  Example prompts:
    "Create a Python web server"
    "Explain this Docker Compose file"
    "Help me debug this error"
  
Happy hacking! 🎉

EOWELCOME

# Display welcome message
cat "$WELCOME_PATH"
echo ""
echo "Starting web terminal on port 8080..."
echo ""

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

# Start tmux server with initial session
if tmux new-session -d -s dev-farm -c /home/coder/workspace /bin/zsh 2>&1 | tee -a "$LOG_FILE"; then
    echo "✓ Tmux session 'dev-farm' created successfully" | tee -a "$LOG_FILE"
    TMUX_READY=true
else
    echo "⚠ Failed to create tmux session, falling back to direct zsh" | tee -a "$LOG_FILE"
    TMUX_READY=false
fi

# Start ttyd (web-based terminal) with tmux or zsh fallback
# --writable: Allow input
# --port 8080: Listen on port 8080
# --interface 0.0.0.0: Bind to all interfaces
# -2: Force 256 color mode for better tmux rendering
# -t options: Client-side terminal configuration for better mobile experience
#   fontSize: Larger font for mobile readability
#   fontFamily: Use system monospace fonts
#   cursorBlink: Improve cursor visibility
#   bellStyle: Visual bell instead of audio
if [ "$TMUX_READY" = true ]; then
    exec /usr/local/bin/ttyd \
        --writable \
        --port 8080 \
        --interface 0.0.0.0 \
        -t fontSize=16 \
        -t fontFamily="'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace" \
        -t cursorBlink=true \
        -t bellStyle=visual \
        tmux -2 attach-session -t dev-farm
else
    exec /usr/local/bin/ttyd \
        --writable \
        --port 8080 \
        --interface 0.0.0.0 \
        -t fontSize=16 \
        -t fontFamily="'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace" \
        -t cursorBlink=true \
        -t bellStyle=visual \
        /bin/zsh
fi
