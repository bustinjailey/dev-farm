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

# VS Code workspace files (user-specific)
.vscode/
.devfarm/

# OS files
.DS_Store
Thumbs.db
GITIGNORE

echo "Applying VS Code Insiders workspace settings..."
# VS Code Insiders Server uses ~/.vscode-server-insiders/data/ for settings
mkdir -p /home/coder/.vscode-server-insiders/data/Machine
mkdir -p /home/coder/.vscode-server-insiders/data/User

# ============================================================================
# Configure MCP Servers (Unified User Settings)
# ============================================================================
# All AI tools (Copilot, Cline, etc.) use the same MCP config from User settings.json
# This simplifies management and ensures consistency across all tools.

VSCODE_SETTINGS_FILE="/home/coder/.vscode-server-insiders/data/User/settings.json"

if [ -f /home/coder/.devfarm/mcp-copilot.json ]; then
    echo "Configuring MCP servers in User settings (applies to all AI tools)..."
    /usr/bin/python3 - <<PYEOF
import json, os

settings_path = "/home/coder/.vscode-server-insiders/data/User/settings.json"
mcp_template_path = "/home/coder/.devfarm/mcp-copilot.json"

# Get environment variables
github_token = os.environ.get('GITHUB_TOKEN', '')
workspace_root = os.environ.get('WORKSPACE_ROOT', '/home/coder/workspace')
brave_api_key = os.environ.get('BRAVE_API_KEY', '')

# Load existing settings or create empty dict
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
else:
    settings = {}

# Load MCP configuration template
with open(mcp_template_path, 'r') as f:
    mcp_config_str = f.read()

# Expand environment variables
mcp_config_str = mcp_config_str.replace('\${GITHUB_TOKEN}', github_token)
mcp_config_str = mcp_config_str.replace('\${WORKSPACE_ROOT}', workspace_root)
mcp_config_str = mcp_config_str.replace('\${BRAVE_API_KEY}', brave_api_key)

mcp_config = json.loads(mcp_config_str)

# Configure for GitHub Copilot
settings["github.copilot.chat.mcp.servers"] = mcp_config["servers"]

# Configure for Cline (uses same servers, different key format)
settings["cline.mcpServers"] = mcp_config["servers"]

# Write back
os.makedirs(os.path.dirname(settings_path), exist_ok=True)
with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)

print("✓ MCP servers configured in User settings.json")
print("  - GitHub Copilot: github.copilot.chat.mcp.servers")
print("  - Cline: cline.mcpServers")
PYEOF
    chown coder:coder "$VSCODE_SETTINGS_FILE"
fi

echo "MCP configuration complete - unified settings for all AI tools"

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
    allowed_paths = ['/home/coder/repo']
elif dev_mode == 'ssh':
    allowed_paths = ['/home/coder/remote']
else:  # workspace mode
    allowed_paths = ['/home/coder/workspace']

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

