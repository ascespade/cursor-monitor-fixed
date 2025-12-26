#!/bin/bash

###############################################################################
# Docker Development Manager Script
# 
# Purpose: Manage Docker dev environment with hot reload
# 
# Usage: ./scripts/docker-dev.sh [command]
# 
# Commands:
#   start       Start dev containers (with hot reload)
#   stop        Stop dev containers
#   restart     Restart dev containers
#   logs        Show dev container logs
#   status      Show dev container status
#   rebuild     Rebuild dev containers
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Find docker-compose command
DOCKER_COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    if [ -f "/tmp/docker-compose" ]; then
        DOCKER_COMPOSE_CMD="/tmp/docker-compose"
    else
        log_error "Docker Compose not found. Please install Docker Compose."
        exit 1
    fi
fi

cd "$PROJECT_ROOT"

# Use dev compose file
COMPOSE_FILE="docker-compose.dev.yml"

# Parse command
COMMAND="${1:-status}"

###############################################################################
# Functions
###############################################################################

docker_dev_start() {
    log_info "Starting Docker dev environment (hot reload enabled)..."
    
    # Stop any existing production containers
    $DOCKER_COMPOSE_CMD down 2>/dev/null || true
    
    # Start dev containers
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    
    sleep 3
    docker_dev_status
    
    log_info ""
    log_success "Dev server is starting..."
    log_info "Watch logs with: $0 logs"
    log_info "App will be available at: http://localhost:3000"
    log_info ""
    log_warning "IMPORTANT: Code changes will reflect immediately (hot reload enabled)"
}

docker_dev_stop() {
    log_info "Stopping Docker dev containers..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    log_success "Dev containers stopped"
}

docker_dev_restart() {
    log_info "Restarting Docker dev containers..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" restart
    sleep 2
    docker_dev_status
}

docker_dev_status() {
    log_info "Dev Container Status:"
    echo ""
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps
    echo ""
    
    # Check if app is responding
    if curl -s http://localhost:3000/api/cloud-agents/health &> /dev/null; then
        log_success "App is responding on http://localhost:3000"
    else
        log_warning "App may still be starting. Check logs with: $0 logs"
    fi
}

docker_dev_logs() {
    local lines="${2:-50}"
    log_info "Showing dev container logs (last $lines lines)..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs --tail="$lines" -f app
}

docker_dev_rebuild() {
    log_info "Rebuilding dev containers..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" build --no-cache app
    log_success "Dev containers rebuilt"
    log_info "Restarting containers..."
    docker_dev_restart
}

###############################################################################
# Main
###############################################################################

case "$COMMAND" in
    start|up)
        docker_dev_start
        ;;
    stop|down)
        docker_dev_stop
        ;;
    restart)
        docker_dev_restart
        ;;
    status)
        docker_dev_status
        ;;
    logs)
        docker_dev_logs
        ;;
    rebuild)
        docker_dev_rebuild
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  start       Start dev containers (with hot reload)"
        echo "  stop        Stop dev containers"
        echo "  restart     Restart dev containers"
        echo "  logs        Show dev container logs"
        echo "  status      Show dev container status"
        echo "  rebuild     Rebuild dev containers"
        echo ""
        exit 1
        ;;
esac
