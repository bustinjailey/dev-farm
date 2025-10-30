# ⌨️ Terminal Mode - CLI AI Tools

## Overview

Terminal mode provides a **lightweight, web-based terminal environment** focused entirely on command-line AI tools. Instead of running a full VS Code IDE, you get direct terminal access with pre-configured CLI AI assistants.

## 🎯 When to Use Terminal Mode

**Perfect for:**

- Quick command-line tasks without IDE overhead
- Learning CLI tools and shell commands
- DevOps and system administration work
- Lightweight code editing with vim/nano
- Working on remote servers via SSH from the terminal
- Situations where you prefer terminal over graphical IDE

**Not ideal for:**

- Heavy code editing (use workspace/git mode instead)
- Visual debugging
- GUI-based extension requirements

## 🤖 Available CLI AI Tools

### 1. GitHub Copilot CLI

Pre-configured and authenticated with your GitHub account.

```bash
# Explain what a command does
gh copilot explain "docker ps -a"

# Get command suggestions
gh copilot suggest "compress a folder into tar.gz"
gh copilot suggest "find all python files modified today"
```

### 2. AIChat

Multi-model AI chat CLI supporting GPT-4, Claude, and more.

```bash
# Ask questions
aichat "explain kubernetes pods"
ai "how do I debug a python script"

# Interactive mode
aichat

# Specify model
aichat -m gpt-4 "your query"

# One-shot code generation
aichat "write a bash script to backup /var/log"
```

### 3. Standard CLI Tools

All the usual development tools are available:

- **git**: Version control
- **gh**: GitHub CLI
- **vim/nano**: Text editors
- **tmux**: Terminal multiplexer
- **zsh**: Enhanced shell with Oh My Zsh
- **python3, nodejs, npm**: Programming languages

## 📁 Workspace Structure

Terminal mode includes persistent storage:

```
/home/coder/workspace/
├── .terminal.log         # Startup log
├── WELCOME.txt          # Welcome message
└── [your files]         # Your code and files persist here
```

**Git Mode with Terminal:**

```
/home/coder/workspace/
├── repo/                # Cloned repository
├── REPO_INFO.md        # Repository information
└── .terminal.log       # Logs
```

## 🚀 Creating a Terminal Environment

### Via Dashboard

1. Go to `http://farm.bustinjailey.org` (or your dashboard URL)
2. Click **"➕ Create New Environment"**
3. Enter environment name
4. Select **"⌨️ Terminal (CLI AI tools only)"** mode
5. Click **"Create"**
6. Opens directly to a web-based terminal

### Via API

```bash
# Pure terminal mode
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "cli-workspace",
    "mode": "terminal",
    "project": "cli-tools"
  }'

# Terminal mode with git repository
curl -X POST http://192.168.1.126:5000/create \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "repo-terminal",
    "mode": "terminal",
    "git_url": "https://github.com/user/repo.git"
  }'
```

## 💡 Terminal Tips & Tricks

### Tmux Session Management

Tmux keeps your sessions alive even if you disconnect:

```bash
# Start tmux
tmux

# Detach: Ctrl+B then D
# Reattach
tmux attach

# List sessions
tmux ls

# Create named session
tmux new -s mysession
```

### Helpful Aliases (Pre-configured)

```bash
ll        # List files (ls -alh)
gs        # Git status
gp        # Git pull
ai        # Shortcut for aichat
```

### AI-Powered Workflows

**Example 1: Learning new commands**

```bash
# Ask Copilot to explain
gh copilot explain "awk '{print $1}' file.txt"

# Ask for alternatives
gh copilot suggest "extract first column from csv"
```

**Example 2: Code generation**

```bash
# Generate a script
aichat "write a python script to parse json logs"

# Save to file
aichat "python web scraper for news sites" > scraper.py

# Get help refining
aichat "improve this script for better error handling"
```

**Example 3: Debugging**

```bash
# Explain errors
gh copilot explain "ImportError: No module named 'requests'"

# Get suggestions
aichat "python script crashes with 'list index out of range'"
```

## 🔐 Authentication

### GitHub (Automatic)

If you connected GitHub in the dashboard, terminal mode automatically:

- ✅ Configures git credentials
- ✅ Authenticates GitHub CLI
- ✅ Installs and configures GitHub Copilot CLI extension

### OpenAI API Key (Optional)

