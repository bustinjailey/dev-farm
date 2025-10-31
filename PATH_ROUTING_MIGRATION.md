# Path-Based Routing Migration Guide

**Date**: October 31, 2025  
**Change**: Migrated from port-based routing (`:8100`, `:8101`) to path-based routing (`/env/project-name`)

## What Changed

### Before (Port-Based)

```
https://farm.bustinjailey.org/ → Dashboard
https://farm.bustinjailey.org:8100/ → Environment 1
https://farm.bustinjailey.org:8101/ → Environment 2
...100+ ports exposed
```

### After (Path-Based)

```
https://farm.bustinjailey.org/ → Dashboard
https://farm.bustinjailey.org/env/my-project → Environment
https://farm.bustinjailey.org/env/test-app → Environment
...single port (5000)
```

## Architecture Changes

### New Component: nginx Reverse Proxy

```
┌─────────────────────────────────────────────────────────────┐
│  Caddy (farm.bustinjailey.org → 192.168.1.126:5000)       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  nginx Proxy (devfarm-proxy:80)                            │
│  - Listens on host port 5000                                │
│  - Routes / to dashboard                                    │
│  - Routes /env/{id} to environment containers               │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
      ┌────────────────┴────────────────┐
      ↓                                 ↓
┌──────────────┐              ┌──────────────────┐
│  Dashboard   │              │  Environments    │
│  (port 5000) │              │  (internal 8080) │
│  Internal    │              │  devfarm-{id}    │
└──────────────┘              └──────────────────┘
```

### Key Benefits

1. **Simplified Caddy Config**: One rule instead of 100+
2. **Clean URLs**: No port numbers in links
3. **Better UX**: Shareable, memorable URLs
4. **Security**: No need to expose 100+ ports through firewall
5. **Scalability**: Add unlimited environments without port conflicts

## Deployment Steps

### 1. Update Caddy Configuration

Replace this entire section:

```caddyfile
# OLD - Delete these
farm.bustinjailey.org:8100, farm.bustinjailey.org:8101 ... {
    import lan_reverse_proxy_http 192.168.1.126:{http.request.port}
}

farm.bustinjailey.org {
    import lan_reverse_proxy_http 192.168.1.126:5000
}
```

With this simple rule:

```caddyfile
# NEW - Just this one rule
farm.bustinjailey.org {
    import lan_reverse_proxy_http 192.168.1.126:5000
}
```

Apply changes:

```bash
sudo systemctl reload caddy
# Or if using docker:
docker restart caddy
```

### 2. Deploy Updated Dev Farm

On your Proxmox LXC (eagle, container 200):

```bash
# Pull latest code
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm && git pull'"

# Rebuild images
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm && docker compose build --no-cache'"

# Restart services (will include new proxy)
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm && docker compose up -d'"

# Verify proxy is running
ssh root@eagle "pct exec 200 -- docker ps | grep devfarm-proxy"
```

### 3. Verify Everything Works

```bash
# Check proxy health
curl -I http://192.168.1.126:5000/proxy-health

# Test dashboard (from LAN)
curl https://farm.bustinjailey.org/

# Test environment (replace with actual env name)
curl https://farm.bustinjailey.org/env/my-project
```

## What Existing Environments Need

**Nothing!** Existing environments continue to work:

- They still listen on internal ports (8100+)
- nginx routes traffic to them via Docker DNS
- No recreation needed (but recommended to see new URLs)

New environments will automatically use path-based URLs.

## Rolling Back (If Needed)

If you need to revert:

1. Stop the proxy:

   ```bash
   ssh root@eagle "pct exec 200 -- docker stop devfarm-proxy"
   ```

2. Restore Caddy config with port-based rules

3. Remove proxy from docker-compose.yml and expose dashboard port 5000 directly

4. Restart dashboard:
   ```bash
   ssh root@eagle "pct exec 200 -- docker compose restart dashboard"
   ```

## Troubleshooting

### "Environment Not Ready" Error

This is normal if:

- Environment container is still starting up (wait 10-30 seconds)
- Environment is stopped (start it from dashboard)

To debug:

```bash
# Check if container exists and is running
ssh root@eagle "pct exec 200 -- docker ps | grep devfarm-{env-name}"

# Check container logs
ssh root@eagle "pct exec 200 -- docker logs devfarm-{env-name}"

# Check VS Code Server started
ssh root@eagle "pct exec 200 -- docker logs devfarm-{env-name} | grep 'serve-web'"
```

### Dashboard Shows Port-Based URLs

If dashboard still shows old `:8100` style links:

1. Check EXTERNAL_URL is set:

   ```bash
   ssh root@eagle "pct exec 200 -- docker exec devfarm-dashboard env | grep EXTERNAL_URL"
   ```

2. Should show:

   ```
   EXTERNAL_URL=https://farm.bustinjailey.org
   ```

3. If not correct, rebuild dashboard:
   ```bash
   ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm && docker compose up -d --force-recreate dashboard'"
   ```

### WebSocket Connections Fail

Ensure your Caddy config includes WebSocket support (already in your `lan_reverse_proxy_http` snippet):

```caddyfile
header_up Upgrade {http.request.header.Upgrade}
header_up Connection {http.request.header.Connection}
flush_interval -1
```

### nginx Can't Find Environment Container

nginx uses Docker's internal DNS (127.0.0.11). Verify:

1. Environment container exists:

   ```bash
   docker ps | grep devfarm-{env-name}
   ```

2. Container is on `devfarm` network:

   ```bash
   docker inspect devfarm-{env-name} | grep NetworkMode
   ```

3. nginx can resolve it:
   ```bash
   docker exec devfarm-proxy nslookup devfarm-{env-name}
   ```

## Testing Checklist

- [ ] Caddy config updated and reloaded
- [ ] Dev Farm code pulled and deployed
- [ ] `devfarm-proxy` container running
- [ ] Dashboard accessible at `https://farm.bustinjailey.org/`
- [ ] Existing environments still work
- [ ] New environment URLs use `/env/{name}` format
- [ ] VS Code opens successfully from environment links
- [ ] WebSocket connections work (terminal, language features)
- [ ] SSE works (live status updates in dashboard)

## Next Steps

1. **Update Documentation**: Any docs referencing port numbers (`:8100`)
2. **Bookmark New URLs**: Update saved links to use new format
3. **Share Clean Links**: Can now share `farm.bustinjailey.org/env/demo` instead of ports
4. **Monitor**: Check nginx logs for any routing issues

## Technical Details

### nginx Resolver Configuration

nginx uses Docker's internal DNS:

```nginx
resolver 127.0.0.11 valid=10s;
```

This allows dynamic container discovery without hardcoding IPs.

### Container Name Extraction

nginx extracts environment ID from URL:

```nginx
location ~ ^/env/([a-zA-Z0-9_-]+)(/.*)?$ {
    set $env_name $1;
    set $backend "devfarm-$env_name:8080";
    proxy_pass http://$backend...;
}
```

Example: `/env/my-project` → routes to `devfarm-my-project:8080`

### Error Handling

502/503/504 errors show friendly HTML page instead of nginx error.

### Health Check

Proxy exposes `/proxy-health` for monitoring (excluded from access logs).

---

**Migration Complete!** 🎉

Your Dev Farm now uses clean, professional URLs that are easier to share and manage.
