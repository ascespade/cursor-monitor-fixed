# 🧪 Complete Testing Guide

## 📋 Pre-Testing Checklist

### ✅ Local Server (Must be Ready)

```bash
# 1. Check PM2 services
pm2 list | grep orchestrator

# Should show:
# - cursor-monitor-orchestrator-worker: online
# - cursor-monitor-orchestrator-settings: online

# 2. Check Redis
redis-cli -a redis_s3cure_8e92a7f3c4 -h 127.0.0.1 ping
redis-cli -a redis_s3cure_8e92a7f3c4 -h 100.98.212.73 ping

# Both should return: PONG

# 3. Check Settings Server
curl http://localhost:3001/api/settings

# Should return: {"success": true, ...}
```

### ✅ Vercel Environment Variables

Go to: https://vercel.com/codemasters-projects-4f2a92ad/cursor-monitor/settings/environment-variables

**Required Variables:**

```env
REDIS_HOST=100.98.212.73
REDIS_PORT=6379
REDIS_PASSWORD=redis_s3cure_8e92a7f3c4
WEBHOOK_SECRET=e3b6f2d9c8a147ef9b0c4d5a6b7e8f90123456789abcdef0fedcba9876543210
CURSOR_API_KEY=key_e4020d3d2e94157ba6fa77347ab42a37095f03b5592c330dcafab187ef8bedbe
```

**Important:**
- `REDIS_HOST` must be `100.98.212.73` (Tailscale IP), NOT `176.224.73.232`
- `REDIS_PASSWORD` must NOT be empty
- After updating, click **Save** and wait for deployment (or redeploy manually)

---

## 🧪 Test 1: Health Check Endpoint

### From Browser:
1. Open: https://cursor-monitor.vercel.app/api/cloud-agents/health
2. Should return JSON with:
   ```json
   {
     "success": true,
     "data": {
       "cursorApi": { "status": "ok" },
       "redisQueue": { "status": "ok" },
       "orchestrator": { "status": "warning" }
     }
   }
   ```

### From Terminal:
```bash
curl https://cursor-monitor.vercel.app/api/cloud-agents/health | jq
```

**Expected Results:**
- ✅ `cursorApi.status: "ok"` - Cursor API is working
- ✅ `redisQueue.status: "ok"` - Redis connection successful
- ⚠️ `orchestrator.status: "warning"` - Normal (worker monitored on local server)

---

## 🧪 Test 2: Settings Page Connection Diagnostics

### Steps:
1. Open: https://cursor-monitor.vercel.app/cloud-agents/settings
2. Scroll down to **"Connection Diagnostics"** section
3. Click **"Run connection tests"** button
4. Wait for results

### Expected Results:

**✅ Cursor API:**
- Status: ✅ OK
- Message: "Successfully connected to Cursor API"
- Details: Shows API key name and user email

**✅ Redis Queue:**
- Status: ✅ OK
- Message: "Successfully enqueued test job"
- Details: Host: `100.98.212.73`, Port: `6379`

**⚠️ Local Orchestrator Worker:**
- Status: ⚠️ Warning
- Message: "Jobs are reaching the orchestrator queue. Verify worker status on the local server (PM2)."
- This is **normal** - full worker status is monitored locally

---

## 🧪 Test 3: Webhook Flow (End-to-End)

### Step 1: Configure Webhook in Cursor

1. Go to Cursor Dashboard → Settings → Webhooks
2. Add webhook URL:
   ```
   https://cursor-monitor.vercel.app/api/cloud-agents/webhook
   ```
3. Set webhook secret:
   ```
   e3b6f2d9c8a147ef9b0c4d5a6b7e8f90123456789abcdef0fedcba9876543210
   ```
4. Save

### Step 2: Launch a Test Agent

1. Go to Cursor Dashboard → Cloud Agents
2. Create a new agent or use existing one
3. Launch the agent with a simple task
4. Wait for agent to complete (FINISHED or ERROR status)

### Step 3: Verify Webhook Reception (Vercel)

**Check Vercel Logs:**
1. Go to: https://vercel.com/codemasters-projects-4f2a92ad/cursor-monitor/logs
2. Filter by: `/api/cloud-agents/webhook`
3. Look for:
   - ✅ `POST /api/cloud-agents/webhook` - 200 OK
   - ✅ `Webhook queued for orchestrator processing`

