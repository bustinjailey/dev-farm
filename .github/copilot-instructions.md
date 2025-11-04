# Dev Farm - AI Coding Agent Instructions

## System Architecture

Dev Farm is a **self-hosted development environment orchestrator** running on Proxmox LXC #200 (`eagle.bustinjailey.org`). It manages isolated VS Code Server containers via a Flask dashboard.

**Critical: ALL commands must be executed through the LXC container:**

```bash
ssh root@eagle "pct exec 200 -- <command>"
```

### Component Topology

```
┌─── Dashboard (Flask + gevent) ──────────────────┐
│   Container: devfarm-dashboard                  │
│   Port: 5000                                    │
│   Volumes: /var/run/docker.sock, /opt/dev-farm │
│   Role: Orchestrates code-server containers    │
│   Registry: /data/environments.json             │
└─────────────────────────────────────────────────┘
           │ manages (via Docker socket)
           ▼
┌─── Code-Server Containers (N instances) ────────┐
│   Naming: devfarm-<kebab-case-name>            │
│   Ports: 8100+ (auto-assigned)                 │
│   Volumes: devfarm-<name> mounted at /workspace│
│   Modes: workspace | git | ssh                 │
│   Auth: GITHUB_TOKEN env var                   │
└─────────────────────────────────────────────────┘
```

**Key Insight**: Dashboard container mounts Docker socket (`/var/run/docker.sock`) to create/manage peer containers, not child containers.

## Critical Workflows

### Deploying Changes to Production LXC

**Never run commands directly in LXC.** Always through `pct exec`:

```bash
# Check container status
ssh root@eagle "pct exec 200 -- docker ps -a --filter 'label=dev-farm=true' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

# View dashboard logs
ssh root@eagle "pct exec 200 -- docker logs --tail 50 devfarm-dashboard"

# Restart dashboard
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm && docker compose restart'"

# Pull latest code and rebuild
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm && git pull && docker compose build --no-cache && docker compose up -d'"
```

### Update System (Self-Update Flow)

Dashboard has built-in self-update via `/api/system/update/start` endpoint:

1. Validates prerequisites (repo path exists, GitHub token optional for public repos)
2. Pulls latest code (`git pull origin main`)
3. Rebuilds images (`docker compose build`)
4. Restarts services (`docker compose up -d`)
5. Broadcasts progress via SSE (`env-status` events)

**Implementation Location**: `dashboard/app.py` lines 1040-1480 (`_run_system_update_thread`)

### Environment Creation Flow