For aichat to work with OpenAI models, you can:

1. **Via Environment Variable** (per-container):

   ```bash
   # Add to dashboard or recreate with env var
   OPENAI_API_KEY=sk-...
   ```

2. **Manually in Container**:
   ```bash
   # Create config
   mkdir -p ~/.config/aichat
   cat > ~/.config/aichat/config.yaml <<EOF
   model: gpt-4
   clients:
     - type: openai
       api_key: sk-your-key-here
   EOF
   ```

## 🛠️ Technical Details

### Container Specifications

- **Base Image**: Debian Trixie Slim
- **Web Terminal**: ttyd (lightweight web terminal)
- **Shell**: Zsh with Oh My Zsh
- **Port**: 8080 (mapped to host)
- **Storage**: Persistent Docker volume

### Installed Packages

**CLI Tools:**

- ttyd (web terminal)
- tmux (terminal multiplexer)
- git, gh (GitHub)
- zsh (enhanced shell)

**Programming Languages:**

- Python 3
- Node.js / npm

**AI Tools:**

- GitHub Copilot CLI (gh extension)
- aichat (Rust-based CLI)

### Resource Usage

Terminal mode is significantly lighter than IDE mode:

- **Memory**: ~100-200 MB (vs 500+ MB for VS Code)
- **CPU**: Minimal when idle
- **Startup**: < 5 seconds

## 🔄 Comparison: Terminal vs IDE Modes

| Feature          | Terminal Mode     | IDE Mode (workspace/git/ssh) |
| ---------------- | ----------------- | ---------------------------- |
| **Interface**    | Web terminal      | Full VS Code IDE             |
| **Memory**       | ~150 MB           | ~500+ MB                     |
| **Startup**      | < 5 sec           | ~15-30 sec                   |
| **AI Tools**     | CLI only          | GUI extensions + CLI         |
| **Code Editing** | vim/nano          | Full VS Code editor          |
| **Best For**     | CLI tasks, DevOps | Code development, debugging  |

## 🐛 Troubleshooting

### Copilot CLI not working

```bash
# Check authentication
gh auth status

# Reinstall extension
gh extension install github/gh-copilot --force

# Test
gh copilot suggest "list files"
```

### AIChat not responding

```bash
# Check config
cat ~/.config/aichat/config.yaml

# Test with help
aichat --help

# Verify API key is set
echo $OPENAI_API_KEY
```

### Terminal won't load

Check container logs:

```bash
# From host
ssh root@eagle "pct exec 200 -- docker logs devfarm-<name>"

# Look for ttyd startup errors
```

### Lost connection

Terminal sessions persist with tmux:

```bash
# Reconnect and reattach
tmux attach
```

## 📚 Resources

- **ttyd**: https://github.com/tsl0922/ttyd
- **GitHub Copilot CLI**: https://docs.github.com/en/copilot/github-copilot-in-the-cli
- **aichat**: https://github.com/sigoden/aichat
- **Oh My Zsh**: https://ohmyz.sh/
- **tmux**: https://github.com/tmux/tmux

## 🎯 Use Cases

### 1. Learning Shell Commands

```bash
# Unsure about a command?
gh copilot explain "tar -xzvf file.tar.gz"

# Need to do something?
gh copilot suggest "find all log files larger than 100MB"
```

### 2. Quick Scripts

```bash
# Generate a script
aichat "bash script to monitor disk usage and send alerts" > monitor.sh
chmod +x monitor.sh
./monitor.sh
```

### 3. Git Operations

```bash
# All your repos are accessible via gh
gh repo list
gh repo clone myrepo
cd myrepo
# ... edit files with vim/nano ...
git commit -am "updates"
git push
```

### 4. Remote Server Management

```bash
# SSH from terminal environment
ssh user@remotehost

# Or use tmux to manage multiple connections
tmux new -s server1
ssh user@server1
# Ctrl+B then D to detach
tmux new -s server2
ssh user@server2
```

## 🎉 Why Terminal Mode?

**Speed**: Faster startup, lower resource usage  
**Focus**: No IDE distractions, pure CLI workflow  
**Lightweight**: Perfect for simple tasks  
**AI-Powered**: CLI AI tools at your fingertips  
**Persistent**: Your workspace and tmux sessions survive disconnects

Perfect for developers who live in the terminal! 🚀
