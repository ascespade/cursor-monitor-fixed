#!/bin/bash

###############################################################################
# Setup Environment Script
# 
# Purpose: Prepare and configure SSH + Key + Tailscale + Docker for smaller environment
# 
# Usage: ./scripts/setup-environment.sh [options]
# 
# Options:
#   --ssh-only      Setup SSH only
#   --tailscale-only Setup Tailscale only
#   --docker-only   Setup Docker only
#   --all           Setup everything (default)
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
SETUP_SSH=false
SETUP_TAILSCALE=false
SETUP_DOCKER=false
SETUP_ALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --ssh-only)
            SETUP_SSH=true
            SETUP_ALL=false
            shift
            ;;
        --tailscale-only)
            SETUP_TAILSCALE=true
            SETUP_ALL=false
            shift
            ;;
        --docker-only)
            SETUP_DOCKER=true
            SETUP_ALL=false
            shift
            ;;
        --all)
            SETUP_ALL=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [ "$SETUP_ALL" = true ]; then
    SETUP_SSH=true
    SETUP_TAILSCALE=true
    SETUP_DOCKER=true
fi

###############################################################################
# SSH Setup
###############################################################################
setup_ssh() {
    log_info "Setting up SSH server and keys..."
    
    # Check if SSH server is installed
    if ! command -v sshd &> /dev/null; then
        log_info "Installing OpenSSH server..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y openssh-server
        elif command -v yum &> /dev/null; then
            sudo yum install -y openssh-server
        else
            log_error "Package manager not found. Please install OpenSSH server manually."
            return 1
        fi
    fi
    
    # Start SSH service
    log_info "Starting SSH service..."
    sudo systemctl enable ssh
    sudo systemctl start ssh || sudo service ssh start
    
    # Create .ssh directory if it doesn't exist
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    
    # Generate SSH key if it doesn't exist
    if [ ! -f ~/.ssh/id_rsa ]; then
        log_info "Generating SSH key pair..."
        ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N "" -C "cursor-monitor-setup"
        log_success "SSH key generated: ~/.ssh/id_rsa"
    else
        log_info "SSH key already exists: ~/.ssh/id_rsa"
    fi
    
    # Add public key to authorized_keys if not already there
    if [ -f ~/.ssh/id_rsa.pub ]; then
        PUB_KEY=$(cat ~/.ssh/id_rsa.pub)
        if ! grep -q "$PUB_KEY" ~/.ssh/authorized_keys 2>/dev/null; then
            cat ~/.ssh/id_rsa.pub >> ~/.ssh/authorized_keys
            log_success "Public key added to authorized_keys"
        fi
    fi
    
    chmod 600 ~/.ssh/authorized_keys
    chmod 644 ~/.ssh/id_rsa.pub
    
    # Get SSH connection info
    SSH_USER=$(whoami)
    SSH_IP=$(hostname -I | awk '{print $1}')
    
    log_success "SSH setup complete!"
    log_info "SSH Connection Info:"
    echo "  User: $SSH_USER"
    echo "  IP: $SSH_IP"
    echo "  Port: 22"
    echo "  Command: ssh $SSH_USER@$SSH_IP"
    echo ""
    echo "  Public Key:"
    cat ~/.ssh/id_rsa.pub
    echo ""
}

###############################################################################
# Tailscale Setup
###############################################################################
setup_tailscale() {
    log_info "Setting up Tailscale..."
    
    # Check if Tailscale is installed
    if ! command -v tailscale &> /dev/null; then
        log_info "Installing Tailscale..."
        curl -fsSL https://tailscale.com/install.sh | sh
    else
        log_info "Tailscale is already installed"
    fi
    
    # Check if Tailscale is authenticated
    if ! tailscale status &> /dev/null; then
        log_warning "Tailscale is not authenticated"
        log_info "To authenticate Tailscale, run:"
        echo "  sudo tailscale up"
        echo ""
        echo "Or with auth key:"
        echo "  sudo tailscale up --auth-key=YOUR_AUTH_KEY"
        echo ""
    else
        TAILSCALE_IP=$(tailscale ip -4)
        log_success "Tailscale is running"
        log_info "Tailscale IP: $TAILSCALE_IP"
    fi
    
    log_success "Tailscale setup complete!"
}

###############################################################################
# Docker Setup
###############################################################################
setup_docker() {
    log_info "Setting up Docker..."
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_info "Installing Docker..."
        curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
        sh /tmp/get-docker.sh
        rm /tmp/get-docker.sh
        
        # Add current user to docker group
        sudo usermod -aG docker $USER
        log_warning "You may need to log out and back in for Docker group changes to take effect"
    else
        log_info "Docker is already installed"
    fi
    
    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_info "Installing Docker Compose..."
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    else
        log_info "Docker Compose is available"
    fi
    
    # Start Docker service
    log_info "Starting Docker service..."
    sudo systemctl enable docker
    sudo systemctl start docker || sudo service docker start
    
    # Verify Docker is working
    if docker ps &> /dev/null; then
        log_success "Docker is running"
    else
        log_warning "Docker may require sudo or user needs to be in docker group"
    fi
    
    log_success "Docker setup complete!"
}

###############################################################################
# Main Execution
###############################################################################
main() {
    log_info "Starting environment setup..."
    echo ""
    
    if [ "$SETUP_SSH" = true ]; then
        setup_ssh
        echo ""
    fi
    
    if [ "$SETUP_TAILSCALE" = true ]; then
        setup_tailscale
        echo ""
    fi
    
    if [ "$SETUP_DOCKER" = true ]; then
        setup_docker
        echo ""
    fi
    
    log_success "Environment setup complete!"
    echo ""
    log_info "Summary:"
    echo "  - SSH: $(if command -v sshd &> /dev/null; then echo 'Installed'; else echo 'Not installed'; fi)"
    echo "  - Tailscale: $(if command -v tailscale &> /dev/null; then echo 'Installed'; else echo 'Not installed'; fi)"
    echo "  - Docker: $(if command -v docker &> /dev/null; then echo 'Installed'; else echo 'Not installed'; fi)"
    echo ""
}

# Run main function
main
