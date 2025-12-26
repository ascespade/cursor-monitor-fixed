/**
 * Settings Server for Orchestrator
 * 
 * Purpose:
 * - Simple HTTP server to manage environment variables via web UI
 * - Allows users to configure CURSOR_API_KEY, REDIS_*, WEBHOOK_SECRET, etc.
 * - Provides test endpoints for each configuration
 * 
 * Usage:
 * - Run: npm run settings-server
 * - Access: http://localhost:3001
 */

import '../utils/env-loader'; // Load centralized .env from parent directory
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { getRedisClient } from '../queue/redis';
import { logger } from '../utils/logger';

const app = express();
const PORT = process.env['SETTINGS_SERVER_PORT'] ? parseInt(process.env['SETTINGS_SERVER_PORT'], 10) : 3001;

// Use centralized .env from parent directory (root of project)
const currentDir = process.cwd();
const parentEnvPath = resolve(currentDir, '..', '.env');
const localEnvPath = join(currentDir, '.env');
const ENV_FILE_PATH = existsSync(parentEnvPath) ? parentEnvPath : localEnvPath;
const PUBLIC_DIR = join(currentDir, 'src', 'public');

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ────────────────────────────────────────────────
// Helper: Read .env file
// ────────────────────────────────────────────────
function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE_PATH)) {
    return {};
  }
  
  const content = readFileSync(ENV_FILE_PATH, 'utf-8');
  const env: Record<string, string> = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1]?.trim() ?? '';
      const value = match[2]?.trim() ?? '';
      // Remove quotes if present
      env[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  
  return env;
}

// ────────────────────────────────────────────────
// Helper: Write .env file
// ────────────────────────────────────────────────
function writeEnvFile(env: Record<string, string>): void {
  const lines: string[] = [];
  
  // Preserve comments and structure from .env.example if exists
  // Try parent directory first (centralized), then local
  const parentExamplePath = resolve(currentDir, '..', '.env.example');
  const localExamplePath = join(currentDir, '.env.example');
  const examplePath = existsSync(parentExamplePath) ? parentExamplePath : localExamplePath;
  if (existsSync(examplePath)) {
    const exampleContent = readFileSync(examplePath, 'utf-8');
    const exampleLines = exampleContent.split('\n');
    
    for (const line of exampleLines) {
      if (line.trim().startsWith('#')) {
        lines.push(line);
      } else {
        const match = line.match(/^([^=]+)=/);
        if (match) {
          const key = match[1]?.trim() ?? '';
          if (env[key] !== undefined) {
            lines.push(`${key}=${env[key]}`);
            delete env[key];
          } else {
            lines.push(line);
          }
        }
      }
    }
  }
  
  // Add any remaining env vars
  for (const [key, value] of Object.entries(env)) {
    if (key && value !== undefined) {
      lines.push(`${key}=${value}`);
    }
  }
  
  writeFileSync(ENV_FILE_PATH, lines.join('\n') + '\n', 'utf-8');
}

// ────────────────────────────────────────────────
// GET /api/settings - Get all environment variables
// ────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try {
    const env = readEnvFile();
    
    // Mask sensitive values for display (but keep raw for form population)
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (key.includes('KEY') || key.includes('SECRET') || key.includes('PASSWORD')) {
        masked[key] = value.length > 4 ? `****${value.slice(-4)}` : '****';
      } else {
        masked[key] = value;
      }
    }
    
    // Return both masked (for display) and raw (for form inputs)
    res.json({ 
      success: true, 
      data: { 
        env: masked,  // Masked for display
        raw: env      // Raw values for form population
      } 
    });
  } catch (error) {
    logger.error('Failed to read settings', { error });
    res.status(500).json({ success: false, error: 'Failed to read settings' });
  }
});

