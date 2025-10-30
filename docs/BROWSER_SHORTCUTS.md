# Browser Keyboard Shortcuts for VS Code Server

This guide explains how to make VS Code keyboard shortcuts work properly in the browser without conflicts with native browser shortcuts like `Ctrl+P` (print) or `Ctrl+Shift+P` (new private window).

## Problem

Browser keyboard shortcuts often conflict with VS Code shortcuts:
- **Ctrl+P**: Browser tries to print instead of opening Quick Open
- **Ctrl+Shift+P**: Browser opens private window instead of Command Palette
- **Ctrl+W**: Browser closes tab instead of closing editor
- **Ctrl+Tab**: Browser switches tabs instead of switching between open files

## Solutions

### Option 1: Install as PWA (Progressive Web App) ⭐ **RECOMMENDED**

**Best solution** - Gives you a native-like experience with zero conflicts.

#### Chrome/Edge:
1. Open your Dev Farm environment: `https://farm.bustinjailey.org`
2. Click environment to open VS Code Server
3. Look for install icon (⊕) in address bar
4. Click **"Install"** or Menu → **"Install [environment name]"**
5. App opens in standalone window

#### Benefits:
- ✅ **All VS Code shortcuts work** without conflicts
- ✅ Runs in own window (no browser tabs/chrome)
- ✅ Appears in app launcher/taskbar
- ✅ Works offline after first load
- ✅ Can pin to taskbar/dock
- ✅ Separate from browser session

#### Firefox:
Firefox doesn't support PWA installation, use Option 2 or 3 instead.

---

### Option 2: Browser Extensions

Override browser shortcuts for specific domains.

#### Chrome/Edge:
1. Install [Shortcut Manager](https://chrome.google.com/webstore/detail/shortcut-manager/mgjjeipcdnnjhgodgjpfkffcejoljijf)
2. Configure exceptions for `farm.bustinjailey.org`
3. Disable conflicting shortcuts when on Dev Farm

#### Firefox:
1. Navigate to `about:config`
2. Search: `permissions.default.shortcuts`
3. Set value to **2** (allow sites to override shortcuts)

---

### Option 3: VS Code Server Settings (Built-in)

Dev Farm environments now include browser-optimized settings by default.

**Already configured** in `docker/config/workspace-settings.json`:

```json
{
  "keyboard.dispatch": "keyCode",
  "window.titleBarStyle": "custom"
}
```

**What this does**:
- `keyboard.dispatch: "keyCode"`: Captures raw key codes before browser interprets them
- `window.titleBarStyle: "custom"`: Uses VS Code's custom title bar (better keyboard handling)

**Limitations**: Some shortcuts may still be intercepted by browser (Ctrl+W, Ctrl+T, etc.)

---

### Option 4: Browser-Specific Workarounds

If you can't use PWA or extensions, these browser flags help:

#### Chrome/Edge:
1. Navigate to `chrome://flags`
2. Search: **"Override site keyboard shortcuts"**
3. Enable
4. Restart browser

#### Brave:
1. Settings → Shields → Advanced View
2. Enable **"Site-specific keybinding override"**

---

## Keyboard Shortcut Reference

With PWA or proper configuration, these shortcuts work natively:

| Shortcut | VS Code Action | Browser Conflict |
|----------|---------------|------------------|
| `Ctrl+P` | Quick Open | Print Dialog |
| `Ctrl+Shift+P` | Command Palette | New Private Window |
| `Ctrl+B` | Toggle Sidebar | Bookmarks |
| `Ctrl+W` | Close Editor | Close Tab |
| `Ctrl+Tab` | Switch Editors | Switch Browser Tabs |
| `Ctrl+Shift+T` | Reopen Closed Editor | Reopen Browser Tab |
| `F11` | Toggle Fullscreen | Browser Fullscreen |

---

## Testing Your Setup

After applying any solution, test these shortcuts:

1. **Ctrl+P**: Should open Quick Open (file search), not print dialog
2. **Ctrl+Shift+P**: Should open Command Palette, not private window
3. **Ctrl+B**: Should toggle sidebar, not bookmarks
4. **Ctrl+W**: Should close editor tab, not browser tab
5. **Ctrl+`**: Should toggle terminal

**If shortcuts still conflict**: PWA installation is the most reliable solution.

---

## Deployment Status

**Workspace settings** already include browser-optimized keyboard configuration:
- ✅ **Existing environments**: Apply settings via Command Palette → "Preferences: Open Workspace Settings" → reload
- ✅ **New environments**: Automatically configured in `workspace-settings.json`

---

## Troubleshooting

### Shortcuts Still Not Working

**Symptoms**: Shortcuts open browser actions instead of VS Code actions.

**Solutions**:
1. **Try PWA installation** (most reliable)
2. **Check browser extensions** aren't blocking shortcuts
3. **Verify VS Code settings**:
   ```bash
   # In environment container
   cat /workspace/.vscode/settings.json | grep keyboard
   ```
4. **Reload VS Code window**: Command Palette → "Developer: Reload Window"

### PWA Not Available

**Symptoms**: No install icon in address bar.

**Causes**:
- Browser doesn't support PWA (Firefox)
- Site not served over HTTPS (Dev Farm uses HTTPS via Caddy)
- VS Code Server not configured as PWA

**Solutions**:
- Use Chrome/Edge/Brave (best PWA support)
- Ensure accessing via `https://farm.bustinjailey.org` (not IP)
- Use browser extension method instead

### Keyboard Dispatch Not Working

**Symptoms**: Settings applied but shortcuts still conflict.

**Debug**:
```bash
# Check if settings applied
docker exec devfarm-<name> cat /workspace/.vscode/settings.json | grep dispatch

# Should show:
# "keyboard.dispatch": "keyCode"
```

**Fix**: Delete `/workspace/.vscode/settings.json` and let startup script regenerate.

---

## Technical Details

### How keyboard.dispatch Works

VS Code Server uses different keyboard event handling modes:

| Mode | Behavior | Best For |
|------|----------|----------|
| `"code"` (default) | Uses `event.code` (physical key location) | Desktop apps |
| `"keyCode"` | Uses `event.keyCode` (raw key codes) | **Browser environments** |

**Browser mode (`keyCode`)**: Captures events earlier in browser event chain, before many browser shortcuts trigger.

### Why PWA Works Better

Progressive Web Apps run in **standalone mode**:
- Separate process from browser
- No browser UI (tabs, address bar, bookmarks)
- OS treats as native app
- Browser shortcut handlers don't apply
- Full control over keyboard events

### VS Code Server Manifest

VS Code Server includes PWA manifest (`manifest.json`):
```json
{
  "name": "VS Code Server",
  "display": "standalone",
  "start_url": "/",
  "scope": "/",
  "theme_color": "#1e1e1e",
  "background_color": "#1e1e1e"
}
```

Browser detects this and offers PWA installation.

---

## References

- **VS Code Keyboard Shortcuts**: https://code.visualstudio.com/docs/getstarted/keybindings
- **VS Code Server**: https://code.visualstudio.com/docs/remote/vscode-server
- **PWA Installation**: https://web.dev/articles/install-web-apps
- **Chrome Flags**: `chrome://flags/#override-key-event-for-frame`

---

## Change History

- **2025-10-29**: Added browser-optimized keyboard settings to workspace-settings.json
  - `keyboard.dispatch: "keyCode"` for better browser compatibility
  - `window.titleBarStyle: "custom"` for improved keyboard handling
  - Automatic configuration in all new environments
