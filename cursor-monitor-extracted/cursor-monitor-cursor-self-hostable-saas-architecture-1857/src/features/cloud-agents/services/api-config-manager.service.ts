/**
 * API Config Manager Service (Client-side)
 *
 * Purpose:
 * - Manage Cursor API configurations using localStorage for client-side persistence.
 * - Also supports reading API key from NEXT_PUBLIC_CURSOR_API_KEY environment variable.
 * - Provides CRUD operations for API configs with color coding.
 *
 * Notes:
 * - This is a client-side only service using localStorage.
 * - Environment variable configs are read-only (cannot be edited/deleted from UI).
 * - For production, consider migrating to server-side API + database.
 */

export interface ApiConfig {
  id: string;
  name: string;
  description?: string;
  color: string; // Hex color code for visual distinction
  apiKey: string; // Stored in localStorage or from environment variable
  _isEnvVar?: boolean; // True if this config is from environment variable (read-only)
  _masked?: boolean; // True if API key should be masked in UI
}

const STORAGE_KEY = 'cursor_cloud_apis_configs';
const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16' // lime
];

/**
 * Environment variable API key cache (to avoid repeated fetch calls)
 */
let envVarApiKeyCache: string | null = null;
let envVarApiKeyCacheTime: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get environment variable API config (if available)
 * Reads from both NEXT_PUBLIC_CURSOR_API_KEY (client-side) and server-side API
 */
function getEnvVarConfig(): ApiConfig | null {
  if (typeof window === 'undefined') return null;
  
  // Try to read from NEXT_PUBLIC_CURSOR_API_KEY first (client-side accessible)
  const clientEnvApiKey = process.env['NEXT_PUBLIC_CURSOR_API_KEY'];
  
  if (clientEnvApiKey && clientEnvApiKey.length >= 10) {
    return {
      id: 'env_cursor_api_key',
      name: 'Cursor API (Environment)',
      description: 'API key from environment variable',
      color: '#FFC107', // Golden yellow to distinguish from localStorage configs
      apiKey: clientEnvApiKey,
      _isEnvVar: true,
      _masked: true
    };
  }
  
  // If client-side key not found, check cache first
  const now = Date.now();
  if (envVarApiKeyCache && (now - envVarApiKeyCacheTime) < CACHE_DURATION) {
    return {
      id: 'env_cursor_api_key',
      name: 'Cursor API (Environment)',
      description: 'API key from environment variable',
      color: '#FFC107',
      apiKey: envVarApiKeyCache,
      _isEnvVar: true,
      _masked: true
    };
  }
  
  // Cache expired or not set - return null (will be loaded async by component)
  return null;
}

/**
 * Load environment variable API key from server (async)
 */
