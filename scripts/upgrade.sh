#!/bin/bash
#
# Dev Farm Upgrade Script
# Pulls latest code from GitHub and rebuilds containers
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Dev Farm Upgrade Script ===${NC}\n"

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}Error: docker-compose.yml not found. Please run this script from the dev-farm directory.${NC}"
    exit 1
fi

# Load PAT token if PAT file exists (for local use)
if [ -f "PAT" ]; then
    echo -e "${YELLOW}Loading GitHub PAT from PAT file...${NC}"
    GITHUB_PAT=$(cat PAT | grep -v "^PAT:" | grep -v "^$" | head -n 1)
    export GITHUB_TOKEN="${GITHUB_PAT}"
fi

# Check if .env exists, if not prompt to create it
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Warning: .env file not found.${NC}"
    echo -e "Would you like to create it now from .env.example? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            echo -e "${GREEN}.env file created. Please edit it with your values.${NC}"
            echo -e "${YELLOW}Opening .env for editing...${NC}"
            ${EDITOR:-nano} .env
        else
            echo -e "${RED}Error: .env.example not found.${NC}"
            exit 1
        fi
    fi
fi

# Source .env if it exists
if [ -f ".env" ]; then
    echo -e "${GREEN}Loading configuration from .env...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
fi

# Verify we have a GitHub token
if [ -z "${GITHUB_TOKEN}" ]; then
    echo -e "${RED}Error: GITHUB_TOKEN not set. Please add it to .env file or PAT file.${NC}"
    exit 1
fi

echo -e "${GREEN}Step 1: Checking git repository...${NC}"
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}Initializing git repository...${NC}"
    git init
    git remote add origin https://github.com/bustinjailey/dev-farm.git
fi

echo -e "${GREEN}Step 2: Fetching latest code from GitHub...${NC}"
# Use token for authentication
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/bustinjailey/dev-farm.git"
git fetch origin

echo -e "${GREEN}Step 3: Checking current branch...${NC}"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo -e "Current branch: ${CURRENT_BRANCH}"

echo -e "${GREEN}Step 4: Pulling latest changes...${NC}"
git pull origin ${CURRENT_BRANCH} || {
    echo -e "${YELLOW}Pull failed, attempting to reset to origin/${CURRENT_BRANCH}...${NC}"
    git reset --hard origin/${CURRENT_BRANCH}
}

# Remove token from remote URL for security
git remote set-url origin "https://github.com/bustinjailey/dev-farm.git"

echo -e "${GREEN}Step 5: Rebuilding code-server image...${NC}"
docker build -t dev-farm/code-server:latest -f docker/Dockerfile.code-server docker/

echo -e "${GREEN}Step 6: Rebuilding dashboard image...${NC}"
docker compose build

echo -e "${GREEN}Step 7: Stopping existing containers...${NC}"
docker compose down

# Stop and remove dashboard container if it exists
if docker ps -a --format '{{.Names}}' | grep -q '^devfarm-dashboard$'; then
    echo -e "${YELLOW}Removing existing dashboard container...${NC}"
    docker stop devfarm-dashboard 2>/dev/null || true
    docker rm devfarm-dashboard 2>/dev/null || true
fi

echo -e "${GREEN}Step 8: Starting updated containers...${NC}"
docker compose up -d

echo -e "\n${GREEN}=== Upgrade Complete! ===${NC}"
echo -e "${GREEN}Dashboard is running at: http://localhost:5000${NC}"
echo -e "\n${YELLOW}Note: Existing dev environments will continue running with old configuration.${NC}"
echo -e "${YELLOW}Create new environments to use the updated code-server image.${NC}\n"

# Show running containers
echo -e "${GREEN}Running containers:${NC}"
docker ps --filter "name=devfarm" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
