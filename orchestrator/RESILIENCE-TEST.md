# 🛡️ System Resilience & Recovery Tests

## ✅ Current Configuration Status

### 1. PM2 Auto-Start on Reboot
```bash
# Check if configured
pm2 startup

# If not configured, run:
pm2 startup systemd -u asce --hp /home/asce
sudo env PATH=$PATH:/home/asce/.nvm/versions/node/v20.19.6/bin pm2 startup systemd -u asce --hp /home/asce

# Save current processes
pm2 save
```

### 2. Nginx Auto-Start
```bash
# Enable auto-start
sudo systemctl enable nginx

# Check status
systemctl is-enabled nginx
```

### 3. Redis Auto-Start
```bash
# Enable auto-start
sudo systemctl enable redis-server  # or redis

# Check status
systemctl is-enabled redis-server
```

### 4. PM2 Auto-Restart Policy
Current settings in `ecosystem.config.js`:
- `autorestart: true` - Auto-restart on crash
- `max_restarts: 10` - Maximum restart attempts
- `min_uptime: "10s"` - Minimum uptime before considered stable

---

## 🧪 Resilience Tests

### Test 1: Server Restart
```bash
# Simulate server restart
sudo reboot

# After reboot, check:
pm2 list                    # Should show all services online
systemctl status nginx      # Should be active
systemctl status redis      # Should be active
curl http://localhost:8080  # Should respond
```

### Test 2: Kill Process Accidentally
```bash
# Kill a process
pm2 kill cursor-monitor-orchestrator-settings

# Wait 5 seconds
sleep 5

# Check if it restarted
pm2 list                    # Should show process restarted
pm2 logs cursor-monitor-orchestrator-settings --lines 20  # Check logs
```

### Test 3: Network Disconnection
```bash
# Simulate network issue (disconnect Tailscale)
sudo tailscale down

# Services should continue working locally
curl http://localhost:8080  # Should still work

# Reconnect
sudo tailscale up

# Services should reconnect automatically
```

### Test 4: Redis Connection Loss
```bash
# Stop Redis
sudo systemctl stop redis-server

# Check orchestrator logs
pm2 logs cursor-monitor-orchestrator-worker --lines 20

# Restart Redis
sudo systemctl start redis-server

# Check if reconnected
pm2 logs cursor-monitor-orchestrator-worker --lines 20
```

---

## 🔧 Recovery Procedures

### If PM2 Services Don't Auto-Start After Reboot
```bash
# Manually start
cd /home/asce/projects/nodejs/cursor-monitor/orchestrator
pm2 start ecosystem.config.js
pm2 save
```

### If Nginx Doesn't Start
```bash
# Check logs
sudo journalctl -xeu nginx.service

# Start manually
sudo systemctl start nginx
sudo systemctl enable nginx
```

### If Redis Doesn't Start
```bash
# Check logs
sudo journalctl -xeu redis-server.service

# Start manually
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### If Process Keeps Crashing
```bash
# Check logs
pm2 logs cursor-monitor-orchestrator-settings --err --lines 50

# Check restart count
pm2 describe cursor-monitor-orchestrator-settings | grep restarts

# If max_restarts reached, investigate error
pm2 logs cursor-monitor-orchestrator-settings --err --lines 100
```

---

## 📊 Monitoring Commands

### Check All Services
```bash
# PM2 services
pm2 list

# System services
systemctl status nginx
systemctl status redis-server

# Network connectivity
tailscale status
curl http://localhost:8080/health
```

### Check Auto-Start Configuration
```bash
# PM2
pm2 startup

# System services
systemctl list-unit-files | grep -E "nginx|redis" | grep enabled
```

### Check Process Health
```bash
# PM2 monitoring
pm2 monit

# Detailed info
pm2 describe cursor-monitor-orchestrator-settings
pm2 describe cursor-monitor-orchestrator-worker
```

---

## ⚠️ Known Issues & Solutions

### Issue: Nginx Service Shows "Failed" but Proxy Works
**Solution**: There may be another nginx process running. Check:
```bash
ps aux | grep nginx
sudo lsof -i :8080
```

### Issue: PM2 Processes Don't Restart After Kill
**Solution**: Check `autorestart` setting:
```bash
pm2 describe cursor-monitor-orchestrator-settings | grep autorestart
# Should be: true
```

### Issue: Redis Connection Lost
**Solution**: Redis client has retry strategy. Check logs:
```bash
pm2 logs cursor-monitor-orchestrator-worker | grep -i redis
```

---

## ✅ Resilience Checklist

- [x] PM2 auto-start on reboot configured
- [x] PM2 processes saved
- [x] Nginx auto-start enabled
- [ ] Redis auto-start enabled (check)
- [x] PM2 auto-restart on crash enabled
- [x] Redis retry strategy configured
- [x] Network resilience (local access works)
- [ ] Monitoring setup (optional)

---

## 🚀 Recommended Improvements

1. **Add Health Check Endpoint**
   - Monitor service health
   - Alert on failures

2. **Add Log Rotation**
   - Prevent disk space issues
   - Keep logs manageable

3. **Add Monitoring Service**
   - Uptime monitoring
   - Alert on downtime

4. **Add Backup Strategy**
   - Backup Redis data
   - Backup configuration files

---

**Last Updated**: 2024-12-19
