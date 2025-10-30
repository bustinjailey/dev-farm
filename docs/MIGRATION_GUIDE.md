# Migration Guide: Workspace Root Restructuring

This guide helps users migrate to the new workspace root structure in Dev Farm environments.

## What Changed?

### Before (Old Structure)
```
SSH Mode:  /home/coder/workspace/remote/  (subdirectory)
Git Mode:  /home/coder/workspace/repo/    (subdirectory)
Workspace: /home/coder/workspace/         (unchanged)
```

### After (New Structure)
```
SSH Mode:  /home/coder/remote/     (direct workspace root)
Git Mode:  /home/coder/repo/       (direct workspace root)
Workspace: /home/coder/workspace/  (unchanged)
```

## Impact by Mode

### SSH Mode Users
**What Changed:**
- Remote filesystem now mounts at `/home/coder/remote` (workspace root)
- VS Code opens directly at the remote mount point
- No need to navigate to a `remote/` subdirectory

**Action Required:**
- **If you have scripts or paths hardcoded to `/home/coder/workspace/remote/`:**
  - Update them to `/home/coder/remote/`
- **If you use relative paths only:**
  - No changes needed! Relative paths continue to work.

**Benefits:**
- ✅ Cleaner directory structure
- ✅ Direct access to remote files
- ✅ More intuitive navigation

### Git Mode Users
**What Changed:**
- Repository now clones to `/home/coder/repo` (workspace root)
- VS Code opens directly at the repository root
- No need to navigate to a `repo/` subdirectory

**Action Required:**
- **If you have scripts or paths hardcoded to `/home/coder/workspace/repo/`:**
  - Update them to `/home/coder/repo/`
- **If you use relative paths only:**
  - No changes needed! Relative paths continue to work.

**Benefits:**
- ✅ Cleaner directory structure
- ✅ Direct access to repository files
- ✅ More intuitive for version control operations

### Workspace Mode Users
**What Changed:**
- Nothing! Workspace mode continues to use `/home/coder/workspace/`

**Action Required:**
- None

## New Features

### 1. Aggregate MCP Server
**What It Does:**
- Centralized Model Context Protocol proxy for all AI tools
- Automatically updates on every container restart
- Provides unified access to MCP servers (filesystem, GitHub, Brave Search, etc.)

**Location:** `/home/coder/.local/bin/aggregate-mcp-server/`

**Configuration:**
- Automatically configured in both Cline and GitHub Copilot
- Uses your GITHUB_TOKEN for private repo access
- No manual setup required!

**Benefits:**
- ✅ Always up-to-date with latest features
- ✅ Centralized management
- ✅ Simplified configuration

### 2. Machine-Level Settings
**What Changed:**
- Settings now configured at machine level (apply to all workspaces)
- Located at: `~/.vscode-server-insiders/data/Machine/settings.json`
- Workspace-level settings still supported for project-specific overrides

**Benefits:**
- ✅ Consistent configuration across all workspaces
- ✅ No need to recreate settings for each project
- ✅ Still allows per-project customization

### 3. AI Model Configuration
**Pre-configured Models:**
- All AI extensions now default to **Claude Sonnet 4.5**
- GitHub Copilot Chat
- ChatGPT extension
- Cline/Claude Dev
- Kilo Code

**Benefits:**
- ✅ Superior code understanding
- ✅ Extended context window
- ✅ Latest model capabilities
- ✅ Consistent experience across tools

## Common Migration Scenarios

### Scenario 1: Scripts with Hardcoded Paths

**Before:**
```bash
# Old script
cd /home/coder/workspace/remote/project
./deploy.sh
```

**After:**
```bash
# New script - SSH mode
cd /home/coder/remote/project
./deploy.sh

# Or use relative path (works in both old and new)
cd project
./deploy.sh
```

### Scenario 2: Git Operations

**Before:**
```bash
# Old commands
cd /home/coder/workspace/repo
git pull
git push
```

**After:**
```bash
# New commands - Git mode
cd /home/coder/repo
git pull
git push

# Or from VS Code terminal (already in repo root)
git pull
git push
```

