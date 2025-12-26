/**
 * PM2 Ecosystem Configuration - Cursor Monitor
 * 
 * Centralized PM2 configuration for development and production
 * 
 * Manages:
 * - Next.js App (UI + API routes)
 * - Orchestrator Worker (background processing)
 * - Settings Server (optional - configuration UI)
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # Start all services
 *   pm2 start ecosystem.config.js --only app  # Start only Next.js
 *   pm2 start ecosystem.config.js --only worker  # Start only worker
 *   pm2 save
 *   pm2 startup
 */

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'cursor-monitor-app',
      script: 'npm',
      args: 'run dev',
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: '3000'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      error_file: './logs/pm2-app-error.log',
      out_file: './logs/pm2-app-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      watch: false
    },
    {
      name: 'cursor-monitor-worker',
      script: 'npx',
      args: 'tsx src/workers/orchestrator-worker.ts',
      cwd: path.resolve(__dirname, 'orchestrator'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      error_file: '../logs/pm2-worker-error.log',
      out_file: '../logs/pm2-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      watch: false
    },
    {
      name: 'cursor-monitor-settings',
      script: 'npx',
      args: 'tsx src/server/settings-server.ts',
      cwd: path.resolve(__dirname, 'orchestrator'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      env: {
        NODE_ENV: 'development',
        SETTINGS_SERVER_PORT: '3001'
      },
      env_production: {
        NODE_ENV: 'production',
        SETTINGS_SERVER_PORT: '3001'
      },
      error_file: '../logs/pm2-settings-error.log',
      out_file: '../logs/pm2-settings-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Optional: only start if explicitly requested
      // Comment out to disable by default
      // To start: pm2 start ecosystem.config.js --only cursor-monitor-settings
    }
  ]
};

