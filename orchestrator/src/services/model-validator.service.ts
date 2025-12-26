/**
 * Model Validator Service
 * 
 * Purpose:
 * - Validate model names against Cursor API
 * - Fetch available models dynamically from /v0/models endpoint
 * - Provide fallback mechanisms
 * - Support Auto mode (let API choose model)
 * - Cache valid models for performance
 * 
 * @see https://cursor.com/docs/cloud-agent/api/endpoints
 */

import { logger } from '../utils/logger';

const CURSOR_API_BASE = process.env['CURSOR_API_BASE'] || 'https://api.cursor.com';

interface ModelValidationResult {
  isValid: boolean;
  normalizedModel: string; // Empty string means Auto mode (don't send model parameter)
  originalModel: string;
  reason?: string;
  fallbackUsed: boolean;
  isAutoMode?: boolean; // True if API should choose the model
}

interface CachedModels {
  models: string[];
  cachedAt: number;
  expiresAt: number;
}

interface ModelsResponse {
  models?: string[];
  code?: string;
  message?: string;
}

// Cache valid models for 1 hour
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
let modelCache: CachedModels | null = null;

/**
 * Fallback models if API fetch fails
 * Based on Cursor API docs: https://cursor.com/docs/cloud-agent/api/endpoints
 * These are the known valid models for Cloud Agents (Max Mode compatible)
 * Updated based on actual API response
 */
const FALLBACK_MODELS = [
  'claude-4.5-opus-high-thinking',  // Claude Opus (most powerful)
  'gpt-5.2',                        // GPT model
  'gpt-5.2-high',                   // GPT model (high quality)
  'gemini-3-pro',                   // Gemini Pro
  'gemini-3-flash',                 // Gemini Flash (fastest)
] as const;

/**
 * Model fallback mappings for common/legacy model names
 * Maps deprecated or common aliases to valid API model names
 * Updated based on actual API response
 */
const MODEL_FALLBACKS: Record<string, string> = {
  // Legacy names -> Valid API names
  'claude-sonnet-4': 'claude-4.5-opus-high-thinking',
  'claude-4-sonnet': 'claude-4.5-opus-high-thinking',
  'claude-4-sonnet-thinking': 'claude-4.5-opus-high-thinking',
  'claude-opus-4': 'claude-4.5-opus-high-thinking',
  'claude-4-opus': 'claude-4.5-opus-high-thinking',
  'claude-4-opus-thinking': 'claude-4.5-opus-high-thinking',
  
  // Old naming conventions (keep as-is if valid)
  'claude-4.5-opus-high-thinking': 'claude-4.5-opus-high-thinking',
  'claude-4.5-sonnet-thinking': 'claude-4.5-opus-high-thinking',
  
  // Common aliases
  'gpt-4': 'gpt-5.2',
  'gpt-4o': 'gpt-5.2',
  'gpt-5': 'gpt-5.2',
  'o1': 'gpt-5.2',
  'o1-preview': 'gpt-5.2',
  'o3': 'gpt-5.2',
  
  // Gemini aliases
  'gemini-pro': 'gemini-3-pro',
  'gemini-flash': 'gemini-3-flash',
  'gemini-2': 'gemini-3-pro',
};

/**
 * Default fallback model if validation fails
 * Recommended: claude-4.5-opus-high-thinking (most powerful)
 * Alternative: gemini-3-flash (fastest, most cost-effective)
 */
const DEFAULT_FALLBACK_MODEL = 'claude-4.5-opus-high-thinking';

/**
 * Fetch available models from Cursor API
 * @param apiKey - Cursor API key for authentication
 * @returns Array of available model names
 */
