/**
 * Environment Configuration (Zod-validated)
 *
 * Purpose:
 * - Provide a single, type-safe source of truth for environment variables
 *   used by this starter (especially Supabase configuration).
 *
 * Usage:
 * - Import { env } and read properties instead of accessing process.env directly.
 */
import { z } from 'zod';

const envSchema = z.object({
  /**
   * Supabase configuration is optional at the config layer because
   * some deployments of this starter may not wire Supabase yet.
   *
   * Feature code that actually needs Supabase must still guard
   * against missing values and fail fast with a clear error.
   */
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .optional()
    .describe('Supabase project URL used on both client and server'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20)
    .optional()
    .describe('Supabase anon key used for client-side access'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20)
    .optional()
    .describe('Supabase service role key (server-side only, keep secret).'),
  SLACK_WEBHOOK_URL: z
    .string()
    .url()
    .optional()
    .describe('Optional Slack webhook URL for Cloud Agents notifications.'),
  NEXT_PUBLIC_CURSOR_API_KEY: z
    .string()
    .min(10)
    .optional()
    .describe('Cursor Cloud Agents API key (client-side accessible)'),
  CURSOR_API_KEY: z
    .string()
    .min(10)
    .optional()
    .describe('Cursor Cloud Agents API key (server-side only)'),
  WEBHOOK_SECRET: z
    .string()
    .min(32)
    .optional()
    .describe('Webhook secret for verifying Cursor Cloud Agent webhook signatures'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
  SLACK_WEBHOOK_URL: process.env['SLACK_WEBHOOK_URL'],
  NEXT_PUBLIC_CURSOR_API_KEY: process.env['NEXT_PUBLIC_CURSOR_API_KEY'],
  CURSOR_API_KEY: process.env['CURSOR_API_KEY'],
  WEBHOOK_SECRET: process.env['WEBHOOK_SECRET'],
  NODE_ENV: process.env.NODE_ENV
});
