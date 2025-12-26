#!/bin/bash
#
# Start Development Environment
# 
# Starts all services using PM2 for development
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🚀 Starting Cursor Monitor Development Environment"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed. Installing..."
    npm install -g pm2
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "📋 Copying .env.example to .env"
    cp .env.example .env
    echo "✅ Please edit .env and add your configuration values"
    echo ""
    read -p "Press Enter to continue after editing .env..."
fi

# Create logs directory
mkdir -p logs

# Start services with PM2
echo "📦 Starting services with PM2..."
pm2 start ecosystem.config.js --only cursor-monitor-app,cursor-monitor-worker

echo ""
echo "✅ Services started!"
echo ""
echo "📊 View status:"
echo "   pm2 status"
echo ""
echo "📝 View logs:"
echo "   pm2 logs cursor-monitor-app"
echo "   pm2 logs cursor-monitor-worker"
echo ""
echo "🌐 Access:"
echo "   Next.js App: http://localhost:3000"
echo ""
echo "🛑 Stop services:"
echo "   pm2 stop all"
echo "   pm2 delete all"
echo ""

