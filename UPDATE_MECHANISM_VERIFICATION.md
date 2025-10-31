# Update Mechanism Verification

**Date**: October 31, 2025  
**Status**: ✅ **VERIFIED - All Systems Operational**

## Summary

The Dev Farm update functionality is working correctly. The temporary dashboard downtime you experienced was **expected behavior** during the update process.

## How the Update System Works

### Architecture

```
User clicks "Update" in UI
    ↓
Dashboard API (/api/system/update/start)
    ↓
Background thread starts
    ↓
Uses devfarm-updater container
    (has Docker socket mounted)
    ↓
1. Git pull latest code
2. Rebuild code-server image
3. Rebuild dashboard image
4. Schedule dashboard restart
    ↓
Updater container runs restart script
    (5s delay → stop → remove → recreate)
    ↓
Dashboard comes back online with new code
```

### Key Design Decisions

1. **Updater Container Pattern**: Uses a separate `devfarm-updater` container to avoid self-termination issues

   - Dashboard cannot restart itself directly (container dies before restart completes)
   - Updater container persists and executes restart script

2. **5-Second Delay**: Gives the update API response time to return to the user before shutdown

3. **Docker Compose Integration**: Uses `docker compose` commands to maintain consistency with manual deployment

## Command Comparison

### Manual Commands (What You Were Running)

```bash
# Pull latest code
cd /opt/dev-farm && git pull

# Rebuild code-server
docker build --no-cache -f docker/Dockerfile.code-server \
  -t dev-farm/code-server:latest docker/

# Rebuild and restart dashboard
docker compose build dashboard && docker compose up -d dashboard
```

### Automated Update Commands (Inside Updater Container)

```bash
# Pull latest code
cd /opt/dev-farm && git pull origin main

# Rebuild code-server (inside updater)
docker build --no-cache -t dev-farm/code-server:latest \
  -f /opt/dev-farm/docker/Dockerfile.code-server /opt/dev-farm/docker

# Rebuild dashboard (inside updater)
cd /opt/dev-farm && docker build --no-cache \
  -t dev-farm-dashboard:latest ./dashboard

# Restart dashboard (via background script in updater)
docker compose -f /opt/dev-farm/docker-compose.yml stop dashboard
docker compose -f /opt/dev-farm/docker-compose.yml rm -f dashboard
docker compose -f /opt/dev-farm/docker-compose.yml up -d dashboard
```

## Verification Results (Oct 31, 2025)

### ✅ Update Logs (from updater container)

```
Waiting 5 seconds for dashboard to finish current request...
Stopping dashboard container...
Container devfarm-dashboard  Stopped
Removing old dashboard container...
Container devfarm-dashboard  Removed
Starting dashboard with new image...
Container devfarm-dashboard  Created
Container devfarm-dashboard  Started
Waiting for dashboard to be healthy...
Check 1: Status=running
✅ Dashboard is running after 1 seconds
```

### ✅ Current System State

- **Git SHA**: `e8606ef` (latest commit with Ctrl+W fix and UI cleanup)
- **Dashboard Status**: `Up 5 minutes (healthy)`
- **Working Directory**: Clean (no uncommitted changes)

### ✅ Image Consistency

- Code-server image: `dev-farm/code-server:latest`
- Dashboard image: `dev-farm-dashboard` (built from docker-compose)
- Both images rebuilt with `--no-cache` to ensure latest code

## Differences Between Manual and Automated Approach

| Aspect                  | Manual Commands           | Automated Update              |
| ----------------------- | ------------------------- | ----------------------------- |
| **Execution Context**   | Direct on LXC host        | Inside updater container      |
| **Dashboard Restart**   | Manual compose restart    | Scheduled script with delay   |
| **Image Cleanup**       | Manual prune needed       | Automatic prune of old images |
| **Progress Visibility** | Terminal output only      | SSE stream to UI + logs       |
| **Error Recovery**      | Manual intervention       | Detailed error stages shown   |
| **Safety**              | Risk of mid-update issues | 5s delay + health checks      |

## Why Manual Commands Still Work

Your manual commands work because:

1. **Same Docker daemon**: Both approaches talk to the same Docker engine
2. **Image names match**: Both create the same image tags
3. **Compose consistency**: Docker Compose uses the same logic regardless of where it's called from
4. **No state conflicts**: Registry is file-based, not container-specific

The only difference is the **orchestration layer** - the automated update adds:

- Progress tracking
- Error handling
- Safe restart scheduling
- UI feedback

## Recommendations

### ✅ Use the UI Update Button When:

- You want visibility into the update process
- You're updating from a remote location
- You want automatic image cleanup
- You prefer SSE progress updates

### ✅ Use Manual Commands When:

- Testing specific changes locally
- Debugging build issues
- Need to rebuild only one component
- Performing maintenance tasks

### ✅ Both Approaches Are Safe:

- They produce identical results
- Registry stays in sync
- Existing environments unaffected (they use current images until recreated)

## devfarm.sh Script Status

The `scripts/devfarm.sh` script is **correctly implemented** and matches the Docker commands:

```bash
# Build code-server
devfarm.sh build code-server
→ docker build -t dev-farm/code-server:latest -f Dockerfile.code-server .

# Start dashboard
devfarm.sh start
→ docker compose up -d

# Restart dashboard
devfarm.sh restart
→ docker compose down && docker compose up -d
```

**Note**: The script doesn't have an `update` command - that's intentional. Updates are designed to run through the web UI to provide progress feedback and handle the self-restart complexity.

## Next Steps

1. **No action needed** - system is working as designed
2. Continue using either UI updates or manual commands based on your needs
3. When creating new environments, they'll automatically use the latest images (SHA: e8606ef)

## Technical Notes

### Why the 5-Second Delay?

```bash
echo "Waiting 5 seconds for dashboard to finish current request..."
sleep 5
```

This ensures the HTTP response from `/api/system/update/start` reaches the user before the container shuts down. Without this, the user would see a network error even though the update succeeded.

### Health Check Integration

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:5000/health"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 15s
```

The restart script waits for the container to be `running`, but Docker Compose's health check ensures the dashboard is actually serving traffic before marking it healthy.

### Image Tag Strategy

- **Code-server**: `dev-farm/code-server:latest` (explicit tag)
- **Dashboard**: `dev-farm-dashboard` (implicit :latest from compose project name)

Both approaches work, and Docker resolves `:latest` automatically if omitted.

---

**Conclusion**: Your update system is robust and working correctly. The temporary downtime was expected and lasted less than 10 seconds. Both manual commands and the UI update button are valid approaches that produce identical results.
