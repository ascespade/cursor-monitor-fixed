/**
 * Rate Limiter Utility
 * 
 * Database-based rate limiting for API endpoints
 * Works without Redis - uses Supabase as storage
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix: string; // Prefix for rate limit key (e.g., 'orchestration:')
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // Seconds until reset
}

/**
 * Get Supabase client for rate limiting
 */
function getSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing');
  }

  const supabaseKey = supabaseServiceKey || supabaseAnonKey;
  if (!supabaseKey) {
    throw new Error('Supabase key missing');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Check rate limit for a given key
 * 
 * @param key - Unique identifier for rate limiting (e.g., API key or user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const supabase = getSupabaseClient();
    const rateLimitKey = `${config.keyPrefix}${key}`;
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowMs);

    // Get or create rate limit record
    const { data: existing, error: fetchError } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', rateLimitKey)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // Error other than "not found" - log and allow (fail open)
      logger.warn('Rate limit check failed', { error: fetchError.message, key: rateLimitKey });
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt: new Date(now.getTime() + config.windowMs)
      };
    }

    if (!existing) {
      // First request - create record
      const resetAt = new Date(now.getTime() + config.windowMs);
      await supabase
        .from('rate_limits')
        .insert({
          key: rateLimitKey,
          count: 1,
          window_start: windowStart.toISOString(),
          reset_at: resetAt.toISOString()
        });

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt
      };
    }

    // Check if window has expired
    const resetAt = new Date(existing.reset_at);
    if (now >= resetAt) {
      // Window expired - reset
      const newResetAt = new Date(now.getTime() + config.windowMs);
      await supabase
        .from('rate_limits')
        .update({
          count: 1,
          window_start: now.toISOString(),
          reset_at: newResetAt.toISOString()
        })
        .eq('key', rateLimitKey);

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: newResetAt
      };
    }

    // Check if limit exceeded
    if (existing.count >= config.maxRequests) {
      const retryAfter = Math.ceil((resetAt.getTime() - now.getTime()) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter
      };
    }

    // Increment count
    const newCount = existing.count + 1;
    await supabase
      .from('rate_limits')
      .update({ count: newCount })
      .eq('key', rateLimitKey);

    return {
      allowed: true,
      remaining: config.maxRequests - newCount,
      resetAt
    };
  } catch (error) {
    // Fail open - don't block requests if rate limiting fails
    logger.error('Rate limit check error', { error: error instanceof Error ? error.message : String(error), key });
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: new Date(Date.now() + config.windowMs)
    };
  }
}

/**
 * Create rate limit table if it doesn't exist
 * Run this migration in Supabase SQL Editor:
 * 
 * CREATE TABLE IF NOT EXISTS rate_limits (
 *   key TEXT PRIMARY KEY,
 *   count INTEGER NOT NULL DEFAULT 1,
 *   window_start TIMESTAMP NOT NULL,
 *   reset_at TIMESTAMP NOT NULL,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   updated_at TIMESTAMP DEFAULT NOW()
 * );
 * 
 * CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);
 * 
 * -- Cleanup old records (optional - can be done via cron)
 * CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
 * RETURNS void AS $$
 * BEGIN
 *   DELETE FROM rate_limits WHERE reset_at < NOW() - INTERVAL '1 day';
 * END;
 * $$ LANGUAGE plpgsql;
 */

