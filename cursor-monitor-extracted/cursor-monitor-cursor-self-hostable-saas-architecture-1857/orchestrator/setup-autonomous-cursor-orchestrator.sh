#!/bin/bash
set -e
echo "🚀 Setting up Autonomous Cursor Orchestrator Server..."

# --- Update & base packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx ufw docker.io docker-compose redis-server

# --- Node.js + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# --- Tailscale Setup (if not already installed)
if ! command -v tailscale &> /dev/null; then
    echo "📡 Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
    echo "⚠️  Run: sudo tailscale up --ssh"
    echo "⚠️  Then approve routes in Tailscale dashboard"
else
    echo "✅ Tailscale already installed"
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
    if [ -n "$TAILSCALE_IP" ]; then
        echo "✅ Tailscale IP: $TAILSCALE_IP"
    else
        echo "⚠️  Tailscale installed but not connected. Run: sudo tailscale up"
    fi
fi

# --- Get Tailscale IP for Redis binding
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "127.0.0.1")
echo "🔐 Using Tailscale IP for Redis: $TAILSCALE_IP"

# --- Redis Configuration (Tailscale + Local only)
echo "🔧 Configuring Redis for Tailscale..."
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# Bind to localhost + Tailscale IP only (NOT 0.0.0.0)
sudo sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf
sudo sed -i "s/^bind .*/bind 127.0.0.1 $TAILSCALE_IP/" /etc/redis/redis.conf
sudo sed -i 's/^protected-mode yes/protected-mode yes/' /etc/redis/redis.conf

# Set password (generate strong password)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
echo "🔑 Generated Redis password: $REDIS_PASSWORD"
echo "💾 Save this password in your .env files!"
sudo sed -i "s/^# requirepass .*/requirepass $REDIS_PASSWORD/" /etc/redis/redis.conf
sudo sed -i "s/^requirepass .*/requirepass $REDIS_PASSWORD/" /etc/redis/redis.conf

sudo systemctl restart redis-server && sudo systemctl enable redis-server

# Test Redis
if redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; then
    echo "✅ Redis configured and running"
else
    echo "⚠️  Redis test failed, but continuing..."
fi

# --- Supabase (Docker self-hosted)
echo "🗄️  Setting up Supabase Local..."
mkdir -p ~/supabase && cd ~/supabase
if [ ! -d "docker" ]; then
    git clone --depth=1 https://github.com/supabase/supabase.git .
    cd docker
    cp .env.example .env
    docker-compose up -d
    echo "🟢 Supabase started at http://localhost:54321"
    echo "📝 Default keys will be in docker/.env"
else
    echo "✅ Supabase directory exists, skipping clone"
    cd docker
    docker-compose up -d
fi

# --- Firewall (Secure - Tailscale only)
echo "🔥 Configuring Firewall..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
# DO NOT open 6379 publicly - use Tailscale only
sudo ufw deny 6379/tcp  # Block Redis from public
# Allow Tailscale network (100.x.x.x/10)
sudo ufw allow from 100.64.0.0/10 to any port 6379
sudo ufw --force enable
echo "✅ Firewall configured (Redis accessible via Tailscale only)"

# --- Cloudflare Tunnel (optional - not needed with Tailscale)
echo "☁️  Cloudflare Tunnel: Optional (Tailscale recommended)"
echo "   If needed: https://one.dash.cloudflare.com → Zero Trust → Tunnels"

# --- Nginx reverse proxy
echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/orchestrator <<'EOF'
server {
    listen 80;
    server_name _;
    
    # Next.js App
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Settings Server
    location /settings {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/orchestrator /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "✅ Base infrastructure ready!"
echo ""
echo "📋 IMPORTANT: Save these values in your .env files:"
echo "   REDIS_HOST=$TAILSCALE_IP (for Vercel) or 127.0.0.1 (for local)"
echo "   REDIS_PASSWORD=$REDIS_PASSWORD"
echo "   TAILSCALE_IP=$TAILSCALE_IP"
echo ""
echo "🔐 Security:"
echo "   - Redis is bound to 127.0.0.1 and $TAILSCALE_IP only"
echo "   - Redis password is set: $REDIS_PASSWORD"
echo "   - Port 6379 is blocked from public (Tailscale only)"
echo ""
echo "📁 Next steps:"
echo "   1. Configure Tailscale subnet router (if needed)"
echo "   2. Update .env files with Redis password and Tailscale IP"
echo "   3. Start orchestrator: pm2 start ecosystem.config.js"
