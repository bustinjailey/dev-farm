#!/bin/bash
#
# Setup Secrets - Helper script for configuring secrets
# Can be run locally or on remote LXC
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Dev Farm Secrets Setup ===${NC}\n"

# Determine the directory
if [ -f "docker-compose.yml" ]; then
    DEVFARM_DIR="$(pwd)"
elif [ -f "/opt/docker-compose.yml" ]; then
    DEVFARM_DIR="/opt"
else
    echo -e "${RED}Error: Cannot find dev-farm directory${NC}"
    echo "Please run this script from the dev-farm directory or /opt"
    exit 1
fi

cd "$DEVFARM_DIR"

echo -e "Working directory: ${GREEN}$DEVFARM_DIR${NC}\n"

# Check if .env already exists
if [ -f ".env" ]; then
    echo -e "${YELLOW}Warning: .env file already exists.${NC}"
    echo -e "Do you want to overwrite it? (y/n)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Keeping existing .env file."
        echo -e "\n${GREEN}To edit your secrets:${NC} nano .env"
        exit 0
    fi
fi

# Copy from example
if [ ! -f ".env.example" ]; then
    echo -e "${RED}Error: .env.example not found${NC}"
    exit 1
fi

cp .env.example .env
echo -e "${GREEN}✓ Created .env from template${NC}\n"

# Prompt for GitHub token
echo -e "${YELLOW}Enter your GitHub Personal Access Token:${NC}"
echo "  (Get one at: https://github.com/settings/tokens/new)"
echo "  Required scopes: repo, read:org, workflow, copilot"
echo ""
read -s -p "Token: " GITHUB_TOKEN_INPUT
echo ""

if [ -z "$GITHUB_TOKEN_INPUT" ]; then
    echo -e "${RED}Error: Token cannot be empty${NC}"
    exit 1
fi

# Prompt for GitHub username (default: bustinjailey)
echo ""
echo -e "${YELLOW}GitHub Username [bustinjailey]:${NC}"
read -r GITHUB_USERNAME_INPUT
GITHUB_USERNAME_INPUT=${GITHUB_USERNAME_INPUT:-bustinjailey}

# Prompt for GitHub email
echo -e "${YELLOW}GitHub Email [${GITHUB_USERNAME_INPUT}@users.noreply.github.com]:${NC}"
read -r GITHUB_EMAIL_INPUT
GITHUB_EMAIL_INPUT=${GITHUB_EMAIL_INPUT:-${GITHUB_USERNAME_INPUT}@users.noreply.github.com}

# Generate random secret key
SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 64)

# Update .env file
sed -i "s|GITHUB_TOKEN=.*|GITHUB_TOKEN=${GITHUB_TOKEN_INPUT}|" .env
sed -i "s|GITHUB_USERNAME=.*|GITHUB_USERNAME=${GITHUB_USERNAME_INPUT}|" .env
sed -i "s|GITHUB_EMAIL=.*|GITHUB_EMAIL=${GITHUB_EMAIL_INPUT}|" .env
sed -i "s|SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env

echo ""
echo -e "${GREEN}✓ Configured .env file${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  • GitHub Username: ${GITHUB_USERNAME_INPUT}"
echo "  • GitHub Email: ${GITHUB_EMAIL_INPUT}"
echo "  • Secret Key: Generated"
echo "  • GitHub Token: Set (hidden)"
echo ""

# Ask if they want to restart dashboard
if docker ps --format '{{.Names}}' | grep -q 'devfarm-dashboard'; then
    echo -e "${YELLOW}Dashboard is running. Restart to apply changes? (y/n)${NC}"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo -e "\n${GREEN}Restarting dashboard...${NC}"
        docker compose restart
        echo -e "${GREEN}✓ Dashboard restarted${NC}"
    fi
fi

echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Create a new environment from the dashboard"
echo "  2. Open the environment and verify GitHub authentication:"
echo "     • Open terminal and run: gh auth status"
echo "     • Should show you're logged in as ${GITHUB_USERNAME_INPUT}"
echo ""
echo -e "${YELLOW}To edit secrets later:${NC} nano .env"
echo -e "${YELLOW}After editing:${NC} docker compose restart"
echo ""
