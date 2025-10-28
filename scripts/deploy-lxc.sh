#!/bin/bash
# Deploy Dev Farm LXC Container to Proxmox
# This script must be run ON the Proxmox host

set -e

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

# Configuration
PROXMOX_HOST="${PROXMOX_HOST:-192.168.1.157}"
LXC_ID="${LXC_ID:-200}"  # Change if this ID is already in use
LXC_HOSTNAME="${LXC_HOSTNAME:-devfarm}"
LXC_PASSWORD="${LXC_PASSWORD:-devfarm123}"  # Change this!
LXC_CORES="${LXC_CORES:-4}"
LXC_MEMORY="${LXC_MEMORY:-8192}"  # MB
LXC_SWAP="${LXC_SWAP:-2048}"  # MB
LXC_DISK_SIZE="${LXC_DISK_SIZE:-100}"  # GB
LXC_STORAGE="${LXC_STORAGE:-local-lvm}"  # Change to match your storage
LXC_BRIDGE="${LXC_BRIDGE:-vmbr0}"
LXC_IP="${LXC_IP:-dhcp}"  # Or set static like "192.168.1.200/24"
LXC_GATEWAY="${LXC_GATEWAY:-192.168.1.1}"  # Only used if static IP
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
OSTEMPLATE="${OSTEMPLATE:-ubuntu-22.04-standard}"  # Will search for latest

# GitHub configuration (optional)
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_USERNAME="${GITHUB_USERNAME:-bustinjailey}"

# Function to check if running on Proxmox host
check_proxmox_host() {
    if ! command -v pct &> /dev/null; then
        log_error "This script must be run on a Proxmox host"
        log_info "The 'pct' command was not found"
        log_info ""
        log_info "To run this script remotely, use:"
        log_info "  scp scripts/deploy-lxc.sh root@${PROXMOX_HOST}:/tmp/"
        log_info "  ssh root@${PROXMOX_HOST} 'bash /tmp/deploy-lxc.sh'"
        exit 1
    fi
}

# Function to check if CT ID is available
check_ct_id() {
    if pct status $LXC_ID &> /dev/null; then
        log_error "Container ID $LXC_ID is already in use"
        log_info "Please set a different LXC_ID environment variable"
        log_info "Example: LXC_ID=201 $0"
        exit 1
    fi
}

# Function to find the latest template
find_template() {
    log_info "Searching for Ubuntu 22.04 template..."
    
    # List available templates
    local template=$(pveam list $TEMPLATE_STORAGE | grep -i "ubuntu-22.04-standard" | tail -n1 | awk '{print $1}')
    
    if [ -z "$template" ]; then
        log_warning "Ubuntu 22.04 template not found, downloading..."
        pveam update
        pveam download $TEMPLATE_STORAGE ubuntu-22.04-standard_22.04-1_amd64.tar.zst
        template=$(pveam list $TEMPLATE_STORAGE | grep -i "ubuntu-22.04-standard" | tail -n1 | awk '{print $1}')
    fi
    
    if [ -z "$template" ]; then
        log_error "Failed to find or download Ubuntu template"
        exit 1
    fi
    
    echo "$template"
}

# Function to create LXC container
create_lxc() {
    local template=$1
    
    log_info "Creating LXC container $LXC_ID ($LXC_HOSTNAME)..."
    
    # Build network configuration
    local net_config="name=eth0,bridge=$LXC_BRIDGE,firewall=1"
    if [ "$LXC_IP" == "dhcp" ]; then
        net_config="${net_config},ip=dhcp"
    else
        net_config="${net_config},ip=${LXC_IP},gw=${LXC_GATEWAY}"
    fi
    
    # Create the container
    pct create $LXC_ID "$template" \
        --hostname "$LXC_HOSTNAME" \
        --password "$LXC_PASSWORD" \
        --cores $LXC_CORES \
        --memory $LXC_MEMORY \
        --swap $LXC_SWAP \
        --rootfs "${LXC_STORAGE}:${LXC_DISK_SIZE}" \
        --net0 "$net_config" \
        --nameserver 8.8.8.8 \
        --nameserver 8.8.4.4 \
        --unprivileged 1 \
        --features nesting=1,fuse=1 \
        --onboot 1 \
        --start 1
    
    log_success "Container created with ID: $LXC_ID"
}

# Function to wait for container to be ready
wait_for_container() {
    log_info "Waiting for container to start and be ready..."
    sleep 5
    
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if pct exec $LXC_ID -- systemctl is-system-running --wait 2>/dev/null | grep -q "running\|degraded"; then
            log_success "Container is ready"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    
    log_warning "Container may not be fully ready, but continuing..."
}

# Function to install Docker and dependencies
install_dependencies() {
    log_info "Installing Docker and dependencies..."
    
    pct exec $LXC_ID -- bash -c "
        export DEBIAN_FRONTEND=noninteractive
        
        # Update system
        apt-get update
        apt-get upgrade -y
        
        # Install basic tools
        apt-get install -y curl git ca-certificates gnupg lsb-release
        
        # Install Docker
        curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
        sh /tmp/get-docker.sh
        
        # Install Docker Compose
        apt-get install -y docker-compose-plugin docker-compose
        
        # Enable and start Docker
        systemctl enable docker
        systemctl start docker
    "
    
    log_success "Dependencies installed"
}