### Scenario 3: File References in Code

**Before:**
```python
# Old code with absolute path
config_path = "/home/coder/workspace/remote/config/settings.json"
```

**After:**
```python
# New code - SSH mode
config_path = "/home/coder/remote/config/settings.json"

# Better: Use relative path (works in both)
config_path = "config/settings.json"

# Best: Use environment variable
import os
workspace_root = os.environ.get('WORKSPACE_ROOT', '/home/coder/workspace')
config_path = f"{workspace_root}/config/settings.json"
```

## Troubleshooting

### Issue: My scripts still reference old paths
**Solution:**
1. Search for hardcoded paths: `grep -r "/home/coder/workspace/remote" .`
2. Replace with new paths or use `$WORKSPACE_ROOT` environment variable
3. Test scripts in a new environment

### Issue: VS Code opens wrong directory
**Solution:**
- The `WORKSPACE_ROOT` is automatically set based on your mode
- Check logs: `cat /home/coder/workspace/.devfarm/startup.log`
- Verify mode is correct in environment variables

### Issue: MCP servers not working
**Solution:**
1. Check if GITHUB_TOKEN is set
2. Verify aggregate MCP server installation:
   ```bash
   ls -la /home/coder/.local/bin/aggregate-mcp-server/
   ```
3. Check startup logs for installation errors
4. Try recreating the environment

### Issue: Settings not applying
**Solution:**
- Settings are now at machine level
- Check: `~/.vscode-server-insiders/data/Machine/settings.json`
- Workspace-level overrides: `.vscode/settings.json` in project root
- Reload VS Code window: `Ctrl+Shift+P` → "Developer: Reload Window"

## Testing Your Migration

### For SSH Mode
```bash
# 1. Check mount point
ls -la /home/coder/remote

# 2. Verify WORKSPACE_ROOT
echo $WORKSPACE_ROOT  # Should show /home/coder/remote

# 3. Check info file
cat /home/coder/remote/DEVFARM_INFO.md
```

### For Git Mode
```bash
# 1. Check repository location
ls -la /home/coder/repo

# 2. Verify WORKSPACE_ROOT
echo $WORKSPACE_ROOT  # Should show /home/coder/repo

# 3. Check git status
cd /home/coder/repo
git status

# 4. Check info file
cat /home/coder/repo/DEVFARM_INFO.md
```

### For Workspace Mode
```bash
# 1. Check workspace
ls -la /home/coder/workspace

# 2. Verify WORKSPACE_ROOT
echo $WORKSPACE_ROOT  # Should show /home/coder/workspace
```

## Rollback Instructions

If you need to revert to the old structure:

1. **Stop the environment** through the Dev Farm dashboard
2. **Contact your administrator** to revert the Docker configuration
3. **Your data is safe** - files in SSH/Git modes are on remote systems or in repositories

## Benefits Summary

### Cleaner Structure
- ✅ No more nested subdirectories
- ✅ Direct workspace access
- ✅ Intuitive file navigation

### Better AI Integration
- ✅ Aggregate MCP server with auto-updates
- ✅ Claude Sonnet 4.5 by default
- ✅ Kilo Code extension included

### Improved Configuration
- ✅ Machine-level settings (consistent across workspaces)
- ✅ Workspace-level overrides when needed
- ✅ Environment variable support

## Support

Need help with migration?
- Check the startup logs: `/home/coder/workspace/.devfarm/startup.log`
- Review the implementation plan: [`docs/IMPLEMENTATION_PLAN_MCP_AND_WORKSPACE.md`](IMPLEMENTATION_PLAN_MCP_AND_WORKSPACE.md)
- See architecture diagrams: [`docs/ARCHITECTURE_DIAGRAM.md`](ARCHITECTURE_DIAGRAM.md)

## Version Information

- **Migration Date:** 2025-01-30
- **Affected Environments:** All new environments created after this date
- **Backward Compatibility:** Old environments continue to work until recreated