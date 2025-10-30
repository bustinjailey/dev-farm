# Implementation Plan: Aggregate MCP Server & Workspace Root Restructuring

This document outlines the architectural changes needed to:
1. Add the aggregate MCP server with auto-update functionality
2. Restructure workspace roots to be mode-specific

## Overview

### Current Architecture
```
/home/coder/workspace/          # VS Code workspace root (all modes)
├── .vscode/                    # Workspace settings
├── remote/                     # SSH mode mount point (subdirectory)
├── repo/                       # Git mode clone location (subdirectory)
└── WELCOME.md                  # Welcome file
```

### New Architecture
```
SSH Mode:
/home/coder/remote/             # VS Code workspace root = SSH mount point
└── (remote filesystem)

Git Mode:
/home/coder/repo/               # VS Code workspace root = Git clone
└── (cloned repository)

Workspace Mode:
/home/coder/workspace/          # VS Code workspace root (unchanged)
└── (local files)
```

## Part 1: Aggregate MCP Server Integration

### Installation Strategy

**Location**: `/home/coder/.local/bin/aggregate-mcp-server/`

**Installation Flow**:
1. Check if GITHUB_TOKEN is available
2. Clone/pull from `https://github.com/bustinjailey/aggregate-mcp-server`
3. Install dependencies with `npm install`
4. Make executable and add to PATH

**Auto-Update Mechanism**:
- On every container startup, check for updates
- Use `git fetch origin main` to check for new commits
- If updates exist, pull and reinstall
- Log update status to startup log

### MCP Configuration

**For Cline** (mcp.json):
```json
{
  "mcpServers": {
    "aggregate": {
      "type": "local",
      "command": "node",
      "args": [
        "/home/coder/.local/bin/aggregate-mcp-server/dist/index.js"
      ],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "tools": ["*"]
    }
  }
}
```

**For GitHub Copilot** (mcp-copilot.json):
```json
{
  "servers": {
    "aggregate": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/coder/.local/bin/aggregate-mcp-server/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Startup Script Changes

Add to `startup.sh` (before extension installation):

```bash
# ============================================================================
# Install/Update Aggregate MCP Server
# ============================================================================

echo "Setting up Aggregate MCP Server..." | tee -a "$LOG_FILE"

MCP_INSTALL_DIR="/home/coder/.local/bin/aggregate-mcp-server"
MCP_REPO_URL="https://github.com/bustinjailey/aggregate-mcp-server.git"

if [ -n "${GITHUB_TOKEN}" ]; then
    mkdir -p /home/coder/.local/bin
    
    if [ -d "$MCP_INSTALL_DIR/.git" ]; then
        echo "Checking for aggregate MCP server updates..." | tee -a "$LOG_FILE"
        cd "$MCP_INSTALL_DIR"
        
        # Configure git to use token for authentication
        git config credential.helper store
        echo "https://${GITHUB_TOKEN}@github.com" > /home/coder/.git-credentials
        
        # Fetch updates
        BEFORE_HASH=$(git rev-parse HEAD)
        git fetch origin main 2>&1 | tee -a "$LOG_FILE" || true
        AFTER_HASH=$(git rev-parse origin/main)
        
        if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
            echo "Updates found, pulling latest version..." | tee -a "$LOG_FILE"
            git pull origin main 2>&1 | tee -a "$LOG_FILE"
            npm install 2>&1 | tee -a "$LOG_FILE"
            echo "✓ Aggregate MCP server updated successfully" | tee -a "$LOG_FILE"
        else
            echo "✓ Aggregate MCP server already up to date" | tee -a "$LOG_FILE"
        fi
    else
        echo "Installing aggregate MCP server from GitHub..." | tee -a "$LOG_FILE"
        git clone "https://${GITHUB_TOKEN}@github.com/bustinjailey/aggregate-mcp-server.git" "$MCP_INSTALL_DIR" 2>&1 | tee -a "$LOG_FILE"
        cd "$MCP_INSTALL_DIR"
        npm install 2>&1 | tee -a "$LOG_FILE"
        echo "✓ Aggregate MCP server installed successfully" | tee -a "$LOG_FILE"
    fi
    
    # Clean up credentials file
    rm -f /home/coder/.git-credentials
else
    echo "⚠ GITHUB_TOKEN not set, skipping aggregate MCP server installation" | tee -a "$LOG_FILE"
