# Redis Connection Setup for Vercel

## Option 1: Upstash Redis Cloud (Recommended - FREE)

1. Visit: https://console.upstash.com
2. Sign up for free account
3. Create new Redis database
4. Copy the Redis URL (format: `redis://default:password@host:port`)
5. Extract host and port from URL
6. Update Vercel REDIS_HOST and REDIS_PORT

## Option 2: Cloudflare Tunnel (Temporary)

If you want to use local Redis with Cloudflare Tunnel:

```bash
# Start tunnel
cloudflared tunnel --url tcp://localhost:6379

# Extract the URL from output (format: https://xxx.trycloudflare.com:port)
# Update Vercel REDIS_HOST to the hostname (without https://)
```

## Option 3: Public IP + Firewall

1. Get public IP: `curl ifconfig.me`
2. Configure Redis to bind to 0.0.0.0
3. Open port 6379 on firewall
4. Update Vercel REDIS_HOST to public IP

**Note:** This is less secure and requires public IP.

## Current Status

- Local Redis: Running on localhost:6379
- Worker: Connected to local Redis ✅
- Vercel: Needs accessible Redis host

**Recommended:** Use Upstash Redis Cloud (free tier, reliable, no setup needed)
