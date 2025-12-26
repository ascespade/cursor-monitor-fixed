/**
 * Environment Loader Utility
 * 
 * Loads .env file from parent directory (root of project) for centralized configuration
 * Falls back to local .env if parent .env doesn't exist
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync } from 'fs';

/**
 * Load environment variables from centralized .env file
 * Priority:
 * 1. Parent directory .env (root of project) - preferred
 * 2. Local .env (orchestrator/.env) - fallback
 */
export function loadEnv(): void {
  // Get current directory (orchestrator/)
  const currentDir = process.cwd();
  
  // Try parent directory first (root of project)
  const parentEnvPath = resolve(currentDir, '..', '.env');
  const localEnvPath = join(currentDir, '.env');
  
  if (existsSync(parentEnvPath)) {
    // Load from parent directory (centralized)
    config({ path: parentEnvPath });
    console.log(`[env-loader] Loaded centralized .env from: ${parentEnvPath}`);
  } else if (existsSync(localEnvPath)) {
    // Fallback to local .env
    config({ path: localEnvPath });
    console.log(`[env-loader] Loaded local .env from: ${localEnvPath}`);
  } else {
    // Try default dotenv behavior (current directory)
    config();
    console.log(`[env-loader] Using default dotenv behavior`);
  }
}

// Auto-load on import
loadEnv();

