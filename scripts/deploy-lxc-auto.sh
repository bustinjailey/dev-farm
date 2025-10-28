#!/bin/bash
# Deploy Dev Farm LXC Container to Proxmox (Non-Interactive)
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
LXC_ID="${LXC_ID:-200}"
LXC_HOSTNAME="${LXC_HOSTNAME:-devfarm}"
LXC_PASSWORD="${LXC_PASSWORD:-devfarm123}"
LXC_CORES="${LXC_CORES:-4}"
LXC_MEMORY="${LXC_MEMORY:-8192}"
LXC_SWAP="${LXC_SWAP:-2048}"
LXC_DISK_SIZE="${LXC_DISK_SIZE:-100}"
LXC_STORAGE="${LXC_STORAGE:-local-lvm}"
LXC_BRIDGE="${LXC_BRIDGE:-vmbr0}"
LXC_IP="${LXC_IP:-dhcp}"
LXC_GATEWAY="${LXC_GATEWAY:-192.168.1.1}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
OSTEMPLATE="${OSTEMPLATE:-local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst}"

# GitHub configuration
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_USERNAME="${GITHUB_USERNAME:-bustinjailey}"

# Function to check if running on Proxmox host
check_proxmox_host() {
    if ! command -v pct &> /dev/null; then
        log_error "This script must be run on a Proxmox host"
        log_info "The 'pct' command was not found"
        exit 1
    fi
}

# Function to check if CT ID is available
check_ct_id() {
    if pct status $LXC_ID &> /dev/null; then
        log_error "Container ID $LXC_ID is already in use"
        log_info "Use a different LXC_ID: LXC_ID=201 $0"
        exit 1
    fi
}

# Function to verify template exists
find_template() {
    log_info "Verifying template exists..." >&2
    
    # Check if the specified template exists
    if pveam list $TEMPLATE_STORAGE 2>/dev/null | grep -q "$(basename $OSTEMPLATE)"; then
        log_success "Found template: $OSTEMPLATE" >&2
        echo "$OSTEMPLATE"
    else
        log_error "Template not found: $OSTEMPLATE" >&2
        log_info "Available templates:" >&2
        pveam list $TEMPLATE_STORAGE >&2
        exit 1
    fi
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
        apt-get install -y docker-compose-plugin
        
        # Enable and start Docker
        systemctl enable docker
        systemctl start docker
    "
    
    log_success "Dependencies installed"
}

# Function to configure GitHub access
configure_github() {
    log_info "Configuring GitHub access..."
    
    pct exec $LXC_ID -- bash -c "
        # Configure git
        git config --global user.name '${GITHUB_USERNAME}'
        git config --global user.email '${GITHUB_USERNAME}@users.noreply.github.com'
        
        # Install GitHub CLI
        mkdir -p -m 755 /etc/apt/keyrings
        wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
        chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
        echo 'deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        apt-get update
        apt-get install -y gh
    "
    
    log_success "GitHub CLI installed"
}

# Function to deploy Dev Farm
deploy_devfarm() {
    log_info "Deploying Dev Farm..."
    
    log_info "Attempting to clone repository..."
    
    # Try HTTPS clone first (works if repo is public)
    if pct exec $LXC_ID -- bash -c "cd /opt && git clone https://github.com/${GITHUB_USERNAME}/dev-farm.git" 2>/dev/null; then
        log_success "Repository cloned successfully"
    else
        log_warning "HTTPS clone failed - repo may be private"
        log_info "Please run these commands to complete setup manually:"
        echo ""
        echo "  ssh root@\$(pct exec $LXC_ID -- hostname -I | awk '{print \$1}')"
        echo "  cd /opt"
        echo "  gh auth login"
        echo "  git clone https://github.com/${GITHUB_USERNAME}/dev-farm.git"
        echo "  cd dev-farm"
        echo "  chmod +x scripts/devfarm.sh"
        echo "  ./scripts/devfarm.sh setup"
        echo ""
        log_info "Or make the repository public on GitHub"
        return 1
    fi
    
    local github_token_export=""
    if [ -n "$GITHUB_TOKEN" ]; then
        github_token_export="export GITHUB_TOKEN='$GITHUB_TOKEN'"
    fi
    
    pct exec $LXC_ID -- bash -c "
        cd /opt/dev-farm
        
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
    local ip=$(pct exec $LXC_ID -- hostname -I 2>/dev/null | awk '{print $1}')
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

# Main execution
main() {
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
    
    log_info "Starting automatic deployment..."
    echo ""
    
    check_proxmox_host
    check_ct_id
    
    local template=$(find_template)
    log_success "Using template: $template"
    
    create_lxc "$template"
    wait_for_container
    install_dependencies
    
    if deploy_devfarm; then
        show_summary
    else
        log_warning "Manual setup required"
        local container_ip=$(get_container_ip)
        echo ""
        log_info "Container created successfully at: $container_ip"
        log_info "SSH into container with: pct enter $LXC_ID"
    fi
}

main "$@"
