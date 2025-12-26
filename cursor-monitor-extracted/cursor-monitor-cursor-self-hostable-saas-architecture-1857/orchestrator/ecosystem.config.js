/**
 * PM2 Configuration - Complete Automation Server
 * 
 * Manages:
 * - Orchestrator Worker (background processing)
 * - Cron Job (stuck agents check)
 * - Settings Server (configuration UI)
 * - Next.js Dev Server (local development)
 * - Cloudflare Tunnel (public access)
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'cursor-monitor-orchestrator-worker',
      script: 'npx',
      args: 'tsx src/workers/orchestrator-worker.ts',
      cwd: '/home/asce/projects/nodejs/cursor-monitor/orchestrator',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-worker-error.log',
      out_file: './logs/pm2-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      watch: false
    },
    {
      name: 'cursor-monitor-orchestrator-cron',
      script: 'npx',
      args: 'tsx src/cron/check-stuck-agents.ts',
      cwd: '/home/asce/projects/nodejs/cursor-monitor/orchestrator',
      cron_restart: '*/30 * * * *', // Every 30 minutes
      autorestart: false,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-cron-error.log',
      out_file: './logs/pm2-cron-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'cursor-monitor-orchestrator-settings',
      script: 'npx',
      args: 'tsx src/server/settings-server.ts',
      cwd: '/home/asce/projects/nodejs/cursor-monitor/orchestrator',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      env: {
        NODE_ENV: 'production',
        SETTINGS_SERVER_PORT: '3001'
      },
      error_file: './logs/pm2-settings-error.log',
      out_file: './logs/pm2-settings-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'cursor-monitor-nextjs',
      script: 'npm',
      args: 'run dev',
      cwd: '/home/asce/projects/nodejs/cursor-monitor',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: '3002'
      },
      error_file: './logs/pm2-nextjs-error.log',
      out_file: './logs/pm2-nextjs-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'cursor-monitor-nextjs-tunnel',
      script: 'cloudflared',
      args: 'tunnel --url http://localhost:3002',
      cwd: '/home/asce/projects/nodejs/cursor-monitor',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      error_file: './logs/pm2-tunnel-error.log',
      out_file: './logs/pm2-tunnel-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};