1. User submits form → `POST /create` → `dashboard/app.py:356`
2. Name converted to kebab-case via `kebabify()` function
3. Container created with mode-specific env vars (Note: VS Code tunnel doesn't use exposed ports):
   - `DEV_MODE`: workspace | git | ssh
   - `GITHUB_TOKEN`, `GITHUB_USERNAME`, `GITHUB_EMAIL`
   - Mode-specific: `GIT_URL`, `SSH_HOST`, `SSH_USER`, `SSH_PATH`, `SSH_PASSWORD`
4. Registry updated in `/data/environments.json`
5. SSE broadcast: `registry-update` event
6. Container runs `docker/config/startup.sh` which:
   - Configures GitHub CLI (`gh auth login`)
   - Clones repo (git mode) or mounts SSH (ssh mode)
   - Applies VS Code settings from `docker/config/workspace-settings.json`
   - Starts VS Code Remote Tunnel: `code-insiders tunnel --accept-server-license-terms --name devfarm-<env-id> --disable-telemetry`
   - Extensions run on the server (not in browser) for persistent execution across disconnections

## Project-Specific Conventions

### Naming Patterns

- **Display names**: User-facing, any format ("My Cool Project")
- **Container IDs**: Kebab-case (`my-cool-project`), prefixed `devfarm-`
- **Volume names**: `devfarm-<kebab-case-id>`
- **Docker labels**: All containers have `dev-farm=true`, `dev-farm.id=<id>`

### Status State Machine

Container states (from Docker API):

- `created` → `starting` (while health check pending) → `running` (tunnel process verified)
- `exited` (startup failure or stopped)
- `paused`, `restarting`, `removing`, `dead` (rare)

**Frontend Issue**: Must handle ALL Docker states. CSS classes required:

```css
.status-running,
.status-stopped,
.status-starting,
.status-exited,
.status-created,
.status-paused,
.status-restarting,
.status-removing,
.status-dead;
```

**Location**: `dashboard/templates/index.html` lines 183-221

### SSE Event System

Real-time updates via Server-Sent Events (`/api/stream`):

```javascript
eventSource.addEventListener("env-status", (e) => {
  // Immediate UI update when container status changes
  // Payload: {env_id, status, port}
});

eventSource.addEventListener("registry-update", (e) => {
  // Debounced refresh when environments added/removed
});
```

**Backend Implementation**: `dashboard/app.py` lines 289-320 (`/api/stream`)  
**Monitoring Loop**: `background_status_monitor()` checks every 2 seconds, broadcasts on change

## Code Patterns & Anti-Patterns

### ✅ Correct: Update Container Status

```python
# Always check if status changed before broadcasting
with STATUS_LOCK:
    last_status = LAST_KNOWN_STATUS.get(env_id)
    if last_status != display_status:
        LAST_KNOWN_STATUS[env_id] = display_status
        broadcast_sse('env-status', {'env_id': env_id, 'status': display_status, 'port': port})
```

### ❌ Incorrect: Direct Docker Socket Access from Frontend

Never expose Docker socket directly to web UI. Always proxy through Flask routes.

### ✅ Correct: Environment Registry Management

```python
def load_registry():
    if os.path.exists(REGISTRY_FILE):
        with open(REGISTRY_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_registry(registry):
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    with open(REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2)
    broadcast_sse('registry-update', {'timestamp': time.time()})
```

## Integration Points

### GitHub OAuth Device Flow

**Location**: `dashboard/app.py` lines 686-889  
**Frontend**: `dashboard/templates/index.html` lines 978-1157

**Flow**:

1. User clicks "Connect GitHub" → `POST /api/github/oauth/start`
2. Backend calls GitHub API → gets `device_code` + `user_code`
3. Frontend polls `GET /api/github/oauth/poll` every 5 seconds (GitHub enforces minimum)
4. Handle `slow_down` error → increase interval by 5 seconds
5. On success, token saved to `/data/.github_token`
6. Token applied to new containers via `GITHUB_TOKEN` env var

**Critical**: `--user-data-dir` → `--server-data-dir` (VS Code Server v1.95+ breaking change)

### Proxmox LXC Deployment

**Primary deployment target**: LXC container #200 on `eagle.bustinjailey.org`  
**Installation path**: `/opt/dev-farm`  
**Network**: Caddy reverse proxy at `farm.bustinjailey.org` → `192.168.1.126:5000`

**Caddy configuration for SSE support**:

```caddy
farm.bustinjailey.org {
    reverse_proxy 192.168.1.126:5000 {
        flush_interval -1  # Disable buffering for SSE
        transport http {
            read_timeout 300s
            write_timeout 300s
        }
    }
}
```

## Debugging Commands

```bash
# Check environment health
ssh root@eagle "pct exec 200 -- docker exec devfarm-<name> pgrep -f 'code-insiders tunnel'"

# View startup logs
ssh root@eagle "pct exec 200 -- docker logs devfarm-<name> | grep -A 10 'Starting'"

# Verify GitHub auth
ssh root@eagle "pct exec 200 -- docker exec devfarm-<name> gh auth status"

# Inspect VS Code Server process
ssh root@eagle "pct exec 200 -- docker exec devfarm-<name> ps aux | grep code"

# Check port mapping
ssh root@eagle "pct exec 200 -- docker port devfarm-<name>"

# Test SSE connection
curl -N http://192.168.1.126:5000/api/stream
```

## Files to Read First

1. `dashboard/app.py` - Core orchestration logic
2. `docker/config/startup.sh` - Container initialization
3. `dashboard/templates/index.html` - Frontend SSE/UI logic
4. `docker-compose.yml` - Service definitions
5. `docs/QUICKREF.md` - Command reference

## Common Pitfalls

1. **Forgetting LXC context**: Commands fail if not wrapped in `pct exec 200`
2. **Missing CSS for Docker states**: Frontend breaks on `exited`, `paused` states
3. **OAuth polling too fast**: GitHub rate-limits at <5s intervals, returns `slow_down`
4. **Token not applied to existing containers**: Must recreate containers, not just restart
5. **Docker network misconfiguration**: Containers must be on `devfarm` bridge network for inter-container HTTP checks

## Recent Breaking Changes

- **2025-11-04**: Fixed SSE reconnection during system updates (commit 49f1a9c)
  - **Issue**: Dashboard restart during system update (after pulling code) caused SSE connection loss
  - **Symptom**: Modal showed "Update in progress..." with no progress messages after reconnection
  - **Solution**: Added `reopenUpdateModal()` to reconstruct UI state from `/api/system/update/status`
  - **Implementation**: When SSE reconnects and update in progress, fetches all stages and rebuilds UI
  - **Files changed**: `dashboard/templates/index.html` (added 100+ line function to replay stages)
  - **Testing**: System update flow now works correctly with dashboard restarts mid-update
- **2025-11-04**: Migrated from web mode to tunnel mode for server-side extensions
  - **Breaking**: Containers no longer expose port 8080 or use nginx proxy routing
  - **New**: All environments accessed via `https://vscode.dev/tunnel/devfarm-<env-id>`
  - **Why**: Extensions now run on server (not browser) for persistent execution across disconnections
  - **Health check**: Changed from HTTP probe to `pgrep -f "code-insiders tunnel"`
  - **Impact**: Port numbers still tracked in registry for consistency but not mapped to containers
  - **Access**: Users must authenticate to GitHub/Microsoft to access their tunnels
- **2025-10-30**: Fixed github.copilot-chat extension compatibility with VS Code Insiders
  - Issue: Extension uses proposed APIs (`chatParticipantPrivate`, `languageModelDataPart`, `chatSessionsProvider`) incompatible with latest Insiders
  - Solution: Install pre-release version using `--pre-release` flag instead of stable
  - Improved error detection in `install_extension_with_retry()` to catch API incompatibility messages
- **2025-10-29**: Added cross-tool MCP support for GitHub Copilot + Cline (commit PENDING)
  - **Copilot**: Global config in `~/.vscode-server-insiders/data/User/settings.json` with `github.copilot.chat.mcp.servers` key
  - **Cline**: Extension-specific config in `~/.vscode-server-insiders/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
  - **Format differences**: Copilot uses `{"servers": {...}}`, Cline uses `{"mcpServers": {...}}`
  - **Shared servers**: filesystem, github, brave-search configured for both tools
  - **Runtime init**: startup.sh initializes both configs, workspace mcp.json created as template
- **2025-10-29**: Fixed MCP server configuration for Cline extension (commit fbb77cc)
  - Path: `~/.vscode-server-insiders/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
  - Includes: filesystem, github, brave-search servers
  - Runtime initialization in startup.sh ensures settings persist
- **2025-10-29**: Fixed dashboard restart after updates using updater container (commit 20e2a5d)
  - Old: Daemon thread in dashboard (race condition)
  - New: Restart script runs in devfarm-updater container
- **2025-10-29**: Fixed background monitoring threads for SSE (commit aca2acc)
  - Moved thread initialization outside `__main__` block (works with gunicorn)
- **2025-10-29**: VS Code Insiders Server flag changed from `--user-data-dir` to `--server-data-dir` (commit c659251)
- **2025-10-29**: Added CSS for all 7 Docker states (commit 1cb0467)
- **2025-10-29**: Made GitHub token optional for public repo updates (commit ead2e1a)
