/**
 * Redis Queue Setup for Orchestrator (OPTIONAL)
 * 
 * Purpose:
 * - Setup Redis connection and BullMQ queue for webhook processing
 * - Used by webhook route to queue jobs for Local Server processing
 * 
 * Note:
 * - Redis is OPTIONAL - system works without it using Supabase outbox
 * - If Redis is not available, jobs are created in Supabase outbox only
 * - This queue is consumed by the Local Server orchestrator worker
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '@/shared/utils/logger';

// Redis connection configuration
const redisConfig = {
  host: process.env['REDIS_HOST'] || 'localhost',
  port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
  password: process.env['REDIS_PASSWORD'],
  maxRetriesPerRequest: null, // Required by BullMQ for blocking operations
  retryStrategy: (times: number): number => {
    const delay = Math.min(times * 50, 2000);
    logger.warn('Redis connection retry', { times, delay });
    return delay;
  },
  reconnectOnError: (err: Error): boolean => {
    const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT'];
    return targetErrors.some((targetError) => err.message.includes(targetError));
  },
  lazyConnect: true, // Don't connect immediately
  enableOfflineQueue: false // Fail fast if Redis is unavailable
};

// Create Redis connection (lazy initialization)
let redisClient: Redis | null = null;
let redisAvailable = false;

function getRedisClient(): Redis | null {
  // If REDIS_HOST is not set, Redis is disabled
  if (!process.env['REDIS_HOST']) {
    return null;
  }

  if (!redisClient) {
    try {
      redisClient = new Redis(redisConfig);

      redisClient.on('connect', () => {
        logger.info('Redis connected', { host: redisConfig.host, port: redisConfig.port });
        redisAvailable = true;
      });

      redisClient.on('error', (error) => {
        logger.warn('Redis connection error', { error: error.message });
        redisAvailable = false;
      });

      redisClient.on('close', () => {
        logger.warn('Redis connection closed');
        redisAvailable = false;
      });
    } catch (error) {
      logger.warn('Failed to create Redis client', { error });
      redisAvailable = false;
      return null;
    }
  }

  return redisClient;
}

// Create BullMQ Queue (lazy initialization, returns null if Redis unavailable)
let orchestratorQueueInstance: Queue | null = null;

export function getOrchestratorQueue(): Queue | null {
  // If Redis is not configured, return null
  if (!process.env['REDIS_HOST']) {
    return null;
  }

  const client = getRedisClient();
  if (!client || !redisAvailable) {
    return null;
  }

  if (!orchestratorQueueInstance) {
    try {
      orchestratorQueueInstance = new Queue('orchestrator', {
        connection: client,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 1000 }
        }
      });

      logger.info('Orchestrator queue initialized (Redis)');
    } catch (error) {
      logger.warn('Failed to initialize orchestrator queue', { error });
      return null;
    }
  }

  return orchestratorQueueInstance;
}

/**
 * Check if Redis is enabled (configured)
 */
export function isRedisEnabled(): boolean {
  return !!process.env['REDIS_HOST'];
}

/**
 * Check if Redis is available (connected)
 */
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

// Graceful shutdown helper
export async function closeQueue(): Promise<void> {
  if (orchestratorQueueInstance) {
    await orchestratorQueueInstance.close();
    orchestratorQueueInstance = null;
    logger.info('Orchestrator queue closed');
  }

  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (error) {
      // Ignore errors during shutdown
    }
    redisClient = null;
    redisAvailable = false;
    logger.info('Redis connection closed');
  }
}

// Export singleton instance (lazy - only connects when actually used)
// Use Proxy to defer initialization until first method call
// Returns null if Redis is unavailable
export const orchestratorQueue: Queue | null = new Proxy({} as Queue, {
  get(_target, prop) {
    const queue = getOrchestratorQueue();
    if (!queue) {
      return undefined;
    }
    const value = (queue as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(queue) : value;
  }
}) as Queue | null;
