# 🚀 Complete Server Setup Guide

This guide will help you set up the complete Next.js Automation Server with all components.

## 📋 Prerequisites

- Ubuntu/Debian Linux server
- Root or sudo access
- Internet connection

## 🔧 Step 1: Run Setup Script

```bash
cd /home/asce/projects/nodejs/cursor-monitor/orchestrator
chmod +x setup-nextjs-automation-server.sh
./setup-nextjs-automation-server.sh
```

This script will install:
- ✅ Node.js 20.x LTS
- ✅ PM2 Process Manager
- ✅ Redis Server
- ✅ Nginx Reverse Proxy
- ✅ Docker (for Supabase local)
- ✅ Firewall Configuration

## 📦 Step 2: Install Project Dependencies

```bash
# Main project
cd /home/asce/projects/nodejs/cursor-monitor
npm install

# Orchestrator
cd orchestrator
npm install
```

## ⚙️ Step 3: Configure Environment Variables

### Main Project (.env)

```env
# Cursor API
CURSOR_API_KEY=your_cursor_api_key

# Redis (for Vercel → Local communication)
REDIS_HOST=your_public_ip_or_tunnel
REDIS_PORT=6379
REDIS_PASSWORD=optional_password

# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# Webhook Security
WEBHOOK_SECRET=your_shared_secret_32_chars_min
```

### Orchestrator (.env)

```env
# Redis (local)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Supabase (local)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_local_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_local_service_key

# Cursor API
CURSOR_API_KEY=your_cursor_api_key

# Webhook Security (must match Vercel)
WEBHOOK_SECRET=your_shared_secret_32_chars_min

# Project Path
PROJECT_PATH=/home/asce/projects/nodejs/cursor-monitor

# Settings
MAX_ITERATIONS=20
AGENT_TIMEOUT_HOURS=4
LOG_LEVEL=info
```

## 🗄️ Step 4: Setup Supabase Local (Optional)

If using local Supabase:

```bash
cd orchestrator
docker-compose up -d
```

Or install Supabase CLI:

```bash
npm install -g supabase
supabase init
supabase start
```

## 🚀 Step 5: Start Services with PM2

```bash
cd /home/asce/projects/nodejs/cursor-monitor/orchestrator
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

This will start:
- ✅ Orchestrator Worker
- ✅ Settings Server (port 3001)
- ✅ Next.js Dev Server (port 3002)
- ✅ Cloudflare Tunnel (if configured)

## 🔍 Step 6: Verify Services

```bash
# Check PM2 status
pm2 list

# Check logs
pm2 logs

# Test Redis
redis-cli ping

# Test Next.js
curl http://localhost:3002

# Test Settings Server
curl http://localhost:3001/api/settings
```

## 🌐 Step 7: Configure Public Access

### Option 1: Public IP (with Firewall)

```bash
# Allow specific IP for Redis
sudo ufw allow from YOUR_VERCEL_IP to any port 6379

# Or use Cloudflare Tunnel (recommended)
```

### Option 2: Cloudflare Tunnel

The tunnel is already configured in PM2. Check logs:

```bash
pm2 logs cursor-monitor-nextjs-tunnel
```

Look for the `https://xxx.trycloudflare.com` URL.

## 🔐 Step 8: Security Hardening

### Redis Security

```bash
# Edit Redis config
sudo nano /etc/redis/redis.conf

# Set password
requirepass YOUR_STRONG_PASSWORD

# Restart Redis
sudo systemctl restart redis-server

# Update .env files with password
```

### Firewall Rules

```bash
# Remove public Redis access (if not needed)
sudo ufw delete allow 6379/tcp

# Allow only specific IPs
sudo ufw allow from YOUR_IP to any port 6379
```

## 📊 Step 9: Monitor Services

```bash
# PM2 Dashboard
pm2 monit

# Redis Monitor
redis-cli monitor

# Nginx Logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# PM2 Logs
pm2 logs --lines 100
```

## 🧪 Step 10: Test Webhook Flow

1. **Trigger webhook from Cursor** (or use test endpoint)
2. **Check Vercel logs** - should receive webhook
3. **Check Redis queue** - job should be added
4. **Check PM2 logs** - worker should process job
5. **Check Supabase** - state should be updated

## 🐛 Troubleshooting

### Redis Connection Issues

```bash
# Test connection
redis-cli -h HOST -p PORT ping

# Check firewall
sudo ufw status

# Check Redis config
sudo nano /etc/redis/redis.conf
```

### PM2 Issues

```bash
# Restart all
pm2 restart all

# Delete and restart
pm2 delete app_name
pm2 start ecosystem.config.js --only app_name

# Check logs
pm2 logs app_name --lines 50
```

### Nginx Issues

```bash
# Test config
sudo nginx -t

# Reload
sudo systemctl reload nginx

# Check logs
sudo tail -f /var/log/nginx/error.log
```

## 📚 Architecture Reference

See `automation-architecture.json` for complete architecture specification.

## ✅ Verification Checklist

- [ ] Node.js installed (v20.x)
- [ ] PM2 installed and configured
- [ ] Redis running and accessible
- [ ] Nginx configured and running
- [ ] All services started with PM2
- [ ] Environment variables configured
- [ ] Firewall rules set
- [ ] Webhook signature verification working
- [ ] Redis queue processing jobs
- [ ] Supabase connection working
- [ ] Public access configured (tunnel or IP)

## 🎉 You're Ready!

Your automation server is now fully configured and ready to process Cursor Cloud Agent webhooks!
