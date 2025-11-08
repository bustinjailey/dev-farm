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
- 📊 **Resource Monitoring & Logs** - Real-time stats, logs, and AI chat in every card
- 🚀 **One-Click Access** - Tap to open VS Code Server in your browser
- 🧹 **Maintenance Tools** - Orphan cleanup, registry recovery, image rebuilds, and self-update controls

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Mobile/Desktop Browser          │
│                                         │
│  ┌─────────────┐    ┌──────────────┐  │
│  │  Dashboard  │    │  vscode.dev  │  │
│  │   :5000     │    │   /tunnel/   │  │
│  └─────────────┘    │  devfarm-1   │  │
│                     └──────────────┘  │
│         ┌──────────────┐               │
│         │  vscode.dev  │               │
│         │   /tunnel/   │               │
│         │  devfarm-2   │               │
│         └──────────────┘               │
└─────────────────────────────────────────┘
                 ▼
         Azure Tunnel Service
                 ▼
┌─────────────────────────────────────────┐
│           Proxmox LXC/Host             │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Dashboard Container (Node)     │  │
│  │   - Fastify API + Svelte UI      │  │
│  │   - Docker orchestration         │  │
│  │   - Environment registry         │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Tunnel Container #1            │  │
│  │   - VS Code Remote Tunnel        │  │
│  │   - Server-side extensions       │  │
│  │   - GitHub CLI configured        │  │
│  │   - Copilot MCP servers          │  │
│  │   - Isolated workspace volume    │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Tunnel Container #2            │  │
│  │   - VS Code Remote Tunnel        │  │
│  │   - Server-side extensions       │  │
│  │   - GitHub CLI configured        │  │
│  │   - Copilot MCP servers          │  │
│  │   - Isolated workspace volume    │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Key Architecture Details:**

- **Tunnel Mode**: VS Code uses Remote Tunnels (not serve-web) for server-side extension execution
- **No Local Ports**: Containers make outbound connections to Azure, no port mapping required
- **Persistent Extensions**: Extension Host remains alive across browser disconnections
- **Access via vscode.dev**: Environments accessed at `https://vscode.dev/tunnel/devfarm-<name>`

## 🔒 Secret Management

**Important:** Never commit secrets to git!

All sensitive data (GitHub tokens, API keys) should be stored in a `farm.config` file that is automatically ignored by git.

```bash
# Quick setup
cp farm.config.example farm.config
nano farm.config  # Add your GitHub token and other secrets
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

2. **Build and start Dev Farm:**

```bash
# Build all images and start services
pnpm docker:build
pnpm docker:up

# Or use docker compose directly:
docker compose up -d --build
```

4. **Access the dashboard:**

Open your browser (or phone browser) and navigate to:

```
http://<your-lxc-ip>:5000
```

5. **(Recommended) Configure GitHub Authentication:**

**Option A: farm-config.json (Best for local development)**

```bash
cp farm-config.example.json farm-config.json
nano farm-config.json  # Add your GitHub PAT
```

Create a PAT at https://github.com/settings/tokens/new with scopes: `repo`, `read:org`, `workflow`

**Option B: OAuth Device Flow**

- Click the "🔗 Connect" button in the dashboard
- Follow the OAuth device flow to authenticate
- Note: OAuth Apps may have scope limitations

**Option C: Environment Variable (Legacy)**

```bash
export GITHUB_TOKEN="your_github_token_here"
```

## 📱 Using the Dashboard

### From Your Phone

1. Open your mobile browser
2. Navigate to `http://<your-lxc-ip>:5000`
3. Tap **"➕ Create New Environment"**
4. Enter a name and project type
5. Tap **"🚀 Open VS Code"** for the in-browser tunnel, or **"🖥 Copy Desktop Command"** and run it locally to launch VS Code Insiders Desktop (required for tunneling into SSH-backed workspaces)

### Default Credentials

- **Password for all environments:** `code`

### System Management

- Monitor git revisions, Docker connectivity, and environment counts from the status cards.
- Launch a **system update** to fetch/pull `origin/main`, rebuild dashboard/code-server images, and restart proxy/dashboard containers—progress streams in real time.
- Manage GitHub access from the same view: paste a PAT, or walk through the device-flow OAuth without leaving the UI. The git environment modal includes a repo browser backed by your account.
- Clean up orphaned containers, recover the environment registry, tail environment logs, and rebuild images directly from the dashboard.

## 🛠️ Management Commands

### Docker Compose Commands

```bash
# Build all images (first time only)
pnpm docker:build

# Start the dashboard
pnpm docker:up
# or: docker compose up -d

# Stop the dashboard
pnpm docker:down
# or: docker compose down

# View logs
pnpm docker:logs
# or: docker compose logs -f

# Restart services
pnpm docker:restart
# or: docker compose restart
```

### Development Commands

```bash
# Start both frontend and backend dev servers
pnpm dev

# Start only the backend API
pnpm dev:server

# Start only the frontend (Vite)
pnpm dev:client
```

## 🧑‍💻 Local Development Workflow

Dev Farm uses **pnpm workspaces** for managing the monorepo:

```bash
# Install all dependencies (from project root)
pnpm install

# Start development servers (both frontend + backend)
pnpm dev          # Runs both servers concurrently
pnpm dev:server   # Backend only (http://localhost:5000)
pnpm dev:client   # Frontend only (http://localhost:5173)

# Build for production
pnpm build        # Build all packages
pnpm build:server # Build backend only
pnpm build:client # Build frontend only

# Quality checks
pnpm lint         # Lint all code
pnpm check        # TypeScript + Svelte checks
pnpm test         # Run all tests

# Docker operations
pnpm docker:build # Build Docker images
pnpm docker:up    # Start services
pnpm docker:down  # Stop services
```

The project structure uses pnpm workspaces for `dashboard` and `docker` packages.

## 🎛️ Configuration

### GitHub Integration

Each environment is **automatically authenticated** with GitHub using your personal access token from the `farm-config.json` file.

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
pnpm docker:build:code-server
# or: docker build -t dev-farm/code-server:latest -f docker/Dockerfile.code-server docker/
```

## 🗂️ Project Structure

```
dev-farm/                   # Monorepo root
├── package.json           # Workspace configuration + scripts
├── docker-compose.yml     # Service orchestration
├── dashboard/             # Dashboard package (Node + Svelte)
│   ├── package.json       # Dashboard dependencies + scripts
│   ├── Dockerfile         # Dashboard container
│   ├── src/               # Backend API (Fastify + TypeScript)
│   └── frontend/          # Frontend UI (Svelte + Vite)
├── docker/                # Docker images package
│   ├── package.json       # Build scripts for images
│   ├── Dockerfile.code-server  # VS Code Server image
│   ├── Dockerfile.terminal     # Terminal image
│   └── config/            # Container configurations
│       ├── workspace-settings.json
│       ├── mcp-copilot.json
│       └── startup.sh
└── docs/                  # Documentation
    ├── ENVIRONMENT_MODES.md
    ├── TERMINAL_MODE.md
    ├── SECRETS.md
    └── QUICKREF.md
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
pnpm docker:logs
# or: docker compose logs -f dashboard
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
- **[docs/COPILOT_AUTO_SIGNIN.md](docs/COPILOT_AUTO_SIGNIN.md)** - Enable automatic Copilot authentication
- **[docs/QUICKREF.md](docs/QUICKREF.md)** - Quick reference for common commands

---

**Made with ❤️ for developers who code from anywhere**

_Star this repo if you find it useful!_ ⭐
