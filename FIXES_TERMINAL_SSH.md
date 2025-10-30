# Terminal and SSH Mode Fixes

## Issues Fixed

### 1. Terminal Mode Image Building Error

**Problem:**
```
Error: 404 Client Error for http+docker://localhost/v1.51/images/create?tag=latest&fromImage=dev-farm%2Fterminal: Not Found
```

**Root Cause:**
- The terminal image was never built
- Dashboard tried to pull a non-existent image instead of building it
- Image building wasn't integrated into the container creation flow

**Solution:**
1. **Updated `docker-compose.yml`**: Added proper terminal-builder service configuration
2. **Updated `dashboard/app.py`**: 
   - Added automatic image building when terminal mode is selected
   - Image is built using `docker compose build terminal-builder` for consistency
   - Falls back to building if image doesn't exist
3. **Updated `scripts/devfarm.sh`**: 
   - Added support for building terminal image: `./scripts/devfarm.sh build terminal`
   - Added `build all` command to build both code-server and terminal images
   - Integrated into setup process

**Usage:**
```bash
# Build terminal image
./scripts/devfarm.sh build terminal

# Build all images
./scripts/devfarm.sh build all

# Setup (builds all images)
./scripts/devfarm.sh setup
```

### 2. SSH Mode SSHFS Mounting Issues

**Problem:**
```
SSHFS mount failed. Remote filesystem not available.
modprobe: can't change directory to '/lib/modules': No such file or directory
```

**Root Causes:**
- FUSE device not properly detected or accessible
- SSHFS options too strict causing mount failures
- Home Assistant OS doesn't support traditional kernel module loading
- Insufficient error handling and diagnostics

**Solutions:**

#### A. Enhanced FUSE Detection
- Added check for `/dev/fuse` existence AND accessibility
- Added test for `fusermount3` functionality
- Better error messages explaining FUSE requirements

#### B. Improved SSHFS Options
- Simplified options for better compatibility
- Added `allow_other` for multi-user access
- Added `default_permissions` for proper permission handling
- Improved caching options for better performance
- Removed problematic options that can cause issues

**New SSHFS Options:**
```bash
-o allow_other              # Allow all users to access mount
-o default_permissions      # Let kernel handle permissions
-o StrictHostKeyChecking=no # Skip host key verification
-o reconnect                # Auto-reconnect on connection loss
-o ServerAliveInterval=15   # Keep connection alive
-o cache=yes                # Enable caching
-o kernel_cache             # Use kernel cache
```

#### C. Home Assistant OS Special Case

**Understanding the Error:**
The error `modprobe: can't change directory to '/lib/modules': No such file or directory` indicates you're trying to mount FROM Home Assistant OS, which is a special case:

**Home Assistant OS Characteristics:**
- Runs as a minimal container-based system
- Does NOT have `/lib/modules` directory
- Cannot load kernel modules via `modprobe`
- Designed to run add-ons/containers, not to be mounted as a filesystem
- FUSE support is not exposed for external mounting

**Why SSH Mode Won't Work with Home Assistant OS:**
SSH mode with SSHFS will NOT work when the remote host is Home Assistant OS because:
1. Home Assistant OS doesn't expose FUSE capabilities to external systems
2. It's designed to run containers, not to be mounted as a filesystem
3. The system is intentionally minimal and doesn't include development tools
4. Security policies prevent filesystem-level access

**Alternative Solutions for Home Assistant:**

1. **Use Git Mode Instead (RECOMMENDED)**
   ```bash
   # If your Home Assistant config is in a git repo
   # Clone it locally and work on it
   # Push changes back when done
   ```

2. **Use VSCode SSH Remote Extension**
   - Connect directly via SSH to Home Assistant
   - Edit files in place without mounting
   - More reliable for container-based systems
   - Create a regular workspace or code-server environment
   - Use the SSH extension to connect to Home Assistant

3. **Access via Samba/SMB** (if enabled)
   - Mount via CIFS instead of SSHFS
   - Requires Samba add-on installed in Home Assistant
   - Use your local machine's filesystem to mount the share

**For Regular Linux Systems:**
If your remote host is a regular Linux system (Ubuntu, Debian, etc.), SSH mode should work fine. Ensure:
```bash
# On the remote host (not Home Assistant)
sudo apt-get install fuse3
# FUSE module should already be loaded in kernel
```

#### D. Container Configuration
The dashboard automatically sets `privileged: true` for SSH mode containers to ensure FUSE access on supported systems.

### 3. VS Code Extensions Configuration

**Problem:**
```
Error while installing extension github.copilot-chat: This extension is using the API proposals 
'chatParticipantPrivate', 'languageModelDataPart' and 'chatSessionsProvider' that are not compatible 
with the current version of VS Code.

Extension 'kilocode.kilocode' not found.
```

**Root Cause:**
- Some extensions were using incorrect publisher IDs
- Extension compatibility varies with VS Code Insiders builds
- Missing useful productivity extensions

**Solution:**
Updated `docker/config/startup.sh` with correct extension IDs and a better selection:

