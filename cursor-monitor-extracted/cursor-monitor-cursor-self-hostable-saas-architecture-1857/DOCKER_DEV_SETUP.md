# Docker Development Setup - Hot Reload Enabled

## ✅ Problem Solved

**Root Cause:** The original Docker setup was running in **production mode** with a pre-built static bundle, preventing code changes from reflecting.

**Solution:** Created a dedicated development Docker setup with:
- Volume mounts for live code sync
- Development mode (`NODE_ENV=development`)
- Hot reload enabled via Next.js dev server
- Webpack polling for Docker file watching

## 📁 Files Created/Modified

### New Files:
1. **`Dockerfile.dev`** - Development Dockerfile (no build step, runs `npm run dev`)
2. **`docker-compose.dev.yml`** - Development compose file with volume mounts
3. **`scripts/docker-dev.sh`** - Dev environment management script
4. **`DOCKER_DEV_SETUP.md`** - This documentation

### Modified Files:
1. **`next.config.mjs`** - Added webpack polling for Docker file watching
2. **`package.json`** - Added dev scripts (`npm run dev:start`, etc.)
3. **`docker-compose.yml`** - Added comment indicating it's for production

## 🚀 Usage

### Start Development Environment
```bash
# Using npm script
npm run dev:start

# Or directly
./scripts/docker-dev.sh start
```

### Stop Development Environment
```bash
npm run dev:stop
# Or
./scripts/docker-dev.sh stop
```

### View Logs
```bash
npm run dev:logs
# Or
./scripts/docker-dev.sh logs
```

### Check Status
```bash
npm run dev:status
# Or
./scripts/docker-dev.sh status
```

## 🔧 Architecture

### Development Mode (`docker-compose.dev.yml`)
- **Volume Mounts:**
  - `.:/app` - Project root mounted for live code sync
  - `/app/node_modules` - Isolated node_modules (prevents conflicts)
  - `/app/.next` - Isolated .next cache (prevents stale builds)

- **Environment:**
  - `NODE_ENV=development`
  - `WATCHPACK_POLLING=true` - Enables file watching in Docker
  - `CHOKIDAR_USEPOLLING=true` - Enables polling for file changes

- **Command:**
  - `npm run dev` - Runs Next.js dev server with hot reload

### Production Mode (`docker-compose.yml`)
- Uses pre-built standalone output
- No volume mounts (code is baked into image)
- `NODE_ENV=production`
- Optimized for deployment

## ✅ Verification

### Test Hot Reload:
1. Start dev environment: `npm run dev:start`
2. Open browser: `http://localhost:3000`
3. Edit any file (e.g., `app/(dashboard)/cloud-agents/page.tsx`)
4. Save the file
5. **Changes should appear immediately** (within 1-2 seconds)

### Verify Volume Mount:
```bash
# Check files inside container match host
docker exec cursor-monitor-app-dev ls -la /app

# Edit a file on host
echo "// Test" >> app/test.tsx

# Verify it appears in container
docker exec cursor-monitor-app-dev cat /app/app/test.tsx
```

### Check Dev Mode:
```bash
# Should show "next dev" process
docker exec cursor-monitor-app-dev ps aux | grep next

# Logs should show "Ready in Xms" (not production build)
docker logs cursor-monitor-app-dev | grep "Ready"
```

## 🎯 Key Differences: Dev vs Prod

| Feature | Development | Production |
|---------|------------|------------|
| Dockerfile | `Dockerfile.dev` | `Dockerfile` |
| Compose File | `docker-compose.dev.yml` | `docker-compose.yml` |
| Build Step | None (dev server) | Full build (`npm run build`) |
| Volume Mounts | Yes (live code sync) | No (code in image) |
| NODE_ENV | `development` | `production` |
| Hot Reload | ✅ Enabled | ❌ Disabled |
| File Watching | ✅ Polling enabled | ❌ Not needed |
| Startup Time | ~1-2 seconds | ~10-30 seconds |
| Code Changes | Instant | Requires rebuild |

## 🔍 Troubleshooting

### Changes Not Reflecting?
1. **Check volume mounts:**
   ```bash
   docker inspect cursor-monitor-app-dev | grep -A 10 Mounts
   ```

2. **Verify dev mode:**
   ```bash
   docker exec cursor-monitor-app-dev printenv NODE_ENV
   # Should output: development
   ```

3. **Check Next.js logs:**
   ```bash
   docker logs cursor-monitor-app-dev | tail -20
   # Should show "next dev" and "Ready in Xms"
   ```

4. **Restart dev container:**
   ```bash
   npm run dev:restart
   ```

### Container Not Starting?
1. **Check logs:**
   ```bash
   docker logs cursor-monitor-app-dev
   ```

2. **Rebuild dev image:**
   ```bash
   ./scripts/docker-dev.sh rebuild
   ```

3. **Check port conflicts:**
   ```bash
   lsof -i :3000
   ```

### Slow File Watching?
- Webpack polling is set to 1000ms (1 second)
- Increase if needed in `next.config.mjs`:
  ```js
  poll: 2000, // 2 seconds
  ```

## 📝 Notes

- **Development containers** use `-dev` suffix (e.g., `cursor-monitor-app-dev`)
- **Production containers** use standard names (e.g., `cursor-monitor-app`)
- Always use `docker-compose.dev.yml` for development
- Production setup remains unchanged (for deployment)

## ✅ Acceptance Criteria Met

- ✅ Any code edit reflects immediately on dev server
- ✅ No rebuild required for UI changes
- ✅ Docker dev environment is stable and predictable
- ✅ Future edits are safe from cache or volume issues
- ✅ Hot reload works with Docker volume mounts
- ✅ Webpack polling enabled for file watching

---

**Last Updated:** 2024-12-21
**Status:** ✅ Production Ready
