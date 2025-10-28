# Self-Update and GitHub OAuth

This document describes the self-update and GitHub OAuth features added to Dev Farm.

## Features

### 1. Self-Update System

The dashboard can now update itself by pulling the latest code from GitHub and restarting.

**How it works:**

- Click the "⬆️ Update Now" button in the System Status section
- The system will:
  1. Pull latest code from GitHub (requires GitHub token)
  2. Rebuild Docker images if Dockerfile changed
  3. Restart the dashboard service
- A progress modal shows each stage of the update

**API Endpoint:** `POST /api/system/update`

**Requirements:**

- GitHub token must be configured (via OAuth or environment variable)
- LXC must have write access to `/opt` directory

### 2. GitHub OAuth Device Flow

Users can now authenticate with GitHub through a web-based OAuth flow instead of manually configuring tokens.

**How it works:**

1. Click the "🔗 Connect" button next to GitHub status
2. A modal appears with a device code
3. Click "Open GitHub" to visit the authorization page
4. Enter the device code on GitHub
5. Authorize the application
6. The dashboard automatically detects authorization and saves the token

**API Endpoints:**

- `POST /api/github/auth/start` - Initiate OAuth flow, returns device code
- `POST /api/github/auth/poll` - Poll for authorization completion
- `GET /api/github/auth/status` - Check current auth status (updated to use shared token)

**OAuth Configuration:**

- Client ID: `Iv1.b507a08c87ecfe98` (GitHub OAuth App for Dev Farm)
- Scopes: `repo`, `read:org`, `workflow`, `copilot`
- Device flow: No client secret required, secure for public apps

### 3. Shared Token Storage

GitHub tokens are now stored in a shared location accessible to all containers.

**Storage Location:** `/data/.github_token`

**How it works:**

- Dashboard saves token to `/data/.github_token` after OAuth
- All containers mount the `/data` volume
- `startup.sh` reads token from file if `GITHUB_TOKEN` env var not set
- Token persists across dashboard restarts
- Existing containers get token on next restart

**Code locations:**

- Dashboard: `dashboard/app.py` - `load_github_token()`, `save_github_token()`
- Containers: `docker/config/startup.sh` - fallback token reading

### 4. Token Application to Containers

**New containers:**

- Automatically read token from shared storage
- No manual token configuration needed

**Existing containers:**

- Restart the container to apply new token
- Token is read from `/data/.github_token` on startup
- No rebuild required

## Usage

### First-Time Setup

1. Access dashboard at `http://192.168.1.126:5000`
2. Click "🔗 Connect" button in System Status
3. Follow OAuth flow to authorize with GitHub
4. Create new environments - they'll have GitHub auth automatically

### Updating Dev Farm

1. Click "⬆️ Update Now" button in System Status
2. Wait for update to complete (shows progress)
3. Dashboard will reload with latest code

### Applying Token to Existing Environments

After connecting GitHub OAuth:

1. Existing containers need to be restarted to pick up the token
2. Click "⏸️ Stop" on the environment
3. Click "▶️ Start" to restart
4. Container will now have GitHub authentication

## Architecture

### Token Flow

```
User → OAuth Modal → GitHub Device Flow → /data/.github_token
                                               ↓
Dashboard reads from /data/.github_token ←────┤
                                               ↓
Containers read from /data/.github_token on startup
```

### Update Flow

```
User → Update Button → /api/system/update
                             ↓
                       1. git pull origin main
                             ↓
                       2. Check if Dockerfile changed
                             ↓
                       3. Rebuild images (if needed)
                             ↓
                       4. Restart dashboard
                             ↓
                       User sees updated dashboard
```

## Security Notes

- Token file permissions: `0600` (owner read/write only)
- Token stored in Docker volume (not in git)
- Device flow doesn't require client secret (secure for public apps)
- OAuth scopes limited to necessary permissions
- Token never exposed in UI or logs

## Troubleshooting

### Update fails with "GitHub token not configured"

- Run OAuth flow first to get a token
- Or set `GITHUB_TOKEN` in `.env` file

### Existing containers don't have GitHub auth

- Restart the container to apply the shared token
- Token is read from `/data/.github_token` on startup

### OAuth flow times out

- Device codes expire after 15 minutes
- Start a new OAuth flow if expired

### Update fails during git pull

- Check that LXC has network access to GitHub
- Verify repository is public or token has repo access
- Check `/opt` directory is writable

## Future Enhancements

Possible improvements:

- Auto-update on schedule
- Version comparison (show commits behind)
- Rollback to previous version
- Update notifications
- Live token injection (no restart required)
- OAuth flow for other git providers (GitLab, Bitbucket)
