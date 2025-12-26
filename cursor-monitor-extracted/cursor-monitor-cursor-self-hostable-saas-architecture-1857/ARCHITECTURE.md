# Architecture: Chatwoot-style Self-hostable SaaS

This document describes the architecture transformation to a Chatwoot-style self-hostable SaaS.

## Key Principles

1. **Single Codebase**: Same code runs locally and in cloud
2. **Docker-First**: Everything containerized
3. **Database as System of Record**: All state in Supabase/Postgres
4. **Redis is Optional**: System works without Redis using Outbox Pattern
5. **UI is Infrastructure-Agnostic**: No changes to UI/UX
6. **Workers are Stateless**: All state persisted to database

## Container Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   App Container │         │ Worker Container │
│  (Next.js UI +  │         │  (Background     │
│   API Routes)   │         │   Processing)    │
└────────┬────────┘         └────────┬─────────┘
         │                            │
         └────────────┬─────────────────┘
                      │
         ┌────────────▼────────────┐
         │   Supabase (Postgres)   │
         │  - orchestrations       │
         │  - orchestration_events  │
         │  - orchestration_tasks  │
         │  - orchestration_outbox │
         │  - worker_heartbeats   │
         └─────────────────────────┘
                      │
         ┌────────────▼────────────┐
         │   Redis (Optional)      │
         │   - Queue optimization  │
         └─────────────────────────┘
```

## State Management

### Database Tables (System of Record)

1. **orchestrations**: Main orchestration records
   - Status: queued, running, waiting, blocked, completed, error, stopped
   - All orchestration metadata

2. **orchestration_events**: Event store
   - Timeline of all orchestration events
   - Used for UI timeline visualization

3. **orchestration_tasks**: Individual tasks
   - Task tracking within orchestrations
   - Status and progress per task

4. **orchestration_outbox_jobs**: Outbox Pattern queue
   - Reliable job processing without Redis
   - Worker polls this table

5. **service_health_events**: Worker heartbeats
   - Worker health monitoring
   - Last seen timestamps

6. **agent_orchestrator_states**: Agent state
   - Per-agent state management
   - Used by orchestrator service

### No Redis-Only State

- All state is persisted to database
- Redis is only used for queue optimization (optional)
- System works fully without Redis

## Execution Flow

### Starting an Orchestration

1. **API Route** (`POST /api/cloud-agents/orchestrate`):
   - Creates record in `orchestrations` table (status: `queued`)
   - Creates event in `orchestration_events`
   - Optionally enqueues to Redis (if available)
   - Always creates outbox job in `orchestration_outbox_jobs`
   - Returns immediately (202 Accepted)

2. **Worker** (polls outbox every 5 seconds):
   - Finds pending jobs in `orchestration_outbox_jobs`
   - Claims job (optimistic locking)
   - Updates orchestration status to `running`
   - Processes orchestration
   - Writes events to `orchestration_events`
   - Updates orchestration status/progress

3. **UI** (reads from database):
   - Polls or subscribes to `orchestrations` table
   - Reads `orchestration_events` for timeline
   - Shows real-time progress

### Webhook Processing

1. **Webhook arrives** at API route
2. **API route** creates outbox job (or enqueues to Redis)
3. **Worker** processes webhook job
4. **Worker** updates agent state and orchestration status
5. **UI** reflects changes via database subscriptions

## API Route Behavior

All API routes:
- Read from database only (never from Redis)
- Return valid responses even if worker is offline
- Show last known state from database
- Never return 500 for orchestration state queries

### Key Routes

- `GET /api/cloud-agents/orchestrate`: Lists orchestrations from database
- `POST /api/cloud-agents/orchestrate`: Creates orchestration + outbox job
- `GET /api/cloud-agents/orchestrations/[id]/status`: Reads from database
- `GET /api/cloud-agents/orchestrations/[id]/events`: Reads from database
- `GET /api/cloud-agents/orchestrations/[id]/tasks`: Reads from database

## Worker Behavior

Worker:
- Starts even if Redis is unavailable
- Primary: Processes outbox jobs from database
- Secondary: Processes Redis queue (if available)
- Writes all state changes to database
- Sends heartbeats to `service_health_events`

### Worker Startup

1. Check Redis availability (optional)
2. Start outbox processor (always)
3. Start Redis worker (if Redis available)
4. Start heartbeat service (always)

## Docker Configuration

### App Container

- **Base**: `node:20-alpine`
- **Build**: Next.js standalone output
- **Port**: 3000
- **Command**: `node server.js`

### Worker Container

- **Base**: `node:20-alpine`
- **Build**: Orchestrator package
- **Command**: `npm run worker`
- **Environment**: Same as app (Supabase, Cursor API)

### Docker Compose

- Both containers share network
- Both use same environment variables
- Both connect to same Supabase instance
- Redis service is optional (commented out by default)

## Environment Variables

### Required

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CURSOR_API_KEY`

### Optional

- `REDIS_HOST` (leave unset for database-only mode)
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `MAX_ITERATIONS`
- `QUALITY_THRESHOLD`

## Migration Notes

### From Previous Architecture

1. **No UI changes**: All UI remains unchanged
2. **No API breaking changes**: All routes backward compatible
3. **Redis optional**: Remove `REDIS_HOST` to use database-only mode
4. **Database schema**: Run `supabase-schema.sql` to create tables

### Backward Compatibility

- Existing API contracts maintained
- Existing UI behavior maintained
- Existing database tables preserved
- New tables added (no breaking changes)

## Verification Checklist

- [x] Worker starts without Redis
- [x] API routes work without worker online
- [x] All state persisted to database
- [x] Redis is optional
- [x] Docker containers build and run
- [x] Database schema includes all required tables
- [x] Status route added
- [x] Events route reads from database
- [x] Outbox pattern implemented
- [x] Heartbeat service writes to database

## Next Steps

1. Run database schema: `supabase-schema.sql`
2. Configure environment: `.env`
3. Start containers: `docker-compose up`
4. Verify: Check health endpoint and logs
