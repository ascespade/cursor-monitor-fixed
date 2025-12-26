#!/bin/bash

# Production Deployment Script
# Converts Settings UI from localhost:3001 to production domain with HTTPS
#
# Usage:
#   chmod +x deploy-to-production.sh
#   ./deploy-to-production.sh your-domain.com

set -e  # Exit on error

DOMAIN="${1:-orchestrator.example.com}"

echo "🚀 Production Deployment Script"
echo "=============================="
echo ""
echo "Domain: $DOMAIN"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verify PM2
echo "📋 Step 1: Verifying PM2 services..."
if pm2 list | grep -q "cursor-monitor-orchestrator-settings.*online"; then
    echo -e "${GREEN}✅ Settings server is running${NC}"
else
    echo -e "${RED}❌ Settings server is not running${NC}"
    echo "Starting services..."
    cd "$(dirname "$0")"
    pm2 start ecosystem.config.js
    pm2 save
fi

# Step 2: Check if Nginx is installed
echo ""
echo "📋 Step 2: Checking Nginx..."
if ! command -v nginx &> /dev/null; then
    echo -e "${RED}❌ Nginx is not installed${NC}"
    echo "Installing Nginx..."
    sudo apt update
    sudo apt install -y nginx
fi

# Step 3: Copy Nginx config
echo ""
echo "📋 Step 3: Setting up Nginx configuration..."
CONFIG_FILE="/etc/nginx/sites-available/orchestrator-settings"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Copying Nginx config..."
    sudo cp "$SCRIPT_DIR/nginx-settings-config.conf" "$CONFIG_FILE"
    
    # Replace domain placeholder
    sudo sed -i "s/orchestrator.example.com/$DOMAIN/g" "$CONFIG_FILE"
    echo -e "${GREEN}✅ Nginx config created${NC}"
else
    echo -e "${YELLOW}⚠️  Nginx config already exists${NC}"
    read -p "Overwrite? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo cp "$SCRIPT_DIR/nginx-settings-config.conf" "$CONFIG_FILE"
        sudo sed -i "s/orchestrator.example.com/$DOMAIN/g" "$CONFIG_FILE"
        echo -e "${GREEN}✅ Nginx config updated${NC}"
    fi
fi

# Step 4: Enable site
echo ""
echo "📋 Step 4: Enabling Nginx site..."
ENABLED_LINK="/etc/nginx/sites-enabled/orchestrator-settings"
if [ ! -L "$ENABLED_LINK" ]; then
    sudo ln -s "$CONFIG_FILE" "$ENABLED_LINK"
    echo -e "${GREEN}✅ Site enabled${NC}"
else
    echo -e "${YELLOW}⚠️  Site already enabled${NC}"
fi

# Step 5: Test Nginx config
echo ""
echo "📋 Step 5: Testing Nginx configuration..."
if sudo nginx -t; then
    echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
else
    echo -e "${RED}❌ Nginx configuration has errors${NC}"
    exit 1
fi

# Step 6: Reload Nginx
echo ""
echo "📋 Step 6: Reloading Nginx..."
sudo systemctl reload nginx
echo -e "${GREEN}✅ Nginx reloaded${NC}"

# Step 7: Check if domain resolves
echo ""
echo "📋 Step 7: Checking domain resolution..."
if curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN" | grep -q "200\|301\|302"; then
    echo -e "${GREEN}✅ Domain is accessible${NC}"
else
    echo -e "${YELLOW}⚠️  Domain may not be configured in DNS yet${NC}"
    echo "   Make sure $DOMAIN points to this server's IP"
fi

# Step 8: SSL Certificate
echo ""
echo "📋 Step 8: SSL Certificate Setup..."
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo -e "${GREEN}✅ SSL certificate already exists${NC}"
    echo "   Certificate location: /etc/letsencrypt/live/$DOMAIN"
else
    echo -e "${YELLOW}⚠️  SSL certificate not found${NC}"
    echo ""
    read -p "Install SSL certificate with Let's Encrypt? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if ! command -v certbot &> /dev/null; then
            echo "Installing Certbot..."
            sudo apt update
            sudo apt install -y certbot python3-certbot-nginx
        fi
        
        echo "Running Certbot..."
        sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@example.com || {
            echo -e "${YELLOW}⚠️  Certbot needs email. Run manually:${NC}"
            echo "   sudo certbot --nginx -d $DOMAIN"
        }
    else
        echo "Skipping SSL setup. You can add it later with:"
        echo "   sudo certbot --nginx -d $DOMAIN"
    fi
fi

# Step 9: Security (Basic Auth)
echo ""
echo "📋 Step 9: Security Setup..."
read -p "Enable Basic Auth protection? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    HTPASSWD_FILE="/etc/nginx/.orchestrator_htpasswd"
    if [ ! -f "$HTPASSWD_FILE" ]; then
        if ! command -v htpasswd &> /dev/null; then
            echo "Installing apache2-utils..."
            sudo apt install -y apache2-utils
        fi
        
        read -p "Enter username for Basic Auth: " USERNAME
        sudo htpasswd -c "$HTPASSWD_FILE" "$USERNAME"
        
        # Enable Basic Auth in Nginx config
        sudo sed -i 's/# auth_basic/auth_basic/g' "$CONFIG_FILE"
        sudo sed -i 's/# auth_basic_user_file/auth_basic_user_file/g' "$CONFIG_FILE"
        
        sudo nginx -t && sudo systemctl reload nginx
        echo -e "${GREEN}✅ Basic Auth enabled${NC}"
    else
        echo -e "${YELLOW}⚠️  Basic Auth file already exists${NC}"
    fi
fi

# Final summary
echo ""
echo "=============================="
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo "=============================="
echo ""
echo "Settings UI is now available at:"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo -e "   ${GREEN}https://$DOMAIN${NC}"
else
    echo -e "   ${YELLOW}http://$DOMAIN${NC} (add SSL with: sudo certbot --nginx -d $DOMAIN)"
fi
echo ""
echo "Local access (for debugging):"
echo "   http://localhost:3001"
echo ""
echo "Next steps:"
echo "   1. Test the domain in your browser"
echo "   2. Verify all test buttons work"
echo "   3. Check SSL certificate (if installed)"
echo "   4. Update documentation with new URL"
echo ""
