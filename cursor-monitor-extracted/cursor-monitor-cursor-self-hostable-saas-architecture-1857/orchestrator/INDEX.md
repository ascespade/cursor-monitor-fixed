# Orchestrator Project Index

## 📁 Project Structure

```
orchestrator/
├── src/
│   ├── services/          # Core business logic
│   │   ├── orchestrator.service.ts    # Main coordinator
│   │   ├── analyzer.service.ts        # AI analysis
│   │   ├── tester.service.ts          # Local testing
│   │   ├── state-manager.service.ts   # Database state
│   │   └── notifier.service.ts        # Notifications
│   ├── workers/          # Background workers
│   │   └── orchestrator-worker.ts     # Redis queue worker
│   ├── cron/             # Scheduled jobs
│   │   └── check-stuck-agents.ts      # Stuck agents checker
│   ├── queue/            # Queue setup
│   │   └── redis.ts                   # Redis connection
│   └── utils/            # Utilities
│       └── logger.ts                   # Logging
├── logs/                 # Log files
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── ecosystem.config.js    # PM2 config
├── .env.example          # Environment template
├── .gitignore            # Git ignore
├── .npmrc                # NPM config
├── supabase-schema.sql   # Database schema
├── README.md             # Main documentation
├── SETUP.md              # Setup guide
└── INDEX.md              # This file
```

## 🔧 Core Services

### 1. Orchestrator Service
**File:** `src/services/orchestrator.service.ts`
- Main coordinator for all components
- Processes webhook events
- Makes decisions (CONTINUE/TEST/FIX/COMPLETE)
- Coordinates Analyzer, Tester, Notifier

### 2. Analyzer Service
**File:** `src/services/analyzer.service.ts`
- Analyzes agent progress using Cursor API
- Builds analysis prompts
- Extracts decisions from AI responses
- Fallback analysis if API fails

### 3. Tester Service
**File:** `src/services/tester.service.ts`
- Tests code locally on server
- Checks out agent's branch
- Runs: npm install, test, lint, build
- Generates fix instructions

### 4. State Manager Service
**File:** `src/services/state-manager.service.ts`
- Manages agent states in Supabase
- CRUD operations for agent states
- Tracks iterations, tasks, status

### 5. Notifier Service
**File:** `src/services/notifier.service.ts`
- Sends notifications (Slack, etc.)
- Progress updates
- Success/failure notifications

## 🔄 Workers & Cron

### Orchestrator Worker
**File:** `src/workers/orchestrator-worker.ts`
- Consumes jobs from Redis queue
- Processes webhook events
- Runs as PM2 process

### Cron Job
**File:** `src/cron/check-stuck-agents.ts`
- Runs every 30 minutes
- Checks for stuck agents (4+ hours)
- Stops stuck agents automatically

## 📊 Queue & Infrastructure

### Redis Queue
**File:** `src/queue/redis.ts`
- Redis connection setup
- BullMQ queue initialization
- Graceful shutdown

### Logger
**File:** `src/utils/logger.ts`
- Structured logging
- Log levels: debug, info, warn, error

## 📝 Configuration Files

### package.json
- Dependencies: @supabase/supabase-js, bullmq, ioredis, dotenv
- Scripts: worker, cron, type-check

### tsconfig.json
- TypeScript compiler options
- Strict mode enabled

### ecosystem.config.js
- PM2 configuration
- Worker and cron job setup

### .env.example
- Environment variables template
- All required variables documented

## 🗄️ Database

### Supabase Schema
**File:** `supabase-schema.sql`
- Table: `agent_orchestrator_states`
- Indexes for performance
- Auto-update triggers

## 📚 Documentation

### README.md
- Overview and architecture
- Quick setup guide
- Services description

### SETUP.md
- Detailed setup instructions
- Troubleshooting guide
- Production checklist

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Setup database:**
   - Run `supabase-schema.sql` in Supabase SQL Editor

4. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   ```

## 🔗 Integration

### With Vercel
- Vercel webhook route adds jobs to Redis queue
- This orchestrator consumes and processes jobs
- Communication: Redis Queue only

### With Supabase
- Stores agent states
- Tracks progress and iterations
- Local or cloud Supabase supported

### With Cursor API
- Fetches conversations
- Gets agent status
- Sends follow-ups

## 📋 Environment Variables

See `.env.example` for all required variables:
- Redis configuration
- Supabase configuration
- Cursor API key
- Webhook secret
- Project path
- Notification settings

## 🐛 Troubleshooting

See `SETUP.md` for detailed troubleshooting guide.

## 📞 Support

- Check logs in `logs/` directory
- Use `pm2 logs` for real-time logs
- Review `SETUP.md` for common issues
