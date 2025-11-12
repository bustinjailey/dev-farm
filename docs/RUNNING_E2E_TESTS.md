# Running E2E Tests - Complete Guide

**Date**: 2025-11-12  
**Issue**: Docker-dependent tests failing with remote execution  
**Solution**: Run inside LXC or use local Docker

## Problem

Tests like `copilot-automation.spec.ts` use dockerode to directly access Docker containers:
- `container.exec()` - Execute commands in containers
- `container.logs()` - Fetch container logs
- `container.restart()` - Restart containers

When running tests locally against `BASE_URL=https://farm.bustinjailey.org`:
- Tests connect to LOCAL Docker socket
- Containers exist on REMOTE Docker (inside LXC #200 on eagle)
- Result: `getContainer()` returns `null` → tests fail

## Solution: Run Tests Inside LXC

### Docker-Dependent Tests (copilot-automation.spec.ts)

**MUST run inside LXC container #200:**

```bash
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm/dashboard && \
  RUN_SLOW_TESTS=1 \
  npx playwright test tests/integration-slow/copilot-automation.spec.ts \
  --reporter=line \
  --timeout=300000'"
```

**Why**: These tests need direct Docker API access via `/var/run/docker.sock`

### API-Based Tests (copilot-status-sse.spec.ts, ai-chat-echo-bug.spec.ts)

**Can run remotely** (no Docker access needed):

```bash
cd dashboard && \
RUN_SLOW_TESTS=1 \
SKIP_WEBSERVER=1 \
BASE_URL=https://farm.bustinjailey.org \
npx playwright test tests/integration-slow/copilot-status-sse.spec.ts \
--reporter=line \
--timeout=300000
```

**Why**: These tests use dashboard HTTP API, not Docker directly

## Test Categories

### Category 1: Docker-Dependent (Run Inside LXC)

- `copilot-automation.spec.ts` - Uses `container.exec()`, `container.logs()`, `container.restart()`
- `copilot-cli.spec.ts` - Uses `container.exec()` to check installed packages
- `terminal-proxy.spec.ts` - Uses `container.inspect()` for network settings

**Detection**: Tests auto-skip if `BASE_URL` contains `farm.bustinjailey.org`

### Category 2: API-Based (Can Run Remotely)

- `copilot-status-sse.spec.ts` - Uses SSE events and DOM inspection
- `ai-chat-echo-bug.spec.ts` - Uses page interactions only
- `ai-chat-dashboard.spec.ts` - Uses dashboard API endpoints

## Full Test Suite Commands

### Run ALL Tests Inside LXC

```bash
ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm/dashboard && \
  RUN_SLOW_TESTS=1 \
  npx playwright test tests/integration-slow \
  --reporter=line \
  --timeout=300000'"
```

### Run Unit Tests (Anywhere)

```bash
cd dashboard && npm test
```

### Run Fast E2E Tests (Anywhere)

```bash
cd dashboard && \
SKIP_WEBSERVER=1 \
BASE_URL=https://farm.bustinjailey.org \
npx playwright test tests/integration \
--reporter=line
```

## Implementation Details

### Remote Detection Logic

```typescript
test.beforeAll(() => {
  const isRemote = baseURL.includes('farm.bustinjailey.org');
  
  if (isRemote) {
    console.log('⚠ Remote testing detected - Docker tests will be skipped');
    console.log('  To run full tests, execute inside LXC');
  }
  
  docker = new Docker(); // Works locally, fails remotely
});

async function getContainer(envName: string): Promise<Docker.Container | null> {
  if (baseURL.includes('farm.bustinjailey.org')) {
    console.log('⊘ Skipping Docker operation - remote testing mode');
    test.skip();
    return null;
  }
  
  // Normal Docker operations
  const containers = await docker.listContainers({ all: true });
  // ...
}
```

### Error Messages

When running remotely, tests show:
```
⚠ Remote testing detected - Docker tests will be skipped
  To run full tests, execute inside LXC:
  ssh root@eagle "pct exec 200 -- bash -c 'cd /opt/dev-farm/dashboard && RUN_SLOW_TESTS=1 npx playwright test tests/integration-slow/copilot-automation.spec.ts --reporter=line'"

⊘ Skipping Docker operation - remote testing mode
```

## Alternative: Run Dashboard Locally

If you don't want to SSH into LXC, run dashboard locally:

```bash
# Terminal 1: Start local dashboard
cd dashboard && npm run build && npm start

# Terminal 2: Run tests against local instance
cd dashboard && \
RUN_SLOW_TESTS=1 \
BASE_URL=http://localhost:5000 \
npx playwright test tests/integration-slow/copilot-automation.spec.ts \
--reporter=line \
--timeout=300000
```

**Caveat**: Local dashboard needs Docker access and proper configuration

## Troubleshooting

### Test Fails: `expect(container).toBeTruthy() - Received: null`

**Cause**: Running remotely without Docker access  
**Fix**: Run inside LXC or set `BASE_URL=http://localhost:5000`

### Test Hangs Serving HTML Report

**Cause**: Missing `--reporter=line` flag  
**Fix**: Always add `--reporter=line` to playwright commands

### Cannot Connect to Docker

**Cause**: Docker socket not accessible  
**Fix**: Verify `/var/run/docker.sock` exists and is accessible

### SSH Command Syntax Errors

**Cause**: Nested quotes not escaped properly  
**Fix**: Use double quotes for outer ssh, single quotes for inner bash

## Related Files

- `dashboard/tests/integration-slow/copilot-automation.spec.ts` - Docker-dependent tests
- `dashboard/playwright.config.ts` - Test configuration
- `TEST_UPDATES_SUMMARY.md` - Test changes documentation
- `.github/copilot-instructions.md` - Deployment instructions
