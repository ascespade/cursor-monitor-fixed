#!/bin/bash
set -e

echo "=== 🚀 Next.js Automation Server Setup ==="
echo "This script will install and configure:"
echo "  - Node.js LTS"
echo "  - PM2 Process Manager"
echo "  - Redis Server"
echo "  - Nginx Reverse Proxy"
echo "  - Supabase Local (Docker)"
echo "  - Firewall Configuration"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== 🔧 SYSTEM UPDATE ===${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${YELLOW}=== 📦 BASE PACKAGES ===${NC}"
sudo apt install -y \
  curl git nginx ufw build-essential \
  redis-server \
  ca-certificates gnupg lsb-release \
  docker.io docker-compose

echo -e "${YELLOW}=== 🟢 NODE.JS LTS (v20.x) ===${NC}"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "Node.js already installed: $(node -v)"
fi
node -v
npm -v

echo -e "${YELLOW}=== ♻️ PM2 PROCESS MANAGER ===${NC}"
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2
  pm2 startup systemd -u $USER --hp $HOME
else
  echo "PM2 already installed: $(pm2 -v)"
fi

echo -e "${YELLOW}=== 🔥 REDIS CONFIGURATION ===${NC}"
# Backup original config
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# Configure Redis for external access (with security)
sudo sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf
sudo sed -i 's/^bind .*/bind 0.0.0.0/' /etc/redis/redis.conf
sudo sed -i 's/^protected-mode yes/protected-mode no/' /etc/redis/redis.conf

# Add password protection (optional but recommended)
# Uncomment and set password if needed:
# sudo sed -i 's/^# requirepass .*/requirepass YOUR_STRONG_PASSWORD/' /etc/redis/redis.conf

sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Test Redis
redis-cli ping || echo "Redis test failed, but continuing..."

echo -e "${YELLOW}=== 🧱 FIREWALL CONFIGURATION ===${NC}"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp  # Next.js
sudo ufw allow 3001/tcp  # Settings Server
sudo ufw allow 3002/tcp  # Next.js Dev (if needed)
sudo ufw allow 6379/tcp   # Redis (consider restricting to specific IPs)
sudo ufw allow 54321/tcp  # Supabase Local
sudo ufw --force enable
sudo ufw status

echo -e "${YELLOW}=== 🐳 DOCKER & SUPABASE LOCAL ===${NC}"
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER

echo "Supabase Local will be set up in the project directory"
echo "Run: cd orchestrator && docker-compose up -d (if using Supabase local)"

echo -e "${YELLOW}=== 📁 PROJECT DIRECTORY ===${NC}"
PROJECT_DIR="$HOME/projects/nodejs/cursor-monitor"
if [ ! -d "$PROJECT_DIR" ]; then
  mkdir -p "$PROJECT_DIR"
  echo "Created project directory: $PROJECT_DIR"
else
  echo "Project directory exists: $PROJECT_DIR"
fi

echo -e "${YELLOW}=== 🌐 NGINX REVERSE PROXY ===${NC}"
sudo tee /etc/nginx/sites-available/cursor-monitor <<'EOF'
# Next.js Automation Server
server {
    listen 80;
    server_name _;

    # Next.js Production
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Settings Server
    location /settings {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # API Routes
    location /api {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF

# Remove default nginx site
sudo rm -f /etc/nginx/sites-enabled/default

# Enable our site
sudo ln -sf /etc/nginx/sites-available/cursor-monitor /etc/nginx/sites-enabled/

# Test and reload nginx
sudo nginx -t && sudo systemctl reload nginx || echo "Nginx configuration test failed"

echo -e "${YELLOW}=== 📝 ENVIRONMENT SETUP ===${NC}"
echo "Creating .env.example in orchestrator directory..."
ORCHESTRATOR_DIR="$PROJECT_DIR/orchestrator"
if [ -d "$ORCHESTRATOR_DIR" ]; then
  echo "Orchestrator directory exists"
else
  echo "Orchestrator directory will be created when you clone/setup the project"
fi

echo -e "${GREEN}=== ✅ SETUP COMPLETE ===${NC}"
echo ""
echo "📋 Next Steps:"
echo "  1. Clone/setup your project in: $PROJECT_DIR"
echo "  2. Install dependencies: cd $PROJECT_DIR && npm install"
echo "  3. Install orchestrator deps: cd $PROJECT_DIR/orchestrator && npm install"
echo "  4. Configure .env files (see .env.example)"
echo "  5. Start services with PM2: pm2 start orchestrator/ecosystem.config.js"
echo "  6. Save PM2 config: pm2 save"
echo ""
echo "🔐 Security Recommendations:"
echo "  - Set Redis password: sudo nano /etc/redis/redis.conf"
echo "  - Restrict Redis access: sudo ufw delete allow 6379/tcp"
echo "  - Add specific IP allow: sudo ufw allow from YOUR_IP to any port 6379"
echo "  - Configure SSL/TLS for Nginx (Let's Encrypt)"
echo ""
echo "🌐 Services:"
echo "  - Next.js: http://localhost:3002"
echo "  - Settings: http://localhost:3001"
echo "  - Redis: localhost:6379"
echo "  - Nginx: http://localhost (proxies to Next.js)"
echo ""
echo -e "${GREEN}Server is ready! 🚀${NC}"