// ────────────────────────────────────────────────
// POST /api/settings - Update environment variables
// ────────────────────────────────────────────────
app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body as Record<string, string>;
    const current = readEnvFile();
    
    // Merge updates
    const updated = { ...current, ...updates };
    
    // Remove empty values
    for (const [key, value] of Object.entries(updated)) {
      if (!value || value.trim() === '') {
        delete updated[key];
      }
    }
    
    writeEnvFile(updated);
    
    // Reload environment (for current process)
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    
    logger.info('Settings updated', { keys: Object.keys(updates) });
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    logger.error('Failed to update settings', { error });
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// ────────────────────────────────────────────────
// POST /api/test/cursor-api - Test Cursor API
// ────────────────────────────────────────────────
app.post('/api/test/cursor-api', async (req, res) => {
  try {
    const { apiKey } = req.body as { apiKey?: string };
    const keyToTest = apiKey || process.env['CURSOR_API_KEY'];
    
    if (!keyToTest) {
      return res.status(400).json({
        success: false,
        error: 'CURSOR_API_KEY is not provided'
      });
    }
    
    // Test Cursor API by calling /v0/me endpoint
    const authHeader = `Basic ${Buffer.from(`${keyToTest}:`).toString('base64')}`;
    const response = await fetch('https://api.cursor.com/v0/me', {
      method: 'GET',
      headers: {
        Authorization: authHeader
      }
    });
    
    if (!response.ok) {
      throw new Error(`Cursor API returned ${response.status}: ${response.statusText}`);
    }
    
    const info = await response.json() as { apiKeyName?: string; userEmail?: string };
    
    res.json({
      success: true,
      message: 'Cursor API connection successful',
      data: {
        apiKeyName: info.apiKeyName ?? null,
        userEmail: info.userEmail ?? null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to connect to Cursor API';
    logger.error('Cursor API test failed', { error: message });
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

  // ────────────────────────────────────────────────
  // POST /api/test/redis - Test Redis connection
  // ────────────────────────────────────────────────
  app.post('/api/test/redis', async (req, res) => {
    let testClient: any = null;
    try {
      const { host, port, password } = req.body as {
        host?: string;
        port?: string;
        password?: string;
      };
      
      const redisHost = host || process.env['REDIS_HOST'] || 'localhost';
      const redisPort = port ? parseInt(port, 10) : parseInt(process.env['REDIS_PORT'] || '6379', 10);
      const redisPassword = password !== undefined ? password : (process.env['REDIS_PASSWORD'] || '');
      
      // Validate host (should be localhost, 127.0.0.1, or Tailscale IP 100.x.x.x)
      const isValidHost = 
        redisHost === 'localhost' || 
        redisHost === '127.0.0.1' || 
        redisHost.startsWith('100.') ||
        redisHost.match(/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      
      if (!isValidHost && redisHost !== process.env['REDIS_HOST']) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Redis host. Use localhost, 127.0.0.1, or Tailscale IP (100.x.x.x)',
          details: {
            provided: redisHost,
            allowed: ['localhost', '127.0.0.1', '100.x.x.x (Tailscale)']
          }
        });
      }
      
      // Create temporary Redis client for testing
      const Redis = (await import('ioredis')).default;
      testClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword || undefined,
        maxRetriesPerRequest: null,
        connectTimeout: 10000,
        lazyConnect: false,
        retryStrategy: () => null // Disable retries for test
      });
      
      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        testClient.on('ready', () => resolve());
        testClient.on('error', (err: Error) => reject(err));
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });
      
      const pong = await testClient.ping();
      
      // Close connection properly
      testClient.disconnect();
      testClient = null;
      
      // Detect if using Tailscale
      const isTailscale = redisHost.startsWith('100.');
      
      res.json({
        success: true,
        message: `Redis connection successful${isTailscale ? ' (via Tailscale)' : ''}`,
        data: {
          host: redisHost,
          port: redisPort,
          response: pong,
          connectionType: isTailscale ? 'Tailscale' : 'Local'
        }
      });
    } catch (error) {
      if (testClient) {
        try {
          testClient.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect to Redis';
      
      // Provide helpful error messages
      let helpfulMessage = errorMessage;
      if (errorMessage.includes('ECONNREFUSED')) {
        helpfulMessage = `Connection refused. Make sure Redis is running and accessible at ${req.body.host || process.env['REDIS_HOST'] || 'localhost'}:${req.body.port || process.env['REDIS_PORT'] || '6379'}. For Tailscale, ensure the IP is correct and routes are approved.`;
      } else if (errorMessage.includes('NOAUTH')) {
        helpfulMessage = 'Authentication failed. Check Redis password.';
      } else if (errorMessage.includes('timeout')) {
        helpfulMessage = 'Connection timeout. Check firewall and network connectivity.';
      }
      
      logger.error('Redis test failed', { error: errorMessage });
      res.status(500).json({
        success: false,
        error: helpfulMessage,
        details: {
          message: errorMessage,
          host: req.body.host || process.env['REDIS_HOST'],
          port: req.body.port || process.env['REDIS_PORT']
        }
      });
    }
  });

// ────────────────────────────────────────────────
// POST /api/test/supabase - Test Supabase connection
// ────────────────────────────────────────────────
app.post('/api/test/supabase', async (req, res) => {
  try {
    const { url, anonKey, serviceKey } = req.body as {
      url?: string;
      anonKey?: string;
      serviceKey?: string;
    };
    
    const supabaseUrl = url || process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const supabaseAnonKey = anonKey || process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    const supabaseServiceKey = serviceKey || process.env['SUPABASE_SERVICE_ROLE_KEY'];
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(400).json({
        success: false,
        error: 'Supabase URL and Anon Key are required'
      });
    }
    
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Test connection by querying a simple table
    const { data, error: queryError } = await supabase
      .from('agent_orchestrator_states')
      .select('id')
      .limit(1);
    
    if (queryError && queryError.code !== 'PGRST116') {
      throw queryError;
    }
    
    res.json({
      success: true,
      message: 'Supabase connection successful',
      data: {
        url: supabaseUrl,
        tableExists: true
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to connect to Supabase';
    logger.error('Supabase test failed', { error: message });
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ────────────────────────────────────────────────
// Serve settings page
// ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

// ────────────────────────────────────────────────
// Start server
// ────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Settings server started on http://localhost:${PORT}`);
  console.log(`\n✅ Orchestrator Settings Server`);
  console.log(`   Access: http://localhost:${PORT}`);
  console.log(`   Configure your environment variables here\n`);
});
