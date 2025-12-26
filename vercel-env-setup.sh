#!/bin/bash
# Vercel Environment Variables Setup Script
# Run this script to add environment variables to Vercel

PROJECT_ID="prj_lsHI8fBVLiycRO879ZWYEZwjABSg"
TEAM_ID="team_OyI1EJA3yfGXofw6ergQ2rcs"
REDIS_HOST="192.168.104.128"
REDIS_PORT="6379"
REDIS_PASSWORD=""
WEBHOOK_SECRET="e3b6f2d9c8a147ef9b0c4d5a6b7e8f90123456789abcdef0fedcba9876543210"

echo "📝 Vercel Environment Variables to Add:"
echo "========================================"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Team ID: $TEAM_ID"
echo ""
echo "Variables:"
echo "1. REDIS_HOST = $REDIS_HOST"
echo "2. REDIS_PORT = $REDIS_PORT"
echo "3. REDIS_PASSWORD = (empty)"
echo "4. WEBHOOK_SECRET = $WEBHOOK_SECRET"
echo ""
echo "⚠️  Add these in Vercel Dashboard:"
echo "   https://vercel.com/$TEAM_ID/cursor-monitor-starter/settings/environment-variables"
