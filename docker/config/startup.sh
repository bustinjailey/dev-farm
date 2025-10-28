#!/bin/bash
set -e

# Fix workspace ownership (volume might be owned by root)
echo "Ensuring workspace ownership..."
sudo chown -R coder:coder /home/coder/workspace 2>/dev/null || true

echo "Applying VS Code workspace settings..."
mkdir -p /home/coder/.local/share/code-server/User

# Seed workspace-level settings from template if available (workspace is the only source of truth now)
mkdir -p /home/coder/workspace/.vscode
FORCE_WS_SETTINGS_SEED="${DEVFARM_FORCE_APPLY_WORKSPACE_SETTINGS:-true}"
if [ -f /home/coder/.devfarm/workspace-settings.json.template ]; then
    if [ ! -f /home/coder/workspace/.vscode/settings.json ] || [ "${FORCE_WS_SETTINGS_SEED}" = "true" ]; then
        echo "Seeding workspace .vscode/settings.json from template..."
        /usr/bin/python3 - <<'PYEOF'
import json, os
tpl = "/home/coder/.devfarm/workspace-settings.json.template"
out = "/home/coder/workspace/.vscode/settings.json"
with open(tpl, 'r', encoding='utf-8') as f:
    data = json.load(f)
# Overlay dynamic window title
title = os.environ.get('WORKSPACE_NAME', 'Workspace')
data["window.title"] = title
with open(out, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
print("Workspace settings written to", out)
PYEOF
    else
        echo "Workspace settings already exist; skipping seed. Set DEVFARM_FORCE_APPLY_WORKSPACE_SETTINGS=true to override."
    fi
else
    echo "No workspace settings template found; skipping."
fi

# Log helper
LOG_FILE="/home/coder/workspace/STARTUP_LOG.txt"
{
    echo "==== Dev Farm startup $(date -Is) ===="
} >> "$LOG_FILE" 2>/dev/null || true

# Tiny helper to install an extension by id (with pre-check and logging)
install_extension() {
    local ext_id="$1"
    if /usr/bin/code-server --list-extensions | grep -q "^${ext_id}$"; then
        echo "Extension already installed: ${ext_id}" | tee -a "$LOG_FILE"
        return 0
    fi
    echo "Installing extension: ${ext_id}" | tee -a "$LOG_FILE"
    if /usr/bin/code-server --install-extension "${ext_id}" >> "$LOG_FILE" 2>&1; then
        echo "Installed: ${ext_id}" | tee -a "$LOG_FILE"
        return 0
    else
        echo "Failed to install by id: ${ext_id}" | tee -a "$LOG_FILE"
        return 1
    fi
}

# Always ensure a Remote-SSH experience is available (or the best possible fallback)
echo "Ensuring Remote-SSH extension is installed..." | tee -a "$LOG_FILE"

# Try official Remote - SSH (MS Marketplace – typically unsupported on code-server/Open VSX)
install_extension ms-vscode-remote.remote-ssh || echo "Remote-SSH (MS) likely unsupported here." | tee -a "$LOG_FILE"

# Fallback: community 'Open Remote - SSH' on Open VSX (works in web)
if ! install_extension jeanp413.open-remote-ssh; then
    echo "Attempting VSIX fallback for Open Remote - SSH..." | tee -a "$LOG_FILE"
    mkdir -p /tmp/devfarm-ext && cd /tmp/devfarm-ext
    # Download the latest VSIX from Open VSX (stable URL) and install from file
    if curl -fsSL -o open-remote-ssh.vsix "https://open-vsx.org/api/jeanp413/open-remote-ssh/latest/file" >> "$LOG_FILE" 2>&1; then
        if /usr/bin/code-server --install-extension /tmp/devfarm-ext/open-remote-ssh.vsix >> "$LOG_FILE" 2>&1; then
            echo "Installed Open Remote - SSH via VSIX." | tee -a "$LOG_FILE"
        else
            echo "VSIX install failed for Open Remote - SSH." | tee -a "$LOG_FILE"
        fi
    else
        echo "Failed to download VSIX for Open Remote - SSH." | tee -a "$LOG_FILE"
    fi
fi

# Setup GitHub authentication if token is provided
if [ -n "${GITHUB_TOKEN}" ]; then
    echo "Setting up GitHub authentication..."
    
    # Configure git with username from environment or default
    GITHUB_USERNAME="${GITHUB_USERNAME:-bustinjailey}"
    GITHUB_EMAIL="${GITHUB_EMAIL:-${GITHUB_USERNAME}@users.noreply.github.com}"
    
    git config --global user.name "${GITHUB_USERNAME}"
    git config --global user.email "${GITHUB_EMAIL}"
    
    # Login to GitHub CLI (with explicit stdin and error handling)
    echo "${GITHUB_TOKEN}" | gh auth login --with-token --hostname github.com 2>&1 || {
        echo "Warning: gh auth login had issues, but continuing..."
    }
    
    # Setup git credential helper
    gh auth setup-git 2>&1 || {
        echo "Warning: gh auth setup-git had issues, but continuing..."
    }
    
    # Create directory for GitHub extensions if it doesn't exist
    mkdir -p /home/coder/.local/share/code-server/User/globalStorage/github.vscode-pull-request-github
    
    # Install GitHub Copilot extensions if not already installed
    /usr/bin/code-server --install-extension github.copilot 2>&1 || echo "Copilot extension install skipped"
    /usr/bin/code-server --install-extension github.copilot-chat 2>&1 || echo "Copilot Chat extension install skipped"
    
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
        
        echo "${GITHUB_TOKEN}" | gh auth login --with-token --hostname github.com 2>&1 || {
            echo "Warning: gh auth login had issues, but continuing..."
        }
        
        gh auth setup-git 2>&1 || {
            echo "Warning: gh auth setup-git had issues, but continuing..."
        }
        
        mkdir -p /home/coder/.local/share/code-server/User/globalStorage/github.vscode-pull-request-github
        /usr/bin/code-server --install-extension github.copilot 2>&1 || echo "Copilot extension install skipped"
        /usr/bin/code-server --install-extension github.copilot-chat 2>&1 || echo "Copilot Chat extension install skipped"
        
        echo "GitHub authentication completed from shared storage for ${GITHUB_USERNAME}!"
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
    # Git repository mode - clone the repository
    if [ -n "${GIT_URL}" ]; then
        echo "Cloning repository: ${GIT_URL}"
        cd /home/coder/workspace
        
        # Remove any existing content (workspace should be empty)
        rm -rf ./* .git 2>/dev/null || true
        
        # Clone the repository
        git clone "${GIT_URL}" temp_clone
        
        # Move contents to workspace root
        mv temp_clone/* temp_clone/.* /home/coder/workspace/ 2>/dev/null || true
        rmdir temp_clone 2>/dev/null || true
        
        echo "Repository cloned successfully!"
    else
        echo "Warning: GIT_URL not set for git mode. Creating empty workspace."
    fi
elif [ "${DEV_MODE}" = "ssh" ]; then
    # SSH mode - configure Remote-SSH extension (already installed globally)
    echo "Setting up Remote-SSH mode..."
    
    # Create SSH config if host details are provided
    if [ -n "${SSH_HOST}" ]; then
        mkdir -p /home/coder/.ssh
        chmod 700 /home/coder/.ssh
        
        SSH_USER="${SSH_USER:-root}"
        SSH_PATH="${SSH_PATH:-/home}"
        
        # Create SSH config entry
        cat > /home/coder/.ssh/config <<EOF
Host ${SSH_HOST}
    HostName ${SSH_HOST}
    User ${SSH_USER}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF
        chmod 600 /home/coder/.ssh/config
        
        echo "SSH configuration created for ${SSH_USER}@${SSH_HOST}"
        echo "You can connect using the Remote-SSH extension"
        
        # Create a README in the workspace with instructions
        cat > /home/coder/workspace/REMOTE_SSH_SETUP.md <<EOF
# Remote SSH Mode

This environment is configured for Remote SSH development.

## Connection Details
- Host: ${SSH_HOST}
- User: ${SSH_USER}
- Default Path: ${SSH_PATH}

## How to Connect
1. Press \`Ctrl+Shift+P\` (or \`Cmd+Shift+P\` on Mac)
2. Type "Remote-SSH: Connect to Host"
3. Select: ${SSH_HOST}
4. Once connected, open the folder: ${SSH_PATH}

Your SSH key authentication should be set up on the remote host.
EOF
    else
        echo "Warning: SSH_HOST not set. Remote-SSH extension installed but not configured."
        cat > /home/coder/workspace/REMOTE_SSH_SETUP.md <<EOF
# Remote SSH Mode

The Remote-SSH extension is installed.

## How to Connect
1. Configure your SSH host details
2. Press \`Ctrl+Shift+P\` (or \`Cmd+Shift+P\` on Mac)
3. Type "Remote-SSH: Connect to Host"
4. Follow the prompts to add your SSH connection

Make sure your SSH keys are properly configured.
EOF
    fi
else
    # Workspace mode (default) - just use the empty workspace
    echo "Using standard workspace mode"
fi

# (Workspace settings seeding moved earlier to honor template and avoid duplicate writes)

# Create keybindings to make Chat/Inline Chat more accessible
mkdir -p /home/coder/.local/share/code-server/User
cat > /home/coder/.local/share/code-server/User/keybindings.json <<'EOFKEYS'
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

# Persist a snapshot of installed extensions for quick troubleshooting
echo "\nInstalled extensions after setup:" | tee -a "$LOG_FILE"
/usr/bin/code-server --list-extensions 2>&1 | tee -a "$LOG_FILE" || true

# Start code-server with focus on Copilot
echo "Starting code-server with workspace name: ${WORKSPACE_NAME:-workspace}"
exec /usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth none /home/coder/workspace
