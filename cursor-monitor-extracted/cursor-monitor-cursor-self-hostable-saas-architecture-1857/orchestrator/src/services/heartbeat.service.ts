/**
 * Worker Heartbeat Service
 * 
 * Writes heartbeat to Supabase every 30 seconds to indicate worker is alive
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import os from 'os';

const supabaseUrl = process.env['SUPABASE_URL'] || process.env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = process.env['SUPABASE_SERVICE_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase configuration missing. SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

let heartbeatInterval: NodeJS.Timeout | null = null;

interface QueueDepths {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

async function getQueueDepths(): Promise<QueueDepths> {
  try {
    // Try to get queue info from Redis if available
    const { getRedisClient } = await import('../queue/redis');
    const redis = getRedisClient();
    
    if (!redis) {
      // Redis not available - return zeros
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
    
    // Use Promise.race to timeout after 2 seconds
    const timeout = new Promise<QueueDepths>((resolve) => {
      setTimeout(() => resolve({ waiting: 0, active: 0, completed: 0, failed: 0 }), 2000);
    });
    
    const queueInfo = Promise.all([
      redis.llen('bull:orchestrator:waiting'),
      redis.llen('bull:orchestrator:active'),
      redis.zcard('bull:orchestrator:completed'),
      redis.zcard('bull:orchestrator:failed')
    ]).then(([waiting, active, completed, failed]) => ({
      waiting, active, completed, failed
    }));
    
    return await Promise.race([queueInfo, timeout]);
  } catch (error) {
    // Redis not available - return zeros
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
}

async function writeHeartbeat(): Promise<void> {
  try {
    const queueDepths = await getQueueDepths();
    const version = process.env['npm_package_version'] || '1.0.0';
    
    const { error } = await supabase
      .from('service_health_events')
      .insert({
        service: 'worker',
        status: 'healthy',
        message: 'Worker heartbeat',
        payload: {
          workerId: WORKER_ID,
          hostname: os.hostname(),
          pid: process.pid,
          version,
          uptime: process.uptime(),
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
          },
          queue: queueDepths,
          timestamp: new Date().toISOString()
        }
      });

    if (error) {
      logger.warn('Failed to write heartbeat', { error: error.message });
    } else {
      logger.info('Heartbeat written successfully', { workerId: WORKER_ID });
    }
  } catch (error) {
    logger.warn('Error writing heartbeat', { 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

export function startHeartbeat(): void {
  if (heartbeatInterval) {
    logger.warn('Heartbeat already started');
    return;
  }

  // Write initial heartbeat
  void writeHeartbeat();

  // Set up interval
  heartbeatInterval = setInterval(() => {
    void writeHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  logger.info('Worker heartbeat started', { 
    workerId: WORKER_ID,
    interval: HEARTBEAT_INTERVAL_MS 
  });
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info('Worker heartbeat stopped');
  }
}

export { WORKER_ID };

