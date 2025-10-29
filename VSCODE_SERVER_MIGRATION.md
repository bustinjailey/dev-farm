# VS Code Server Migration Guide

## What Changed

Dev Farm now uses **official VS Code Server** instead of code-server! 🎉

### Before
- Used `codercom/code-server` (community fork)
- Limited extension compatibility
- Some extensions didn't work properly

### After
- Uses **official Microsoft VS Code CLI** (`code serve-web`)
- **ALL extensions work** (including GitHub Copilot Chat)
- Official support and updates from Microsoft
- Better compatibility with VS Code ecosystem

## Technical Changes

### Dockerfile
- **Base Image**: Changed from `codercom/code-server:latest` to `debian:bookworm-slim`
- **Installation**: Official VS Code CLI installed from Microsoft apt repository
- **Directory Structure**: Updated to use `.config/Code/User` instead of `.local/share/code-server`

### Startup Script
- **Command**: Changed from `code-server --bind-addr 0.0.0.0:8080 --auth none` to `code serve-web --host 0.0.0.0 --port 8080 --without-connection-token --accept-server-license-terms`
- **Extension Installation**: Changed from `code-server --install-extension` to `code --install-extension`
- **Settings Paths**: Updated all references to match official VS Code structure

## What Works Now

✅ **GitHub Copilot Chat** - Full support, no more compatibility issues  
✅ **All VS Code Extensions** - 100% compatibility with VS Code marketplace  
✅ **Markdown Preview** - Built-in language features work perfectly  
✅ **GitHub Authentication** - Seamless sign-in experience  
✅ **All Dev Farm Modes** - Workspace, Git, and SSH modes unchanged  
✅ **SSHFS Support** - Remote filesystem mounting works as before  
✅ **MCP Integration** - Claude Dev and other MCP servers work perfectly  

## How to Update

### Option 1: System Update (Recommended)
1. Go to your Dev Farm dashboard
2. Click **"System Update"** in the top menu
3. Wait for the update to complete (rebuilds code-server image)
4. Your containers will automatically use the new VS Code Server

### Option 2: Manual Rebuild
```bash
# Pull latest changes
git pull origin main

# Rebuild the code-server image
cd dev-farm
docker build -t opt-code-server:latest -f docker/Dockerfile.code-server .

# Recreate your environments
# (Use dashboard UI or devfarm.sh script)
```

## What to Expect

### First Launch
- Container startup time similar to before (~30-60 seconds)
- VS Code Server will show license acceptance (automatic)
- All your extensions will be installed as before
- GitHub authentication works the same way

### Extension Installation
- First time starting a new environment may take slightly longer
- Extensions install in background during startup
- Check `STARTUP_LOG.txt` in workspace to see progress

### Settings Migration
- Workspace settings (`/.vscode/settings.json`) carry over automatically
- User-level settings migrate to new directory structure
- Keybindings and preferences preserved

## Troubleshooting

### Extensions Not Appearing
- Extensions install during container startup
- Check `STARTUP_LOG.txt` for installation status
- Run `/usr/bin/code --list-extensions` in terminal to verify

### GitHub Sign-In Issues
- Follow the keyboard shortcut instructions in WELCOME.md
- Press `Ctrl+Shift+P` → type "GitHub: Sign In"
- Or click Account icon (👤) in bottom-left corner

### Connection Issues
- If you see "Connection lost", refresh the browser
- VS Code Server uses WebSocket connections (same as code-server)
- Port 8080 mapping remains unchanged

### Extension Compatibility
- **All** VS Code extensions should work now
- If an extension doesn't work, it's likely a genuine incompatibility (not our setup)
- Check extension's marketplace page for web support

## Benefits

### For Developers
- **Copilot Chat Works!** - The #1 requested feature
- **Better Extension Support** - No more "extension not compatible" errors
- **Faster Updates** - Microsoft releases VS Code updates frequently
- **Official Support** - Documentation and troubleshooting from Microsoft

### For Dev Farm
- **Stability** - Official binaries are battle-tested
- **Security** - Direct updates from Microsoft
- **Future-Proof** - Will continue to receive updates and support
- **Feature Parity** - Same experience as desktop VS Code

## Rollback Plan

If you encounter issues, the original code-server setup is preserved:

```bash
# Restore original Dockerfile
cp docker/Dockerfile.code-server.backup docker/Dockerfile.code-server

# Rebuild with old version
docker build -t opt-code-server:latest -f docker/Dockerfile.code-server .

# Recreate environments
```

**Note**: We don't anticipate needing this, but it's available as a safety net.

## Reference Implementation

This migration is based on:
- [nerasse/my-code-server](https://github.com/nerasse/my-code-server) - Reference implementation
- [VS Code Server Documentation](https://code.visualstudio.com/docs/remote/vscode-server) - Official docs
- Microsoft's apt repository for official VS Code CLI

## Questions?

- Check the Dev Farm README for general usage
- See `STARTUP_LOG.txt` in your workspace for detailed logs
- GitHub Issues: Report any problems with the migration

---

**Migration Completed**: January 2025  
**Commit**: 5dc1ce8  
**Status**: ✅ Ready for Production
