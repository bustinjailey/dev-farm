# MCP Server Verification Guide

This guide explains how to verify that MCP servers are properly configured for both **GitHub Copilot** and **Cline** extensions in Dev Farm environments.

## Overview

Dev Farm automatically configures MCP servers in **two formats** to support multiple AI tools:

1. **GitHub Copilot**: Global configuration in VS Code settings
2. **Cline Extension**: Extension-specific configuration file

Both tools have access to the same three MCP servers:

- **filesystem**: Browse and read workspace files
- **github**: GitHub API integration (requires `GITHUB_TOKEN`)
- **brave-search**: Web search capabilities (requires `BRAVE_API_KEY`)

## Configuration Locations

### GitHub Copilot (Primary)

**Global Configuration**:

```
~/.vscode-server-insiders/data/User/settings.json
```

Structure:

```json
{
  "github.copilot.chat.mcp.servers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "brave-search": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    }
  }
}
```

**Workspace Configuration** (optional override):

```
/workspace/.vscode/mcp.json
```

Same structure as global, but uses `"servers"` key at root (not `github.copilot.chat.mcp.servers`).

### Cline Extension (Secondary)

**Extension Configuration**:

```
~/.vscode-server-insiders/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
```

Structure:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "tools": ["*"]
    },
    ...
  }
}
```

**Note**: Cline uses `"mcpServers"` key (plural) vs. Copilot's `"servers"`.

## Verification Steps

### 1. Check Configuration Files

**For newly created environments** (created after 2025-10-29), configuration is automatic.

```bash
# SSH into environment container
docker exec -it devfarm-<name> bash

# Check GitHub Copilot config (global)
cat ~/.vscode-server-insiders/data/User/settings.json | grep -A 20 "github.copilot.chat.mcp.servers"

# Check Cline config
cat ~/.vscode-server-insiders/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json

# Check workspace template (optional)
cat /workspace/.vscode/mcp.json
```

### 2. Verify in GitHub Copilot

1. Open GitHub Copilot Chat in VS Code
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Type: **"MCP: List Servers"**
4. Should see:
   - ✓ **filesystem** - Browse workspace files
   - ✓ **github** - GitHub API integration
   - ✓ **brave-search** - Web search

**If servers are missing**: Check that `settings.json` exists and has correct format.

### 3. Verify in Cline

1. Open Cline extension panel
2. Check settings/configuration tab
3. Look for MCP servers section
4. Should show same 3 servers

### 4. Test MCP Functionality

**Filesystem Server**:

```
@copilot Can you read the package.json file in my workspace?
```

Should successfully read and summarize the file.

**GitHub Server** (if `GITHUB_TOKEN` is set):

```
@copilot Show me my recent GitHub repositories
```

**Brave Search Server** (if `BRAVE_API_KEY` is set):

```
@copilot Search the web for "Docker best practices"
```

## Troubleshooting

### Missing Configuration Files

**Symptom**: Configuration files don't exist in expected locations.

**Solution**: Containers created before 2025-10-29 won't have MCP configured. Options:

1. **Recreate the environment** (destroys workspace data):

   ```bash
   # From dashboard UI: Delete environment and create new one
   ```

2. **Manually trigger startup script** (preserves data):

   ```bash
   docker exec -it devfarm-<name> bash -c "cd ~ && bash startup.sh"
   ```

3. **Manual configuration** (advanced):

   ```bash
   # Copy templates
   docker exec devfarm-<name> cp /home/coder/.devfarm/mcp-cline.json \
     ~/.vscode-server-insiders/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json

   # Run Python script to merge Copilot config into settings.json
   # (see startup.sh lines 45-65 for exact script)
   ```

### Servers Not Showing in Copilot

**Symptom**: "MCP: List Servers" shows empty or errors.

**Possible Causes**:

1. VS Code Server not reloaded after config change
2. Syntax error in settings.json
3. Missing `npx` command (Node.js not installed)

**Solutions**:

```bash
# 1. Reload VS Code Server
# Command Palette → "Developer: Reload Window"

# 2. Check settings.json syntax
docker exec devfarm-<name> python3 -m json.tool ~/.vscode-server-insiders/data/User/settings.json

# 3. Verify Node.js/npx available
docker exec devfarm-<name> which npx
docker exec devfarm-<name> node --version
```

### Environment Variables Not Passing Through

**Symptom**: GitHub/Brave servers show errors about missing tokens.

**Cause**: `GITHUB_TOKEN` or `BRAVE_API_KEY` not set in environment.

**Solution**:

```bash
# Check environment variables in container
docker exec devfarm-<name> env | grep -E 'GITHUB_TOKEN|BRAVE_API_KEY'

# If missing, recreate environment with tokens set in dashboard UI
# Or manually set in running container (not persistent):
docker exec devfarm-<name> bash -c 'export GITHUB_TOKEN=ghp_xxx'
```

### Different Behavior Between Copilot and Cline

**Symptom**: MCP works in one tool but not the other.

**Cause**: Format differences or separate configuration paths.

**Debug**:

```bash
# Compare configurations
docker exec devfarm-<name> bash -c '
  echo "=== Copilot Config ===" &&
  cat ~/.vscode-server-insiders/data/User/settings.json | grep -A 30 github.copilot &&
  echo "" &&
  echo "=== Cline Config ===" &&
  cat ~/.vscode-server-insiders/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
'
```

Both should have same servers, just different JSON structure (`servers` vs `mcpServers`).

## Technical Details

### Runtime Initialization

MCP configuration happens in `/home/coder/startup.sh` (lines 29-100):

1. **Cline**: Simple file copy from template if settings file doesn't exist
2. **Copilot**: Python script merges MCP servers into existing settings.json (or creates new one)
3. **Workspace**: Optional `.vscode/mcp.json` created as template for manual override

### Format Differences

| Aspect                | GitHub Copilot                    | Cline                   |
| --------------------- | --------------------------------- | ----------------------- |
| **Config Key**        | `github.copilot.chat.mcp.servers` | `mcpServers`            |
| **Server Structure**  | `{"servers": {...}}`              | `{"mcpServers": {...}}` |
| **Type Field**        | `"stdio"`                         | `"local"`               |
| **Additional Fields** | None                              | `"tools": ["*"]`        |

### Environment Variable Substitution

**Note**: VS Code's variable substitution syntax `${GITHUB_TOKEN}` is used in config files, but **environment variables must be set at container runtime**. The dashboard passes these through when creating containers.

## References

- **GitHub Copilot MCP Docs**: https://docs.github.com/copilot/using-github-copilot/using-extensions/managing-model-context-protocol-servers
- **Cline Extension**: https://github.com/saoudrizwan/claude-dev
- **MCP Specification**: https://modelcontextprotocol.io/
- **Available MCP Servers**: https://github.com/modelcontextprotocol

## Change History

- **2025-10-29**: Added cross-tool MCP support (commit f64fe37)
  - Copilot: Global settings.json configuration
  - Cline: Extension-specific configuration
  - Shared servers: filesystem, github, brave-search
- **2025-10-29**: Initial MCP support for Cline only (commit fbb77cc)
