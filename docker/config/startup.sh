#!/bin/bash
set -e

CODER_HOME=${CODER_HOME:-/home/coder}

SUDO_CMD=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    if sudo -n true >/dev/null 2>&1; then
        SUDO_CMD="sudo -n"
    fi
fi

run_as_root() {
    if [ -n "$SUDO_CMD" ]; then
        $SUDO_CMD "$@"
    else
        "$@"
    fi
}

# Disable core dumps to prevent large core.* files in workspace
ulimit -c 0

### Ensure workspace directory exists and is owned by coder
WORKSPACE_DIR="${CODER_HOME}/workspace"
REMOTE_DIR="${CODER_HOME}/remote"
REPO_DIR="${CODER_HOME}/repo"
DEVFARM_STATE_DIR="${CODER_HOME}/.devfarm"
ALIAS_STORAGE_DIR="${DEVFARM_STATE_DIR}/aliases"
ALIAS_CONFIG_FILE="${DEVFARM_STATE_DIR}/path-aliases.json"

echo "Preparing workspace directory..."
mkdir -p "$WORKSPACE_DIR" || true
run_as_root chown -R coder:coder "$WORKSPACE_DIR" 2>/dev/null || true

# Provide sanitized aliases for workspace paths so URLs don't expose internal layout
echo "Creating workspace path aliases..."
# Ensure backing directories exist for symlink targets
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$REMOTE_DIR"
mkdir -p "$REPO_DIR"
mkdir -p "$ALIAS_STORAGE_DIR"
mkdir -p "$DEVFARM_STATE_DIR"

PATH_ALIAS_RECORDS=""

create_path_alias() {
    local alias_name="$1"
    local target_path="$2"
    local alias_path="$3"
    local fallback_path="${ALIAS_STORAGE_DIR}/${alias_name}"
    local actual_path="$alias_path"

    if ! run_as_root rm -rf "$alias_path" 2>/dev/null; then
        :
    fi

    if ! run_as_root ln -sfn "$target_path" "$alias_path" 2>/dev/null; then
        rm -rf "$fallback_path" 2>/dev/null || true
        ln -sfn "$target_path" "$fallback_path"
        actual_path="$fallback_path"
        echo "Warning: Unable to create alias $alias_path. Using fallback $actual_path instead."
    fi

    PATH_ALIAS_RECORDS+="${alias_name}\t${actual_path}\n"
}

create_path_alias "workspace" "$WORKSPACE_DIR" "/workspace"
create_path_alias "remote" "$REMOTE_DIR" "/remote"
create_path_alias "repo" "$REPO_DIR" "/repo"

export DEVFARM_ALIAS_CONFIG="$ALIAS_CONFIG_FILE"

printf '%b' "$PATH_ALIAS_RECORDS" | /usr/bin/python3 - "$ALIAS_CONFIG_FILE" <<'PYEOF'
import json
import os
import sys

alias_file = sys.argv[1]
aliases = {}
for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    try:
        name, path = line.split('\t', 1)
    except ValueError:
        continue
    aliases[name] = path

os.makedirs(os.path.dirname(alias_file), exist_ok=True)
with open(alias_file, 'w', encoding='utf-8') as fp:
    json.dump(aliases, fp, indent=2)
PYEOF

echo "Applying VS Code Insiders workspace settings..."
# VS Code Insiders Server uses ~/.vscode-server-insiders/data/ for settings
mkdir -p /home/coder/.vscode-server-insiders/data/Machine
mkdir -p /home/coder/.vscode-server-insiders/data/User

# MCP configuration will be done AFTER workspace root is determined (see below)

# Move workspace settings to machine-level for consistent configuration across all workspaces
# Machine-level settings are applied globally, workspace-level settings are optional overrides
echo "Applying machine-level settings from template..."
/usr/bin/python3 - <<'PYEOF'
import json, os

# Read workspace settings template
tpl_path = "/home/coder/.devfarm/workspace-settings.json"
if not os.path.exists(tpl_path):
    print("No workspace settings template found")
    exit(0)

with open(tpl_path, 'r', encoding='utf-8') as f:
    template_settings = json.load(f)

# Apply to machine-level settings (applies to all workspaces)
machine_settings_path = "/home/coder/.vscode-server-insiders/data/Machine/settings.json"
os.makedirs(os.path.dirname(machine_settings_path), exist_ok=True)

# Load existing machine settings
existing_machine = {}
if os.path.exists(machine_settings_path):
    try:
        with open(machine_settings_path, 'r', encoding='utf-8') as f:
            existing_machine = json.load(f)
    except Exception:
        existing_machine = {}

# Merge template settings into machine settings
for key, value in template_settings.items():
    existing_machine[key] = value

# Add dynamic window title
workspace_name = os.environ.get('WORKSPACE_NAME', 'Dev Farm')
existing_machine["window.title"] = workspace_name

# Write machine settings
with open(machine_settings_path, 'w', encoding='utf-8') as f:
    json.dump(existing_machine, f, indent=2)

print(f"✓ Machine-level settings configured for all workspaces")
PYEOF

# ============================================================================
# Apply Auto-Approval Settings for AI Tools
# ============================================================================
echo "Configuring auto-approval settings for AI tools..."

/usr/bin/python3 - <<'PYEOF'
import json, os

# Determine environment mode and set appropriate allowed paths
dev_mode = os.environ.get('DEV_MODE', 'workspace')
workspace_root = os.environ.get('WORKSPACE_ROOT', '/home/coder/workspace')

# Define allowed paths based on mode
if dev_mode == 'git':
    allowed_paths = ['/home/coder/repo', '/repo']
elif dev_mode == 'ssh':
    allowed_paths = ['/home/coder/remote', '/remote']
else:  # workspace mode
    allowed_paths = ['/home/coder/workspace', '/workspace']

# Load auto-approval template
auto_approval_path = "/home/coder/.devfarm/auto-approval-settings.json"
if not os.path.exists(auto_approval_path):
    print("No auto-approval settings template found, skipping")
    exit(0)

with open(auto_approval_path, 'r', encoding='utf-8') as f:
    auto_approval_config = json.load(f)