**Remote Development:**
- `ms-vscode-remote.remote-ssh` - Remote SSH development

**GitHub Copilot (Official):**
- `github.copilot` - GitHub Copilot code completion
- `github.copilot-chat` - GitHub Copilot Chat (installs if compatible)

**AI Assistants:**
- `continue.continue` - Continue.dev AI coding assistant  
- `saoudrizwan.claude-dev` - Cline (Claude Dev) AI assistant

**Utilities:**
- `yzhang.markdown-all-in-one` - Markdown editing
- `eamodio.gitlens` - Git visualization and insights
- `esbenp.prettier-vscode` - Code formatter

**Note:** Extensions use `|| true` so if one fails (e.g., due to API incompatibility), installation continues with others. This ensures maximum compatibility across different VS Code Insiders builds.

### 4. VS Code Server Startup Issue

**Problem:**
```
error: unexpected argument '--default-folder' found
```

**Root Cause:**
- The `--default-folder` flag is not supported by `code-insiders serve-web` command
- This caused containers to fail to start properly

**Solution:**
Removed the `--default-folder` parameter from the VS Code Server startup command in `docker/config/startup.sh`.

The workspace folder is now set through other mechanisms (environment variables and workspace settings).

## Testing

### Test Terminal Mode
```bash
# 1. Build terminal image
./scripts/devfarm.sh build terminal

# 2. Create a terminal environment via dashboard
#    - Select "Terminal" mode
#    - Verify container starts successfully
#    - Access web terminal on assigned port
```

### Test SSH Mode (Regular Linux Hosts Only)
```bash
# SSH mode is for regular Linux systems, NOT Home Assistant OS

# 1. Verify remote host is a regular Linux system (Ubuntu, Debian, etc.)
# 2. Ensure FUSE is available on remote host:
ssh user@remote-host "which fusermount3"

# 3. Create SSH environment via dashboard
#    - Provide SSH host, user, and credentials  
#    - Verify container starts successfully
#    - Check logs for mount status
#    - Verify remote filesystem is accessible at /home/coder/remote

# For Home Assistant: Use Git mode or workspace mode with SSH extension instead
```

### Test Extensions
```bash
# 1. Create any environment
# 2. Wait for container to fully start
# 3. Access VS Code in browser
# 4. Check Extensions panel - should see:
#    - Remote SSH
#    - Markdown All in One
#    - GitHub Copilot (if compatible)
#    - GitHub Copilot Chat (if compatible)
#    - Continue.dev
#    - Cline (Claude Dev)
#    - GitLens
#    - Prettier
```

## Migration Notes

### For Existing Environments

**Terminal Mode:**
- Old terminal environments will need to be recreated after building the image
- Run: `./scripts/devfarm.sh build terminal`

**SSH Mode:**
- Existing SSH environments should be recreated to use new mount options
- **IMPORTANT:** Do not use SSH mode for Home Assistant OS - use Git or Workspace mode instead
- For regular Linux hosts, ensure FUSE is available

**Extensions:**
- Extensions will auto-install on next environment creation
- Incompatible extensions are automatically skipped
- New environments will have the updated extension set

## Home Assistant Specific Guidance

### Recommended Workflow for Home Assistant Development

1. **Use Git Mode** (Best Option):
   ```bash
   # Create a git environment pointing to your Home Assistant config repo
   # Work on configuration files locally
   # Commit and push changes back to Home Assistant
   ```

2. **Use Workspace Mode with SSH Extension**:
   ```bash
   # Create a regular workspace environment
   # Install Remote SSH extension (already included)
   # Connect to Home Assistant via SSH directly from VS Code
   # Edit files in place without SSHFS mounting
   ```

3. **Use Samba/SMB** (if configured):
   ```bash
   # Mount Home Assistant config via SMB on your local machine
   # Work with files directly
   # Changes sync automatically
   ```

### Why Not SSH Mode for Home Assistant?
- Home Assistant OS is a minimal container OS
- It doesn't expose FUSE for filesystem mounting
- System is designed to run containers, not to be developed "on"
- SSH mode requires full Linux with FUSE support

## Future Improvements

1. **Terminal Mode:**
   - Add CLI AI tools (aichat, gh copilot)
   - Add tmux/screen for session management
   - Improve terminal customization options

2. **SSH Mode:**
   - Add detection for Home Assistant OS with helpful error message
   - Add support for SSH key-based auth via file upload
   - Implement mount health monitoring and auto-recovery
   - Add bandwidth/latency indicators

3. **Extensions:**
   - Monitor VS Code Insiders updates for extension compatibility
   - Add extension marketplace integration in dashboard
   - Allow custom extension lists per environment

## Related Files

- `docker-compose.yml` - Terminal builder service
- `dashboard/app.py` - Image building logic, container creation
- `docker/config/startup.sh` - Extension installation, SSHFS mounting
- `docker/Dockerfile.terminal` - Terminal image definition
- `scripts/devfarm.sh` - Build commands and setup