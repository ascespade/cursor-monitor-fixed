/**
 * Fix Old Orchestrations Script
 * 
 * Purpose:
 * - Fix orchestrations with invalid/deprecated models
 * - Validate and update model names
 * - Follow international best practices for data migration
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { validateModel } from '../services/model-validator.service';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] || process.env['SUPABASE_URL'];
const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface OrchestrationRecord {
  id: string;
  model: string | null;
  status: string;
  error_message: string | null;
  error_code: string | null;
}

/**
 * Get API key from environment or prompt user
 */
function getApiKey(): string {
  const apiKey = process.env['CURSOR_API_KEY'];
  if (!apiKey) {
    throw new Error('CURSOR_API_KEY environment variable is required');
  }
  return apiKey;
}

/**
 * Fix orchestrations with invalid models
 */
async function fixOrchestrations(): Promise<void> {
  try {
    const apiKey = getApiKey();
    
    logger.info('Starting orchestration fix process', {
      timestamp: new Date().toISOString()
    });

    // Step 1: Find orchestrations with potentially invalid models
    const { data: orchestrations, error: fetchError } = await supabase
      .from('orchestrations')
      .select('id, model, status, error_message, error_code')
      .in('status', ['error', 'queued', 'running'])
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch orchestrations: ${fetchError.message}`);
    }

    if (!orchestrations || orchestrations.length === 0) {
      logger.info('No orchestrations to fix');
      return;
    }

    logger.info('Found orchestrations to check', {
      count: orchestrations.length
    });

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Step 2: Validate and fix each orchestration
    for (const orchestration of orchestrations as OrchestrationRecord[]) {
      try {
        const model = orchestration.model || 'claude-4.5-opus-high-thinking';
        
        // Validate model
        const validationResult = await validateModel(model, apiKey, {
          allowDeprecated: false,
          useFallback: true,
          forceRefreshCache: false
        });

        // If model needs fixing
        if (validationResult.fallbackUsed || !validationResult.isValid) {
          logger.info('Fixing orchestration', {
            id: orchestration.id,
            originalModel: orchestration.model,
            newModel: validationResult.normalizedModel,
            reason: validationResult.reason
          });

          // Update orchestration
          const updateData: Partial<OrchestrationRecord> = {
            model: validationResult.normalizedModel
          };

          // If orchestration is in error state due to model issue, reset it
          if (orchestration.status === 'error' && 
              orchestration.error_message?.includes('Model') &&
              orchestration.error_message?.includes('not available')) {
            updateData.status = 'queued';
            updateData.error_message = null;
            updateData.error_code = null;
            
            logger.info('Resetting orchestration status', {
              id: orchestration.id,
              previousStatus: orchestration.status
            });
          }

          const { error: updateError } = await supabase
            .from('orchestrations')
            .update(updateData)
            .eq('id', orchestration.id);

          if (updateError) {
            logger.error('Failed to update orchestration', {
              id: orchestration.id,
              error: updateError.message
            });
            errorCount++;
          } else {
            fixedCount++;
            
            // Log event
            await supabase.from('orchestration_events').insert({
              orchestration_id: orchestration.id,
              level: 'info',
              step_key: 'model_fixed',
              step_phase: 'end',
              message: `Model updated from '${orchestration.model}' to '${validationResult.normalizedModel}'`,
              payload: {
                originalModel: orchestration.model,
                newModel: validationResult.normalizedModel,
                reason: validationResult.reason,
                fixedAt: new Date().toISOString()
              }
            });
          }
        } else {
          skippedCount++;
          logger.debug('Orchestration model is valid', {
            id: orchestration.id,
            model: orchestration.model
          });
        }
      } catch (error) {
        logger.error('Error processing orchestration', {
          id: orchestration.id,
          error: error instanceof Error ? error.message : String(error)
        });
        errorCount++;
      }
    }

    logger.info('Orchestration fix process completed', {
      total: orchestrations.length,
      fixed: fixedCount,
      skipped: skippedCount,
      errors: errorCount
    });

  } catch (error) {
    logger.error('Fatal error in fix orchestrations script', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  fixOrchestrations()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Script failed', { error });
      process.exit(1);
    });
}

export { fixOrchestrations };

