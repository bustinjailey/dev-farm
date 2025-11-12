# Copilot CLI Device Authentication Flow - Full Automation

## Overview

As of commit `d2f76da`, the Dev Farm terminal mode environments now **fully automate** the GitHub Copilot CLI device authentication flow. Users no longer need to manually:

1. Confirm workspace trust
2. Enter the `/login` command
3. Select their GitHub account
4. Extract the device code

All these steps are now handled automatically by the startup script.

## Implementation Details

### Automated Steps

The automation is implemented in `docker/config/startup-terminal.sh` (lines 120-180) and performs the following sequence:

#### 1. Workspace Trust Confirmation (First Run Only)

```bash
# Wait for workspace trust prompt
sleep 5
OUTPUT=$(tmux capture-pane -t copilot-auth -p -S -50)

# Check if workspace trust prompt appeared
if echo "$OUTPUT" | grep -q "Confirm folder trust"; then
  echo "✓ Workspace trust prompt detected, auto-confirming..."
  # Send "2" to select "Yes, and remember this folder for future sessions"
  tmux send-keys -t copilot-auth "2" C-m
  sleep 3
  OUTPUT=$(tmux capture-pane -t copilot-auth -p -S -50)
fi
```

**Why**: Copilot CLI requires workspace trust on first run to prevent malicious code execution.

**Options**:
- Option 1: "Yes, I trust the authors" (trust once, will ask again)
- Option 2: "Yes, and remember this folder for future sessions" (trust and persist)
- Option 3: "No, I don't trust the authors" (deny)

**Persistence**: Option 2 remembers the trust decision, so this prompt doesn't appear on subsequent container restarts.

#### 2. Login Command Automation

```bash
# Check if /login is needed
if echo "$OUTPUT" | grep -q "Please use /login to sign in to use Copilot"; then
  echo "✓ Login prompt detected, sending /login command..."
  tmux send-keys -t copilot-auth "/login" C-m
  sleep 3
  OUTPUT=$(tmux capture-pane -t copilot-auth -p -S -50)
fi
```

**Why**: Copilot CLI requires an explicit `/login` command to initiate the device authentication flow.

#### 3. Account Selection Automation

```bash
# Check if account selection is needed
if echo "$OUTPUT" | grep -q "What account do you want to log into?"; then
  echo "✓ Account selection prompt detected, selecting GitHub.com..."
  # Send "1" to select "GitHub.com" (vs "GitHub Enterprise Cloud")
  tmux send-keys -t copilot-auth "1" C-m
  sleep 3
  OUTPUT=$(tmux capture-pane -t copilot-auth -p -S -50)
fi
```

**Why**: Copilot CLI can authenticate to either GitHub.com or GitHub Enterprise. We default to GitHub.com for most users.

#### 4. Device Code Extraction

```bash
# Parse device code and URL from output
# Device code format: XXXX-XXXX (e.g., 7F6B-693E)
if echo "$OUTPUT" | grep -q "github.com/login/device"; then
  # Try multiple patterns to extract device code
  DEVICE_CODE=$(echo "$OUTPUT" | grep -oP "Enter one-time code: \K[A-Z0-9]{4}-[A-Z0-9]{4}" || \
                echo "$OUTPUT" | grep -oP "Enter one time code: \K[A-Z0-9]{4}-[A-Z0-9]{4}" || \
                echo "$OUTPUT" | grep -oP "code: \K[A-Z0-9]{4}-[A-Z0-9]{4}" || \
                echo "$OUTPUT" | grep -oP "\b[A-Z0-9]{4}-[A-Z0-9]{4}\b" | head -1 || \
                echo "")
  DEVICE_URL=$(echo "$OUTPUT" | grep -oP "https://github\.com/login/device[^\s]*" || echo "https://github.com/login/device")

  if [ -n "$DEVICE_CODE" ]; then
    echo "✓ Device code obtained: $DEVICE_CODE"
    echo "✓ Auth URL: $DEVICE_URL"

    # Write device auth info to file for dashboard to read
    cat > "$DEVICE_AUTH_FILE" <<EOF
{
  "code": "$DEVICE_CODE",
  "url": "$DEVICE_URL",
  "timestamp": "$(date -Iseconds)"
}
EOF
  fi
fi
```

**Why**: Multiple regex patterns handle variations in Copilot CLI output format across versions.

**Format**: Device codes are always 8 uppercase alphanumeric characters with a hyphen (e.g., `7F6B-693E`).

### Device Auth File Structure

The extracted device code is saved to `/home/coder/workspace/.copilot-device-auth.json`:

```json
{
  "code": "7F6B-693E",
  "url": "https://github.com/login/device",
  "timestamp": "2025-01-14T08:00:00-08:00"
}
```

The dashboard's background monitor (`dashboard/src/server/routes/environments.ts`) polls this file and broadcasts SSE events when detected.

## User Experience

### Before Automation (Old Flow)

1. User creates terminal environment
2. Container starts, shows workspace trust prompt
3. **User manually presses "1"** to trust workspace
4. Copilot shows "Please use /login to sign in"
5. **User manually types `/login`** and presses Enter
6. Copilot shows account selection
7. **User manually presses "1"** to select GitHub.com
8. Copilot displays device code
9. **User manually copies code** and opens GitHub auth page

### After Automation (New Flow)

1. User creates terminal environment
2. Container starts and **automatically**:
   - Confirms workspace trust
   - Sends `/login` command
   - Selects GitHub.com account
   - Extracts device code
3. Dashboard **automatically**:
   - Displays device auth banner on environment card
   - Shows device code with copy button
   - Provides "Authenticate" link to GitHub
