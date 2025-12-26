# ⚡ Quick Start Guide

## 🚀 3-Step Setup

### 1️⃣ Run Setup Script

```bash
cd orchestrator
chmod +x setup-nextjs-automation-server.sh
./setup-nextjs-automation-server.sh
```

### 2️⃣ Configure & Start

```bash
# Install dependencies
cd /home/asce/projects/nodejs/cursor-monitor
npm install
cd orchestrator && npm install

# Configure .env files (see README-SETUP.md)

# Start all services
pm2 start ecosystem.config.js
pm2 save
```

### 3️⃣ Verify

```bash
# Check services
pm2 list

# Test endpoints
curl http://localhost:3002
curl http://localhost:3001/api/settings

# Check Redis
redis-cli ping
```

## 📁 File Structure

```
orchestrator/
├── setup-nextjs-automation-server.sh  # Server setup script
├── automation-architecture.json         # Complete architecture spec
├── ecosystem.config.js                  # PM2 configuration
├── webhook-verifier.ts                 # Webhook security
├── README-SETUP.md                     # Detailed setup guide
└── QUICK-START.md                      # This file
```

## 🔗 Key URLs

- **Next.js Local**: http://localhost:3002
- **Settings UI**: http://localhost:3001
- **Public Access**: Check PM2 logs for tunnel URL

## 🎯 What's Included

✅ Complete server setup script  
✅ Architecture documentation (JSON)  
✅ Webhook signature verifier  
✅ PM2 process management  
✅ Redis configuration  
✅ Nginx reverse proxy  
✅ Security best practices  

## 📚 Next Steps

1. Read `README-SETUP.md` for detailed instructions
2. Review `automation-architecture.json` for architecture
3. Configure environment variables
4. Test webhook flow

---

**Ready to automate! 🚀**
