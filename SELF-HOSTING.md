# Self-Hosting Guide (Chatwoot-style)

This guide explains how to self-host the Cursor Monitor application using Docker, following a Chatwoot-style architecture where the same codebase runs both locally and in the cloud.

## Architecture

The application consists of two containers:

1. **App Container** (`app`): Next.js UI + API routes
2. **Worker Container** (`worker`): Background orchestration processing

Both containers share the same codebase and are configured via environment variables only.

## Prerequisites

- Docker and Docker Compose installed
- Supabase project (local or cloud)
- Cursor API key

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd <repository-directory>
cp .env.example .env
```

### 2. Edit Environment Variables

Edit `.env` and set:

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CURSOR_API_KEY=your-cursor-api-key

# Optional (leave unset for database-only mode)
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=
```

### 3. Set Up Database

Run the database schema in your Supabase SQL Editor:

```bash
# Copy the schema file content and run it in Supabase SQL Editor
cat supabase-schema.sql
```

Or if using local Supabase:

```bash
supabase db reset
# Then run supabase-schema.sql
```

### 4. Start Containers

```bash
docker-compose up -d
```

This will:
- Build and start the app container on port 3000
- Build and start the worker container
- Both containers will connect to your Supabase database

### 5. Access the Application

Open http://localhost:3000 in your browser.

## Architecture Details

### Database-First Design

- **System of Record**: Supabase (PostgreSQL)
- **Event Store**: `orchestration_events` table
- **Queue**: `orchestration_outbox_jobs` table (Outbox Pattern)
- **Redis**: Optional optimization (not required)

### Container Responsibilities

#### App Container
- Serves Next.js UI
- Handles API routes
- Reads orchestration state from database
- Creates orchestration records and outbox jobs
- Works even if worker is offline (shows last known state)

#### Worker Container
- Processes outbox jobs from database
- Executes orchestration logic
- Writes events and status updates to database
- Optionally processes Redis queue (if configured)
- Sends heartbeats to `service_health_events` table

### State Management

All orchestration state is persisted to the database:

- `orchestrations`: Main orchestration records
- `orchestration_events`: Event timeline
- `orchestration_tasks`: Individual task tracking
- `orchestration_outbox_jobs`: Job queue (Outbox Pattern)
- `agent_orchestrator_states`: Agent state

**No Redis-only state** - everything is in the database.

## Redis Configuration (Optional)

Redis is **optional**. The system works without it using the Supabase outbox pattern.

### Without Redis (Database-Only Mode)

- Leave `REDIS_HOST` unset in `.env`
- All jobs are processed via `orchestration_outbox_jobs` table
- Worker polls the database every 5 seconds
- Fully functional, slightly slower for high-volume scenarios

### With Redis (Optimized Mode)

- Set `REDIS_HOST`, `REDIS_PORT` in `.env`
- Jobs are enqueued to Redis for faster processing
- Outbox table is still used as fallback
- Better performance for high-volume scenarios

To enable Redis locally, uncomment the Redis service in `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: cursor-monitor-redis
  ports:
    - "6379:6379"
  # ... rest of config
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for writes) |
| `CURSOR_API_KEY` | Cursor API key for agent operations |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_HOST` | Redis host (leave unset for database-only) | - |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |
| `MAX_ITERATIONS` | Max iterations per agent | 20 |
| `QUALITY_THRESHOLD` | Quality score threshold | 70 |

## Deployment

### Local Development

```bash
docker-compose up
```

### Production Deployment

1. Set environment variables in your hosting platform
2. Build and push images to your registry
3. Deploy using `docker-compose.yml` or your orchestrator (Kubernetes, etc.)

The same Docker images work in both local and cloud environments.

## Monitoring

### Health Checks

- **App**: http://localhost:3000/api/cloud-agents/health
- **Worker**: Check `service_health_events` table for heartbeats

### Logs

```bash
# App logs
docker-compose logs -f app

# Worker logs
docker-compose logs -f worker
```

### Database Queries

Check orchestration status:

```sql
SELECT * FROM orchestrations ORDER BY created_at DESC LIMIT 10;
```

Check worker health:

```sql
SELECT * FROM service_health_events 
WHERE service = 'worker' 
ORDER BY created_at DESC LIMIT 10;
```

## Troubleshooting

### Worker Not Processing Jobs

1. Check worker logs: `docker-compose logs worker`
2. Verify database connection in worker logs
3. Check `orchestration_outbox_jobs` table for pending jobs
4. Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly

### API Routes Not Working

1. Check app logs: `docker-compose logs app`
2. Verify Supabase connection
3. Ensure database schema is applied
4. Check environment variables

### Redis Connection Issues

If Redis is configured but not available:
- System automatically falls back to database-only mode
- Check logs for warnings about Redis
- Worker continues processing via outbox pattern

## Migration from Existing Setup

If you're migrating from a setup that required Redis:

1. **No code changes needed** - Redis is already optional
2. **Update environment**: Remove `REDIS_HOST` if you want database-only mode
3. **Restart containers**: `docker-compose restart`
4. **Verify**: Check logs to confirm database-only mode is active

## Support

For issues or questions:
- Check logs: `docker-compose logs`
- Review database: Query `orchestration_events` for error events
- Verify environment: Ensure all required variables are set