fi
```

## Part 2: Workspace Root Restructuring

### Key Changes

**1. Mode-Specific Workspace Roots**:
- SSH Mode: `/home/coder/remote` (direct mount)
- Git Mode: `/home/coder/repo` (direct clone)
- Workspace Mode: `/home/coder/workspace` (unchanged)

**2. Settings Location**:
- Move from workspace `.vscode/settings.json` to machine-level settings
- Machine settings: `/home/coder/.vscode-server-insiders/data/Machine/settings.json`
- User settings: `/home/coder/.vscode-server-insiders/data/User/settings.json`

**3. VS Code Server Startup**:
- Use environment variable `WORKSPACE_ROOT` to determine workspace path
- Pass appropriate path based on `DEV_MODE`

### Implementation Details

#### SSH Mode Refactoring

**Before**:
```bash
REMOTE_MOUNT_DIR="/home/coder/workspace/remote"
# Mount to subdirectory
sshfs ... "$REMOTE_MOUNT_DIR"
```

**After**:
```bash
REMOTE_MOUNT_DIR="/home/coder/remote"
WORKSPACE_ROOT="/home/coder/remote"
# Mount directly to workspace root
sshfs ... "$REMOTE_MOUNT_DIR"
```

#### Git Mode Refactoring

**Before**:
```bash
REPO_DIR="/home/coder/workspace/repo"
git clone "${GIT_URL}" "${REPO_DIR}"
```

**After**:
```bash
REPO_DIR="/home/coder/repo"
WORKSPACE_ROOT="/home/coder/repo"
git clone "${GIT_URL}" "${REPO_DIR}"
```

#### Workspace Mode (No Change)

```bash
WORKSPACE_ROOT="/home/coder/workspace"
```

### VS Code Server Startup Changes

**Current**:
```bash
exec /usr/bin/code-insiders serve-web --host 0.0.0.0 --port 8080 \
  --server-data-dir /home/coder/.vscode-server-insiders \
  --without-connection-token \
  --accept-server-license-terms \
  --disable-telemetry
```

**New** (with workspace parameter):
```bash
# Set workspace root based on mode
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/home/coder/workspace}"

# Ensure workspace directory exists
mkdir -p "$WORKSPACE_ROOT"

exec /usr/bin/code-insiders serve-web --host 0.0.0.0 --port 8080 \
  --server-data-dir /home/coder/.vscode-server-insiders \
  --without-connection-token \
  --accept-server-license-terms \
  --disable-telemetry \
  --default-folder="$WORKSPACE_ROOT"
```

### Settings Management

**Machine-Level Settings** (applied to all workspaces):
```json
{
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.startupPrompt": "never",
  "workbench.colorTheme": "Default Dark Modern",
  "editor.fontSize": 16,
  "github.copilot.enable": {
    "*": true
  },
  "github.copilot.chat.model": "claude-sonnet-4.5"
}
```

**Workspace-Specific Settings** (optional overrides):
Users can create `.vscode/settings.json` in their workspace if needed.

### MCP Configuration Updates

Update filesystem server path in MCP configs:

**For Cline**:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${WORKSPACE_ROOT:-/home/coder/workspace}"]
    }
  }
}
```

**For Copilot**:
```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${WORKSPACE_ROOT:-/home/coder/workspace}"]
    }
  }
}
```

## Benefits

### Aggregate MCP Server
- ✅ Always up-to-date with latest features
- ✅ Automatic updates on container restart
- ✅ Centralized MCP proxy for all tools
- ✅ Private repo support via GITHUB_TOKEN

### Workspace Root Changes
- ✅ Cleaner directory structure
- ✅ Direct access to relevant files
- ✅ No nested subdirectories to navigate
- ✅ Machine-level settings for consistency
- ✅ Better separation of concerns per mode

## Migration Strategy

### For Existing Environments

**SSH Mode Users**:
- Files will now be at workspace root instead of `/remote` subdirectory
- Update any hardcoded paths in scripts

**Git Mode Users**:
- Repository will be at workspace root instead of `/repo` subdirectory
- Update any hardcoded paths in scripts

**Workspace Mode Users**:
- No changes needed

### Backward Compatibility

Create symlinks for transition period:
```bash
# If old structure exists, create symlinks
if [ -d "/home/coder/workspace/remote" ]; then
  ln -s /home/coder/remote /home/coder/workspace/remote
fi
if [ -d "/home/coder/workspace/repo" ]; then
  ln -s /home/coder/repo /home/coder/workspace/repo
fi
```

## Testing Plan

### Phase 1: Aggregate MCP Server
1. Test installation with GITHUB_TOKEN
2. Verify MCP server starts correctly
3. Test auto-update mechanism
4. Verify integration with Cline and Copilot

### Phase 2: Workspace Root Changes
1. Test SSH mode with direct mount
2. Test Git mode with direct clone
3. Test Workspace mode (ensure no regression)
4. Verify machine-level settings apply correctly
5. Test WELCOME.md and info files in new locations

### Phase 3: Integration Testing
1. Test all modes with aggregate MCP server
2. Verify filesystem MCP server uses correct paths
3. Test extension installation and configuration
4. Verify startup performance

## Implementation Order

1. ✅ Add aggregate MCP server installation to startup.sh
2. ✅ Update MCP configuration files (mcp.json, mcp-copilot.json)
3. ✅ Refactor SSH mode to use direct mount
4. ✅ Refactor Git mode to use direct clone
5. ✅ Update VS Code Server startup with workspace parameter
6. ✅ Move settings to machine-level configuration
7. ✅ Update WELCOME.md generation for new paths
8. ✅ Test all three modes
9. ✅ Create migration documentation
10. ✅ Deploy to dev farm environments

## Files to Modify

1. **docker/config/startup.sh** - Main implementation
2. **docker/config/mcp.json** - Add aggregate server, update filesystem path
3. **docker/config/mcp-copilot.json** - Add aggregate server, update filesystem path
4. **docker/config/workspace-settings.json** - Convert to machine-level template
5. **docs/MIGRATION_GUIDE.md** - New file for users

## Rollback Plan

If issues arise:
1. Revert startup.sh changes
2. Restore old MCP configurations
3. Keep WORKSPACE_ROOT=/home/coder/workspace for all modes
4. Re-enable subdirectory structure