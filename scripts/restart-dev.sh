#!/bin/bash
#
# Restart Development Environment
# 
# Restarts all PM2 services
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🔄 Restarting Cursor Monitor Development Environment"
echo ""

# Restart all PM2 processes
pm2 restart all

echo "✅ All services restarted!"
echo ""
echo "📊 View status:"
echo "   pm2 status"
echo ""

