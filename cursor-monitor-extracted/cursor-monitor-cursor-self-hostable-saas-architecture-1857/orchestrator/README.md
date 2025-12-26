# Cursor Monitor Orchestrator

Autonomous Cursor Orchestrator - Local Server Edition

## Overview

This is the local server component of the Hybrid Architecture. It processes webhook events queued by Vercel and manages Cloud Agents autonomously.

## Architecture

- **Vercel**: Receives webhooks → Queues jobs to Redis
- **Local Server**: Consumes jobs from Redis → Processes with Orchestrator
- **Communication**: Redis Queue only (no HTTP calls)

## Setup

### 1. Install Dependencies

```bash
cd orchestrator
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required variables:
- `REDIS_HOST` - Redis server IP/URL
- `REDIS_PORT` - Redis port (default: 6379)
- `REDIS_PASSWORD` - Redis password (if required)
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase URL (local or cloud)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `CURSOR_API_KEY` - Cursor API key
- `WEBHOOK_SECRET` - Same secret as Vercel (32+ chars)
- `PROJECT_PATH` - Path to project for local testing

### 3. Setup Supabase

Create the `agent_orchestrator_states` table:

```sql
CREATE TABLE agent_orchestrator_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  task_description TEXT,
  branch_name TEXT,
  repository TEXT,
  iterations INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  tasks_completed JSONB DEFAULT '[]',
  tasks_remaining JSONB DEFAULT '[]',
  last_analysis JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_orchestrator_agent_id ON agent_orchestrator_states(agent_id);
CREATE INDEX idx_agent_orchestrator_status ON agent_orchestrator_states(status);
```

### 4. Start with PM2

```bash
cd orchestrator
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Services

- **Orchestrator Service**: Main coordinator
- **Analyzer Service**: AI-powered analysis using Cursor API
- **Tester Service**: Local code testing
- **State Manager**: Supabase state management
- **Notifier**: Slack notifications

## Scripts

- `npm run worker` - Start worker manually
- `npm run cron` - Run cron job manually
- `npm run type-check` - TypeScript type checking

## Logs

Logs are stored in `./logs/` directory:
- `pm2-worker-out.log` - Worker output
- `pm2-worker-error.log` - Worker errors
- `pm2-cron-out.log` - Cron output
- `pm2-cron-error.log` - Cron errors

## Monitoring

```bash
pm2 status
pm2 logs cursor-monitor-orchestrator-worker
pm2 logs cursor-monitor-orchestrator-cron
```

## Project Structure

```
orchestrator/
├── src/
│   ├── services/
│   │   ├── orchestrator.service.ts
│   │   ├── analyzer.service.ts
│   │   ├── tester.service.ts
│   │   ├── state-manager.service.ts
│   │   └── notifier.service.ts
│   ├── workers/
│   │   └── orchestrator-worker.ts
│   ├── cron/
│   │   └── check-stuck-agents.ts
│   ├── queue/
│   │   └── redis.ts
│   └── utils/
│       └── logger.ts
├── logs/
├── package.json
├── tsconfig.json
├── ecosystem.config.js
└── .env.example
```