async function fetchModelsFromAPI(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(`${CURSOR_API_BASE}/v0/models`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      logger.warn('Failed to fetch models from Cursor API', {
        status: response.status,
        statusText: response.statusText
      });
      return [];
    }

    const data = await response.json() as ModelsResponse;
    
    // Check for error response
    if (data.code || data.message) {
      logger.warn('Cursor API returned error when fetching models', {
        code: data.code,
        message: data.message
      });
      return [];
    }

    const models = data.models || [];
    
    if (models.length > 0) {
      logger.info('Successfully fetched models from Cursor API', {
        modelCount: models.length,
        models
      });
    }

    return models;
  } catch (error) {
    logger.error('Error fetching models from Cursor API', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Get cached models or fetch from API
 * @param apiKey - Cursor API key
 * @param forceRefresh - Force refresh even if cache is valid
 * @returns Array of available model names
 */
async function getValidModels(apiKey: string, forceRefresh = false): Promise<string[]> {
  const now = Date.now();

  // Return cached models if still valid
  if (!forceRefresh && modelCache && now < modelCache.expiresAt) {
    logger.debug('Using cached models', {
      modelCount: modelCache.models.length,
      cacheAge: Math.round((now - modelCache.cachedAt) / 1000) + 's'
    });
    return modelCache.models;
  }

  // Fetch from API
  const models = await fetchModelsFromAPI(apiKey);

  // Update cache if we got models, otherwise use fallback
  const modelsToCache = models.length > 0 ? models : [...FALLBACK_MODELS];
  
  modelCache = {
    models: modelsToCache,
    cachedAt: now,
    expiresAt: now + MODEL_CACHE_TTL_MS
  };
  
  logger.info('Models cache updated', {
    modelCount: modelsToCache.length,
    source: models.length > 0 ? 'API' : 'fallback',
    expiresAt: new Date(modelCache.expiresAt).toISOString()
  });

  return modelsToCache;
}

/**
 * Validate and normalize model name
 * 
 * Supports Auto mode: if model is null/undefined/empty, returns empty string
 * which means "don't send model parameter - let API choose"
 * 
 * @param model - Model name to validate (null/undefined/empty = Auto mode)
 * @param apiKey - Cursor API key for validation
 * @param options - Validation options
 * @returns Validation result with normalized model (empty string = Auto mode)
 */
export async function validateModel(
  model: string | undefined | null,
  apiKey: string,
  options: {
    allowDeprecated?: boolean;
    useFallback?: boolean;
    forceRefreshCache?: boolean;
    allowAutoMode?: boolean; // If true, empty model = Auto mode (recommended)
  } = {}
): Promise<ModelValidationResult> {
  const {
    allowDeprecated = false,
    useFallback = true,
    forceRefreshCache = false,
    allowAutoMode = true // Default to true (recommended by API)
  } = options;

  // Auto mode: if no model specified, let API choose (recommended)
  if (!model || model.trim().length === 0) {
    if (allowAutoMode) {
      logger.info('Auto mode enabled - API will choose best model');
      return {
        isValid: true,
        normalizedModel: '', // Empty = don't send model parameter
        originalModel: '',
        reason: 'Auto mode - API will choose the most appropriate model',
        fallbackUsed: false,
        isAutoMode: true
      };
    }
    // If auto mode not allowed, use default fallback
    model = DEFAULT_FALLBACK_MODEL;
  }

  const originalModel = model.trim();

  // Step 1: Check if model has a fallback mapping (case-insensitive)
  const fallbackKey = Object.keys(MODEL_FALLBACKS).find(
    key => key.toLowerCase() === originalModel.toLowerCase()
  );
  
  if (fallbackKey) {
    const fallbackModel = MODEL_FALLBACKS[fallbackKey];
    logger.info('Model fallback mapping found', {
      original: originalModel,
      fallback: fallbackModel,
      matchedKey: fallbackKey
    });
    
    // Continue validation with fallback model
    model = fallbackModel;
  }

  // Step 2: Fetch valid models from API
  const validModels = await getValidModels(apiKey, forceRefreshCache);

  // Step 3: If API returned models, validate against them
  if (validModels.length > 0) {
    const normalized = model.toLowerCase().trim();
    const isValid = validModels.some(m => m.toLowerCase().trim() === normalized);

    if (isValid) {
      return {
        isValid: true,
        normalizedModel: model, // Keep original casing from valid models list
        originalModel,
        fallbackUsed: MODEL_FALLBACKS[originalModel] !== undefined,
        reason: MODEL_FALLBACKS[originalModel] 
          ? `Model '${originalModel}' mapped to '${model}'`
          : undefined
      };
    }

    // Model not found in valid list
    logger.warn('Model not found in valid models list', {
      model: originalModel,
      validModelsCount: validModels.length,
      validModels,
      useFallback
    });

    if (useFallback) {
      // Try to find a similar model (fuzzy matching)
      const similarModel = findSimilarModel(model, validModels);
      
      const finalModel = similarModel || validModels[0] || DEFAULT_FALLBACK_MODEL;
      
      return {
        isValid: false,
        normalizedModel: finalModel,
        originalModel,
        reason: `Model '${originalModel}' is not available. ${similarModel ? `Using similar model '${similarModel}'` : `Using fallback '${finalModel}'`}`,
        fallbackUsed: true
      };
    }

    return {
      isValid: false,
      normalizedModel: model,
      originalModel,
      reason: `Model '${originalModel}' is not available in Cursor API`,
      fallbackUsed: false
    };
  }

  // Step 4: API unavailable - use fallback logic
  logger.warn('Cannot validate model - API unavailable, using fallback logic', {
    model: originalModel
  });

  if (useFallback) {
    // Check if it's a known valid model pattern
    if (isValidModelPattern(model)) {
      return {
        isValid: true,
        normalizedModel: model,
        originalModel,
        reason: 'Model pattern appears valid (API validation unavailable)',
        fallbackUsed: false
      };
    }

    // Use default fallback
    return {
      isValid: false,
      normalizedModel: DEFAULT_FALLBACK_MODEL,
      originalModel,
      reason: `Cannot validate model '${originalModel}' - API unavailable. Using default fallback '${DEFAULT_FALLBACK_MODEL}'.`,
      fallbackUsed: true
    };
  }

  return {
    isValid: false,
    normalizedModel: model,
    originalModel,
    reason: 'Cannot validate model - API unavailable',
    fallbackUsed: false
  };
}

/**
 * Find similar model using fuzzy matching
 */
function findSimilarModel(model: string, validModels: string[]): string | null {
  const normalized = model.toLowerCase().trim();

  // Exact match (case-insensitive)
  const exactMatch = validModels.find(m => m.toLowerCase().trim() === normalized);
  if (exactMatch) return exactMatch;

  // Partial match (contains)
  const partialMatch = validModels.find(m => 
    m.toLowerCase().includes(normalized) || normalized.includes(m.toLowerCase())
  );
  if (partialMatch) return partialMatch;

  // Pattern match (claude-*)
  if (normalized.includes('claude')) {
    // Try to find exact type match first
    if (normalized.includes('sonnet')) {
      const sonnetModel = validModels.find(m => m.toLowerCase().includes('sonnet'));
      if (sonnetModel) return sonnetModel;
    }
    if (normalized.includes('opus')) {
      const opusModel = validModels.find(m => m.toLowerCase().includes('opus'));
      if (opusModel) return opusModel;
    }
    
    // Fallback to any claude model
    const claudeModel = validModels.find(m => m.toLowerCase().includes('claude'));
    if (claudeModel) return claudeModel;
  }

  // Pattern match (o3, o1, etc.)
  if (normalized.startsWith('o')) {
    const oModel = validModels.find(m => m.toLowerCase().startsWith('o'));
    if (oModel) return oModel;
  }

  return null;
}

/**
 * Check if model name follows valid pattern
 */
function isValidModelPattern(model: string): boolean {
  // Valid patterns:
  // - claude-*-*
  // - o3, o1
  // - Must contain alphanumeric, hyphens, dots
  const pattern = /^[a-z0-9]+(-[a-z0-9]+)*(-[a-z0-9]+)*$/i;
  return pattern.test(model) && model.length >= 3 && model.length <= 100;
}

/**
 * Get available models (with caching)
 * @param apiKey - Cursor API key
 * @param forceRefresh - Force refresh cache
 * @returns Array of available model names
 */
export async function getAvailableModels(apiKey: string, forceRefresh = false): Promise<string[]> {
  return getValidModels(apiKey, forceRefresh);
}

/**
 * Refresh models cache (call this periodically or on demand)
 * @param apiKey - Cursor API key
 */
export async function refreshModelsCache(apiKey: string): Promise<void> {
  logger.info('Refreshing models cache...');
  await getValidModels(apiKey, true);
  logger.info('Models cache refreshed', { 
    models: modelCache?.models || [],
    count: modelCache?.models.length || 0
  });
}

/**
 * Clear model cache (useful for testing or forced refresh)
 */
export function clearModelCache(): void {
  modelCache = null;
  logger.info('Model cache cleared');
}

/**
 * Get cached models (for debugging/monitoring)
 */
export function getCachedModels(): string[] | null {
  if (!modelCache || Date.now() >= modelCache.expiresAt) {
    return null;
  }
  return modelCache.models;
}

/**
 * Get fallback models (for when API is unavailable)
 */
export function getFallbackModels(): readonly string[] {
  return FALLBACK_MODELS;
}