### Step 4: Verify Job Processing (Local Server)

**Check PM2 Logs:**
```bash
cd /home/asce/projects/nodejs/cursor-monitor
pm2 logs cursor-monitor-orchestrator-worker --lines 100
```

**Look for:**
- ✅ `Processing job: process-webhook`
- ✅ `Agent state updated in Supabase`
- ✅ `Job completed successfully`

### Step 5: Verify Supabase State

```bash
# Connect to Supabase
cd /home/asce/projects/nodejs/cursor-monitor
# Or use Supabase Studio: http://127.0.0.1:54323

# Check agent_orchestrator_states table
# Should see new entry with agent_id and status
```

---

## 🧪 Test 4: Local Settings UI

### Steps:
1. Open: http://localhost:3001
2. Fill in all fields:
   - CURSOR_API_KEY: `key_e4020d3d2e94157ba6fa77347ab42a37095f03b5592c330dcafab187ef8bedbe`
   - REDIS_HOST: `localhost`
   - REDIS_PORT: `6379`
   - REDIS_PASSWORD: `redis_s3cure_8e92a7f3c4`
   - NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:54321`
   - (Fill other required fields)
3. Click **Test** buttons for each service
4. All should show ✅
5. Click **Save All Settings**

---

## 🐛 Troubleshooting

### Issue: Health Check Returns Error

**Symptoms:**
- `redisQueue.status: "error"`
- Error message about connection refused

**Solutions:**
1. ✅ Verify `REDIS_HOST=100.98.212.73` in Vercel (not `176.224.73.232`)
2. ✅ Verify `REDIS_PASSWORD` is set (not empty)
3. ✅ Test Redis from local server:
   ```bash
   redis-cli -a redis_s3cure_8e92a7f3c4 -h 100.98.212.73 ping
   ```
4. ✅ Check Tailscale is connected:
   ```bash
   tailscale status
   ```

### Issue: Webhook Not Received

**Symptoms:**
- No logs in Vercel
- Agent completes but no webhook

**Solutions:**
1. ✅ Verify webhook URL in Cursor dashboard
2. ✅ Verify `WEBHOOK_SECRET` matches in both Vercel and Cursor
3. ✅ Check Vercel logs for errors
4. ✅ Test webhook manually:
   ```bash
   curl -X POST https://cursor-monitor.vercel.app/api/cloud-agents/webhook \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Signature: <signature>" \
     -d '{"event":"statusChange","id":"test","status":"FINISHED"}'
   ```

### Issue: Jobs Not Processing

**Symptoms:**
- Webhook received in Vercel
- Job queued to Redis
- But worker not processing

**Solutions:**
1. ✅ Check PM2 status:
   ```bash
   pm2 list | grep orchestrator-worker
   ```
2. ✅ Check PM2 logs:
   ```bash
   pm2 logs cursor-monitor-orchestrator-worker --lines 50
   ```
3. ✅ Restart worker:
   ```bash
   pm2 restart cursor-monitor-orchestrator-worker
   ```
4. ✅ Check Redis queue:
   ```bash
   redis-cli -a redis_s3cure_8e92a7f3c4
   > KEYS bull:cursor-orchestrator:*
   ```

---

## ✅ Success Criteria

All tests pass when:

- ✅ Health endpoint returns all OK
- ✅ Settings page connection tests pass
- ✅ Webhook received in Vercel logs
- ✅ Job processed in PM2 logs
- ✅ State updated in Supabase
- ✅ No errors in any logs

---

## 📝 Quick Test Commands

```bash
# Test Redis from Vercel perspective
redis-cli -a redis_s3cure_8e92a7f3c4 -h 100.98.212.73 ping

# Test Health Endpoint
curl https://cursor-monitor.vercel.app/api/cloud-agents/health | jq

# Check PM2 Status
pm2 list | grep orchestrator

# Check PM2 Logs
pm2 logs cursor-monitor-orchestrator-worker --lines 50

# Check Redis Queue
redis-cli -a redis_s3cure_8e92a7f3c4
> KEYS bull:cursor-orchestrator:*
> LLEN bull:cursor-orchestrator:wait
```

---

**Last Updated:** 2024-12-19  
**Status:** Production Ready ✅
