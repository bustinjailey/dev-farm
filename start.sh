#!/bin/bash

# Dev Farm Dashboard Startup Script
# This script starts the dashboard in a way that's consistent with the auto-update mechanism

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Dev Farm Dashboard..."
echo "Working directory: $SCRIPT_DIR"
echo ""

# Check if docker compose is available
if ! command -v docker &> /dev/null; then
    echo "❌ Error: docker command not found"
    echo "Please ensure Docker is installed and in your PATH"
    exit 1
fi

# Check if docker compose (V2) is available
if ! docker compose version &> /dev/null; then
    echo "❌ Error: docker compose (V2) not available"
    echo "Please ensure Docker Compose V2 is installed"
    echo "See: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker Compose V2 found"
echo ""

# Check if .env file exists or if required env vars are set
if [ ! -f .env ] && [ -z "$GITHUB_TOKEN" ]; then
    echo "⚠️  Warning: No .env file found and GITHUB_TOKEN not set"
    echo "GitHub integration may not work without authentication"
    echo ""
fi

# Stop any existing dashboard containers (same as update mechanism)
echo "🛑 Stopping existing dashboard..."
docker compose stop dashboard 2>/dev/null || true

# Remove old container (same as update mechanism)
echo "🗑️  Removing old container..."
docker compose rm -f dashboard 2>/dev/null || true

# Start dashboard with docker compose (same as update mechanism)
echo "🔄 Starting dashboard..."
docker compose up -d --no-build dashboard

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Failed to start dashboard"
    echo "Check the logs with: docker compose logs dashboard"
    exit 1
fi

echo ""
echo "⏳ Waiting for dashboard to become healthy..."

# Wait up to 30 seconds for dashboard to be healthy
for i in {1..30}; do
    CONTAINER_STATUS=$(docker inspect --format='{{.State.Status}}' devfarm-dashboard 2>/dev/null || echo "not-found")
    
    if [ "$CONTAINER_STATUS" = "not-found" ]; then
        echo "  [$i/30] Container not found yet..."
        sleep 1
        continue
    fi
    
    if [ "$CONTAINER_STATUS" = "created" ]; then
        if [ $i -gt 3 ]; then
            echo "  [$i/30] Container stuck in 'created' state, manually starting..."
            docker start devfarm-dashboard 2>/dev/null || true
        else
            echo "  [$i/30] Container created, waiting for start..."
        fi
        sleep 1
        continue
    fi
    
    if [ "$CONTAINER_STATUS" = "running" ]; then
        # Check if healthcheck exists
        HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' devfarm-dashboard 2>/dev/null || echo "none")
        
        if [ "$HEALTH_STATUS" = "healthy" ]; then
            echo "  [$i/30] ✅ Dashboard is healthy!"
            break
        elif [ "$HEALTH_STATUS" = "none" ]; then
            echo "  [$i/30] ✅ Dashboard is running (no healthcheck configured)"
            break
        else
            echo "  [$i/30] Dashboard running but not healthy yet (status: $HEALTH_STATUS)..."
        fi
    else
        echo "  [$i/30] Container status: $CONTAINER_STATUS"
    fi
    
    sleep 1
done

# Final check
FINAL_STATUS=$(docker inspect --format='{{.State.Status}}' devfarm-dashboard 2>/dev/null || echo "not-found")

if [ "$FINAL_STATUS" = "running" ]; then
    PORT=$(docker compose port dashboard 5000 2>/dev/null | cut -d: -f2)
    echo ""
    echo "✅ Dashboard started successfully!"
    echo ""
    echo "Dashboard is accessible at:"
    echo "  - http://localhost:${PORT:-5000}"
    echo "  - http://$(hostname -I | awk '{print $1}'):${PORT:-5000}"
    echo ""
    echo "To view logs:    docker compose logs -f dashboard"
    echo "To stop:         docker compose stop dashboard"
    echo "To restart:      docker compose restart dashboard"
    echo ""
else
    echo ""
    echo "⚠️  Dashboard may not have started correctly (status: $FINAL_STATUS)"
    echo ""
    echo "Check logs with: docker compose logs dashboard"
    echo ""
    exit 1
fi
