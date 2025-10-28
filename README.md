# 🚜 Dev Farm

**Your On-Demand Development Environments**

Dev Farm is a self-hosted platform for spinning up isolated VS Code Server development environments on demand, managed through a mobile-friendly web dashboard.

Perfect for running multiple projects on a Proxmox LXC, with consistent GitHub integration and Copilot MCP server configuration.

## ✨ Features

- 🎯 **On-Demand Environments** - Create and destroy dev environments instantly
- 📱 **Mobile Dashboard** - Touch-optimized interface for managing from your phone
- 🔐 **Consistent Configuration** - Every environment has GitHub CLI and Copilot MCP pre-configured
- 🐳 **Docker-Based** - Isolated containers for each project
- 📊 **Resource Monitoring** - See CPU and memory usage at a glance
- 🚀 **One-Click Access** - Tap to open VS Code Server in your browser

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

2. **(Optional) Set up GitHub token:**

```bash
export GITHUB_TOKEN="your_github_token_here"
```

3. **Run the setup script:**

```bash
chmod +x scripts/devfarm.sh
./scripts/devfarm.sh setup
```

This will:

- Build the custom code-server Docker image
- Start the dashboard
- Create the Docker network
- Set up persistent storage

4. **Access the dashboard:**

Open your browser (or phone browser) and navigate to:

```
http://<your-lxc-ip>:5000
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

# Upgrade to latest version
./scripts/upgrade.sh
```

### Upgrading Dev Farm

To pull the latest code and rebuild containers:

```bash
cd /opt  # or your dev-farm directory
./scripts/upgrade.sh
```

The upgrade script will:

1. Load your GitHub token from `.env` or `PAT` file
2. Pull latest code from GitHub
3. Rebuild the code-server image
4. Rebuild and restart the dashboard
5. Preserve all existing environments

**Note:** Existing environments will continue running. Create new environments to use the updated code-server image.

# List all environments

./scripts/devfarm.sh list

# Delete an environment

./scripts/devfarm.sh delete my-project

# View logs

./scripts/devfarm.sh logs

# Show help

./scripts/devfarm.sh help

````

## 🎛️ Configuration

### GitHub Integration

Each environment is **automatically authenticated** with GitHub using your personal access token from the `.env` file.

Features:

- **GitHub CLI** pre-authenticated
- **Git** with credentials configured
- **GitHub Copilot** ready to use (if you have a license)
- **GitHub username:** `bustinjailey`

No manual login required! Just open your environment and start coding.

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
````

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

---

**Made with ❤️ for developers who code from anywhere**

_Star this repo if you find it useful!_ ⭐
