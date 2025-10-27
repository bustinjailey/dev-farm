#!/bin/bash
# Dev Farm Management Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Build the code-server image
build_image() {
    log_info "Building code-server image..."
    cd "$PROJECT_DIR/docker"
    docker build -t dev-farm/code-server:latest -f Dockerfile.code-server .
    log_success "Code-server image built successfully"
}

# Start the dashboard
start_dashboard() {
    log_info "Starting Dev Farm dashboard..."
    cd "$PROJECT_DIR"
    docker-compose up -d
    log_success "Dashboard started successfully"
    log_info "Access the dashboard at: http://localhost:5000"
}

# Stop the dashboard
stop_dashboard() {
    log_info "Stopping Dev Farm dashboard..."
    cd "$PROJECT_DIR"
    docker-compose down
    log_success "Dashboard stopped"
}

# Create a new environment
create_env() {
    local name=$1
    local project=${2:-general}
    
    if [ -z "$name" ]; then
        log_error "Please provide an environment name"
        echo "Usage: $0 create <name> [project]"
        exit 1
    fi
    
    log_info "Creating environment: $name"
    
    # Call the dashboard API
    curl -X POST http://localhost:5000/create \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$name\", \"project\": \"$project\"}" \
        -s | python3 -m json.tool
    
    log_success "Environment created"
}

# List all environments
list_envs() {
    log_info "Active development environments:"
    echo ""
    docker ps --filter "label=dev-farm=true" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

# Delete an environment
delete_env() {
    local name=$1
    
    if [ -z "$name" ]; then
        log_error "Please provide an environment name"
        echo "Usage: $0 delete <name>"
        exit 1
    fi
    
    log_info "Deleting environment: $name"
    
    curl -X POST "http://localhost:5000/delete/$name" -s | python3 -m json.tool
    
    log_success "Environment deleted"
}

# Show logs
show_logs() {
    cd "$PROJECT_DIR"
    docker-compose logs -f
}

# Setup initial configuration
setup() {
    log_info "Setting up Dev Farm..."
    
    check_docker
    
    # Build images
    build_image
    
    # Create network
    docker network inspect devfarm >/dev/null 2>&1 || docker network create devfarm
    
    # Start dashboard
    start_dashboard
    
    log_success "Setup complete!"
    echo ""
    log_info "📱 Access your Dev Farm dashboard at: http://localhost:5000"
    log_info "🔐 Default password for environments: code"
    log_info "💡 Run './scripts/devfarm.sh help' for more commands"
}

# Show help
show_help() {
    cat << EOF
Dev Farm Management Script
==========================

Usage: $0 <command> [options]

Commands:
  setup              - Initial setup (build images, start dashboard)
  build              - Build the code-server Docker image
  start              - Start the dashboard
  stop               - Stop the dashboard
  restart            - Restart the dashboard
  create <name> [project] - Create a new environment
  delete <name>      - Delete an environment
  list               - List all environments
  logs               - Show dashboard logs
  help               - Show this help message

Examples:
  $0 setup
  $0 create my-project python
  $0 list
  $0 delete my-project

EOF
}

# Main command handler
case "${1:-help}" in
    setup)
        setup
        ;;
    build)
        check_docker
        build_image
        ;;
    start)
        check_docker
        start_dashboard
        ;;
    stop)
        stop_dashboard
        ;;
    restart)
        check_docker
        stop_dashboard
        start_dashboard
        ;;
    create)
        check_docker
        create_env "$2" "$3"
        ;;
    delete)
        check_docker
        delete_env "$2"
        ;;
    list)
        check_docker
        list_envs
        ;;
    logs)
        show_logs
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
