/**
 * Supabase Browser Client
 *
 * Purpose:
 * - Provide a factory for creating a typed Supabase browser client using
 *   auth-helpers and the validated environment configuration.
 *
 * Notes:
 * - Use this only in client components; for server components prefer the
 *   server client helpers from auth-helpers-nextjs.
 * - Returns null during SSR/build time to avoid errors.
 */
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { logger } from '@/shared/utils/logger';

export function createSupabaseBrowserClient() {
  // Skip during build time (SSR/SSG)
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return createClientComponentClient();
  } catch (error) {
    // Silently fail during build/runtime if client creation fails
    logger.warn('Failed to create Supabase browser client', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return null;
  }
}