# Replace PLACEHOLDER_PATHS with actual paths
def replace_placeholders(obj):
    if isinstance(obj, dict):
        return {k: replace_placeholders(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        if obj == ["PLACEHOLDER_PATHS"]:
            return allowed_paths
        return [replace_placeholders(item) for item in obj]
    elif isinstance(obj, str) and obj == "PLACEHOLDER_PATHS":
        return allowed_paths[0]  # For single path values
    return obj

auto_approval_config = replace_placeholders(auto_approval_config)

# Apply to machine-level settings
machine_settings_path = "/home/coder/.vscode-server-insiders/data/Machine/settings.json"
os.makedirs(os.path.dirname(machine_settings_path), exist_ok=True)

existing_machine = {}
if os.path.exists(machine_settings_path):
    try:
        with open(machine_settings_path, 'r', encoding='utf-8') as f:
            existing_machine = json.load(f)
    except Exception:
        existing_machine = {}

# Merge auto-approval settings
for key, value in auto_approval_config.items():
    existing_machine[key] = value

# Write updated machine settings
with open(machine_settings_path, 'w', encoding='utf-8') as f:
    json.dump(existing_machine, f, indent=2)

print(f"✓ Auto-approval configured for {dev_mode} mode with paths: {', '.join(allowed_paths)}")
PYEOF

# Configure workspace trust settings via User settings (proper location)
# Security workspace trust settings are user-scoped, not machine-scoped
echo "Configuring workspace trust settings..."
/usr/bin/python3 - <<'PYEOF'
import json, os

# User-level settings (proper location for workspace trust)
user_settings_path = "/home/coder/.vscode-server-insiders/data/User/settings.json"
os.makedirs(os.path.dirname(user_settings_path), exist_ok=True)

existing = {}
if os.path.exists(user_settings_path):
    try:
        with open(user_settings_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
    except Exception:
        existing = {}

# Configure workspace trust (disable prompts, trust all folders)
existing["security.workspace.trust.untrustedFiles"] = "open"
existing["security.workspace.trust.enabled"] = False
existing["security.workspace.trust.startupPrompt"] = "never"
existing["security.workspace.trust.emptyWindow"] = False

# Trust all common workspace paths
existing["security.workspace.trust.trustedFolders"] = [
    "/home/coder/workspace",
    "/home/coder/repo", 
    "/home/coder/remote",
    "/workspace",
    "/repo",
    "/remote",
    "/home/coder"
]

with open(user_settings_path, 'w', encoding='utf-8') as f:
    json.dump(existing, f, indent=2)

print("✓ Workspace trust disabled - all folders trusted")
PYEOF

# Create a friendly WELCOME.md in the appropriate workspace root
# This will be created after modes set WORKSPACE_ROOT, so we'll create it later in the script
create_welcome_file() {
    local WELCOME_PATH="$1/WELCOME.md"
    cat > "$WELCOME_PATH" <<'EOWELCOME'
# 👋 Welcome to Dev Farm

You're ready to code!

## 🔐 Sign In to GitHub

To get started with GitHub and Copilot:

1. **Open Command Palette**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. **Type**: `GitHub: Sign In`
3. **Select** the command and follow the prompts

Or use the **Accounts** menu in the bottom left corner (👤 icon)

### Quick Commands
- **GitHub Sign In**: `Ctrl+Shift+P` → `GitHub: Sign In`
- **Copilot Sign In**: `Ctrl+Shift+P` → `GitHub Copilot: Sign In`
- **Manage Accounts**: Click the **Account icon** (👤) in the bottom-left corner

## 📁 Your Workspace

- **Git Mode**: Your cloned repository is in the `repo/` directory
- **SSH Mode**: Your remote filesystem is mounted at `remote/`
- **Workspace Mode**: Use this directory directly for your code

## 🔄 Persistent Terminal Sessions

This environment uses **tmux** for persistent terminal sessions:
- **Your terminals survive disconnections** - Long-running processes continue even when you close the browser
- **Resume from any device** - Reconnect to see your work in progress
- **Perfect for terminal-based agentic workflows** - CLI AI agents can work continuously in the background

### Important: What Persists?

✅ **Terminal processes** - Commands running in terminals continue when you disconnect
✅ **Workspace files** - All your code and changes are saved
✅ **Extension processes** - Extensions run on the server and persist across disconnections
✅ **Active AI generations** - Copilot Chat and other AI tools continue working even when you close the browser
✅ **Chat history** - Previous Copilot conversations are preserved

💡 **Dev Farm uses VS Code Remote Tunnels** - All extensions run on the server, not in your browser!
💡 **For terminal-based AI work**: Use agents like `aider` or `gh copilot` in tmux for command-line workflows!

### Tmux Quick Reference
- Terminals automatically attach to the persistent session
- **Detach manually**: Press `Ctrl+B` then `D` (rarely needed)
- **List sessions**: Run `tmux ls` in a new terminal
- **Reattach**: Run `tmux attach -t devfarm`

## 💡 Tips

- Git and the GitHub CLI (gh) are pre-authenticated if you connected GitHub in the dashboard
- Press `Ctrl+`` (backtick) to open the integrated terminal
- Press `Ctrl+Shift+E` to focus the file explorer
- Press `Ctrl+P` to quickly open files
- Long-running processes in terminals will continue even when you close your browser

Happy hacking!
EOWELCOME
    echo "WELCOME.md created at $WELCOME_PATH"
}

# Log helper - store in .devfarm to keep workspace root clean
LOG_FILE="/home/coder/workspace/.devfarm/startup.log"
mkdir -p /home/coder/workspace/.devfarm
{
    echo "==== Dev Farm startup $(date -Is) ===="
} >> "$LOG_FILE" 2>/dev/null || true

# Setup GitHub authentication if token is provided
# Note: GITHUB_TOKEN is used by:
#   - gh CLI (GitHub's official CLI tool)
#   - GitHub Copilot extension
#   - git via gh CLI's credential helper
if [ -n "${GITHUB_TOKEN}" ]; then
    echo "Setting up GitHub authentication..."
    
    # Configure git with username from environment or default
    GITHUB_USERNAME="${GITHUB_USERNAME:-bustinjailey}"
    GITHUB_EMAIL="${GITHUB_EMAIL:-${GITHUB_USERNAME}@users.noreply.github.com}"
    
    git config --global user.name "${GITHUB_USERNAME}"
    git config --global user.email "${GITHUB_EMAIL}"
    
    # Login to GitHub CLI (suppress expected warnings about GITHUB_TOKEN env var)
    echo "${GITHUB_TOKEN}" | gh auth login --with-token --hostname github.com >/dev/null 2>&1 || {
        echo "Note: GitHub CLI authentication configured via GITHUB_TOKEN environment variable"
    }
    
    # Setup git credential helper to use gh CLI for HTTPS authentication
    # This allows cloning private repos without SSH key management
    echo "Setting up git credential helper..." | tee -a "$LOG_FILE"
    gh auth setup-git 2>&1 | tee -a "$LOG_FILE"
    echo "✓ Git configured to use GitHub CLI for authentication" | tee -a "$LOG_FILE"
    
    # Note: gh CLI and GitHub Copilot both use GITHUB_TOKEN environment variable
    # No need to set GH_TOKEN separately - it's just an alias gh CLI also checks
    
    # Create directory for GitHub extensions if it doesn't exist
    mkdir -p /home/coder/.config/Code/User/globalStorage/github.vscode-pull-request-github
    
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
        
        # Setup SSH for GitHub (so we can use git@github.com URLs for private repos)
        echo "Setting up SSH authentication for GitHub..." | tee -a "$LOG_FILE"
        
        # Add GitHub's host key to known_hosts
        mkdir -p /home/coder/.ssh
        chmod 700 /home/coder/.ssh
        ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /home/coder/.ssh/known_hosts 2>/dev/null
        
        # Generate SSH key if it doesn't exist
        if [ ! -f /home/coder/.ssh/id_ed25519 ]; then
            echo "Generating SSH key..." | tee -a "$LOG_FILE"
            ssh-keygen -t ed25519 -C "devfarm-${GITHUB_USERNAME}@container" -f /home/coder/.ssh/id_ed25519 -N "" >/dev/null 2>&1
            chmod 600 /home/coder/.ssh/id_ed25519
            chmod 644 /home/coder/.ssh/id_ed25519.pub
        fi
        
        # Setup git credential helper to use gh CLI for HTTPS authentication
        echo "Setting up git credential helper..." | tee -a "$LOG_FILE"
        gh auth setup-git 2>&1 | tee -a "$LOG_FILE"
        echo "✓ Git configured to use GitHub CLI for authentication" | tee -a "$LOG_FILE"
        
        # Note: GITHUB_TOKEN is already set and used by gh CLI and GitHub Copilot
        
        mkdir -p /home/coder/.config/Code/User/globalStorage/github.vscode-pull-request-github
        
        echo "GitHub authentication completed from shared storage for ${GITHUB_USERNAME}!"
    else
        echo "Warning: Shared GitHub token file is empty."
    fi
else
    echo "Warning: GITHUB_TOKEN not set and no shared token found. Skipping GitHub authentication."
    echo "You'll need to authenticate manually or use the dashboard to connect GitHub."
fi

# ============================================================================
# Setup GitHub Copilot Authentication (Optional)
# ============================================================================
# Copilot stores authentication in ~/.config/github-copilot/hosts.json
# If a shared auth file exists, copy it to automatically sign in to Copilot

COPILOT_AUTH_SOURCE="/data/.github-copilot-hosts.json"
COPILOT_AUTH_DEST="/home/coder/.config/github-copilot/hosts.json"

if [ -f "$COPILOT_AUTH_SOURCE" ]; then
    echo "Configuring GitHub Copilot authentication from shared storage..." | tee -a "$LOG_FILE"
    mkdir -p "$(dirname "$COPILOT_AUTH_DEST")"
    cp "$COPILOT_AUTH_SOURCE" "$COPILOT_AUTH_DEST"
    chmod 600 "$COPILOT_AUTH_DEST"
    echo "✓ GitHub Copilot authentication configured - you should be automatically signed in" | tee -a "$LOG_FILE"
elif [ -n "${GITHUB_TOKEN}" ]; then
    echo "Note: GITHUB_TOKEN is set but Copilot auth file not found at $COPILOT_AUTH_SOURCE" | tee -a "$LOG_FILE"
    echo "      Copilot requires interactive sign-in on first use." | tee -a "$LOG_FILE"
    echo "      To enable auto-signin: Sign in once, then run this command on the host:" | tee -a "$LOG_FILE"
    echo "      docker cp devfarm-<env>:/home/coder/.config/github-copilot/hosts.json /opt/dev-farm/data/.github-copilot-hosts.json" | tee -a "$LOG_FILE"
else
    echo "Note: No GitHub authentication found. Copilot requires interactive sign-in." | tee -a "$LOG_FILE"
fi

# ============================================================================
# Install/Update Aggregate MCP Server
# ============================================================================

echo "Setting up Aggregate MCP Server..." | tee -a "$LOG_FILE"

MCP_INSTALL_DIR="/home/coder/.local/bin/aggregate-mcp-server"
MCP_REPO_URL="https://github.com/bustinjailey/aggregate-mcp-server.git"

# Check if GitHub token is available (required for private repo)
if [ -z "${GITHUB_TOKEN}" ]; then
    echo "⚠ GITHUB_TOKEN not set, skipping aggregate MCP server installation (private repo)" | tee -a "$LOG_FILE"
else
    mkdir -p /home/coder/.local/bin
    
    # Use gh CLI's authentication for git operations (already configured in earlier steps)
    # gh auth setup-git was called earlier, so git will use the token automatically
    
    if [ -d "$MCP_INSTALL_DIR/.git" ]; then
        echo "Checking for aggregate MCP server updates..." | tee -a "$LOG_FILE"
        cd "$MCP_INSTALL_DIR"
        
        # Fetch updates (uses gh CLI credential helper)
        BEFORE_HASH=$(git rev-parse HEAD 2>/dev/null || echo "none")
        if git fetch origin main 2>&1 | tee -a "$LOG_FILE"; then
            AFTER_HASH=$(git rev-parse origin/main 2>/dev/null || echo "none")
            
            if [ "$BEFORE_HASH" != "$AFTER_HASH" ] && [ "$AFTER_HASH" != "none" ]; then
                echo "Updates found, pulling latest version..." | tee -a "$LOG_FILE"
                if git pull origin main 2>&1 | tee -a "$LOG_FILE"; then
                    # Use pnpm if pnpm-lock.yaml exists and pnpm is available, otherwise use npm
                    UPDATE_SUCCESS=false
                    if [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
                        echo "Using pnpm for update..." | tee -a "$LOG_FILE"
                        if pnpm install 2>&1 | tee -a "$LOG_FILE"; then
                            if pnpm run build 2>&1 | tee -a "$LOG_FILE"; then
                                UPDATE_SUCCESS=true
                            else
                                echo "⚠ pnpm build failed" | tee -a "$LOG_FILE"
                            fi
                        else
                            echo "⚠ pnpm install failed" | tee -a "$LOG_FILE"
                        fi
                    else
                        echo "Using npm for update..." | tee -a "$LOG_FILE"
                        if npm install 2>&1 | tee -a "$LOG_FILE"; then
                            if npm run build 2>&1 | tee -a "$LOG_FILE"; then
                                UPDATE_SUCCESS=true
                            else
                                echo "⚠ npm build failed" | tee -a "$LOG_FILE"
                            fi
                        else
                            echo "⚠ npm install failed" | tee -a "$LOG_FILE"
                        fi
                    fi
                    
                    if [ "$UPDATE_SUCCESS" = true ]; then
                        echo "✓ Aggregate MCP server updated successfully" | tee -a "$LOG_FILE"
                    else
                        echo "✗ Failed to build aggregate MCP server update" | tee -a "$LOG_FILE"
                        echo "   Check the logs above for npm/pnpm errors" | tee -a "$LOG_FILE"
                    fi
                else
                    echo "⚠ Failed to pull aggregate MCP server updates" | tee -a "$LOG_FILE"
                fi
            else
                echo "✓ Aggregate MCP server already up to date" | tee -a "$LOG_FILE"
            fi
        else
            echo "⚠ Failed to fetch aggregate MCP server updates" | tee -a "$LOG_FILE"
        fi
        
        cd /home/coder
    else
        echo "Installing aggregate MCP server from private GitHub repo..." | tee -a "$LOG_FILE"
        # Clone private repo using HTTPS (uses gh CLI credential helper)
        if git clone "$MCP_REPO_URL" "$MCP_INSTALL_DIR" 2>&1 | tee -a "$LOG_FILE"; then
            cd "$MCP_INSTALL_DIR"
            
            # Use pnpm if pnpm-lock.yaml exists and pnpm is available, otherwise use npm
            INSTALL_SUCCESS=false
            if [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
                echo "Using pnpm for installation..." | tee -a "$LOG_FILE"
                if pnpm install 2>&1 | tee -a "$LOG_FILE"; then
                    if pnpm run build 2>&1 | tee -a "$LOG_FILE"; then
                        INSTALL_SUCCESS=true
                    else
                        echo "⚠ pnpm build failed" | tee -a "$LOG_FILE"
                    fi
                else
                    echo "⚠ pnpm install failed" | tee -a "$LOG_FILE"
                fi
            else
                echo "Using npm for installation..." | tee -a "$LOG_FILE"
                if npm install 2>&1 | tee -a "$LOG_FILE"; then
                    if npm run build 2>&1 | tee -a "$LOG_FILE"; then
                        INSTALL_SUCCESS=true
                    else
                        echo "⚠ npm build failed" | tee -a "$LOG_FILE"
                    fi
                else
                    echo "⚠ npm install failed" | tee -a "$LOG_FILE"
                fi
            fi
            
            if [ "$INSTALL_SUCCESS" = true ]; then
                echo "✓ Aggregate MCP server installed successfully" | tee -a "$LOG_FILE"
            else
                echo "✗ Failed to build aggregate MCP server" | tee -a "$LOG_FILE"
                echo "   Check the logs above for npm/pnpm errors" | tee -a "$LOG_FILE"
            fi
            
            cd /home/coder
        else
            echo "✗ Failed to clone aggregate MCP server repository" | tee -a "$LOG_FILE"
            echo "   This requires GITHUB_TOKEN with 'repo' scope for private repos" | tee -a "$LOG_FILE"
            echo "   Check authentication: gh auth status" | tee -a "$LOG_FILE"
        fi
    fi
fi

# Handle different development modes
DEV_MODE="${DEV_MODE:-workspace}"
echo "Development mode: ${DEV_MODE}"

if [ "${DEV_MODE}" = "git" ]; then
    # Git repository mode - clone the repository directly to workspace root
    if [ -n "${GIT_URL}" ]; then
        echo "Cloning repository: ${GIT_URL}"
        REPO_DIR="/home/coder/repo"
        WORKSPACE_ROOT="/home/coder/repo"
        
        # Create repo directory
        mkdir -p "${REPO_DIR}"
        
        # Clone the repository directly
        git clone "${GIT_URL}" "${REPO_DIR}"
        
        echo "Repository cloned successfully to ${REPO_DIR}"
        
        # Create info file about the cloned repo in the repo root
        cat > "${REPO_DIR}/DEVFARM_INFO.md" <<EOF
# 📦 Git Repository Mode

Successfully cloned repository from **${GIT_URL}**

## Repository Location
This directory IS the cloned repository root.

## Git Operations
- All git commands work normally in this directory
- Changes are tracked by git
- You can commit and push as usual

## VS Code Workspace
This directory is your VS Code workspace root - no need to navigate to subdirectories.

Happy coding! 🚀
EOF
    else
        echo "Warning: GIT_URL not set for git mode. Creating empty workspace."
        WORKSPACE_ROOT="/home/coder/workspace"
    fi
elif [ "${DEV_MODE}" = "ssh" ]; then
    # SSH mode - configure VS Code Remote-SSH for automatic connection
    echo "Setting up Remote-SSH connection..." | tee -a "$LOG_FILE"

    if [ -z "${SSH_HOST}" ]; then
        echo "Error: SSH_HOST not set. Cannot configure remote connection." | tee -a "$LOG_FILE"
        cat > /home/coder/workspace/SSH_SETUP_ERROR.md <<'EOFERR'
# SSH Setup Error

SSH_HOST environment variable is not set. Cannot configure remote connection.

To use SSH mode, you need to provide:
- SSH_HOST: The remote hostname or IP
- SSH_USER: The SSH username (optional, defaults to root)
- SSH_PATH: The remote path to open (optional, defaults to /home)
- SSH_PASSWORD: Password for SSH authentication (recommended)
- SSH_PRIVATE_KEY: Your SSH private key (alternative to password)

You can update these settings in the dashboard.
EOFERR
    else
        # Configure SSH connection for VS Code Remote-SSH extension
        echo "Configuring SSH connection..." | tee -a "$LOG_FILE"
        
        mkdir -p /home/coder/.ssh
        chmod 700 /home/coder/.ssh

        SSH_USER="${SSH_USER:-root}"
        SSH_PATH="${SSH_PATH:-/home}"
        SSH_PORT="${SSH_PORT:-22}"

        # Setup SSH key if provided
        if [ -n "${SSH_PRIVATE_KEY}" ]; then
            echo "Using SSH private key from environment" | tee -a "$LOG_FILE"
            echo "${SSH_PRIVATE_KEY}" > /home/coder/.ssh/id_rsa
            chmod 600 /home/coder/.ssh/id_rsa
        fi

        # Create SSH config entry for Remote-SSH
        # This makes the connection appear in VS Code's Remote Explorer
        echo "Creating SSH config for remote-target..." | tee -a "$LOG_FILE"
        
        # Security Note: StrictHostKeyChecking=no and UserKnownHostsFile=/dev/null are used
        # to avoid host key verification errors in ephemeral container environments.
        # This is a trade-off for usability in development environments.
        # For production use, consider implementing proper host key management:
        #   1. Pre-populate known_hosts with target host keys
        #   2. Use SSH certificate authorities
        #   3. Or require users to manually verify host keys
        
        if [ -n "${SSH_PASSWORD}" ]; then
            # Password-based authentication
            # keyboard-interactive is included to support servers that use PAM/challenge-response
            cat > /home/coder/.ssh/config <<EOF
Host remote-target
    HostName ${SSH_HOST}
    User ${SSH_USER}
    Port ${SSH_PORT}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 15
    ServerAliveCountMax 3
    PreferredAuthentications password,keyboard-interactive
EOF
        else
            # Key-based authentication
            cat > /home/coder/.ssh/config <<EOF
Host remote-target
    HostName ${SSH_HOST}
    User ${SSH_USER}
    Port ${SSH_PORT}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 15
    ServerAliveCountMax 3
    IdentityFile /home/coder/.ssh/id_rsa
    PreferredAuthentications publickey
EOF
        fi
        chmod 600 /home/coder/.ssh/config
        
        # Test SSH connectivity to provide immediate feedback
        echo "Testing SSH connectivity to ${SSH_USER}@${SSH_HOST}..." | tee -a "$LOG_FILE"
        SSH_TEST_SUCCESS=false
        
        if [ -n "${SSH_PASSWORD}" ]; then
            # Test with password authentication
            export SSHPASS="${SSH_PASSWORD}"
            if timeout 10 sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" "echo SSH_OK" 2>&1 | grep -q "SSH_OK"; then
                SSH_TEST_SUCCESS=true
                echo "✓ SSH connectivity confirmed (password auth)" | tee -a "$LOG_FILE"
            else
                echo "✗ SSH connectivity test failed" | tee -a "$LOG_FILE"
            fi
            unset SSHPASS
        else
            # Test with key-based authentication
            if timeout 10 ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" "echo SSH_OK" 2>&1 | grep -q "SSH_OK"; then
                SSH_TEST_SUCCESS=true
                echo "✓ SSH connectivity confirmed (key auth)" | tee -a "$LOG_FILE"
            else
                echo "✗ SSH connectivity test failed" | tee -a "$LOG_FILE"
            fi
        fi
        
        # Create workspace directory and connection guide
        WORKSPACE_ROOT="/home/coder/workspace"
        mkdir -p "$WORKSPACE_ROOT"
        
        if [ "$SSH_TEST_SUCCESS" = true ]; then
            # Connection successful - create helper file with instructions
            cat > "$WORKSPACE_ROOT/CONNECT_TO_REMOTE.md" <<'EOFSUCCESS'
# 🔗 SSH Remote Connection Ready

## ✅ Connection Test Successful!

Successfully verified connection to your remote host!

## 🚀 Connect to Remote Host

### Method 1: Using VS Code Remote-SSH (Recommended)

The Remote-SSH extension is already installed and configured for you!

**Steps to Connect:**
1. Open the **Command Palette**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type: **Remote-SSH: Connect to Host...**
3. Select: **remote-target**
4. VS Code will connect and open a new window with the remote filesystem

Your configured remote folder will be your workspace.

### Method 2: Using Terminal

You can also use the integrated terminal to SSH directly:

```bash
ssh remote-target
```

This will connect you to your configured remote host.

## 📁 Connection Details

All connection details are saved in `~/.ssh/config` under the name **remote-target**.

## 💡 Tips

- Remote-SSH will install VS Code Server on the remote host automatically
- Your extensions will be synced to the remote environment  
- Files are edited directly on the remote host (no local copies)
- Changes are saved instantly to the remote filesystem

## 🔧 Troubleshooting

If connection fails:
1. Check network connectivity from this container to your remote host
2. Verify SSH credentials are correct
3. Check remote host firewall settings
4. View logs in `.devfarm/startup.log`

## 🔒 Security Note

**Host Key Verification Disabled**: This environment is configured with `StrictHostKeyChecking=no` 
for ease of use in development. This means:
- First connections won't prompt for host key verification
- Connections are vulnerable to man-in-the-middle attacks
- Suitable for trusted networks and development environments
- For production use, implement proper host key management

## 🎯 What's Different from SSHFS?

This approach uses VS Code's native Remote-SSH extension instead of SSHFS mounting:
- **More Reliable**: Works with any SSH server (no SFTP subsystem required)
- **Better Performance**: Direct SSH connection, no FUSE overhead
- **Full VS Code Features**: Extensions run on the remote, better integration
- **No Privileges Required**: Container doesn't need privileged mode

Happy remote coding! 🎉
EOFSUCCESS
            echo "✅ SSH connection configured successfully" | tee -a "$LOG_FILE"
            echo "✅ Connection test passed - ready to connect via Remote-SSH" | tee -a "$LOG_FILE"
        else
            # Connection test failed - create error message
            cat > "$WORKSPACE_ROOT/SSH_CONNECTION_ERROR.md" <<'EOFERROR'
# ⚠️ SSH Connection Test Failed

## ❌ Unable to Connect

The connection test to your remote host failed. This usually means:

### Common Causes

1. **Authentication Issues**
   - SSH password is incorrect
   - SSH private key is missing or invalid
   - Remote host doesn't allow password/key authentication

2. **Network Issues**
   - Remote host is unreachable or offline
   - Firewall blocking SSH connection
   - Incorrect hostname or IP address

3. **SSH Service Issues**
   - SSH service not running on remote host
   - SSH port (default 22) is incorrect
   - Host key verification issues

## 🔧 How to Fix

### Check Your Credentials

Verify your SSH settings in the dashboard:
- **Hostname/IP**: Make sure it's correct and reachable
- **Port**: Usually 22, check if different
- **Username**: Verify the SSH username
- **Authentication**: Ensure password or private key is correct

### Test Connection Manually

Open the integrated terminal (Ctrl+`) and try:

```bash
# Test connection
ssh remote-target

# If that fails, try manually:
ssh -p PORT USERNAME@HOSTNAME
```

### View Detailed Logs

Check the startup logs for more details:

```bash
cat ~/.devfarm/startup.log
```

## 🎯 Next Steps

Once you fix the connectivity issue:
1. Update the SSH settings in the dashboard, OR
2. Recreate this environment with correct credentials

The environment is still usable for local development in the meantime!
EOFERROR
            echo "⚠️ SSH connection test failed - see SSH_CONNECTION_ERROR.md" | tee -a "$LOG_FILE"
        fi
        
        WORKSPACE_ROOT="/home/coder/workspace"
    fi
else
    # Workspace mode (default) - just use the empty workspace
    echo "Using standard workspace mode"
    WORKSPACE_ROOT="/home/coder/workspace"
fi

# Export WORKSPACE_ROOT for use by VS Code Server and MCP configuration
export WORKSPACE_ROOT
echo "Workspace root set to: ${WORKSPACE_ROOT}" | tee -a "$LOG_FILE"

# ============================================================================
# Configure MCP Servers (Isolated .vscode/mcp.json file)
# ============================================================================
# VS Code's proper MCP configuration method is via .vscode/mcp.json file
# To avoid polluting user workspaces (especially git repos), we:
#   1. Create MCP config in /home/coder/.devfarm/vscode-config/
#   2. Symlink it as .vscode in the workspace root
#   3. Add .vscode to workspace .gitignore (created below based on mode)
# This must happen AFTER WORKSPACE_ROOT is set for the correct mode

if [ -f /home/coder/.devfarm/mcp-copilot.json ]; then
    echo "Configuring MCP servers in isolated .vscode directory..." | tee -a "$LOG_FILE"
    /usr/bin/python3 - <<'PYEOF'
import json, os, sys

mcp_template_path = "/home/coder/.devfarm/mcp-copilot.json"
workspace_root = os.environ.get('WORKSPACE_ROOT', '/home/coder/workspace')

# Create isolated .vscode directory in devfarm state dir (not in workspace)
vscode_config_dir = "/home/coder/.devfarm/vscode-config"
os.makedirs(vscode_config_dir, exist_ok=True)

mcp_json_path = os.path.join(vscode_config_dir, 'mcp.json')

print(f"[MCP Config] Template path: {mcp_template_path}")
print(f"[MCP Config] Workspace: {workspace_root}")
print(f"[MCP Config] Isolated config dir: {vscode_config_dir}")
print(f"[MCP Config] MCP config will be written to: {mcp_json_path}")

# Get environment variables
github_token = os.environ.get('GITHUB_TOKEN', '')
brave_api_key = os.environ.get('BRAVE_API_KEY', '')

print(f"[MCP Config] GITHUB_TOKEN present: {bool(github_token)}")
print(f"[MCP Config] BRAVE_API_KEY present: {bool(brave_api_key)}")

# Load MCP configuration template
with open(mcp_template_path, 'r') as f:
    mcp_config_str = f.read()

# Expand environment variables
mcp_config_str = mcp_config_str.replace('${GITHUB_TOKEN}', github_token)
mcp_config_str = mcp_config_str.replace('${WORKSPACE_ROOT}', workspace_root)
mcp_config_str = mcp_config_str.replace('${BRAVE_API_KEY}', brave_api_key)

try:
    mcp_config = json.loads(mcp_config_str)
    servers = mcp_config.get('servers', {})
    
    print(f"[MCP Config] Parsed config with {len(servers)} servers")
    for server_name in servers:
        print(f"[MCP Config]   - Server: {server_name}")
    
    # Write to isolated mcp.json
    with open(mcp_json_path, 'w') as f:
        json.dump(mcp_config, f, indent=2)
    
    print(f"✓ MCP configuration written to {mcp_json_path}")
    
    # Create symlink from workspace to isolated config directory
    # This makes .vscode appear in workspace without polluting it
    workspace_vscode_link = os.path.join(workspace_root, '.vscode')
    
    # Remove existing .vscode if it exists (file, dir, or symlink)
    if os.path.islink(workspace_vscode_link):
        os.unlink(workspace_vscode_link)
        print(f"[MCP Config] Removed existing .vscode symlink")
    elif os.path.exists(workspace_vscode_link):
        import shutil
        if os.path.isdir(workspace_vscode_link):
            # Backup existing .vscode directory if it has user content
            backup_path = workspace_vscode_link + '.backup'
            shutil.move(workspace_vscode_link, backup_path)
            print(f"[MCP Config] Backed up existing .vscode to {backup_path}")
        else:
            os.remove(workspace_vscode_link)
    
    # Create symlink: workspace/.vscode -> /home/coder/.devfarm/vscode-config
    try:
        os.symlink(vscode_config_dir, workspace_vscode_link)
        print(f"✓ Symlinked {workspace_vscode_link} -> {vscode_config_dir}")
        print(f"  MCP servers are now accessible to all AI tools in workspace")
    except Exception as e:
        print(f"⚠ Failed to create .vscode symlink: {e}", file=sys.stderr)
        print(f"  MCP servers may not be accessible", file=sys.stderr)
    
except json.JSONDecodeError as e:
    print(f"[MCP Config] ERROR: Failed to parse JSON: {e}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"[MCP Config] ERROR: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
    
    # Also add minimal Copilot-specific setting to Machine/settings.json to enable MCP
    # This is just to enable the feature, actual servers are in .vscode/mcp.json
    /usr/bin/python3 - <<'PYEOF'
import json, os

settings_path = "/home/coder/.vscode-server-insiders/data/Machine/settings.json"

# Load existing settings
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
else:
    settings = {}

# Only add the access control setting, not the servers themselves
# The servers will be read from .vscode/mcp.json automatically
settings["chat.mcp.access"] = "all"  # Allow all MCP servers

# Write back
os.makedirs(os.path.dirname(settings_path), exist_ok=True)
with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)

print("✓ MCP access enabled in Machine settings")
PYEOF
    
else
    echo "[MCP Config] WARNING: mcp-copilot.json template not found!" | tee -a "$LOG_FILE"
fi

echo "MCP configuration complete" | tee -a "$LOG_FILE"
echo "Note: MCP servers are in isolated .vscode directory (symlinked to workspace)" | tee -a "$LOG_FILE"
echo "Note: aggregate-mcp-server uses config from its cloned repo (aggregate.mcp.json)" | tee -a "$LOG_FILE"

# Create workspace-specific .gitignore based on mode
# This prevents .vscode symlink and other dev-farm files from being committed
if [ "${DEV_MODE}" = "git" ]; then
    # In git mode, user has cloned repo - add .gitignore to prevent committing our .vscode symlink
    echo "Creating .gitignore for git mode to exclude dev-farm files..." | tee -a "$LOG_FILE"
    cat > "${WORKSPACE_ROOT}/.gitignore.devfarm" <<'GITIGNORE'
# Dev Farm managed files (auto-generated)
# Add these entries to your .gitignore if needed
.vscode/
.devfarm/
core.*
*.core
vgcore.*
.DS_Store
Thumbs.db
GITIGNORE
    echo "✓ Created ${WORKSPACE_ROOT}/.gitignore.devfarm (reference file)" | tee -a "$LOG_FILE"
    echo "  Add these entries to your repository's .gitignore if needed" | tee -a "$LOG_FILE"
elif [ "${DEV_MODE}" = "workspace" ]; then
    # In workspace mode, create .gitignore to keep workspace clean
    echo "Creating .gitignore for workspace mode..." | tee -a "$LOG_FILE"
    cat > "${WORKSPACE_ROOT}/.gitignore" <<'GITIGNORE'
# Core dumps and debug files
core.*
*.core
vgcore.*

# VS Code workspace files (dev-farm managed)
.vscode/
.devfarm/

# OS files
.DS_Store
Thumbs.db
GITIGNORE
    echo "✓ Created ${WORKSPACE_ROOT}/.gitignore" | tee -a "$LOG_FILE"
fi
# SSH mode: Don't create .gitignore as we're working on remote filesystem

# Create WELCOME.md in the workspace root (unless it's SSH/Git mode with custom info files)
if [ "${DEV_MODE}" = "workspace" ]; then
    if [ ! -f "${WORKSPACE_ROOT}/WELCOME.md" ] || [ "${DEVFARM_FORCE_WELCOME}" = "true" ]; then
        create_welcome_file "${WORKSPACE_ROOT}"
    fi
fi

# (Workspace settings seeding moved earlier to honor template and avoid duplicate writes)

# Install essential extensions with retry logic
echo "Installing default extensions..." | tee -a "$LOG_FILE"

# Extension directory for VS Code Server Insiders
EXT_DIR="/home/coder/.vscode-server-insiders/extensions"

# ============================================================================
# Pre-Installation Diagnostics
# ============================================================================
echo "=== Extension Installation Diagnostics ===" | tee -a "$LOG_FILE"

# Check VS Code Insiders binary
if [ -x "/usr/bin/code-insiders" ]; then
    echo "✓ VS Code Insiders binary found at /usr/bin/code-insiders" | tee -a "$LOG_FILE"
    CODE_VERSION=$(/usr/bin/code-insiders --version 2>&1 | head -n1 || echo "unknown")
    echo "  Version: $CODE_VERSION" | tee -a "$LOG_FILE"
else
    echo "✗ VS Code Insiders binary not found or not executable!" | tee -a "$LOG_FILE"
fi

# Check extension directory
if [ -d "$EXT_DIR" ]; then
    echo "✓ Extension directory exists: $EXT_DIR" | tee -a "$LOG_FILE"
    EXT_COUNT=$(find "$EXT_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
    echo "  Current extension count: $EXT_COUNT" | tee -a "$LOG_FILE"
    
    if [ "$EXT_COUNT" -gt 0 ]; then
        echo "  Existing extensions:" | tee -a "$LOG_FILE"
        find "$EXT_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | head -5 | while read ext; do
            echo "    - $ext" | tee -a "$LOG_FILE"
        done
        if [ "$EXT_COUNT" -gt 5 ]; then
            echo "    ... and $((EXT_COUNT - 5)) more" | tee -a "$LOG_FILE"
        fi
    fi
else
    echo "⚠ Extension directory does not exist yet: $EXT_DIR" | tee -a "$LOG_FILE"
    echo "  Will be created during first extension install" | tee -a "$LOG_FILE"
fi

# Test extension installation capability with a quick dry-run
echo "Testing extension installation capability..." | tee -a "$LOG_FILE"
TEST_OUTPUT=$(/usr/bin/code-insiders --list-extensions --extensions-dir "$EXT_DIR" 2>&1 || echo "failed")
if echo "$TEST_OUTPUT" | grep -q "failed"; then
    echo "⚠ Extension listing failed - installation may have issues" | tee -a "$LOG_FILE"
    echo "  Output: $TEST_OUTPUT" | tee -a "$LOG_FILE"
else
    echo "✓ Extension system is responsive" | tee -a "$LOG_FILE"
fi

echo "=== End Diagnostics ===" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

install_extension_with_retry() {
    local ext_id="$1"
    local max_attempts=3
    local attempt=1
    local delay=3
    
    while [ $attempt -le $max_attempts ]; do
        echo "[$attempt/$max_attempts] Installing $ext_id..." | tee -a "$LOG_FILE"
        
        # Capture full output including stderr with detailed logging
        local output
        local exit_code
        output=$(/usr/bin/code-insiders --install-extension "$ext_id" --extensions-dir "$EXT_DIR" 2>&1)
        exit_code=$?
        
        # Log everything for diagnostics
        echo "  Exit code: $exit_code" | tee -a "$LOG_FILE"
        echo "  Full output:" | tee -a "$LOG_FILE"
        echo "$output" | sed 's/^/    /' | tee -a "$LOG_FILE"
        
        # Verify extension was actually installed by checking if it appears in list
        local installed=false
        if /usr/bin/code-insiders --list-extensions --extensions-dir "$EXT_DIR" 2>/dev/null | grep -qi "^${ext_id}$"; then
            installed=true
        fi
        
        # Detect specific error types
        local error_type="unknown"
        if echo "$output" | grep -qi "not compatible\|incompatible"; then
            error_type="compatibility"
        elif echo "$output" | grep -qi "network\|timeout\|econnrefused\|enotfound"; then
            error_type="network"
        elif echo "$output" | grep -qi "marketplace\|gallery"; then
            error_type="marketplace"
        fi
        
        # Check for success: exit code 0, no error messages, AND extension is listed
        if [ $exit_code -eq 0 ] && [ "$installed" = true ] && ! echo "$output" | grep -qi "error\|failed"; then
            echo "  ✓ Successfully installed and verified $ext_id" | tee -a "$LOG_FILE"
            return 0
        elif [ "$installed" = true ]; then
            # Extension is installed even though there were warnings
            echo "  ✓ Extension $ext_id installed (with warnings)" | tee -a "$LOG_FILE"
            return 0
        else
            echo "  ✗ Installation failed (error type: $error_type)" | tee -a "$LOG_FILE"
            
            # Don't retry on compatibility errors
            if [ "$error_type" = "compatibility" ]; then
                echo "  ⚠ $ext_id is not compatible with this version of VS Code Insiders" | tee -a "$LOG_FILE"
                return 1
            fi
            
            # Retry with exponential backoff for other errors
            if [ $attempt -lt $max_attempts ]; then
                echo "  ⏳ Retrying in ${delay}s... (error type: $error_type)" | tee -a "$LOG_FILE"
                sleep $delay
                delay=$((delay * 2))  # Exponential backoff
            fi
            attempt=$((attempt + 1))
        fi
    done
    
    echo "  ✗ Failed to install $ext_id after $max_attempts attempts" | tee -a "$LOG_FILE"
    return 1
}

# Install VS Code extensions
# Remote development
install_extension_with_retry "ms-vscode-remote.remote-ssh" || true

# Markdown support
install_extension_with_retry "yzhang.markdown-all-in-one" || true

# GitHub Copilot (official Microsoft extensions)
install_extension_with_retry "github.copilot" || true

# GitHub Copilot Chat requires pre-release version for VS Code Insiders compatibility
# The stable version uses proposed APIs that may not be compatible with latest Insiders builds
echo "Installing github.copilot-chat pre-release (required for VS Code Insiders)..." | tee -a "$LOG_FILE"
if /usr/bin/code-insiders --install-extension "github.copilot-chat" --pre-release --extensions-dir "$EXT_DIR" 2>&1 | tee -a "$LOG_FILE"; then
    echo "✓ Successfully installed github.copilot-chat (pre-release)" | tee -a "$LOG_FILE"
else
    echo "⚠ Failed to install github.copilot-chat pre-release, trying stable version..." | tee -a "$LOG_FILE"
    install_extension_with_retry "github.copilot-chat" || true
fi

# GitHub Copilot Web Search extension
install_extension_with_retry "ms-vscode.vscode-websearchforcopilot" || true

# AI Assistants
install_extension_with_retry "continue.continue" || true  # Continue.dev AI assistant
install_extension_with_retry "saoudrizwan.claude-dev" || true  # Cline (formerly Claude Dev)
install_extension_with_retry "openai.chatgpt" || true  # Codex

# General utilities
install_extension_with_retry "eamodio.gitlens" || true  # GitLens
install_extension_with_retry "esbenp.prettier-vscode" || true  # Prettier

echo "Extension installation complete" | tee -a "$LOG_FILE"

# ============================================================================
# Post-Installation Verification
# ============================================================================
echo "=== Extension Installation Verification ===" | tee -a "$LOG_FILE"

# List all installed extensions
echo "Listing all installed extensions:" | tee -a "$LOG_FILE"
INSTALLED_EXTS=$(/usr/bin/code-insiders --list-extensions --extensions-dir "$EXT_DIR" 2>&1 || echo "")
if [ -n "$INSTALLED_EXTS" ]; then
    echo "$INSTALLED_EXTS" | tee -a "$LOG_FILE"
    INSTALLED_COUNT=$(echo "$INSTALLED_EXTS" | wc -l)
    echo "Total installed extensions: $INSTALLED_COUNT" | tee -a "$LOG_FILE"
else
    echo "⚠ No extensions found or unable to list extensions" | tee -a "$LOG_FILE"
    INSTALLED_COUNT=0
fi

# Check for critical extensions
echo "" | tee -a "$LOG_FILE"
echo "Checking critical extensions:" | tee -a "$LOG_FILE"
CRITICAL_EXTS=(
    "ms-vscode-remote.remote-ssh"
    "github.copilot"
    "github.copilot-chat"
)

MISSING_CRITICAL=()
for ext in "${CRITICAL_EXTS[@]}"; do
    if echo "$INSTALLED_EXTS" | grep -qi "^${ext}$"; then
        echo "  ✓ $ext" | tee -a "$LOG_FILE"
    else
        echo "  ✗ $ext (MISSING)" | tee -a "$LOG_FILE"
        MISSING_CRITICAL+=("$ext")
    fi
done

if [ ${#MISSING_CRITICAL[@]} -gt 0 ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "⚠ WARNING: ${#MISSING_CRITICAL[@]} critical extension(s) missing:" | tee -a "$LOG_FILE"
    for ext in "${MISSING_CRITICAL[@]}"; do
        echo "  - $ext" | tee -a "$LOG_FILE"
    done
fi

# Show extension storage size
EXT_DIR="/home/coder/.vscode-server-insiders/extensions"
if [ -d "$EXT_DIR" ]; then
    EXT_SIZE=$(du -sh "$EXT_DIR" 2>/dev/null | cut -f1 || echo "unknown")
    echo "" | tee -a "$LOG_FILE"
    echo "Extension storage size: $EXT_SIZE" | tee -a "$LOG_FILE"
fi

echo "=== End Verification ===" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Create keybindings to make Chat/Inline Chat more accessible
# VS Code Insiders Server uses ~/.vscode-server-insiders/data/User/ for user data
mkdir -p /home/coder/.vscode-server-insiders/data/User
cat > /home/coder/.vscode-server-insiders/data/User/keybindings.json <<'EOFKEYS'
[
  {
    "key": "ctrl+shift+space",
    "command": "workbench.action.chat.open"
  },
  {
    "key": "ctrl+i",
    "command": "github.copilot.interactiveEditor.explain"
  }
]
EOFKEYS

# Configure tmux for persistent sessions
# ============================================================================
echo "Configuring tmux for persistent terminal sessions..." | tee -a "$LOG_FILE"

# Create tmux configuration for better user experience
cat > /home/coder/.tmux.conf <<'EOTMUX'
# Enable mouse support
set -g mouse on

# Increase scrollback buffer
set -g history-limit 50000

# Use 256 colors
set -g default-terminal "screen-256color"

# Start window numbering at 1
set -g base-index 1

# Renumber windows when one is closed
set -g renumber-windows on

# Status bar styling
set -g status-style 'bg=colour236 fg=colour250'
set -g status-left '[#S] '
set -g status-right '%Y-%m-%d %H:%M '

# Pane border colors
set -g pane-border-style 'fg=colour238'
set -g pane-active-border-style 'fg=colour39'

# Message styling
set -g message-style 'bg=colour39 fg=colour232'

# Activity monitoring
setw -g monitor-activity on
set -g visual-activity off

# Vi mode for copy mode
setw -g mode-keys vi
EOTMUX

# Create a tmux startup script that ensures a persistent session exists
# This will be used by VS Code's integrated terminal
mkdir -p /home/coder/.local/bin

cat > /home/coder/.local/bin/tmux-persistent <<'EOTMUXSCRIPT'
#!/bin/bash
# Attach to existing devfarm session or create new one
# This script handles edge cases like sessions with no windows

SESSION_NAME="devfarm"

# Check if session exists and has windows
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # Check if session has any windows
    WINDOW_COUNT=$(tmux list-windows -t "$SESSION_NAME" 2>/dev/null | wc -l)
    
    if [ "$WINDOW_COUNT" -gt 0 ]; then
        # Session exists and has windows, attach to it
        exec tmux attach-session -t "$SESSION_NAME"
    else
        # Session exists but has no windows, kill it and create new
        tmux kill-session -t "$SESSION_NAME" 2>/dev/null
        exec tmux new-session -s "$SESSION_NAME"
    fi
else
    # Session doesn't exist, create it
    exec tmux new-session -s "$SESSION_NAME"
fi
EOTMUXSCRIPT

chmod +x /home/coder/.local/bin/tmux-persistent

echo "✓ Tmux configured for persistent sessions (session name: devfarm)" | tee -a "$LOG_FILE"

# Start tmux server immediately to prevent "error connecting to /tmp/tmux-1000/default" errors
# This ensures the tmux server is always running for AI assistant and other tmux operations
echo "Starting tmux server..." | tee -a "$LOG_FILE"

# Log tmux state before starting
echo "DEBUG: Checking tmux state before server start..." | tee -a "$LOG_FILE"
ls -la /tmp/tmux-* 2>&1 | tee -a "$LOG_FILE" || echo "No tmux sockets found" | tee -a "$LOG_FILE"
ps aux | grep tmux | grep -v grep | tee -a "$LOG_FILE" || echo "No tmux processes found" | tee -a "$LOG_FILE"

# Start the server
if tmux start-server 2>&1 | tee -a "$LOG_FILE"; then
    echo "✓ Tmux server started successfully" | tee -a "$LOG_FILE"
else
    echo "⚠ Tmux server start returned error code: $?" | tee -a "$LOG_FILE"
fi

# Create a persistent background session to keep the server alive
# This session will never be attached to by users, it just keeps the server running
echo "Creating persistent background session to keep tmux server alive..." | tee -a "$LOG_FILE"
if tmux new-session -d -s background-keepalive -c /home/coder 2>&1 | tee -a "$LOG_FILE"; then
    echo "✓ Background session 'background-keepalive' created" | tee -a "$LOG_FILE"
else
    echo "⚠ Failed to create background session" | tee -a "$LOG_FILE"
fi

# Log tmux state after starting
echo "DEBUG: Checking tmux state after server start..." | tee -a "$LOG_FILE"
ls -la /tmp/tmux-* 2>&1 | tee -a "$LOG_FILE" || echo "No tmux sockets found" | tee -a "$LOG_FILE"
ps aux | grep tmux | grep -v grep | tee -a "$LOG_FILE" || echo "No tmux processes found" | tee -a "$LOG_FILE"
tmux list-sessions 2>&1 | tee -a "$LOG_FILE" || echo "No sessions exist yet" | tee -a "$LOG_FILE"

# ============================================================================
# Deferred Extension Installation (Background Process)
# ============================================================================
# If extension count is low, schedule a background retry after VS Code starts
if [ "$INSTALLED_COUNT" -lt 5 ] || [ ${#MISSING_CRITICAL[@]} -gt 0 ]; then
    echo "Extension count is low ($INSTALLED_COUNT) or critical extensions missing" | tee -a "$LOG_FILE"
    echo "Scheduling background extension installation retry in 30 seconds..." | tee -a "$LOG_FILE"
    
    (
        sleep 30
        echo "=== Background Extension Installation Retry ===" >> "$LOG_FILE"
        echo "$(date -Is): Starting deferred extension installation" >> "$LOG_FILE"
        
        # Retry missing critical extensions
        for ext in "${MISSING_CRITICAL[@]}"; do
            echo "Retrying $ext..." >> "$LOG_FILE"
            install_extension_with_retry "$ext" >> "$LOG_FILE" 2>&1 || true
        done
        
        # Verify after retry
        FINAL_EXTS=$(/usr/bin/code-insiders --list-extensions --extensions-dir "$EXT_DIR" 2>&1 || echo "")
        FINAL_COUNT=$(echo "$FINAL_EXTS" | wc -l)
        echo "$(date -Is): Deferred installation complete. Final count: $FINAL_COUNT" >> "$LOG_FILE"
        echo "=== End Background Installation ===" >> "$LOG_FILE"
    ) &
    
    echo "Background installation process started (PID: $!)" | tee -a "$LOG_FILE"
fi

# Start VS Code Server
echo "Starting VS Code Server (workspace will be set via URL parameter)" | tee -a "$LOG_FILE"

# Ensure workspace directory exists
mkdir -p "${WORKSPACE_ROOT}"

# Start VS Code Remote Tunnel
# Dev Farm always uses tunnel mode to ensure extensions run on the server (not in browser)
# This provides persistent extension host across browser disconnections
echo "🔄 Starting VS Code Remote Tunnel (server-side extensions)" | tee -a "$LOG_FILE"
echo "All extensions run on the server and persist across browser disconnections" | tee -a "$LOG_FILE"

# Authenticate tunnel if token available
if [ -n "${GITHUB_TOKEN}" ]; then
    echo "Authenticating tunnel with GitHub..." | tee -a "$LOG_FILE"
    echo "${GITHUB_TOKEN}" | /usr/bin/code-insiders tunnel user login \
      --provider github \
      --access-token 2>&1 | tee -a "$LOG_FILE" || true
fi

# Start tunnel with unique name based on environment ID
TUNNEL_NAME="devfarm-${DEVFARM_ENV_ID:-unknown}"
echo "Starting tunnel with name: ${TUNNEL_NAME}" | tee -a "$LOG_FILE"
echo "Access via: https://vscode.dev/tunnel/${TUNNEL_NAME}" | tee -a "$LOG_FILE"

exec /usr/bin/code-insiders tunnel \
  --accept-server-license-terms \
  --name "${TUNNEL_NAME}" \
  --disable-telemetry
