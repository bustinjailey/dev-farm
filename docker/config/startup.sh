#!/bin/bash
set -e

# Fix workspace ownership (volume might be owned by root)
echo "Ensuring workspace ownership..."
sudo chown -R coder:coder /home/coder/workspace 2>/dev/null || true

# Ensure settings directory exists and copy settings
echo "Applying VS Code settings..."
mkdir -p /home/coder/.local/share/code-server/User

# Copy settings if they don't exist or are different
if [ -f /home/coder/.local/share/code-server/User/settings.json.template ]; then
    cp -f /home/coder/.local/share/code-server/User/settings.json.template /home/coder/.local/share/code-server/User/settings.json
    echo "Settings applied successfully!"
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
else
    echo "Warning: GITHUB_TOKEN not set. Skipping GitHub authentication."
    echo "You'll need to authenticate manually."
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
    # SSH mode - install and configure Remote-SSH extension
    echo "Setting up Remote-SSH mode..."
    
    # Install Remote-SSH extension
    /usr/bin/code-server --install-extension ms-vscode-remote.remote-ssh 2>&1 || {
        echo "Warning: Failed to install Remote-SSH extension"
    }
    
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

# Create a startup script to open Copilot Chat
mkdir -p /home/coder/workspace/.vscode

# Use WORKSPACE_NAME if provided for the window title
WORKSPACE_DISPLAY_NAME="${WORKSPACE_NAME:-Workspace}"

cat > /home/coder/workspace/.vscode/settings.json <<EOFVSCODE
{
  "github.copilot.chat.welcomeMessage": "never",
  "workbench.startupEditor": "none",
  "window.title": "${WORKSPACE_DISPLAY_NAME}"
}
EOFVSCODE

# Create keybindings to make Copilot more accessible
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

# Start code-server with focus on Copilot
echo "Starting code-server with workspace name: ${WORKSPACE_NAME:-workspace}"
exec /usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth none /home/coder/workspace
