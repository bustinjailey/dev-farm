# Dev Farm Scripts Guide

This guide explains the **single authoritative script** for managing Dev Farm and when to use it.

## Main Script: `scripts/devfarm.sh`

This is the **ONLY** script you need for managing Dev Farm. All overlapping scripts have been removed to eliminate confusion.

### Usage

```bash
./scripts/devfarm.sh <command> [options]
```

### Available Commands

#### Initial Setup
```bash
./scripts/devfarm.sh setup
```
- Builds the code-server image
- Creates Docker network
- Starts the dashboard
- **Use this for first-time setup**

#### Build Commands
```bash
./scripts/devfarm.sh build
```
- Rebuilds the code-server image
- **Use this after updating Dockerfile.code-server**

#### Dashboard Management
```bash
./scripts/devfarm.sh start    # Start dashboard
./scripts/devfarm.sh stop     # Stop dashboard
./scripts/devfarm.sh restart  # Restart dashboard
./scripts/devfarm.sh logs     # View dashboard logs
```

#### Environment Management
```bash
./scripts/devfarm.sh create <name> [project]   # Create new environment
./scripts/devfarm.sh delete <name>             # Delete environment
./scripts/devfarm.sh list                      # List all environments
```

**Examples:**
```bash
./scripts/devfarm.sh create my-python-app python
./scripts/devfarm.sh create my-web-project nodejs
./scripts/devfarm.sh delete my-python-app
```

## Applying Updates from Git

### Manual Update Process

When you pull changes from GitHub, use the dashboard's built-in **self-update feature**:

1. **Via Dashboard UI** (Recommended):
   - Go to http://localhost:5000
   - Click the "Update" button in the UI
   - The system will automatically:
     - Pull latest code from GitHub
     - Rebuild both images
     - Restart the dashboard
     - Show real-time progress

2. **Via API** (for automation):
   ```bash
   curl -X POST http://localhost:5000/api/update/trigger
   ```

### Why Not a Separate Upgrade Script?

The self-updater in the dashboard is superior because:
- ✅ Handles git operations safely (stash, pull, restore)
- ✅ Always rebuilds both dashboard and code-server images
- ✅ Manages container lifecycle correctly (stop → remove → create → start)
- ✅ Provides real-time progress via SSE
- ✅ Validates successful restart before completing
- ✅ No risk of killing itself mid-update

**All previous upgrade/update scripts have been removed** - use the dashboard update feature instead.

## Configuration

### GitHub Token Setup

**Option 1: Using .env file** (Recommended)
```bash
cp .env.example .env
nano .env  # Add your GITHUB_TOKEN
docker compose restart dashboard
```

**Option 2: Using environment variables**
```bash
export GITHUB_TOKEN="your_token_here"
./scripts/devfarm.sh restart
```

### GitHub PAT Scopes Required
Your GitHub Personal Access Token needs:
- `repo` - Full repository access
- `read:org` - Read organization data
- `workflow` - Update GitHub Actions
- `copilot` - GitHub Copilot access (if using Copilot)

Get a token at: https://github.com/settings/tokens/new

## Deployment to Proxmox LXC

For deploying to a Proxmox LXC container, use the dashboard's deployment features or manually:

1. **Create LXC container on Proxmox** with:
   - Nesting enabled (`features: nesting=1`)
   - At least 4 cores, 8GB RAM
   - Ubuntu 22.04 or 24.04 template

2. **Install Docker inside LXC**:
   ```bash
   curl -fsSL https://get.docker.com | sh
   apt-get install -y docker-compose-plugin
   ```

3. **Clone and setup**:
   ```bash
   cd /opt
   git clone https://github.com/bustinjailey/dev-farm.git
   cd dev-farm
   cp .env.example .env
   nano .env  # Configure
   ./scripts/devfarm.sh setup
   ```

## Removed Scripts (Historical Reference)

The following scripts have been **removed** because they duplicated functionality:

| Removed Script | Replacement |
|----------------|-------------|
| `scripts/upgrade.sh` | Dashboard self-updater (click "Update" button) |
| `scripts/deploy-lxc.sh` | Manual deployment instructions above |
| `scripts/deploy-lxc-auto.sh` | Manual deployment instructions above |
| `scripts/deploy-to-lxc.sh` | Manual deployment instructions above |
| `scripts/update-config.sh` | Edit `.env` directly + `docker compose restart` |
| `scripts/setup-github-auth.sh` | Edit `.env` directly + `docker compose restart` |
| `scripts/setup-secrets.sh` | Edit `.env` directly + `docker compose restart` |
| `start.sh` | `./scripts/devfarm.sh start` |
| `test-setup.sh` | Not needed - setup is simpler now |

## Quick Reference

| Task | Command |
|------|---------|
| First time setup | `./scripts/devfarm.sh setup` |
| Update from GitHub | Use dashboard "Update" button |
| Create environment | `./scripts/devfarm.sh create <name>` |
| List environments | `./scripts/devfarm.sh list` |
| View logs | `./scripts/devfarm.sh logs` |
| Configure GitHub | Edit `.env` + restart |
| Restart dashboard | `./scripts/devfarm.sh restart` |

## Troubleshooting

### Dashboard won't start
```bash
docker compose logs dashboard
./scripts/devfarm.sh restart
```

### Environment stuck in "STARTING"
- Wait 60 seconds for healthcheck
- Check logs: `docker logs <container-name>`
- Verify code-server image: `docker images | grep code-server`

### GitHub auth not working
```bash
# Check .env file
cat .env | grep GITHUB_TOKEN

# Restart to apply
docker compose restart dashboard
```

### Update failed
```bash
# View update logs
docker logs devfarm-dashboard

# Manual recovery
cd /home/justin/dev-farm
git stash
git pull
docker compose build
./scripts/devfarm.sh restart
```

## Need Help?

- Check logs: `./scripts/devfarm.sh logs`
- View container status: `docker ps -a`
- Inspect specific container: `docker logs <container-name>`
- Dashboard health: `curl http://localhost:5000/health`