# Ensure minimal user-level settings for features that require user scope (workspace trust)
# VS Code Server uses Machine/settings.json for machine-level settings
/usr/bin/python3 - <<'PYEOF'
import json, os
# Machine-level settings (used by VS Code Insiders Server)
machine_settings_path = "/home/coder/.vscode-server-insiders/data/Machine/settings.json"
os.makedirs(os.path.dirname(machine_settings_path), exist_ok=True)
existing = {}
if os.path.exists(machine_settings_path):
    try:
        with open(machine_settings_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
    except Exception:
        existing = {}
# Enforce: disable workspace trust prompts globally (must be user scope)
existing["security.workspace.trust.enabled"] = False
existing["security.workspace.trust.startupPrompt"] = "never"
existing["security.workspace.trust.emptyWindow"] = False
# Explicitly trust the workspace and parent folder
existing["security.workspace.trust.trustedFolders"] = [
    "/home/coder/workspace",
    "/home/coder"
]
with open(machine_settings_path, 'w', encoding='utf-8') as f:
    json.dump(existing, f, indent=2)
print("Machine-level settings updated for VS Code Server")
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

## 💡 Tips

- Git and the GitHub CLI (gh) are pre-authenticated if you connected GitHub in the dashboard
- Press `Ctrl+`` (backtick) to open the integrated terminal
- Press `Ctrl+Shift+E` to focus the file explorer
- Press `Ctrl+P` to quickly open files

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
        git fetch origin main 2>&1 | tee -a "$LOG_FILE" || true
        AFTER_HASH=$(git rev-parse origin/main 2>/dev/null || echo "none")
        
        if [ "$BEFORE_HASH" != "$AFTER_HASH" ] && [ "$AFTER_HASH" != "none" ]; then
            echo "Updates found, pulling latest version..." | tee -a "$LOG_FILE"
            git pull origin main 2>&1 | tee -a "$LOG_FILE"
            npm install 2>&1 | tee -a "$LOG_FILE"
            npm run build 2>&1 | tee -a "$LOG_FILE"
            echo "✓ Aggregate MCP server updated successfully" | tee -a "$LOG_FILE"
        else
            echo "✓ Aggregate MCP server already up to date" | tee -a "$LOG_FILE"
        fi
        
        cd /home/coder
    else
        echo "Installing aggregate MCP server from private GitHub repo..." | tee -a "$LOG_FILE"
        # Clone private repo using SSH (key was uploaded to GitHub earlier)
        git clone "$MCP_REPO_URL" "$MCP_INSTALL_DIR" 2>&1 | tee -a "$LOG_FILE"
        
        if [ -d "$MCP_INSTALL_DIR" ]; then
            cd "$MCP_INSTALL_DIR"
            npm install 2>&1 | tee -a "$LOG_FILE"
            npm run build 2>&1 | tee -a "$LOG_FILE"
            echo "✓ Aggregate MCP server installed successfully" | tee -a "$LOG_FILE"
            cd /home/coder
        else
            echo "⚠ Failed to clone aggregate MCP server repository" | tee -a "$LOG_FILE"
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
    # SSH mode - mount remote filesystem as subdirectory to preserve local workspace settings
    echo "Setting up SSHFS mount for remote filesystem (background)..." | tee -a "$LOG_FILE"

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
        # Start background mount process - don't block container startup
        (
            # Background mount function
            echo "Background SSH mount starting..." | tee -a "$LOG_FILE"
            
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
            if [ -n "${SSH_PASSWORD}" ]; then
                # For password auth, don't specify IdentityFile
                cat > /home/coder/.ssh/config <<EOF
Host remote-target
    HostName ${SSH_HOST}
    User ${SSH_USER}
    Port ${SSH_PORT}
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 15
    ServerAliveCountMax 3
    PreferredAuthentications password
EOF
            else
                # For key-based auth, specify identity file
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

            # Create mount point as workspace root
            REMOTE_MOUNT_DIR="/home/coder/remote"
            WORKSPACE_ROOT="/home/coder/remote"
            mkdir -p "$REMOTE_MOUNT_DIR"
            
            # Ensure FUSE device exists and is accessible
            if [ ! -e /dev/fuse ]; then
                echo "Error: /dev/fuse is not available in the container. SSHFS cannot mount." | tee -a "$LOG_FILE"
                cat > /home/coder/workspace/SSH_MOUNT_ERROR.md <<'EOFERR'
# SSH Mount Error

/dev/fuse device is not available in this container.

SSHFS requires FUSE support which needs the container to be started with privileged mode.
The dashboard automatically configures this for SSH mode, but the device is not available.

**Possible causes:**
- Docker doesn't have access to /dev/fuse on the host
- The host system doesn't have FUSE support enabled
- Container security policies blocking device access

**To fix:**
1. On the host, ensure FUSE is installed: `apt-get install fuse3`
2. Load the FUSE kernel module: `modprobe fuse`
3. Recreate this environment

If the issue persists, SSH mode may not be supported on this host.
EOFERR
                exit 1
            fi
            
            # Test if FUSE is actually usable (not just present)
            if ! fusermount3 -V >/dev/null 2>&1; then
                echo "Warning: fusermount3 not working properly" | tee -a "$LOG_FILE"
            fi
            # Attempt to mount remote path to subdirectory
            echo "Mounting ${SSH_USER}@${SSH_HOST}:${SSH_PATH} -> ${REMOTE_MOUNT_DIR}" | tee -a "$LOG_FILE"
            
            # Unmount if previously mounted
            if mountpoint -q "$REMOTE_MOUNT_DIR"; then
                fusermount3 -u "$REMOTE_MOUNT_DIR" || true
            fi
            
            # Mount with user mapping and reconnect options
            UID_VAL=$(id -u coder 2>/dev/null || id -u)
            GID_VAL=$(id -g coder 2>/dev/null || id -g)
            
            # Prepare SSHFS options - simplified for better compatibility
            SSHFS_OPTS="-p ${SSH_PORT}"
            # Use allow_other to allow all users to access mount (requires user_allow_other in /etc/fuse.conf)
            SSHFS_OPTS="${SSHFS_OPTS} -o allow_other"
            SSHFS_OPTS="${SSHFS_OPTS} -o default_permissions"
            SSHFS_OPTS="${SSHFS_OPTS} -o StrictHostKeyChecking=no"
            SSHFS_OPTS="${SSHFS_OPTS} -o UserKnownHostsFile=/dev/null"
            SSHFS_OPTS="${SSHFS_OPTS} -o reconnect"
            SSHFS_OPTS="${SSHFS_OPTS} -o ServerAliveInterval=15"
            SSHFS_OPTS="${SSHFS_OPTS} -o ServerAliveCountMax=3"
            SSHFS_OPTS="${SSHFS_OPTS} -o uid=${UID_VAL}"
            SSHFS_OPTS="${SSHFS_OPTS} -o gid=${GID_VAL}"
            # Add cache options for better performance
            SSHFS_OPTS="${SSHFS_OPTS} -o cache=yes"
            SSHFS_OPTS="${SSHFS_OPTS} -o kernel_cache"
            
            # Handle password authentication if provided
            if [ -n "${SSH_PASSWORD}" ]; then
                echo "Using password authentication for SSH mount" | tee -a "$LOG_FILE"
                # Note: sshpass handles password automatically, no need for password_stdin option
            else
                echo "Using key-based authentication for SSH mount" | tee -a "$LOG_FILE"
                SSHFS_OPTS="${SSHFS_OPTS} -o PasswordAuthentication=no"
                SSHFS_OPTS="${SSHFS_OPTS} -o BatchMode=yes"
            fi
            
            # Run SSHFS with timeout to prevent hanging on authentication failures
            MOUNT_SUCCESS=false
            SFTP_SETUP_ATTEMPTED=false
            
            # Test SSH connectivity FIRST before attempting any mount
            echo "Testing SSH connectivity to ${SSH_USER}@${SSH_HOST}..." | tee -a "$LOG_FILE"
            SSH_TEST_SUCCESS=false
            if [ -n "${SSH_PASSWORD}" ]; then
                export SSHPASS="${SSH_PASSWORD}"
                if timeout 10 sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                    "${SSH_USER}@${SSH_HOST}" "echo SSH_OK" 2>&1 | grep -q "SSH_OK"; then
                    SSH_TEST_SUCCESS=true
                    echo "✓ SSH connectivity confirmed" | tee -a "$LOG_FILE"
                else
                    echo "✗ SSH connectivity test failed" | tee -a "$LOG_FILE"
                fi
            else
                if timeout 10 ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                    "${SSH_USER}@${SSH_HOST}" "echo SSH_OK" 2>&1 | grep -q "SSH_OK"; then
                    SSH_TEST_SUCCESS=true
                    echo "✓ SSH connectivity confirmed" | tee -a "$LOG_FILE"
                else
                    echo "✗ SSH connectivity test failed" | tee -a "$LOG_FILE"
                fi
            fi
            
            # Only attempt mount if SSH connectivity is confirmed
            if [ "$SSH_TEST_SUCCESS" = false ]; then
                echo "Skipping SSHFS mount due to SSH connectivity failure" | tee -a "$LOG_FILE"
                cat > /home/coder/workspace/SSH_CONNECTION_ERROR.md <<EOFERR
# SSH Connection Error

Cannot connect to ${SSH_USER}@${SSH_HOST}:${SSH_PORT}

Possible causes:
- Host is unreachable or offline
- SSH credentials are incorrect
- SSH service is not running on remote host
- Firewall blocking connection
- Network connectivity issues

Check your SSH settings and try again.
EOFERR
            else
                # Attempt SSHFS mount
                if [ -n "${SSH_PASSWORD}" ]; then
                    # Use password authentication via sshpass (reads from SSHPASS env var)
                    export SSHPASS="${SSH_PASSWORD}"
                    MOUNT_OUTPUT=$(timeout 10 sshpass -e sshfs \
                            ${SSHFS_OPTS} \
                            remote-target:"${SSH_PATH}" \
                            "$REMOTE_MOUNT_DIR" 2>&1 || true)
                    MOUNT_EXIT=$?
                    echo "$MOUNT_OUTPUT" >> "$LOG_FILE" || true
                    if [ $MOUNT_EXIT -eq 0 ] && mountpoint -q "$REMOTE_MOUNT_DIR"; then
                        MOUNT_SUCCESS=true
                    fi
                else
                    # Use key-based authentication
                    MOUNT_OUTPUT=$(timeout 10 sshfs \
                            ${SSHFS_OPTS} \
                            remote-target:"${SSH_PATH}" \
                            "$REMOTE_MOUNT_DIR" 2>&1 || true)
                    MOUNT_EXIT=$?
                    echo "$MOUNT_OUTPUT" >> "$LOG_FILE" || true
                    if [ $MOUNT_EXIT -eq 0 ] && mountpoint -q "$REMOTE_MOUNT_DIR"; then
                        MOUNT_SUCCESS=true
                    fi
                fi
            fi
            
            # If mount failed, try to enable SFTP subsystem (common issue with minimal SSH servers)
            if [ "$MOUNT_SUCCESS" = false ]; then
                # Check if error suggests SFTP issue
                if echo "$MOUNT_OUTPUT" | grep -qi "subsystem\|connection reset" 2>/dev/null; then
                    echo "Mount failed - attempting to enable SFTP subsystem on remote host..." | tee -a "$LOG_FILE"
                    SFTP_SETUP_ATTEMPTED=true
                    
                    # Build the SFTP enablement command
                    SFTP_ENABLE_CMD='
                        if ! grep -q "^Subsystem.*sftp" /etc/ssh/sshd_config 2>/dev/null; then
                            echo "Subsystem sftp /usr/lib/openssh/sftp-server" | sudo tee -a /etc/ssh/sshd_config > /dev/null && \
                            sudo systemctl restart sshd 2>/dev/null || sudo service sshd restart 2>/dev/null || sudo /etc/init.d/ssh restart 2>/dev/null
                            if [ $? -eq 0 ]; then
                                echo "SFTP enabled successfully"
                                exit 0
                            else
                                echo "Failed to restart SSH service"
                                exit 1
                            fi
                        else
                            echo "SFTP already configured"
                            exit 0
                        fi
                    '
                    
                    # Execute SFTP enablement on remote host
                    if [ -n "${SSH_PASSWORD}" ]; then
                        export SSHPASS="${SSH_PASSWORD}"
                        SFTP_RESULT=$(sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                            "${SSH_USER}@${SSH_HOST}" "${SFTP_ENABLE_CMD}" 2>&1)
                        SFTP_EXIT=$?
                    else
                        SFTP_RESULT=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                            "${SSH_USER}@${SSH_HOST}" "${SFTP_ENABLE_CMD}" 2>&1)
                        SFTP_EXIT=$?
                    fi
                    
                    echo "$SFTP_RESULT" | tee -a "$LOG_FILE"
                    
                    # If SFTP was enabled, retry the mount
                    if [ $SFTP_EXIT -eq 0 ]; then
                        echo "Retrying SSHFS mount after enabling SFTP..." | tee -a "$LOG_FILE"
                        sleep 5  # Give SSH service more time to restart
                        
                        # Test SSH connectivity before retrying mount
                        echo "Testing SSH connectivity..." | tee -a "$LOG_FILE"
                        SSH_TEST_SUCCESS=false
                        for i in {1..3}; do
                            if [ -n "${SSH_PASSWORD}" ]; then
                                if sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                                    "${SSH_USER}@${SSH_HOST}" "echo connected" 2>&1 | grep -q "connected"; then
                                    SSH_TEST_SUCCESS=true
                                    break
                                fi
                            else
                                if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
                                    "${SSH_USER}@${SSH_HOST}" "echo connected" 2>&1 | grep -q "connected"; then
                                    SSH_TEST_SUCCESS=true
                                    break
                                fi
                            fi
                            echo "SSH connection test attempt $i failed, waiting..." | tee -a "$LOG_FILE"
                            sleep 2
                        done
                        
                        if [ "$SSH_TEST_SUCCESS" = true ]; then
                            echo "SSH connectivity confirmed, attempting mount..." | tee -a "$LOG_FILE"
                            if [ -n "${SSH_PASSWORD}" ]; then
                                export SSHPASS="${SSH_PASSWORD}"
                                RETRY_OUTPUT=$(timeout 10 sshpass -e sshfs \
                                        ${SSHFS_OPTS} \
                                        remote-target:"${SSH_PATH}" \
                                        "$REMOTE_MOUNT_DIR" 2>&1 || true)
                                RETRY_EXIT=$?
                                echo "$RETRY_OUTPUT" >> "$LOG_FILE" || true
                                if [ $RETRY_EXIT -eq 0 ] && mountpoint -q "$REMOTE_MOUNT_DIR"; then
                                    MOUNT_SUCCESS=true
                                fi
                            else
                                RETRY_OUTPUT=$(timeout 10 sshfs \
                                        ${SSHFS_OPTS} \
                                        remote-target:"${SSH_PATH}" \
                                        "$REMOTE_MOUNT_DIR" 2>&1 || true)
                                RETRY_EXIT=$?
                                echo "$RETRY_OUTPUT" >> "$LOG_FILE" || true
                                if [ $RETRY_EXIT -eq 0 ] && mountpoint -q "$REMOTE_MOUNT_DIR"; then
                                    MOUNT_SUCCESS=true
                                fi
                            fi
                        else
                            echo "SSH connectivity test failed after SFTP enablement" | tee -a "$LOG_FILE"
                        fi
                    else
                        echo "Failed to enable SFTP on remote host (exit code: $SFTP_EXIT)" | tee -a "$LOG_FILE"
                    fi
                fi
            fi
            
            # Clean up password env var
            if [ -n "${SSH_PASSWORD}" ]; then
                unset SSHPASS
            fi
            
            if [ "$MOUNT_SUCCESS" = true ] && mountpoint -q "$REMOTE_MOUNT_DIR"; then
                echo "SSHFS mount successful at ${REMOTE_MOUNT_DIR}" | tee -a "$LOG_FILE"
                cat > "${REMOTE_MOUNT_DIR}/DEVFARM_INFO.md" <<EOF
# 🔗 Remote SSH Mode

Successfully connected to **${SSH_HOST}**!

## Mounted Location
This directory IS the remote filesystem from **${SSH_USER}@${SSH_HOST}:${SSH_PATH}**

## Connection Details
- **Host**: ${SSH_HOST}:${SSH_PORT}
- **User**: ${SSH_USER}
- **Remote Path**: ${SSH_PATH}

## VS Code Workspace
This directory is your VS Code workspace root - you're working directly on remote files.

## Tips
- Files are edited live on the remote host
- Changes are synchronized automatically via SSHFS
- If connection is lost, the mount will attempt to reconnect
- Use the terminal to run commands on the remote host

Happy coding! 🚀
EOF
            else
                echo "SSHFS mount failed. Remote filesystem not available." | tee -a "$LOG_FILE"
                rmdir "$REMOTE_MOUNT_DIR" 2>/dev/null || true
                
                # Create appropriate error message based on whether SFTP setup was attempted
                if [ "$SFTP_SETUP_ATTEMPTED" = true ]; then
                    cat > /home/coder/workspace/SSHFS_ERROR.md <<EOF
# 🔌 SSH Mount Failed

We attempted to mount **${SSH_USER}@${SSH_HOST}:${SSH_PATH}** to \`workspace/remote/\` but the connection failed.

## SFTP Auto-Configuration Attempted
The system detected that SFTP was not enabled on the remote host and attempted to enable it automatically. This requires:
- **Sudo access** on the remote host for user ${SSH_USER}
- **Write access** to /etc/ssh/sshd_config
- **Permission** to restart the SSH service

## What You Can Do
1. **Manual SFTP Setup**: SSH to the remote host and run:
   \`\`\`bash
   echo 'Subsystem sftp /usr/lib/openssh/sftp-server' | sudo tee -a /etc/ssh/sshd_config
   sudo systemctl restart sshd
   \`\`\`
2. **Check Permissions**: Ensure ${SSH_USER} has sudo access or ask your system administrator
3. **Verify Configuration**: Check if SFTP line exists in /etc/ssh/sshd_config
4. **Test Connection**: Use the integrated terminal:
   \`\`\`bash
   ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} "grep sftp /etc/ssh/sshd_config"
   \`\`\`
5. **Check Logs**: See .devfarm/startup.log for detailed error messages

## Current Status
Your workspace is running with **local storage only**. Once SFTP is enabled, recreate this environment to mount the remote filesystem at \`workspace/remote/\`.

For now, you can still use this environment to write code locally! 🚀
EOF
                else
                    cat > /home/coder/workspace/SSHFS_ERROR.md <<EOF
# 🔌 SSH Mount Failed

We attempted to mount **${SSH_USER}@${SSH_HOST}:${SSH_PATH}** to \`workspace/remote/\` but the connection failed.

## Common Causes
- **Authentication**: SSH key not provided or password incorrect
  - Add your SSH private key via the dashboard's environment settings
  - Or verify the SSH password is correct
- **Network**: Cannot reach ${SSH_HOST}:${SSH_PORT}
  - Check firewall rules and network connectivity
- **Permissions**: Missing FUSE support in container
  - Requires /dev/fuse device and SYS_ADMIN capability (automatically configured)
- **SFTP Not Available**: Remote host doesn't support SFTP
  - The auto-enablement requires "subsystem request failed" error
  - See manual setup instructions below

## What You Can Do
1. **Test Connection**: Use the integrated terminal to run:
   \`\`\`bash
   ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST}
   \`\`\`
2. **Verify Authentication**: Ensure your SSH key or password is correct
3. **Check Logs**: See .devfarm/startup.log for detailed error messages
4. **Manual SFTP Setup** (if needed): SSH to remote host and run:
   \`\`\`bash
   echo 'Subsystem sftp /usr/lib/openssh/sftp-server' | sudo tee -a /etc/ssh/sshd_config
   sudo systemctl restart sshd
   \`\`\`

## Current Status
Your workspace is running with **local storage only**. Once authentication is configured, recreate this environment to mount the remote filesystem at \`workspace/remote/\`.

For now, you can still use this environment to write code locally! 🚀
EOF
                fi
            fi
            
            # Notify completion or failure
            if [ "$MOUNT_SUCCESS" = true ]; then
                echo "✅ Background SSH mount completed successfully" | tee -a "$LOG_FILE"
                # Mount status file is now in the mounted directory as DEVFARM_INFO.md
            else
                echo "❌ Background SSH mount failed" | tee -a "$LOG_FILE"
            fi
        ) &  # End of background subshell
        
        # Create initial status file while mount is in progress
        mkdir -p /home/coder/remote
        cat > /home/coder/remote/MOUNTING.md <<'EOF'
# ⏳ SSH Mount In Progress

The remote filesystem is being mounted in the background...

This may take a few moments. This file will be replaced with DEVFARM_INFO.md when the mount completes.

Check /home/coder/workspace/.devfarm/startup.log for details.

**VS Code is ready to use!** The mount process won't block your workspace.
EOF
        echo "SSH mount started in background. Container will start immediately." | tee -a "$LOG_FILE"
        WORKSPACE_ROOT="/home/coder/remote"
    fi
else
    # Workspace mode (default) - just use the empty workspace
    echo "Using standard workspace mode"
    WORKSPACE_ROOT="/home/coder/workspace"
fi

# Export WORKSPACE_ROOT for use by VS Code Server and MCP configuration
export WORKSPACE_ROOT
echo "Workspace root set to: ${WORKSPACE_ROOT}" | tee -a "$LOG_FILE"

# Create WELCOME.md in the workspace root (unless it's SSH/Git mode with custom info files)
if [ "${DEV_MODE}" = "workspace" ]; then
    if [ ! -f "${WORKSPACE_ROOT}/WELCOME.md" ] || [ "${DEVFARM_FORCE_WELCOME}" = "true" ]; then
        create_welcome_file "${WORKSPACE_ROOT}"
    fi
fi

# (Workspace settings seeding moved earlier to honor template and avoid duplicate writes)

# Install essential extensions with retry logic
echo "Installing default extensions..." | tee -a "$LOG_FILE"

install_extension_with_retry() {
    local ext_id="$1"
    local max_attempts=3
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        echo "Installing $ext_id (attempt $attempt/$max_attempts)..." | tee -a "$LOG_FILE"
        
        # Capture output and check for both exit code and error messages
        local output
        output=$(/usr/bin/code-insiders --install-extension "$ext_id" 2>&1)
        local exit_code=$?
        
        # Log the output
        echo "$output" | tee -a "$LOG_FILE"
        
        # Check for success: exit code 0 AND no "Error while installing" or "not compatible" messages
        if [ $exit_code -eq 0 ] && ! echo "$output" | grep -qi "error while installing\|not compatible\|failed installing"; then
            echo "✓ Successfully installed $ext_id" | tee -a "$LOG_FILE"
            return 0
        else
            if echo "$output" | grep -qi "not compatible"; then
                echo "⚠ $ext_id is not compatible with this version of VS Code" | tee -a "$LOG_FILE"
                return 1
            fi
            
            if [ $attempt -lt $max_attempts ]; then
                echo "Retrying in 2 seconds..." | tee -a "$LOG_FILE"
                sleep 2
            fi
            attempt=$((attempt + 1))
        fi
    done
    
    echo "⚠ Failed to install $ext_id after $max_attempts attempts" | tee -a "$LOG_FILE"
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
if /usr/bin/code-insiders --install-extension "github.copilot-chat" --pre-release 2>&1 | tee -a "$LOG_FILE"; then
    echo "✓ Successfully installed github.copilot-chat (pre-release)" | tee -a "$LOG_FILE"
else
    echo "⚠ Failed to install github.copilot-chat pre-release, trying stable version..." | tee -a "$LOG_FILE"
    install_extension_with_retry "github.copilot-chat" || true
fi

# AI Assistants
install_extension_with_retry "continue.continue" || true  # Continue.dev AI assistant
install_extension_with_retry "saoudrizwan.claude-dev" || true  # Cline (formerly Claude Dev)

# General utilities
install_extension_with_retry "eamodio.gitlens" || true  # GitLens
install_extension_with_retry "esbenp.prettier-vscode" || true  # Prettier

echo "Extension installation complete" | tee -a "$LOG_FILE"

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

# Start VS Code Server with mode-specific workspace root
echo "Starting VS Code Server with workspace: ${WORKSPACE_ROOT}" | tee -a "$LOG_FILE"

# Ensure workspace directory exists
mkdir -p "${WORKSPACE_ROOT}"

# Start official VS Code Insiders Server with serve-web command
# Accept server license terms automatically
# Disable telemetry to reduce network noise and log clutter
# Pass workspace folder as positional argument at end
exec /usr/bin/code-insiders serve-web --host 0.0.0.0 --port 8080 \
  --server-data-dir /home/coder/.vscode-server-insiders \
  --without-connection-token \
  --accept-server-license-terms \
  --disable-telemetry \
  "${WORKSPACE_ROOT}"
