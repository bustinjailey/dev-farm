# 🚜 Dev Farm

**Your On-Demand Development Environments**

Dev Farm is a self-hosted platform for spinning up isolated VS Code Server development environments on demand, managed through a mobile-friendly web dashboard.

Perfect for running multiple projects on a Proxmox LXC, with consistent GitHub integration and Copilot MCP server configuration.

## ✨ Features

- 🎯 **On-Demand Environments** - Create and destroy dev environments instantly
- 📦 **Four Environment Modes**:
  - 💻 **Workspace Mode** - Empty folder for new projects
  - 📦 **Git Mode** - Clone from GitHub with repository browser
  - 🔌 **SSH Mode** - Connect to remote servers with Remote-SSH
  - ⌨️ **Terminal Mode** - Lightweight CLI with AI tools (Copilot CLI, AIChat)
- **Mobile Dashboard** - Touch-optimized interface for managing from your phone
- 🔄 **Self-Update System** - Update Dev Farm with one click from the dashboard
- 🔐 **GitHub OAuth Integration** - Web-based authentication, no manual token setup
- 🔒 **Consistent Configuration** - Every environment has GitHub CLI and Copilot MCP pre-configured
- � **No Trust Prompts** - Workspaces always open in trusted mode
- 🐳 **Docker-Based** - Isolated containers for each project
- 📊 **Resource Monitoring** - See CPU and memory usage at a glance
- 🚀 **One-Click Access** - Tap to open VS Code Server in your browser
- 🧹 **Orphan Detection** - Automatically find and clean up zombie containers

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Mobile/Desktop Browser          │
│                                         │
│  ┌─────────────┐    ┌──────────────┐  │
│  │  Dashboard  │    │  VS Code #1  │  │
│  │   :5000     │    │    :8100     │  │
│  └─────────────┘    └──────────────┘  │
│                                         │
│         ┌──────────────┐               │
│         │  VS Code #2  │               │
│         │    :8101     │               │
│         └──────────────┘               │
└─────────────────────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│           Proxmox LXC/Host             │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Dashboard Container (Flask)    │  │
│  │   - Docker orchestration         │  │
│  │   - Environment registry         │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Code-Server Container #1       │  │
│  │   - Full VS Code in browser      │  │
│  │   - GitHub CLI configured        │  │
│  │   - Copilot MCP servers          │  │
│  │   - Isolated workspace volume    │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Code-Server Container #2       │  │
│  │   - Full VS Code in browser      │  │
│  │   - GitHub CLI configured        │  │
│  │   - Copilot MCP servers          │  │
│  │   - Isolated workspace volume    │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## � Secret Management

**Important:** Never commit secrets to git!

All sensitive data (GitHub tokens, API keys) should be stored in a `.env` file that is automatically ignored by git.

```bash
# Quick setup
cp .env.example .env
nano .env  # Add your GitHub token and other secrets
```

See [docs/SECRETS.md](docs/SECRETS.md) for complete documentation on managing secrets securely.

## �🚀 Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Git installed
- GitHub account (username: bustinjailey)
- (Optional) GitHub Personal Access Token for MCP servers

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/bustinjailey/dev-farm.git
cd dev-farm
```

2. **Access the dashboard:**

Open your browser (or phone browser) and navigate to:

```
http://<your-lxc-ip>:5000
```

3. **(Recommended) Connect GitHub via OAuth:**

- Click the "🔗 Connect" button next to GitHub status in the dashboard
- Follow the OAuth device flow to authenticate
- Your token will be stored securely and applied to all environments

Alternative: Set up GitHub token manually via environment variable:

```bash
export GITHUB_TOKEN="your_github_token_here"
```

## 📱 Using the Dashboard

### From Your Phone

1. Open your mobile browser
2. Navigate to `http://<your-lxc-ip>:5000`
3. Tap **"➕ Create New Environment"**
4. Enter a name and project type
5. Tap **"🚀 Open VS Code"** to access your environment

### Default Credentials

- **Password for all environments:** `code`

### System Management

**Self-Update:**

- Click the "⬆️ Update Now" button in the dashboard
- System will pull latest code and restart automatically
- No SSH or manual commands required

**GitHub Authentication:**

- Click "🔗 Connect" button to authenticate via OAuth
- Token is automatically applied to all new and existing environments
- Restart existing containers to apply the token

**Orphan Cleanup:**

- Dashboard automatically detects zombie containers
- Click "🧹 Clean Up" to remove orphaned containers

## 🛠️ Management Commands

The `devfarm.sh` script provides easy management:

```bash
# Setup (first time only)
./scripts/devfarm.sh setup

# Start the dashboard
./scripts/devfarm.sh start

# Stop the dashboard
./scripts/devfarm.sh stop

# Create a new environment (via CLI)
./scripts/devfarm.sh create my-project python

./scripts/devfarm.sh list

# Delete an environment

./scripts/devfarm.sh delete my-project

# View logs

./scripts/devfarm.sh logs

# Show help

./scripts/devfarm.sh help

```

## 🎛️ Configuration

### GitHub Integration

Each environment is **automatically authenticated** with GitHub using your personal access token from the `.env` file.

Features:

