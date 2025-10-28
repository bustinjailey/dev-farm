#!/bin/bash
set -e

### Ensure workspace directory exists and is owned by coder
echo "Preparing workspace directory..."
mkdir -p /home/coder/workspace || true
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

# Ensure minimal user-level settings for features that require user scope (workspace trust)
/usr/bin/python3 - <<'PYEOF'
import json, os
user_settings_path = "/home/coder/.local/share/code-server/User/settings.json"
os.makedirs(os.path.dirname(user_settings_path), exist_ok=True)
existing = {}
if os.path.exists(user_settings_path):
    try:
        with open(user_settings_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
    except Exception:
        existing = {}
# Enforce: disable workspace trust prompts globally (must be user scope)
existing["security.workspace.trust.enabled"] = False
existing["security.workspace.trust.startupPrompt"] = "never"
existing["security.workspace.trust.emptyWindow"] = False
with open(user_settings_path, 'w', encoding='utf-8') as f:
    json.dump(existing, f, indent=2)
print("User-level settings updated for trust and extension host overrides")
PYEOF

# Create a friendly WELCOME.md with one-click sign-in links (only if not present or forced)
WELCOME_PATH="/home/coder/workspace/WELCOME.md"
if [ ! -f "$WELCOME_PATH" ] || [ "${DEVFARM_FORCE_WELCOME}" = "true" ]; then
    cat > "$WELCOME_PATH" <<'EOWELCOME'
# 👋 Welcome to Dev Farm

You’re ready to code! A few helpful shortcuts:

- Sign in to GitHub: [Click here](command:github.signin)
- Sign in to GitHub Copilot: [Click here](command:github.copilot.signIn)
- Manage Accounts: [Open Accounts](command:workbench.action.manageAccounts)

Notes:
- Git and the GitHub CLI (gh) are already authenticated if you connected GitHub in the dashboard.
- These links run VS Code commands in your browser session.

Happy hacking!
EOWELCOME
    echo "WELCOME.md created at $WELCOME_PATH"
fi

# Log helper
LOG_FILE="/home/coder/workspace/STARTUP_LOG.txt"
{
    echo "==== Dev Farm startup $(date -Is) ===="
} >> "$LOG_FILE" 2>/dev/null || true

# (Removed Open Remote - SSH extension installation; switching to server-side SSHFS for SSH mode)

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
    # SSH mode - mount remote filesystem as subdirectory to preserve local workspace settings
    echo "Setting up SSHFS mount for remote filesystem..." | tee -a "$LOG_FILE"

    if [ -z "${SSH_HOST}" ]; then
        echo "Error: SSH_HOST not set. Cannot mount remote filesystem." | tee -a "$LOG_FILE"
        cat > /home/coder/workspace/SSH_SETUP_ERROR.md <<'EOFERR'
# SSH Setup Error

SSH_HOST environment variable is not set. Cannot mount remote filesystem.

To use SSH mode, you need to provide:
- SSH_HOST: The remote hostname or IP
- SSH_USER: The SSH username (optional, defaults to root)
- SSH_PATH: The remote path to mount (optional, defaults to /home)
- SSH_PRIVATE_KEY: Your SSH private key (optional, for key-based auth)

You can update these settings in the dashboard.
EOFERR
    else
        mkdir -p /home/coder/.ssh
        chmod 700 /home/coder/.ssh

        SSH_USER="${SSH_USER:-root}"
        SSH_PATH="${SSH_PATH:-/home}"
        SSH_PORT="${SSH_PORT:-22}"

        # Optional: private key provided via env (SSH_PRIVATE_KEY). If present, use it.
        if [ -n "${SSH_PRIVATE_KEY}" ]; then
            echo "Using SSH private key from environment" | tee -a "$LOG_FILE"
            echo "${SSH_PRIVATE_KEY}" > /home/coder/.ssh/id_rsa
            chmod 600 /home/coder/.ssh/id_rsa
        fi

        # Create SSH config entry
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
EOF
        chmod 600 /home/coder/.ssh/config

        # Create mount point as subdirectory of workspace
        REMOTE_MOUNT_DIR="/home/coder/workspace/remote"
        mkdir -p "$REMOTE_MOUNT_DIR"
        
        # Ensure FUSE device exists
        if [ ! -e /dev/fuse ]; then
            echo "Error: /dev/fuse is not available in the container. SSHFS cannot mount. Check container run privileges." | tee -a "$LOG_FILE"
            cat > /home/coder/workspace/SSH_MOUNT_ERROR.md <<'EOFERR'
# SSH Mount Error

/dev/fuse device is not available in this container.

SSHFS requires FUSE support which needs:
- /dev/fuse device mapped into container
- SYS_ADMIN capability
- AppArmor security profile configured

The container was not started with the necessary privileges for SSHFS.
Please contact your administrator or recreate this environment.
EOFERR
        else
            # Attempt to mount remote path to subdirectory
            echo "Mounting ${SSH_USER}@${SSH_HOST}:${SSH_PATH} -> ${REMOTE_MOUNT_DIR}" | tee -a "$LOG_FILE"
            
            # Unmount if previously mounted
            if mountpoint -q "$REMOTE_MOUNT_DIR"; then
                fusermount3 -u "$REMOTE_MOUNT_DIR" || true
            fi
            
            # Mount with user mapping and reconnect options
            UID_VAL=$(id -u coder 2>/dev/null || id -u)
            GID_VAL=$(id -g coder 2>/dev/null || id -g)
            
            # Run SSHFS with timeout to prevent hanging on authentication failures
            MOUNT_SUCCESS=false
            if timeout 10 sshfs \
                    -p "${SSH_PORT}" \
                    -o allow_other \
                    -o StrictHostKeyChecking=no \
                    -o UserKnownHostsFile=/dev/null \
                    -o reconnect \
                    -o follow_symlinks \
                    -o ConnectTimeout=5 \
                    -o ServerAliveInterval=5 \
                    -o ServerAliveCountMax=2 \
                    -o uid=${UID_VAL} \
                    -o gid=${GID_VAL} \
                    -o PasswordAuthentication=no \
                    -o BatchMode=yes \
                    remote-target:"${SSH_PATH}" \
                    "$REMOTE_MOUNT_DIR" 2>&1 | tee -a "$LOG_FILE"; then
                MOUNT_SUCCESS=true
            fi
            
            if [ "$MOUNT_SUCCESS" = true ] && mountpoint -q "$REMOTE_MOUNT_DIR"; then
                echo "SSHFS mount successful at ${REMOTE_MOUNT_DIR}" | tee -a "$LOG_FILE"
                cat > /home/coder/workspace/REMOTE_ACCESS.md <<EOF
# 🔗 Remote SSH Access

Successfully connected to **${SSH_HOST}**!

## Mounted Location
The remote filesystem is mounted at: \`remote/\`

Browse and edit files from **${SSH_USER}@${SSH_HOST}:${SSH_PATH}** directly in this workspace.

## Connection Details
- **Host**: ${SSH_HOST}:${SSH_PORT}
- **User**: ${SSH_USER}
- **Remote Path**: ${SSH_PATH}
- **Mount Point**: ${REMOTE_MOUNT_DIR}

## Tips
- Files are edited live on the remote host
- Changes are synchronized automatically via SSHFS
- If connection is lost, the mount will attempt to reconnect
- Use the terminal to run commands directly on remote files

Happy coding! 🚀
EOF
            else
                echo "SSHFS mount failed. Remote filesystem not available." | tee -a "$LOG_FILE"
                rmdir "$REMOTE_MOUNT_DIR" 2>/dev/null || true
                cat > /home/coder/workspace/SSHFS_ERROR.md <<EOF
# 🔌 SSH Mount Failed

We attempted to mount **${SSH_USER}@${SSH_HOST}:${SSH_PATH}** to \`workspace/remote/\` but the connection failed.

## Common Causes
- **Authentication**: SSH key not provided or incorrect
  - Add your SSH private key via the dashboard's environment settings
  - Or ensure password authentication is enabled on the remote host
- **Network**: Cannot reach ${SSH_HOST}:${SSH_PORT}
  - Check firewall rules and network connectivity
- **Permissions**: Missing FUSE support in container
  - Requires /dev/fuse device and SYS_ADMIN capability (automatically configured)

## What You Can Do
1. **Add SSH Key**: Go to the dashboard → Edit Environment → Add your private SSH key
2. **Test Connection**: Use the integrated terminal to run:
   \`\`\`bash
   ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST}
   \`\`\`
3. **Check Logs**: See STARTUP_LOG.txt for detailed error messages

## Current Status
Your workspace is running with **local storage only**. Once authentication is configured, recreate this environment to mount the remote filesystem at \`workspace/remote/\`.

For now, you can still use this environment to write code locally! 🚀
EOF
            fi
        fi
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

# Start code-server and open WELCOME.md in preview mode on first run
echo "Starting code-server with workspace name: ${WORKSPACE_NAME:-workspace}"
WELCOME_MARK_DIR="/home/coder/workspace/.devfarm"
WELCOME_MARK_FILE="$WELCOME_MARK_DIR/.welcome_opened"
mkdir -p "$WELCOME_MARK_DIR"

# Open workspace folder, and if first run, also open WELCOME.md
# The workbench.editorAssociations setting will open it in preview mode
OPEN_PATHS=("/home/coder/workspace")
if [ -f "$WELCOME_PATH" ] && [ ! -f "$WELCOME_MARK_FILE" ]; then
    echo "Opening WELCOME.md in preview mode on first run"
    OPEN_PATHS+=("$WELCOME_PATH")
    touch "$WELCOME_MARK_FILE"
fi

exec /usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth none "${OPEN_PATHS[@]}"
