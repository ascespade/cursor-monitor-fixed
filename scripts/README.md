# Scripts Documentation

This directory contains utility scripts for managing the Cursor Monitor project.

## Available Scripts

### 1. `setup-environment.sh`
Prepares and configures SSH + Key + Tailscale + Docker for smaller environments.

**Usage:**
```bash
# Setup everything (default)
./scripts/setup-environment.sh

# Setup specific components
./scripts/setup-environment.sh --ssh-only
./scripts/setup-environment.sh --tailscale-only
./scripts/setup-environment.sh --docker-only
./scripts/setup-environment.sh --all
```

**What it does:**
- Installs and configures OpenSSH server
- Generates SSH key pair if not exists
- Installs and configures Tailscale
- Installs Docker and Docker Compose
- Sets up proper permissions

**Output:**
- SSH connection information (user, IP, port, public key)
- Tailscale IP address
- Docker installation status

---

### 2. `docker-manager.sh`
Manages Docker containers for the project (start, stop, restart, status, logs).

**Usage:**
```bash
# Show status (default)
./scripts/docker-manager.sh status

# Start all services
./scripts/docker-manager.sh start

# Start specific service
./scripts/docker-manager.sh start app
./scripts/docker-manager.sh start worker

# Stop services
./scripts/docker-manager.sh stop
./scripts/docker-manager.sh stop app

# Restart services
./scripts/docker-manager.sh restart
./scripts/docker-manager.sh restart app

# View logs
./scripts/docker-manager.sh logs app
./scripts/docker-manager.sh logs worker 100  # Last 100 lines

# Build containers
./scripts/docker-manager.sh build
./scripts/docker-manager.sh build app

# List running containers
./scripts/docker-manager.sh ps

# Stop and remove containers
./scripts/docker-manager.sh down
```

**Commands:**
- `start [service]` - Start containers (default: all)
- `stop [service]` - Stop containers (default: all)
- `restart [service]` - Restart containers (default: all)
- `status` - Show container status and health
- `logs [service] [lines]` - Show container logs (default: 50 lines)
- `build [service]` - Build containers with --no-cache
- `ps` - List running containers
- `down` - Stop and remove containers

**Services:**
- `app` - Next.js application
- `worker` - Background worker
- `all` - All services (default)

---

### 3. `clean-cache.sh`
Cleans all caches and prepares for hard refresh to see latest updates.

**Usage:**
```bash
# Clean all caches (default)
./scripts/clean-cache.sh

# Clean specific caches
./scripts/clean-cache.sh --next-only
./scripts/clean-cache.sh --docker-only
./scripts/clean-cache.sh --node-only
./scripts/clean-cache.sh --all

# Clean and rebuild
./scripts/clean-cache.sh --rebuild
./scripts/clean-cache.sh --all --rebuild
```

**What it cleans:**
- Next.js cache (`.next` directory)
- Docker cache and volumes
- Node.js cache (`node_modules/.cache`, npm cache, `.turbo`)

**Options:**
- `--next-only` - Clean Next.js cache only
- `--docker-only` - Clean Docker cache only
- `--node-only` - Clean Node.js cache only
- `--all` - Clean all caches (default)
- `--rebuild` - Rebuild project after cleaning

**After cleaning:**
1. Hard refresh browser: `Ctrl+Shift+R` (or `Cmd+Shift+R`)
2. Or open DevTools (F12) → Network → Enable "Disable cache" → Refresh

---

## Quick Reference

### Initial Setup
```bash
# Setup environment (SSH + Tailscale + Docker)
./scripts/setup-environment.sh

# Start Docker containers
./scripts/docker-manager.sh start
```

### Daily Development
```bash
# Check status
./scripts/docker-manager.sh status

# View logs
./scripts/docker-manager.sh logs app

# Restart after changes
./scripts/docker-manager.sh restart app
```

### After Updates
```bash
# Clean cache and rebuild
./scripts/clean-cache.sh --rebuild

# Or just clean (rebuild manually)
./scripts/clean-cache.sh
./scripts/docker-manager.sh build app
./scripts/docker-manager.sh restart app
```

### Troubleshooting
```bash
# Full reset
./scripts/clean-cache.sh --all
./scripts/docker-manager.sh down
./scripts/docker-manager.sh build
./scripts/docker-manager.sh start
```

---

## Examples

### Example 1: First Time Setup
```bash
# 1. Setup environment
./scripts/setup-environment.sh

# 2. Start Docker
./scripts/docker-manager.sh start

# 3. Check status
./scripts/docker-manager.sh status
```

### Example 2: After Code Changes
```bash
# 1. Clean cache
./scripts/clean-cache.sh

# 2. Rebuild and restart
./scripts/docker-manager.sh build app
./scripts/docker-manager.sh restart app

# 3. Hard refresh browser (Ctrl+Shift+R)
```

### Example 3: View Logs
```bash
# View app logs
./scripts/docker-manager.sh logs app

# View worker logs
./scripts/docker-manager.sh logs worker

# View last 100 lines
./scripts/docker-manager.sh logs app 100
```

---

## Notes

- All scripts require executable permissions (already set)
- Scripts automatically detect Docker Compose command
- Scripts use colored output for better readability
- All scripts are idempotent (safe to run multiple times)
