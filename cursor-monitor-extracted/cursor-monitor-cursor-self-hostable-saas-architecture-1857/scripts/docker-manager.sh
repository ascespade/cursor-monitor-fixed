#!/bin/bash

###############################################################################
# Docker Manager Script
# 
# Purpose: Start, stop, restart Docker containers for the project
# 
# Usage: ./scripts/docker-manager.sh [command] [service]
# 
# Commands:
#   start [service]    Start containers (default: all)
#   stop [service]     Stop containers (default: all)
#   restart [service]  Restart containers (default: all)
#   status             Show container status
#   logs [service]     Show container logs
#   build [service]    Build containers
#   ps                 List running containers
# 
# Services:
#   app                Next.js application
#   worker             Background worker
#   all                All services (default)
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
    # Try to use the downloaded binary
    if [ -f "/tmp/docker-compose" ]; then
        DOCKER_COMPOSE_CMD="/tmp/docker-compose"
    else
        log_error "Docker Compose not found. Please install Docker Compose."
        exit 1
    fi
fi

# Change to project root
cd "$PROJECT_ROOT"

# Parse command
COMMAND="${1:-status}"
SERVICE="${2:-all}"

# Validate service
if [ "$SERVICE" != "all" ] && [ "$SERVICE" != "app" ] && [ "$SERVICE" != "worker" ]; then
    log_error "Invalid service: $SERVICE. Use 'app', 'worker', or 'all'"
    exit 1
fi

###############################################################################
# Functions
###############################################################################

docker_start() {
    local service=$1
    log_info "Starting Docker containers ($service)..."
    
    if [ "$service" = "all" ]; then
        $DOCKER_COMPOSE_CMD up -d
    else
        $DOCKER_COMPOSE_CMD up -d "$service"
    fi
    
    sleep 2
    docker_status
}

docker_stop() {
    local service=$1
    log_info "Stopping Docker containers ($service)..."
    
    if [ "$service" = "all" ]; then
        $DOCKER_COMPOSE_CMD stop
    else
        $DOCKER_COMPOSE_CMD stop "$service"
    fi
    
    log_success "Containers stopped"
}

docker_restart() {
    local service=$1
    log_info "Restarting Docker containers ($service)..."
    
    if [ "$service" = "all" ]; then
        $DOCKER_COMPOSE_CMD restart
    else
        $DOCKER_COMPOSE_CMD restart "$service"
    fi
    
    sleep 2
    docker_status
}

docker_status() {
    log_info "Container Status:"
    echo ""
    $DOCKER_COMPOSE_CMD ps
    echo ""
    
    # Check if services are responding
    if [ "$SERVICE" = "all" ] || [ "$SERVICE" = "app" ]; then
        if curl -s http://localhost:3000/api/cloud-agents/health &> /dev/null; then
            log_success "App is responding on http://localhost:3000"
        else
            log_warning "App is not responding yet (may still be starting)"
        fi
    fi
}

docker_logs() {
    local service=$1
    local lines="${3:-50}"
    
    if [ "$service" = "all" ]; then
        log_info "Showing logs for all services (last $lines lines)..."
        $DOCKER_COMPOSE_CMD logs --tail="$lines" -f
    else
        log_info "Showing logs for $service (last $lines lines)..."
        $DOCKER_COMPOSE_CMD logs --tail="$lines" -f "$service"
    fi
}

docker_build() {
    local service=$1
    log_info "Building Docker containers ($service)..."
    
    if [ "$service" = "all" ]; then
        $DOCKER_COMPOSE_CMD build --no-cache
    else
        $DOCKER_COMPOSE_CMD build --no-cache "$service"
    fi
    
    log_success "Build complete"
}

docker_ps() {
    log_info "Running containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

docker_down() {
    log_info "Stopping and removing containers..."
    $DOCKER_COMPOSE_CMD down
    log_success "Containers stopped and removed"
}

docker_up() {
    local service=$1
    log_info "Starting containers ($service)..."
    
    if [ "$service" = "all" ]; then
        $DOCKER_COMPOSE_CMD up -d
    else
        $DOCKER_COMPOSE_CMD up -d "$service"
    fi
    
    sleep 3
    docker_status
}

###############################################################################
# Main
###############################################################################

case "$COMMAND" in
    start|up)
        docker_start "$SERVICE"
        ;;
    stop)
        docker_stop "$SERVICE"
        ;;
    restart)
        docker_restart "$SERVICE"
        ;;
    status)
        docker_status
        ;;
    logs)
        docker_logs "$SERVICE" "${3:-50}"
        ;;
    build)
        docker_build "$SERVICE"
        ;;
    ps)
        docker_ps
        ;;
    down)
        docker_down
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        echo ""
        echo "Usage: $0 [command] [service]"
        echo ""
        echo "Commands:"
        echo "  start [service]    Start containers"
        echo "  stop [service]     Stop containers"
        echo "  restart [service]  Restart containers"
        echo "  status             Show container status"
        echo "  logs [service]     Show container logs"
        echo "  build [service]    Build containers"
        echo "  ps                 List running containers"
        echo "  down               Stop and remove containers"
        echo ""
        echo "Services:"
        echo "  app                Next.js application"
        echo "  worker             Background worker"
        echo "  all                All services (default)"
        echo ""
        exit 1
        ;;
esac
