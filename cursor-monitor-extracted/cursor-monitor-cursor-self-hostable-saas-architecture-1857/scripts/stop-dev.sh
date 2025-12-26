#!/bin/bash
#
# Stop Development Environment
# 
# Stops all PM2 services
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🛑 Stopping Cursor Monitor Development Environment"
echo ""

# Stop all PM2 processes
pm2 stop all

echo "✅ All services stopped!"
echo ""
echo "💡 To remove from PM2:"
echo "   pm2 delete all"
echo ""

