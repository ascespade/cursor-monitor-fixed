# Environment Variables Documentation

## Required Environment Variables

### Vercel Deployment (Next.js App)

#### Supabase Configuration
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (e.g., `https://xxx.supabase.co`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous/public key

#### Cursor API
- `CURSOR_API_KEY` - Cursor API key for creating agents

#### Redis (Optional - for hybrid deployments)
- `REDIS_HOST` - Redis host (only accessible from local worker, not from Vercel)
- `REDIS_PORT` - Redis port
- `REDIS_PASSWORD` - Redis password (if required)

### Local Worker (Orchestrator)

#### Supabase Configuration
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase service role key (preferred) or anon key

#### Cursor API
- `CURSOR_API_KEY` - Cursor API key for creating agents

#### Redis
- `REDIS_HOST` - Redis host (e.g., `localhost` or Tailscale IP)
- `REDIS_PORT` - Redis port (default: `6379`)
- `REDIS_PASSWORD` - Redis password (if required)

#### Worker Configuration
- `MAX_ITERATIONS` - Maximum iterations per orchestration (default: `20`)
- `WORKER_ID` - Unique worker identifier (auto-generated if not set)

## Setting Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `CURSOR_API_KEY`
4. Redeploy the application after adding variables

## Setting Environment Variables for Local Worker

Create a `.env` file in the `orchestrator` directory:

```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Cursor API
CURSOR_API_KEY=your-cursor-api-key

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Worker Config
MAX_ITERATIONS=20
```

## Verification

To verify environment variables are set correctly:

1. **Vercel**: Check the deployment logs for any missing variable errors
2. **Local Worker**: Run `npm run worker` and check for configuration errors
3. **API Health Check**: Visit `/api/cloud-agents/health` to verify all services are configured

## Security Notes

- Never commit `.env` files to version control
- Use Vercel's environment variable encryption for sensitive keys
- Prefer `SUPABASE_SERVICE_KEY` over `NEXT_PUBLIC_SUPABASE_ANON_KEY` for local worker (more permissions)
- `NEXT_PUBLIC_*` variables are exposed to the browser - only use for public keys