export async function loadEnvVarApiKey(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  
  try {
    const response = await fetch('/api/cloud-agents/configs/env/api-key');
    if (response.ok) {
      const data = await response.json() as { apiKey?: string };
      if (data.apiKey && data.apiKey.length >= 10) {
        envVarApiKeyCache = data.apiKey;
        envVarApiKeyCacheTime = Date.now();
        return data.apiKey;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return null;
}

/**
 * Get all stored API configs from localStorage and environment variable
 * Removes duplicates based on API key value (same API key won't appear twice)
 */
export async function getAllApiConfigs(): Promise<ApiConfig[]> {
  const configs: ApiConfig[] = [];
  const seenApiKeys = new Set<string>();
  
  // Add environment variable config first (if available)
  let envConfig = getEnvVarConfig();
  
  // If client-side key not found, try to load from server
  if (!envConfig) {
    const serverApiKey = await loadEnvVarApiKey();
    if (serverApiKey) {
      envConfig = {
        id: 'env_cursor_api_key',
        name: 'Cursor API (Environment)',
        description: 'API key from environment variable',
        color: '#FFC107',
        apiKey: serverApiKey,
        _isEnvVar: true,
        _masked: true
      };
    }
  }
  
  // Add env config if available (always first, has priority)
  if (envConfig && envConfig.apiKey) {
    configs.push(envConfig);
    seenApiKeys.add(envConfig.apiKey);
  }
  
  // Add localStorage configs (exclude duplicates and env config ID)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ApiConfig[];
        if (Array.isArray(parsed)) {
          // Filter out env config ID and duplicates (same API key)
          const localConfigs = parsed
            .filter(c => {
              // Exclude env config ID
              if (c.id === 'env_cursor_api_key') return false;
              // Exclude if API key already exists (duplicate)
              if (c.apiKey && seenApiKeys.has(c.apiKey)) return false;
              return true;
            })
            .map(c => {
              // Mark as seen
              if (c.apiKey) seenApiKeys.add(c.apiKey);
              // Ensure localStorage configs don't have env var flags
              return {
                ...c,
                _isEnvVar: false,
                _masked: false
              };
            });
          configs.push(...localConfigs);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }
  
  return configs;
}

/**
 * Synchronous version for backward compatibility (returns cached env var if available)
 * Removes duplicates based on API key value
 */
export function getAllApiConfigsSync(): ApiConfig[] {
  const configs: ApiConfig[] = [];
  const seenApiKeys = new Set<string>();
  
  // Add environment variable config (from cache or client-side) - always first
  const envConfig = getEnvVarConfig();
  if (envConfig && envConfig.apiKey) {
    configs.push(envConfig);
    seenApiKeys.add(envConfig.apiKey);
  }
  
  // Add localStorage configs (exclude duplicates)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ApiConfig[];
        if (Array.isArray(parsed)) {
          // Filter out env config ID and duplicates (same API key)
          const localConfigs = parsed
            .filter(c => {
              // Exclude env config ID
              if (c.id === 'env_cursor_api_key') return false;
              // Exclude if API key already exists (duplicate)
              if (c.apiKey && seenApiKeys.has(c.apiKey)) return false;
              return true;
            })
            .map(c => {
              // Mark as seen
              if (c.apiKey) seenApiKeys.add(c.apiKey);
              // Ensure localStorage configs don't have env var flags
              return {
                ...c,
                _isEnvVar: false,
                _masked: false
              };
            });
          configs.push(...localConfigs);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }
  
  return configs;
}

/**
 * Save API configs to localStorage (only local configs, not env var config)
 */
function saveApiConfigs(configs: ApiConfig[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    // Only save non-env configs
    const localConfigs = configs.filter(c => !c._isEnvVar);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localConfigs));
  } catch (error) {
    console.error('Failed to save API configs to localStorage:', error);
  }
}

/**
 * Generate a unique ID for new configs
 */
function generateId(): string {
  return `api_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get next available color from default palette
 */
function getNextColor(existingConfigs: ApiConfig[]): string {
  const usedColors = new Set(existingConfigs.map(c => c.color));
  const availableColor = DEFAULT_COLORS.find(c => !usedColors.has(c));
  if (availableColor) return availableColor;
  const fallbackIndex = existingConfigs.length % DEFAULT_COLORS.length;
  return DEFAULT_COLORS[fallbackIndex] ?? DEFAULT_COLORS[0]!;
}

/**
 * Add a new API config
 */
export function addApiConfig(config: Omit<ApiConfig, 'id' | 'color' | '_isEnvVar' | '_masked'>): ApiConfig {
  // Get only localStorage configs (exclude env var config)
  const existing = getAllApiConfigsSync().filter(c => !c._isEnvVar);
  const newConfig: ApiConfig = {
    ...config,
    id: generateId(),
    color: getNextColor(existing),
    _isEnvVar: false,
    _masked: false
  };
  const updated = [...existing, newConfig];
  saveApiConfigs(updated);
  return newConfig;
}

/**
 * Update an existing API config
 */
export function updateApiConfig(id: string, updates: Partial<Omit<ApiConfig, 'id' | '_isEnvVar' | '_masked'>>): ApiConfig | null {
  // Cannot update env var config
  if (id === 'env_cursor_api_key') return null;
  
  const existing = getAllApiConfigsSync().filter(c => !c._isEnvVar);
  const index = existing.findIndex(c => c.id === id);
  if (index === -1) return null;
  
  const current = existing[index];
  if (!current) return null;
  
  const updated: ApiConfig = {
    id: current.id,
    name: updates.name ?? current.name,
    description: updates.description ?? current.description,
    color: updates.color ?? current.color,
    apiKey: updates.apiKey ?? current.apiKey,
    _isEnvVar: false,
    _masked: false
  };
  existing[index] = updated;
  saveApiConfigs(existing);
  return updated;
}

/**
 * Delete an API config
 */
export function deleteApiConfig(id: string): boolean {
  // Cannot delete env var config
  if (id === 'env_cursor_api_key') return false;
  
  const existing = getAllApiConfigsSync().filter(c => !c._isEnvVar);
  const filtered = existing.filter(c => c.id !== id);
  if (filtered.length === existing.length) return false;
  
  saveApiConfigs(filtered);
  return true;
}

/**
 * Get API config by ID (sync version - uses cached data)
 */
export function getApiConfigById(id: string): ApiConfig | null {
  const all = getAllApiConfigsSync();
  return all.find(c => c.id === id) ?? null;
}

/**
 * Get API key for a config (handles environment variable masking)
 */
export function getApiKeyForConfig(config: ApiConfig | null): string | undefined {
  if (!config) return undefined;
  
  // If it's an environment variable config, return the full key (for actual API calls)
  // The masking is only for UI display purposes
  return config.apiKey;
}

/**
 * Mask API key for display (show only last 4 characters)
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 4) return '****';
  return `****${apiKey.slice(-4)}`;
}

/**
 * Get color for API config ID
 */
export function getApiColor(configId: string): string {
  const config = getApiConfigById(configId);
  return config?.color ?? DEFAULT_COLORS[0]!;
}
