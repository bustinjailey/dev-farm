# Quick Reference Guide

## 🚀 Common Commands

### Local Development

```bash
# Initial setup
cp .env.example .env
nano .env  # Add your secrets
docker compose up -d

# Upgrade to latest
./scripts/upgrade.sh

# Setup/change secrets
./scripts/setup-secrets.sh
```

### LXC Deployment

```bash
# Deploy from scratch
./scripts/deploy-to-lxc.sh eagle.bustinjailey.org 200

# Upgrade existing LXC
ssh root@eagle.bustinjailey.org 'pct exec 200 -- bash -c "cd /opt && ./scripts/upgrade.sh"'

# Setup secrets on LXC
ssh root@eagle.bustinjailey.org 'pct exec 200 -- /opt/scripts/setup-secrets.sh'

# Check dashboard logs
ssh root@eagle.bustinjailey.org 'pct exec 200 -- docker logs devfarm-dashboard'

# Restart dashboard
ssh root@eagle.bustinjailey.org 'pct exec 200 -- bash -c "cd /opt && docker compose restart"'
```

## 📁 Important Files

| File | Purpose | Tracked in Git? |
|------|---------|-----------------|
| `.env` | Your actual secrets | ❌ No - Ignored |
| `.env.example` | Template for .env | ✅ Yes |
| `PAT` | GitHub token (alternative) | ❌ No - Ignored |
| `docker-compose.yml` | Container orchestration | ✅ Yes |
| `scripts/upgrade.sh` | Pull & rebuild | ✅ Yes |
| `scripts/setup-secrets.sh` | Interactive secret setup | ✅ Yes |
| `scripts/deploy-to-lxc.sh` | Deploy to Proxmox | ✅ Yes |

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

# Verify .env file exists
ls -la /opt/.env  # or your installation directory

# Rebuild and restart
cd /opt
docker compose build
docker compose down
docker compose up -d
```

### Cannot pull from GitHub

```bash
# Verify token in .env or PAT file
cat .env | grep GITHUB_TOKEN
cat PAT

# Test token manually
curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user

# Check git remote
cd /opt
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
- Secrets: `~/dev-farm/.env` or `~/dev-farm/PAT`
- Scripts: `~/dev-farm/scripts/`

### LXC Container
- Installation: `/opt/`
- Secrets: `/opt/.env`
- Docker data: Docker volumes (managed by Docker)
- Environment registry: `/data/environments.json` (in dashboard container)

## 🔄 Workflow

### Creating New Environment
1. Open dashboard: `http://<lxc-ip>:5000`
2. Click "Create New Environment"
3. Enter name and select project type
4. Wait for container creation (~10-30 seconds)
5. Click "Open VS Code"
6. Verify GitHub auth: Run `gh auth status` in terminal

### Upgrading Dev Farm
1. Local: `./scripts/upgrade.sh`
2. LXC: `ssh root@host 'pct exec ID -- bash -c "cd /opt && ./scripts/upgrade.sh"'`
3. Create new environment to use updated image
4. Old environments continue working with old image

### Rotating Secrets
1. Generate new GitHub token
2. Update `.env`: `nano .env`
3. Restart: `docker compose restart`
4. New environments will use new token
5. Existing environments keep old token (until recreated)

## 🌐 URLs

- Dashboard: `http://<lxc-ip>:5000`
- Environment 1: `http://<lxc-ip>:8100`
- Environment 2: `http://<lxc-ip>:8101`
- Environment N: `http://<lxc-ip>:810(N-1)`

## 📚 Additional Resources

- [Full Documentation](README.md)
- [Secret Management Guide](docs/SECRETS.md)
- [GitHub Token Creation](https://github.com/settings/tokens/new)
- [Docker Compose Docs](https://docs.docker.com/compose/)
- [VS Code Server](https://github.com/coder/code-server)
