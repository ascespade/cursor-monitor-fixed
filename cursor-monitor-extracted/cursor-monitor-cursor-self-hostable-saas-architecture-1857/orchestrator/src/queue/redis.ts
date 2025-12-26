/**
 * Redis Queue Setup (OPTIONAL)
 * 
 * Redis is optional - system works without it using Supabase outbox pattern
 * If Redis is available, it's used for high-volume queue operations
 */

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Redis connection configuration
// BullMQ requires maxRetriesPerRequest to be null for blocking operations
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

// Create Redis connection (may be null if Redis is unavailable)
let redisClient: Redis | null = null;
let redisAvailable = false;

/**
 * Check if Redis is available and attempt connection
 * Returns true if Redis is available, false otherwise
 */
export async function checkRedisAvailability(): Promise<boolean> {
  // If REDIS_HOST is not set, Redis is disabled
  if (!process.env['REDIS_HOST']) {
    logger.info('Redis disabled - REDIS_HOST not set');
    return false;
  }

  if (redisClient && redisAvailable) {
    return true;
  }

  try {
    if (!redisClient) {
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
    }

    // Try to connect
    await redisClient.connect();
    redisAvailable = true;
    return true;
  } catch (error) {
    logger.warn('Redis not available - using database-only mode', {
      error: error instanceof Error ? error.message : String(error)
    });
    redisAvailable = false;
    return false;
  }
}

/**
 * Get Redis client (may throw if Redis is unavailable)
 * Use checkRedisAvailability() first or handle errors
 */
export function getRedisClient(): Redis | null {
  if (!redisAvailable || !redisClient) {
    return null;
  }
  return redisClient;
}

/**
 * Get Redis client or null (safe version)
 */
export function getRedisClientSafe(): Redis | null {
  return redisClient && redisAvailable ? redisClient : null;
}

// Create BullMQ Queue (OPTIONAL - only if Redis is available)
let orchestratorQueueInstance: Queue | null = null;

export function getOrchestratorQueue(): Queue | null {
  if (!redisAvailable || !redisClient) {
    return null;
  }

  if (!orchestratorQueueInstance) {
    orchestratorQueueInstance = new Queue('orchestrator', {
      connection: redisClient,
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
  }
  
  return orchestratorQueueInstance;
}

interface BullMQJob {
  id?: string;
  name: string;
  data: Record<string, unknown>;
  attemptsMade: number;
}

/**
 * Create BullMQ Worker (OPTIONAL - only if Redis is available)
 */
export function createRedisWorker(
  queueName: string,
  processor: (job: BullMQJob) => Promise<void>,
  options?: { concurrency?: number }
): Worker | null {
  if (!redisAvailable || !redisClient) {
    return null;
  }

  return new Worker(
    queueName,
    processor,
    {
      connection: redisClient,
      concurrency: options?.concurrency || 5,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 }
    }
  );
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

