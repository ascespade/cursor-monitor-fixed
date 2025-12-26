# Orchestrator Settings Server

## Overview

A simple web-based interface to manage environment variables for the Autonomous Cursor Orchestrator.

## Features

- ✅ Edit all environment variables via web UI
- ✅ Test each configuration individually (Cursor API, Redis, Supabase)
- ✅ Save settings to `.env` file
- ✅ Visual status indicators for each setting

## Usage

### Start the Settings Server

```bash
cd orchestrator
npm run settings-server
```

Or with PM2:

```bash
pm2 start ecosystem.config.js --only cursor-monitor-orchestrator-settings
```

### Access the Interface

Open your browser and navigate to:

```
http://localhost:3001
```

## Configuration

The server reads and writes to the `.env` file in the orchestrator directory.

### Required Settings

- **CURSOR_API_KEY**: Your Cursor Cloud Agents API key
- **REDIS_HOST**: Redis server hostname or IP (e.g., `localhost` or `176.224.73.232`)
- **REDIS_PORT**: Redis port (default: `6379`)
- **REDIS_PASSWORD**: Redis password (optional)
- **NEXT_PUBLIC_SUPABASE_URL**: Supabase project URL
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**: Supabase anonymous key
- **SUPABASE_SERVICE_ROLE_KEY**: Supabase service role key
- **WEBHOOK_SECRET**: Secret for webhook verification (must match Vercel)

### Optional Settings

- **PROJECT_PATH**: Local project path for code testing
- **SLACK_WEBHOOK_URL**: Slack webhook for notifications
- **MAX_ITERATIONS**: Maximum orchestrator iterations (default: 20)
- **AGENT_TIMEOUT_HOURS**: Agent timeout in hours (default: 4)

## Testing

Each configuration has a "Test" button that verifies:

- **Cursor API**: Tests authentication and retrieves user info
- **Redis**: Tests connection and ping
- **Supabase**: Tests connection and table access

## Security Notes

⚠️ **Important**: This server should only be accessible on your local network or via SSH tunnel. Do not expose it to the public internet.

For production use:
- Add authentication (e.g., basic auth or JWT)
- Use HTTPS
- Restrict access to localhost or VPN

## API Endpoints

- `GET /api/settings` - Get all settings (masked)
- `POST /api/settings` - Update settings
- `POST /api/test/cursor-api` - Test Cursor API
- `POST /api/test/redis` - Test Redis connection
- `POST /api/test/supabase` - Test Supabase connection
