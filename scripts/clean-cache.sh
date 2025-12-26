#!/bin/bash

###############################################################################
# Clean Cache and Hard Refresh Script
# 
# Purpose: Clean all caches and prepare for hard refresh to see latest updates
# 
# Usage: ./scripts/clean-cache.sh [options]
# 
# Options:
#   --next-only      Clean Next.js cache only
#   --docker-only    Clean Docker cache only
#   --node-only      Clean node_modules cache only
#   --all            Clean all caches (default)
#   --rebuild        Rebuild after cleaning
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

# Parse arguments
CLEAN_NEXT=false
CLEAN_DOCKER=false
CLEAN_NODE=false
CLEAN_ALL=true
REBUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --next-only)
            CLEAN_NEXT=true
            CLEAN_ALL=false
            shift
            ;;
        --docker-only)
            CLEAN_DOCKER=true
            CLEAN_ALL=false
            shift
            ;;
        --node-only)
            CLEAN_NODE=true
            CLEAN_ALL=false
            shift
            ;;
        --all)
            CLEAN_ALL=true
            shift
            ;;
        --rebuild)
            REBUILD=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [ "$CLEAN_ALL" = true ]; then
    CLEAN_NEXT=true
    CLEAN_DOCKER=true
    CLEAN_NODE=true
fi

cd "$PROJECT_ROOT"

###############################################################################
# Clean Next.js Cache
###############################################################################
clean_next() {
    log_info "Cleaning Next.js cache..."
    
    if [ -d ".next" ]; then
        rm -rf .next
        log_success "Removed .next directory"
    else
        log_info ".next directory not found (already clean)"
    fi
    
    # Clean Next.js build cache
    if [ -d ".next/cache" ]; then
        rm -rf .next/cache
        log_success "Removed .next/cache"
    fi
}

###############################################################################
# Clean Docker Cache
###############################################################################
clean_docker() {
    log_info "Cleaning Docker cache..."
    
    # Find docker-compose command
    DOCKER_COMPOSE_CMD=""
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    elif [ -f "/tmp/docker-compose" ]; then
        DOCKER_COMPOSE_CMD="/tmp/docker-compose"
    fi
    
    if [ -n "$DOCKER_COMPOSE_CMD" ]; then
        log_info "Stopping containers..."
        $DOCKER_COMPOSE_CMD down 2>/dev/null || true
        
        log_info "Removing Docker volumes and cache..."
        docker system prune -f --volumes 2>/dev/null || true
        
        log_success "Docker cache cleaned"
    else
        log_warning "Docker Compose not found, skipping Docker cache clean"
    fi
}

###############################################################################
# Clean Node.js Cache
###############################################################################
clean_node() {
    log_info "Cleaning Node.js cache..."
    
    # Clean npm cache
    if command -v npm &> /dev/null; then
        npm cache clean --force 2>/dev/null || true
        log_success "npm cache cleaned"
    fi
    
    # Clean node_modules/.cache
    if [ -d "node_modules/.cache" ]; then
        rm -rf node_modules/.cache
        log_success "Removed node_modules/.cache"
    fi
    
    # Clean .turbo if exists
    if [ -d ".turbo" ]; then
        rm -rf .turbo
        log_success "Removed .turbo directory"
    fi
}

###############################################################################
# Rebuild
###############################################################################
rebuild_project() {
    log_info "Rebuilding project..."
    
    # Find docker-compose command
    DOCKER_COMPOSE_CMD=""
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    elif [ -f "/tmp/docker-compose" ]; then
        DOCKER_COMPOSE_CMD="/tmp/docker-compose"
    fi
    
    if [ -n "$DOCKER_COMPOSE_CMD" ]; then
        log_info "Building Docker containers..."
        $DOCKER_COMPOSE_CMD build --no-cache app
        
        log_info "Starting containers..."
        $DOCKER_COMPOSE_CMD up -d app
        
        log_info "Waiting for app to start..."
        sleep 8
        
        # Check if app is responding
        if curl -s http://localhost:3000/api/cloud-agents/health &> /dev/null; then
            log_success "App is running and responding!"
        else
            log_warning "App may still be starting. Check logs with: $DOCKER_COMPOSE_CMD logs app"
        fi
    else
        log_warning "Docker Compose not found, skipping rebuild"
    fi
}

###############################################################################
# Main
###############################################################################
main() {
    log_info "Starting cache cleanup..."
    echo ""
    
    if [ "$CLEAN_NEXT" = true ]; then
        clean_next
    fi
    
    if [ "$CLEAN_NODE" = true ]; then
        clean_node
    fi
    
    if [ "$CLEAN_DOCKER" = true ]; then
        clean_docker
    fi
    
    echo ""
    log_success "Cache cleanup complete!"
    echo ""
    
    if [ "$REBUILD" = true ]; then
        echo ""
        rebuild_project
    else
        log_info "To rebuild, run: $0 --rebuild"
    fi
    
    echo ""
    log_info "Next steps:"
    echo "  1. Hard refresh your browser: Ctrl+Shift+R (or Cmd+Shift+R)"
    echo "  2. Or open DevTools (F12) → Network → Enable 'Disable cache' → Refresh"
    echo "  3. Application URL: http://100.74.153.76:3000"
    echo ""
}

main
