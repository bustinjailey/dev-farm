# Quick Reference Guide

## 🚀 Common Commands

### Local Development

```bash
# Open an environment in VS Code Insiders Desktop (after copying from dashboard)
code-insiders --folder-uri "vscode-remote://tunnel/<env-name>"

# Initial setup
cp farm-config.example.json farm-config.json
chmod 600 farm-config.json  # Secure permissions
nano farm-config.json  # Add your secrets
./scripts/devfarm.sh setup

# Upgrade to latest (use dashboard UI "Update" button)
# Or via API:
curl -X POST http://localhost:5000/api/system/update/start
```

### LXC Deployment

```bash
# Check dashboard logs
ssh root@eagle.bustinjailey.org 'pct exec 200 -- docker logs devfarm-dashboard'

# Restart dashboard
ssh root@eagle.bustinjailey.org 'pct exec 200 -- bash -c "cd /opt/dev-farm && docker compose restart"'

# Update system (use dashboard UI "Update" button preferred)
# Or via API:
ssh root@eagle.bustinjailey.org 'pct exec 200 -- curl -X POST http://localhost:5000/api/system/update/start'
```

## 📁 Important Files

| File                       | Purpose                         | Tracked in Git? |
| -------------------------- | ------------------------------- | --------------- |
| `farm-config.json`         | Main configuration with secrets | ❌ No - Ignored |
| `farm-config.example.json` | Template for farm-config.json   | ✅ Yes          |
| `farm-config.schema.json`  | JSON schema for validation      | ✅ Yes          |
| `docker-compose.yml`       | Container orchestration         | ✅ Yes          |
| `scripts/devfarm.sh`       | Main management script          | ✅ Yes          |

## 🔑 GitHub Token Scopes

When creating your token at https://github.com/settings/tokens/new, select:

- ✅ `repo` - Full control of private repositories
- ✅ `read:org` - Read org and team membership
- ✅ `workflow` - Update GitHub Action workflows
- ✅ `copilot` - GitHub Copilot access

## 🐳 Container Management

```bash
# List all dev-farm containers
docker ps --filter "name=devfarm"

# Stop a specific environment
docker stop devfarm-<environment-name>

# Remove an environment (and its volume)
docker rm devfarm-<environment-name>
docker volume rm devfarm-<environment-name>

# View environment logs
docker logs devfarm-<environment-name>

# Execute command in environment
docker exec -it devfarm-<environment-name> bash

# Check GitHub auth in environment
docker exec devfarm-<environment-name> gh auth status
```

## 📊 Dashboard API

The dashboard runs on port 5000 and provides these endpoints:

```bash
# List all environments
curl http://localhost:5000/api/environments

# Create environment
curl -X POST http://localhost:5000/api/create \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "project": "python"}'

# Delete environment
curl -X POST http://localhost:5000/api/delete \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'

# Get stats
curl http://localhost:5000/api/stats
```

## 🔧 Troubleshooting

### Environment not authenticating with GitHub

```bash
# Check if token is set in dashboard
docker exec devfarm-dashboard env | grep GITHUB_TOKEN

# Check if token is passed to environment
docker exec devfarm-<name> env | grep GITHUB

# Verify GitHub CLI
docker exec -it devfarm-<name> gh auth status

# Check git config
docker exec devfarm-<name> git config --list
```

### Dashboard not starting

```bash
# Check logs
docker logs devfarm-dashboard

# Verify farm-config.json file exists
ls -la /opt/dev-farm/farm-config.json

# Check configuration syntax
cat /opt/dev-farm/farm-config.json | python3 -m json.tool

# Rebuild and restart
cd /opt/dev-farm
docker compose build
docker compose down
docker compose up -d
```

### Cannot pull from GitHub

```bash
# Verify token in farm-config.json
cat /opt/dev-farm/farm-config.json

# Test token manually
# Extract token from farm-config.json first
curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user

# Check git remote
cd /opt/dev-farm
git remote -v
```

### Port conflicts

```bash
# Check what's using port 5000
sudo lsof -i :5000

# Check what's using dev environment ports
sudo lsof -i :8100-8110

# Change dashboard port in docker-compose.yml
# ports:
#   - "5001:5000"  # Use 5001 instead
```

## 📝 File Locations

### Local Machine

- Dev Farm source: `~/dev-farm`
- Configuration: `~/dev-farm/farm.config`
- Scripts: `~/dev-farm/scripts/`

### LXC Container

- Installation: `/opt/dev-farm/`
- Configuration: `/opt/dev-farm/farm.config`
- Docker data: Docker volumes (managed by Docker)
- Environment registry: `/data/environments.json` (in dashboard container)

## 🔄 Workflow

### Creating New Environment

1. Open dashboard: `http://<lxc-ip>:5000` or `https://farm.bustinjailey.org`
2. Click "Create New Environment"
3. Enter name and select mode (Workspace/Git/SSH/Terminal)
4. Wait for container creation (~10-30 seconds)
5. Click "Open" to access environment
6. Verify GitHub auth: Run `gh auth status` in terminal

### Upgrading Dev Farm

1. Use dashboard UI: Click "⬆️ Update Now" button
2. System will automatically pull latest code, rebuild images, and restart
3. Wait for update to complete (~2-3 minutes)
4. Dashboard will reload with new version
5. Create new environments to use updated images
6. Old environments continue working with old images

### Rotating Secrets

1. Generate new GitHub token
2. Update `farm.config`: `nano farm.config`
3. No restart needed - changes apply to new environments automatically
4. New environments will use new token
5. Existing environments keep old token (until recreated)

## 🌐 URLs

### Path-Based Routing (Current)

- Dashboard: `https://farm.bustinjailey.org/`
- Environment: `https://farm.bustinjailey.org/env/<environment-name>`

### Direct Access (LAN)

- Dashboard: `http://<lxc-ip>:5000`
- Environment: `http://<lxc-ip>:5000/env/<environment-name>`

## 📚 Additional Resources

- [Full Documentation](README.md)
- [Secret Management Guide](docs/SECRETS.md)
- [GitHub Token Creation](https://github.com/settings/tokens/new)
- [Docker Compose Docs](https://docs.docker.com/compose/)
- [VS Code Server](https://github.com/coder/code-server)
