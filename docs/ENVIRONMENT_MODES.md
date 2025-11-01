# Development Environment Modes

Dev Farm supports three different modes for development environments, each optimized for different workflows.

## 🎯 Mode Overview

### 1. 💻 Workspace Mode (Default)

**Best for**: New projects, experimentation, sandboxes

- Starts with an empty workspace folder
- Full GitHub authentication pre-configured
- Perfect for starting from scratch
- No trust prompts - ready to code immediately

**Use cases**:

- Creating a new project from scratch
- Testing code snippets
- Learning and experimentation
- Temporary development environments

### 2. 📦 Git Repository Mode

**Best for**: Working on existing GitHub projects

- Clones a Git repository into the workspace
- Repository is ready to edit immediately
- All changes can be committed and pushed
- GitHub Copilot fully functional
- No trust prompts

**Use cases**:

- Contributing to open source projects
- Working on your own repositories
- Code reviews and testing
- Feature development

**How to use**:

1. Select "Git Repository" mode when creating environment
2. Either:
   - Enter a Git URL manually, or
   - Click "📚 Browse" to see your GitHub repositories
3. Repository will be cloned automatically on startup

### 3. 🔌 Remote SSH Mode

**Best for**: Working with existing servers or remote systems

- Uses VS Code's native Remote-SSH extension
- Connects directly to remote servers via SSH
- Edit files directly on remote systems
- Full VS Code experience on remote machines
- More reliable than SSHFS mounting
- No privileged containers required
- No trust prompts

**Use cases**:

- Managing production servers
- Working on remote development machines
- Accessing existing codebases on servers
- Remote debugging and testing

**How to use**:

1. Select "Remote SSH" mode when creating environment
2. Enter:
   - **SSH Host**: IP address or hostname (e.g., `192.168.1.100`)
   - **SSH User**: Username for SSH connection (default: `root`)
   - **SSH Password**: Password for authentication (recommended)
   - **SSH Private Key**: Alternative to password (optional)
   - **Remote Path**: Default folder to open (default: `/home`)
3. Environment will test SSH connectivity on startup
4. Open VS Code Command Palette (`Ctrl+Shift+P`)
5. Select **Remote-SSH: Connect to Host...**
6. Choose **remote-target** from the list
7. VS Code opens a new window connected to the remote host

**SSH Setup Requirements**:

- SSH server running on remote host
- SSH password OR private key configured
- The remote host must be accessible from the container
- No SFTP subsystem required (unlike SSHFS)

## 🔒 Trust Mode

All environments are configured to **always open in trusted mode**. You will never see the "Do you trust the authors of the files in this folder?" prompt.

This is configured via these settings:

```json
{
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.startupPrompt": "never",
  "security.workspace.trust.emptyWindow": false
}
```

## 🎨 Creating Environments

### Via Dashboard UI

1. Go to the dashboard: `http://192.168.1.126:5000`
2. Click "➕ Create New Environment"
3. Fill in the form:
   - **Environment Name**: Unique identifier
   - **Development Mode**: Choose workspace, git, or ssh
   - **Mode-specific fields**: (only shown for selected mode)
   - **Project Type**: Category tag (optional)
4. Click "Create"

### Via API

**Workspace Mode**:

```bash
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-workspace",
    "project": "general",
    "mode": "workspace"
  }'
```

**Git Mode**:

```bash
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-repo",
    "project": "web-app",
    "mode": "git",
    "git_url": "https://github.com/bustinjailey/my-repo.git"
  }'
```

**SSH Mode**:

```bash
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "remote-dev",
    "project": "server",
    "mode": "ssh",
    "ssh_host": "192.168.1.100",
    "ssh_user": "root",
    "ssh_path": "/opt/myproject"
  }'
```

## 📋 Environment Registry

Each environment's mode and configuration is stored in `/data/environments.json`:

```json
{
  "my-repo": {
    "container_id": "abc123...",
    "port": 8100,
    "created": "2025-10-27T...",
    "project": "web-app",
    "mode": "git",
    "git_url": "https://github.com/bustinjailey/my-repo.git"
  },
  "remote-dev": {
    "container_id": "def456...",
    "port": 8101,
    "created": "2025-10-27T...",
    "project": "server",
    "mode": "ssh",
    "ssh_host": "192.168.1.100"
  }
}
```

## 🛠️ Technical Details

### Startup Script

The `startup.sh` script handles mode initialization:

1. **GitHub Authentication** (all modes)

   - Configures git username/email
   - Authenticates with GitHub CLI
   - Sets up credential helper

2. **Mode-specific Setup**

   - **Workspace**: No additional setup
   - **Git**: Clones repository into workspace
   - **SSH**: Installs Remote-SSH extension, creates SSH config

3. **Start Code-Server**
   - Launches on port 8080 (mapped externally)
   - No authentication required
   - Workspace opened automatically

### Environment Variables

Each container receives these variables:

**All modes**:

- `GITHUB_TOKEN`: For GitHub authentication
- `GITHUB_USERNAME`: Git commit author
- `GITHUB_EMAIL`: Git commit email
- `DEV_MODE`: workspace, git, or ssh

**Git mode**:

- `GIT_URL`: Repository to clone

**SSH mode**:

- `SSH_HOST`: Remote hostname/IP
- `SSH_USER`: SSH username
- `SSH_PATH`: Remote folder path
- `SSH_PASSWORD`: Password for authentication (optional)
- `SSH_PRIVATE_KEY`: Private key for authentication (optional)

## 🔍 Troubleshooting

### Git Clone Fails

- Check that the repository URL is accessible
- Verify GitHub token has repo access
- Check container logs: `docker logs devfarm-<name>`

### SSH Connection Fails

**New SSH Mode (Remote-SSH)**:
- Check the connection guide file `CONNECT_TO_REMOTE.md` or `SSH_CONNECTION_ERROR.md` in your workspace
- Verify SSH credentials (password or private key)
- Test connection: `docker exec -it devfarm-<name> ssh remote-target`
- Check network connectivity from container to remote host
- View detailed logs: `docker exec -it devfarm-<name> cat ~/.devfarm/startup.log`

**What Changed**:
- SSH mode now uses VS Code Remote-SSH instead of SSHFS mounting
- More reliable and works with any SSH server
- No SFTP subsystem required
- No privileged containers needed

### Repository List Empty

- Verify `GITHUB_TOKEN` is set in `.env`
- Check token has `repo` scope
- Test API: `curl -H "Authorization: token <token>" https://api.github.com/user/repos`

### Changes Not Trusted

- This should not happen with current config
- If it does, check `/home/coder/.local/share/code-server/User/settings.json`
- Verify trust settings are present

## 📚 Examples

### Example 1: Quick Bug Fix

```bash
# Create environment with your repository
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"bugfix-123","mode":"git","git_url":"https://github.com/bustinjailey/myapp.git"}'

# Open browser to http://192.168.1.126:8100
# Make changes, commit, push
# Delete environment when done
```

### Example 2: Server Configuration

```bash
# Create SSH environment
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"prod-server","mode":"ssh","ssh_host":"production.example.com","ssh_user":"admin"}'

# Open browser, connect via Remote-SSH
# Edit config files directly on server
```

### Example 3: New Project

```bash
# Create empty workspace
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"new-project","mode":"workspace"}'

# Open browser
# Initialize git repo, create files
# Push to new GitHub repository when ready
```

## 🎓 Best Practices

1. **Use descriptive names**: `bugfix-login-error` instead of `test1`
2. **Match mode to task**:
   - New code → workspace
   - Existing repo → git
   - Server work → ssh
3. **Clean up**: Delete environments when done to free resources
4. **Use project tags**: Group related environments with project field
5. **Test locally first**: Use workspace mode before cloning to git

## 🚀 Next Steps

- Check out [QUICKREF.md](./QUICKREF.md) for command reference
- See [SECRETS.md](./SECRETS.md) for authentication setup
- Read [README.md](../README.md) for general setup
