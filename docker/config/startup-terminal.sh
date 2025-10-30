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
    
    # Setup GitHub Copilot CLI extension and authenticate it
    gh extension install github/gh-copilot 2>/dev/null || gh extension upgrade gh-copilot 2>/dev/null || true
    
    # Authenticate GitHub Copilot CLI with the same token
    # This allows 'gh copilot' commands to work without re-authentication
    export GH_TOKEN="${GITHUB_TOKEN}"
    
    echo "GitHub authentication completed successfully for ${GITHUB_USERNAME}!"
    echo "GitHub Copilot CLI is ready!"
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
        gh extension install github/gh-copilot 2>/dev/null || gh extension upgrade gh-copilot 2>/dev/null || true
        
        # Authenticate GitHub Copilot CLI with the token
        export GH_TOKEN="${GITHUB_TOKEN}"
        
        echo "GitHub authentication completed from shared storage for ${GITHUB_USERNAME}!"
        echo "GitHub Copilot CLI is ready!"
    else
        echo "Warning: Shared GitHub token file is empty."
    fi
else
    echo "Warning: GITHUB_TOKEN not set and no shared token found. Skipping GitHub authentication."
    echo "You'll need to authenticate manually or use the dashboard to connect GitHub."
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
║                   🤖 Terminal Environment                     ║
║                      Dev Farm CLI Mode                        ║
╚══════════════════════════════════════════════════════════════╝

Welcome to your terminal-focused development environment!

🔧 AVAILABLE CLI AI TOOL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • gh copilot              GitHub Copilot CLI
    - gh copilot explain    Explain shell commands
    - gh copilot suggest    Get command suggestions

📁 YOUR WORKSPACE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Git Mode: Your repo is in repo/ directory
  • Terminal Mode: Use workspace/ for your code
  • Git and GitHub CLI are pre-authenticated

💡 TERMINAL TIPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • tmux                    Start a terminal multiplexer
  • ctrl+a then d           Detach from tmux
  • tmux attach             Reattach to session
  • ll                      List files (alias for ls -alh)

🚀 GET STARTED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Try these commands:
  gh copilot suggest "create a python web server"
  gh copilot explain "docker compose up -d"
  
Happy hacking! 🎉

EOWELCOME

# Display welcome message
cat "$WELCOME_PATH"
echo ""
echo "Starting web terminal on port 8080..."
echo ""

# Start ttyd (web-based terminal) with zsh
# --writable: Allow input
# --port 8080: Listen on port 8080
# --interface 0.0.0.0: Bind to all interfaces
# --credential: No authentication (handled by Docker network)
exec /usr/local/bin/ttyd --writable --port 8080 --interface 0.0.0.0 /bin/zsh