- **GitHub CLI** pre-authenticated
- **Git** with credentials configured
- **GitHub Copilot** ready to use (if you have a license)
- **GitHub username:** `bustinjailey`

No manual login required! Just open your environment and start coding.

### Environment Modes

Dev Farm supports four different modes for different workflows:

1. **💻 Workspace Mode** (Default)

   - Empty folder for new projects
   - Perfect for experimentation
   - No trust prompts

2. **📦 Git Repository Mode**

   - Clone from GitHub with built-in repository browser
   - Browse your repos or paste any Git URL
   - Repository ready to edit immediately
   - Perfect for contributing to existing projects

3. **🔌 Remote SSH Mode**

   - Connect to remote servers via SSH
   - Remote-SSH extension pre-installed
   - Edit files directly on remote systems
   - Perfect for server management

4. **⌨️ Terminal Mode** (NEW)
   - Lightweight web-based terminal
   - GitHub Copilot CLI for command suggestions
   - AIChat for general AI assistance
   - No IDE overhead (~150MB vs 500+ MB)
   - Perfect for CLI-focused work

**See [docs/ENVIRONMENT_MODES.md](docs/ENVIRONMENT_MODES.md) for workspace/git/ssh modes.**  
**See [docs/TERMINAL_MODE.md](docs/TERMINAL_MODE.md) for terminal mode.**

### Copilot MCP Servers

Each environment includes pre-configured MCP servers:

- **Filesystem MCP** - File system operations
- **GitHub MCP** - GitHub API access (requires `GITHUB_TOKEN`)
- **Brave Search MCP** - Web search capabilities (requires `BRAVE_API_KEY`)

Configure tokens via environment variables before starting.

### Custom VS Code Settings

Default settings are in `docker/config/settings.json`. Modify and rebuild:

```bash
./scripts/devfarm.sh build
```

## 📦 Environment Persistence

Each environment has its own persistent Docker volume:

- Volume name: `devfarm-<environment-name>`
- Mount point: `/workspace`
- Survives container restarts
- Deleted only when you explicitly delete the environment

## 🔧 Advanced Usage

### Proxmox LXC Setup

Recommended LXC specs:

- **OS:** Ubuntu 22.04 or Debian 12
- **CPU:** 4 cores minimum
- **RAM:** 8GB minimum (16GB recommended)
- **Storage:** 50GB minimum
- **Features:** Enable "Nesting" and "FUSE" for Docker

### Port Forwarding

The dashboard automatically assigns ports starting from **8100**.

To access from outside your network:

1. Forward port **5000** (dashboard) on your router
2. Environments will use ports **8100+** (also forward these if needed)

### Custom Dockerfile

Modify `docker/Dockerfile.code-server` to add:

- Additional programming languages
- Custom tools and utilities
- Pre-installed extensions

Then rebuild:

```bash
./scripts/devfarm.sh build
```

## 🗂️ Project Structure

```
dev-farm/
├── dashboard/              # Dashboard web app
│   ├── app.py             # Flask application
│   ├── templates/         # HTML templates
│   ├── Dockerfile         # Dashboard container
│   └── requirements.txt   # Python dependencies
├── docker/                # Code-server configuration
│   ├── Dockerfile.code-server
│   └── config/
│       ├── settings.json  # VS Code settings
│       └── mcp.json       # MCP server config
├── scripts/               # Management scripts
│   └── devfarm.sh        # Main CLI tool
├── docker-compose.yml     # Dashboard orchestration
└── README.md             # This file
```

## 🤝 Contributing

Contributions welcome! Feel free to:

- Report bugs
- Suggest features
- Submit pull requests

## 📄 License

MIT License - feel free to use for personal or commercial projects.

## 🙏 Acknowledgments

- [code-server](https://github.com/coder/code-server) - VS Code in the browser
- [Docker](https://www.docker.com/) - Containerization platform
- [Flask](https://flask.palletsprojects.com/) - Web framework
- [Model Context Protocol](https://modelcontextprotocol.io/) - AI tool integration

## 🐛 Troubleshooting

### Dashboard won't start

```bash
# Check Docker is running
docker info

# View logs
./scripts/devfarm.sh logs
```

### Can't access from phone

```bash
# Check firewall allows port 5000
sudo ufw allow 5000

# Ensure dashboard is listening on 0.0.0.0
docker logs devfarm-dashboard
```

### Environment won't create

```bash
# Check available resources
docker system df

# Clean up unused resources
docker system prune
```

## 💡 Tips

- **Bookmark the dashboard** on your phone for quick access
- **Use SSH tunneling** for secure remote access
- **Set up Tailscale** for zero-config VPN access
- **Backup volumes** regularly with `docker volume inspect`

## 📚 Documentation

- **[docs/ENVIRONMENT_MODES.md](docs/ENVIRONMENT_MODES.md)** - Detailed guide to workspace, git, and SSH modes
- **[docs/TERMINAL_MODE.md](docs/TERMINAL_MODE.md)** - Terminal mode with CLI AI tools
- **[docs/SECRETS.md](docs/SECRETS.md)** - Secret management and GitHub authentication
- **[docs/QUICKREF.md](docs/QUICKREF.md)** - Quick reference for common commands

---

**Made with ❤️ for developers who code from anywhere**

_Star this repo if you find it useful!_ ⭐
