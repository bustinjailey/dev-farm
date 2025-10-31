# Dev Farm Reverse Proxy

## Architecture

```
Internet/LAN
    ↓
Caddy (farm.bustinjailey.org)
    ↓
Nginx Proxy (devfarm-proxy:80 → host:5000)
    ├─ / → Dashboard (devfarm-dashboard:5000)
    └─ /env/{env-id} → Environment Containers (devfarm-{env-id}:8080)
```

## Path-Based Routing

Instead of exposing 100+ ports (8100, 8101, etc.), all environments are accessed through clean URLs:

- **Dashboard**: `https://farm.bustinjailey.org/`
- **Environment**: `https://farm.bustinjailey.org/env/my-project`

## Benefits

1. **Simplified External Routing**: Caddy only needs one rule for `farm.bustinjailey.org`
2. **Clean URLs**: `/env/{env-id}` instead of `:8100`, `:8101`, etc.
3. **No Port Exhaustion**: All environments share port 5000 externally
4. **Better Security**: Internal routing, no need to expose individual ports
5. **Scalability**: Can add hundreds of environments without firewall changes

## Caddy Configuration

Update your Caddyfile to this simple rule:

```caddyfile
farm.bustinjailey.org {
    import lan_reverse_proxy_http 192.168.1.126:5000
}
```

That's it! All routing is handled internally by nginx.

## Container Naming Convention

For nginx to route correctly, containers must follow this pattern:

- Dashboard: `devfarm-dashboard`
- Environments: `devfarm-{env-id}` (e.g., `devfarm-my-project`)

## nginx Configuration

The nginx config template (`nginx.conf.template`) handles:

- **Root path** (`/`): Routes to dashboard for management UI
- **Environment paths** (`/env/*`): Dynamic routing to containers using Docker DNS
- **WebSocket support**: Critical for VS Code Server real-time features
- **SSE support**: Server-Sent Events for dashboard live updates
- **Error handling**: Friendly 503 page when environment isn't running
- **Long timeouts**: 600s for VS Code operations

## Environment Variables

Set in `docker-compose.yml`:

- `EXTERNAL_URL=https://farm.bustinjailey.org` - Public URL for link generation

Path-based routing is always enabled (the only routing mode).

## Testing

```bash
# Start the proxy
docker compose up -d proxy

# Check proxy health
curl http://localhost:5000/proxy-health

# Test dashboard
curl http://localhost:5000/

# Test environment (must be running)
curl http://localhost:5000/env/my-project
```

## Migration from Port-Based Routing

Old URLs still work internally (containers listen on 8100+), but users will see clean URLs:

- Before: `http://192.168.1.126:8100`
- After: `https://farm.bustinjailey.org/env/my-project`

## Troubleshooting

### Environment shows "Not Ready"

- Check container is running: `docker ps | grep devfarm-my-project`
- Check container logs: `docker logs devfarm-my-project`
- Verify VS Code Server started (look for "serve-web" in logs)

### WebSocket connection failed

- Ensure nginx config has `proxy_set_header Upgrade $http_upgrade`
- Check firewall allows WebSocket connections
- Verify Caddy config has `flush_interval -1`

### DNS resolution error in nginx

- Nginx uses Docker's internal DNS (127.0.0.11)
- Ensure containers are on same network (`devfarm`)
- Container names must match exactly: `devfarm-{env-id}`
