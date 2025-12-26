# Production Deployment Guide

## Docker Images

### App Container
- **Image**: `cursor-monitor_app:latest`
- **Base**: `node:20-alpine`
- **Port**: `3000`
- **User**: `nextjs` (non-root)
- **Size**: Optimized with multi-stage build

### Worker Container
- **Image**: `cursor-monitor_worker:latest`
- **Base**: `node:20-alpine`
- **User**: `worker` (non-root)
- **Size**: Optimized with multi-stage build

## Required Environment Variables

### App Container
```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cursor API (Required)
CURSOR_API_KEY=your-cursor-api-key

# Redis (Optional - system works without it)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Node Environment
NODE_ENV=production
```

### Worker Container
```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cursor API (Required)
CURSOR_API_KEY=your-cursor-api-key

# Redis (Optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Worker Configuration (Optional)
MAX_ITERATIONS=20
QUALITY_THRESHOLD=70
NODE_ENV=production
```

## Deployment Options

### Option 1: Docker Compose (Recommended for VPS)
```bash
# Build and start
docker-compose build
docker-compose up -d

# View logs
docker-compose logs -f app
docker-compose logs -f worker

# Stop
docker-compose down
```

### Option 2: Railway
1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Railway will auto-detect `docker-compose.yml` or use `Dockerfile`
4. Deploy automatically on push

### Option 3: VPS with Docker
```bash
# On your VPS
git clone <your-repo>
cd cursor-monitor
cp .env.example .env
# Edit .env with your values
docker-compose up -d
```

## Production Checklist

- [x] Docker images built successfully
- [x] No dev-only environment variables required
- [x] Containers run as non-root users
- [x] Standalone output enabled in Next.js
- [x] Redis is optional (system works without it)
- [x] All state persisted to Supabase
- [x] Worker heartbeats working
- [x] API endpoints responding correctly

## Health Checks

### App Health
```bash
curl http://localhost:3000/api/cloud-agents/health
```

### Worker Health
Check Supabase `service_health_events` table for heartbeat entries every 30 seconds.

### Container Status
```bash
docker-compose ps
```

## Scaling

### Horizontal Scaling (Multiple Workers)
1. Run multiple worker containers:
```bash
docker-compose up -d --scale worker=3
```

2. Each worker processes jobs from Supabase outbox independently
3. No coordination needed (database is source of truth)

### Vertical Scaling
- Increase container resources in docker-compose.yml or cloud platform
- Monitor with: `docker stats`

## Monitoring

### Logs
```bash
# App logs
docker-compose logs -f app

# Worker logs
docker-compose logs -f worker

# All logs
docker-compose logs -f
```

### Database Monitoring
- Check Supabase dashboard for:
  - `orchestrations` table (job status)
  - `orchestration_events` table (timeline)
  - `service_health_events` table (worker heartbeats)

## Troubleshooting

### Container won't start
1. Check logs: `docker-compose logs app`
2. Verify environment variables: `docker-compose config`
3. Check port availability: `netstat -tulpn | grep 3000`

### Worker not processing jobs
1. Check worker logs: `docker-compose logs worker`
2. Verify Supabase connection
3. Check `orchestration_outbox_jobs` table for pending jobs

### API returns 500 errors
1. Check app logs: `docker-compose logs app`
2. Verify Supabase credentials
3. Check database schema is applied

## Security Notes

- ✅ Containers run as non-root users
- ✅ No secrets hardcoded (all via environment variables)
- ✅ Redis optional (no sensitive data in Redis)
- ✅ Database is source of truth (Supabase)
- ⚠️ Ensure `.env` file is not committed to git
- ⚠️ Use strong passwords for Redis if enabled
- ⚠️ Use HTTPS in production (via reverse proxy)

## Reverse Proxy (Nginx Example)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

