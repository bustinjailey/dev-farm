#!/bin/bash
#
# Deploy to LXC - Deploys dev-farm to a Proxmox LXC with secrets
# Usage: ./deploy-to-lxc.sh <proxmox-host> <lxc-id>
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ $# -lt 2 ]; then
    echo "Usage: $0 <proxmox-host> <lxc-id>"
    echo ""
    echo "Example: $0 eagle.bustinjailey.org 200"
    exit 1
fi

PROXMOX_HOST="$1"
LXC_ID="$2"

echo -e "${GREEN}=== Deploy Dev Farm to LXC ===${NC}\n"
echo "Proxmox Host: $PROXMOX_HOST"
echo "LXC Container: $LXC_ID"
echo ""

# Check if PAT file exists locally
if [ ! -f "PAT" ]; then
    echo -e "${RED}Error: PAT file not found${NC}"
    echo "Create a PAT file with your GitHub token first:"
    echo "  echo 'your_token_here' > PAT"
    exit 1
fi

GITHUB_TOKEN=$(cat PAT | grep -v "^PAT:" | grep -v "^$" | head -n 1)

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}Error: No token found in PAT file${NC}"
    exit 1
fi

echo -e "${GREEN}Step 1: Cloning repository to LXC...${NC}"
ssh root@${PROXMOX_HOST} "pct exec ${LXC_ID} -- bash -c '\
    cd /opt && \
    rm -rf .git && \
    git clone https://${GITHUB_TOKEN}@github.com/bustinjailey/dev-farm.git /tmp/dev-farm-new && \
    rm -rf /opt/* && \
    mv /tmp/dev-farm-new/.git /opt/ && \
    mv /tmp/dev-farm-new/* /opt/ && \
    mv /tmp/dev-farm-new/.* /opt/ 2>/dev/null || true && \
    rm -rf /tmp/dev-farm-new && \
    git remote set-url origin https://github.com/bustinjailey/dev-farm.git \
'"

echo -e "${GREEN}Step 2: Configuring secrets...${NC}"

# Prompt for GitHub email
echo -e "${YELLOW}GitHub Email [bustinjailey@users.noreply.github.com]:${NC}"
read -r GITHUB_EMAIL_INPUT
GITHUB_EMAIL_INPUT=${GITHUB_EMAIL_INPUT:-bustinjailey@users.noreply.github.com}

# Generate secret key
SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 64)

# Create .env file on LXC
ssh root@${PROXMOX_HOST} "pct exec ${LXC_ID} -- bash -c 'cat > /opt/.env << EOF
# GitHub Configuration
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_USERNAME=bustinjailey
GITHUB_EMAIL=${GITHUB_EMAIL_INPUT}

# Dashboard Configuration
DEBUG=false
SECRET_KEY=${SECRET_KEY}
EOF
'"

echo -e "${GREEN}Step 3: Building code-server image...${NC}"
ssh root@${PROXMOX_HOST} "pct exec ${LXC_ID} -- bash -c '\
    cd /opt && \
    docker build -t dev-farm/code-server:latest -f docker/Dockerfile.code-server docker/ \
'"

echo -e "${GREEN}Step 4: Starting dashboard...${NC}"
ssh root@${PROXMOX_HOST} "pct exec ${LXC_ID} -- bash -c '\
    cd /opt && \
    docker stop devfarm-dashboard 2>/dev/null || true && \
    docker rm devfarm-dashboard 2>/dev/null || true && \
    docker compose up -d \
'"

# Get LXC IP
LXC_IP=$(ssh root@${PROXMOX_HOST} "pct exec ${LXC_ID} -- hostname -I | awk '{print \$1}'")

echo ""
echo -e "${GREEN}=== Deployment Complete! ===${NC}"
echo ""
echo -e "${GREEN}Dashboard URL:${NC} http://${LXC_IP}:5000"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Open the dashboard in your browser"
echo "  2. Create a new environment"
echo "  3. Verify GitHub authentication with: gh auth status"
echo ""
echo -e "${YELLOW}To upgrade later:${NC}"
echo "  ssh root@${PROXMOX_HOST} 'pct exec ${LXC_ID} -- bash -c \"cd /opt && ./scripts/upgrade.sh\"'"
echo ""