4. User clicks copy button → opens GitHub auth page → pastes code → completes authentication
5. Auth monitor detects completion → dashboard updates UI

## Testing

### E2E Test Updates

The E2E test suite (`dashboard/tests/integration-slow/terminal-auth-banner.spec.ts`) has been updated to verify automation:

#### Test 2: Device Code Display

- ✅ Verifies device code appears with correct format (XXXX-XXXX)
- ✅ Checks container logs for automation markers:
  - `✓ Workspace trust prompt detected`
  - `✓ Login prompt detected`
  - `✓ Account selection prompt detected`
  - `✓ Device code obtained`

#### Test 7: Workspace Trust Persistence (NEW)

- ✅ Creates terminal environment → waits for auth flow
- ✅ Restarts container → checks logs
- ✅ Verifies workspace trust prompt does NOT appear again
- ✅ Confirms trust decision persists across restarts

### Running Tests

```bash
cd dashboard

# Run all terminal auth tests
RUN_SLOW_TESTS=1 SKIP_WEBSERVER=1 BASE_URL=https://farm.bustinjailey.org \
  npx playwright test tests/integration-slow/terminal-auth-banner.spec.ts \
  --reporter=line --timeout=300000
```

**Note**: Always use `--reporter=line` to prevent Playwright from serving HTML report and hanging.

## Monitoring & Debugging

### Log Markers

All automation steps are logged with `✓` checkmarks for easy identification:

```
✓ Workspace trust prompt detected, auto-confirming...
✓ Login prompt detected, sending /login command...
✓ Account selection prompt detected, selecting GitHub.com...
✓ Device code obtained: 7F6B-693E
✓ Auth URL: https://github.com/login/device
✓ Device auth info saved to /home/coder/workspace/.copilot-device-auth.json
✓ Starting authentication monitor
```

### Checking Container Logs

```bash
# From LXC host
ssh root@eagle "pct exec 200 -- docker logs devfarm-<env-name> | grep '✓'"

# Directly in container
docker logs devfarm-<env-name> 2>&1 | grep -A 2 'Workspace trust\|Login prompt\|Account selection\|Device code'
```

### Common Issues

1. **Workspace trust appears every restart**

   - Likely: User manually selected option 2 or 3 (don't remember)
   - Fix: Delete container volume and recreate environment

2. **Device code not extracted**

   - Check logs for which prompts were detected
   - Verify Copilot CLI output format hasn't changed
   - May need to add new regex pattern

3. **Account selection timeout**

   - Check if Copilot CLI added new prompts before account selection
   - Increase sleep delays in startup script

4. **Auth never completes**
   - Check `copilot-auth-monitor.sh` is running in background
   - Verify user actually completed device flow on GitHub
   - Check `$AUTH_STATUS_FILE` for timeout

## Architecture

### Component Interaction

```
┌─────────────────────────────────────────────────────────┐
│ startup-terminal.sh                                     │
│  1. Start Copilot CLI in tmux session                  │
│  2. Detect prompts via tmux capture-pane               │
│  3. Auto-send responses via tmux send-keys             │
│  4. Extract device code with regex                     │
│  5. Write to .copilot-device-auth.json                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ copilot-auth-monitor.sh (background)                   │
│  - Polls tmux session output every 5 seconds           │
│  - Detects "Welcome|How can I help|What can I do"      │
│  - Writes "authenticated" to .copilot-auth-status      │
│  - Removes .copilot-device-auth.json                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Dashboard Backend (routes/environments.ts)             │
│  - background_status_monitor() polls every 2 seconds   │
│  - Reads .copilot-device-auth.json                     │
│  - Broadcasts SSE event: device-auth                   │
│  - Reads .copilot-auth-status                          │
│  - Broadcasts SSE event: copilot-ready                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Dashboard Frontend (App.svelte)                        │
│  - deviceAuthHandler: Updates envDeviceAuth[env_id]    │
│  - copilotReadyHandler: Clears envDeviceAuth[env_id]   │
│  - EnvironmentCard: Shows device auth banner           │
│  - AiChatPanel: Shows device auth in chat panel        │
└─────────────────────────────────────────────────────────┘
```

### File Locations

| Component        | Path                                                            | Purpose                 |
| ---------------- | --------------------------------------------------------------- | ----------------------- |
| Startup script   | `docker/config/startup-terminal.sh`                             | Automation logic        |
| Auth monitor     | `docker/config/copilot-auth-monitor.sh`                         | Completion detection    |
| Device auth file | `/home/coder/workspace/.copilot-device-auth.json`               | Code + URL storage      |
| Auth status file | `/home/coder/workspace/.copilot-auth-status`                    | State tracking          |
| Backend routes   | `dashboard/src/server/routes/environments.ts`                   | SSE broadcasting        |
| Frontend app     | `dashboard/frontend/src/App.svelte`                             | SSE handling            |
| E2E tests        | `dashboard/tests/integration-slow/terminal-auth-banner.spec.ts` | Automation verification |

## Related Commits

- **d2f76da** (this implementation) - Automated workspace trust, /login, account selection, device code extraction
- **08faefd** (previous) - Fixed Copilot chat echo bug, added copilot-ready SSE handler
- **49f1a9c** (prior) - Fixed SSE reconnection during system updates

## Future Improvements

1. **GitHub Enterprise Support**: Add config option to select Enterprise vs GitHub.com
2. **Retry Logic**: Auto-retry device code extraction if first attempt fails
3. **Timeout Handling**: Better UX when device flow expires without completion
4. **Auto-Authentication**: Explore headless browser automation to complete device flow (requires GITHUB_TOKEN with device_code scope)
