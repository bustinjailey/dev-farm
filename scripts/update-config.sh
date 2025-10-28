#!/bin/bash

set -e

echo "🔧 Dev Farm Configuration Update"
echo "================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env and add your GITHUB_TOKEN"
    echo "   Get a token from: https://github.com/settings/tokens"
    echo ""
    read -p "Press Enter after you've added your token..."
fi

# Source the .env file
source .env

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ] || [ "$GITHUB_TOKEN" = "your_github_token_here" ]; then
    echo "❌ GITHUB_TOKEN not set in .env file"
    echo "   Please edit .env and add your GitHub Personal Access Token"
    exit 1
fi

echo "✅ GITHUB_TOKEN found"
echo ""

# Rebuild the code-server image
echo "🔨 Rebuilding code-server image..."
docker build -t dev-farm/code-server:latest -f docker/Dockerfile.code-server docker/

echo ""
echo "✅ Configuration updated successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Restart the dashboard: docker compose restart"
echo "   2. Create a new environment to test"
echo "   3. Your new environments will have GitHub pre-authenticated!"
echo ""
