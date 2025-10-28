# 🚜 Dev Farm - Quick Mode Reference

## 🎯 Choose Your Mode

### 💻 Workspace Mode
**When to use**: New projects, experimentation, learning
- Empty folder
- GitHub auth ready
- No setup needed
```bash
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","mode":"workspace"}'
```

### 📦 Git Mode
**When to use**: Working on existing repos, contributing to projects
- Clone from GitHub
- Browse your repos or paste URL
- Ready to commit/push
```bash
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"myrepo","mode":"git","git_url":"https://github.com/user/repo.git"}'
```

### 🔌 SSH Mode
**When to use**: Remote server management, editing files on existing systems
- Remote-SSH extension installed
- Connect to servers
- Edit files remotely
```bash
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"server","mode":"ssh","ssh_host":"192.168.1.100","ssh_user":"root"}'
```

## 🚀 Deploying Updates

```bash
# From local machine (already done for you)
ssh root@eagle.bustinjailey.org "pct exec 200 -- bash -c 'cd /opt && ./scripts/upgrade.sh'"
```

## 🎨 Dashboard Access

- **URL**: http://192.168.1.126:5000
- Click "➕ Create New Environment"
- Select mode from dropdown
- Fill in mode-specific fields
- Click "Create"

## 🔒 Trust Mode

All environments open in **trusted mode** automatically. No prompts, ever.

## 📚 Full Documentation

- **[ENVIRONMENT_MODES.md](docs/ENVIRONMENT_MODES.md)** - Complete mode guide
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - What was implemented
- **[README.md](README.md)** - Main documentation