# Function to deploy Dev Farm
deploy_devfarm() {
    log_info "Deploying Dev Farm..."
    
    local github_token_export=""
    if [ -n "$GITHUB_TOKEN" ]; then
        github_token_export="export GITHUB_TOKEN='$GITHUB_TOKEN'"
    fi
    
    pct exec $LXC_ID -- bash -c "
        cd /opt
        
        # Clone repository
        git clone https://github.com/${GITHUB_USERNAME}/dev-farm.git
        cd dev-farm
        
        # Set GitHub token if provided
        $github_token_export
        
        # Make script executable
        chmod +x scripts/devfarm.sh
        
        # Run setup
        ./scripts/devfarm.sh setup
    "
    
    log_success "Dev Farm deployed"
}

# Function to get container IP
get_container_ip() {
    local ip=$(pct exec $LXC_ID -- hostname -I | awk '{print $1}')
    echo "$ip"
}

# Function to display summary
show_summary() {
    local container_ip=$(get_container_ip)
    
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║          Dev Farm LXC Deployment Complete! 🚀             ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    log_success "Container ID: $LXC_ID"
    log_success "Hostname: $LXC_HOSTNAME"
    log_success "IP Address: $container_ip"
    echo ""
    log_info "Access Dev Farm Dashboard:"
    echo "  ${GREEN}http://${container_ip}:5000${NC}"
    echo ""
    log_info "Default password for dev environments: ${YELLOW}code${NC}"
    log_info "Root password: ${YELLOW}$LXC_PASSWORD${NC}"
    echo ""
    log_info "Useful commands:"
    echo "  - Access console: ${BLUE}pct enter $LXC_ID${NC}"
    echo "  - Stop container: ${BLUE}pct stop $LXC_ID${NC}"
    echo "  - Start container: ${BLUE}pct start $LXC_ID${NC}"
    echo "  - Delete container: ${BLUE}pct destroy $LXC_ID${NC}"
    echo ""
    log_info "View Dev Farm logs:"
    echo "  ${BLUE}pct exec $LXC_ID -- docker logs -f devfarm-dashboard${NC}"
    echo ""
}

# Function to show help
show_help() {
    cat << EOF
Dev Farm LXC Deployment Script
================================

This script creates and configures an LXC container on Proxmox for Dev Farm.

Usage:
  Run on Proxmox host:
    ./deploy-lxc.sh

  Run remotely:
    scp scripts/deploy-lxc.sh root@${PROXMOX_HOST}:/tmp/
    ssh root@${PROXMOX_HOST} 'bash /tmp/deploy-lxc.sh'

Environment Variables:
  LXC_ID          Container ID (default: 200)
  LXC_HOSTNAME    Container hostname (default: devfarm)
  LXC_PASSWORD    Root password (default: devfarm123)
  LXC_CORES       CPU cores (default: 4)
  LXC_MEMORY      Memory in MB (default: 8192)
  LXC_SWAP        Swap in MB (default: 2048)
  LXC_DISK_SIZE   Disk size in GB (default: 100)
  LXC_STORAGE     Proxmox storage (default: local-lvm)
  LXC_BRIDGE      Network bridge (default: vmbr0)
  LXC_IP          IP config: 'dhcp' or '192.168.1.200/24' (default: dhcp)
  LXC_GATEWAY     Gateway if static IP (default: 192.168.1.1)
  GITHUB_TOKEN    GitHub token for MCP servers (optional)
  GITHUB_USERNAME GitHub username (default: bustinjailey)

Examples:
  # Custom container ID and static IP
  LXC_ID=201 LXC_IP=192.168.1.200/24 ./deploy-lxc.sh

  # With GitHub token
  GITHUB_TOKEN=ghp_xxxxx ./deploy-lxc.sh

  # Custom resources
  LXC_CORES=8 LXC_MEMORY=16384 LXC_DISK_SIZE=200 ./deploy-lxc.sh

EOF
}

# Main execution
main() {
    if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
        show_help
        exit 0
    fi
    
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║        Dev Farm LXC Deployment for Proxmox 🚜             ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    
    log_info "Configuration:"
    echo "  - Container ID: $LXC_ID"
    echo "  - Hostname: $LXC_HOSTNAME"
    echo "  - Cores: $LXC_CORES"
    echo "  - Memory: ${LXC_MEMORY}MB"
    echo "  - Disk: ${LXC_DISK_SIZE}GB"
    echo "  - IP: $LXC_IP"
    echo ""
    
    # Confirm
    read -p "Continue with deployment? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
    
    check_proxmox_host
    check_ct_id
    
    local template=$(find_template)
    log_success "Using template: $template"
    
    create_lxc "$template"
    wait_for_container
    install_dependencies
    deploy_devfarm
    
    show_summary
}

main "$@"
