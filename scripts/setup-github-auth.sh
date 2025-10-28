#!/bin/bash

echo "🔐 Setting up GitHub Token for Dev Farm"
echo "========================================"
echo ""
echo "📋 What you need:"
echo "   1. A GitHub Personal Access Token (PAT)"
echo "   2. Create one at: https://github.com/settings/tokens"
echo ""
echo "✅ Required scopes for your token:"
echo "   - repo (Full repository access)"
echo "   - read:org (Read organization data)"  
echo "   - workflow (Update GitHub Actions)"
echo "   - copilot (GitHub Copilot access)"
echo ""
read -sp "Enter your GitHub token: " GITHUB_TOKEN
echo ""
echo ""

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ No token provided. Exiting."
    exit 1
fi

# Create .env file
echo "📝 Creating .env file..."
cat > /opt/dev-farm/.env << EOF
# GitHub Personal Access Token
GITHUB_TOKEN=$GITHUB_TOKEN

# Optional: Brave Search API key
BRAVE_API_KEY=

# Dashboard Configuration  
DEBUG=false
SECRET_KEY=$(openssl rand -hex 32)
EOF

chmod 600 /opt/dev-farm/.env

echo "✅ .env file created"
echo ""

# Rebuild the code-server image
echo "🔨 Rebuilding code-server image with GitHub auth..."
cd /opt/dev-farm
docker build -t dev-farm/code-server:latest -f docker/Dockerfile.code-server docker/

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "🔄 Restarting dashboard to pick up new environment variables..."
    docker compose restart
    
    echo ""
    echo "🎉 Setup complete!"
    echo ""
    echo "📝 What's new:"
    echo "   ✓ Theme: Dark Modern (matching your VS Code)"
    echo "   ✓ GitHub: Pre-authenticated in all new environments"
    echo "   ✓ Copilot: Ready to use (if you have a license)"
    echo "   ✓ Settings: Synced from your local VS Code"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Create a new environment from the dashboard"
    echo "   2. Open it - you'll be logged into GitHub automatically"
    echo "   3. Start coding with Copilot enabled!"
    echo ""
else
    echo ""
    echo "❌ Build failed. Check the error messages above."
    exit 1
fi
