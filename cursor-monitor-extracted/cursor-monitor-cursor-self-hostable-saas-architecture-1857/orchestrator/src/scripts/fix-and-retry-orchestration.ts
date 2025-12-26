/**
 * Fix and Retry Single Orchestration
 * 
 * Purpose:
 * - Fix model issues in a single orchestration
 * - Update status to queued
 * - Create new outbox job to retry
 */

import '../utils/env-loader'; // Load centralized .env
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { validateModel } from '../services/model-validator.service';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] || process.env['SUPABASE_URL'];
const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
const apiKey = process.env['CURSOR_API_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration');
  process.exit(1);
}

if (!apiKey) {
  console.error('Missing CURSOR_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Fix and retry a single orchestration
 */
async function fixAndRetryOrchestration(orchestrationId: string): Promise<void> {
  try {
    logger.info('Starting orchestration fix and retry', {
      orchestrationId,
      timestamp: new Date().toISOString()
    });

    // 1. Fetch orchestration
    const { data: orchestration, error: fetchError } = await supabase
      .from('orchestrations')
      .select('*')
      .eq('id', orchestrationId)
      .single();

    if (fetchError || !orchestration) {
      throw new Error(`Failed to fetch orchestration: ${fetchError?.message || 'Not found'}`);
    }

    logger.info('Found orchestration', {
      id: orchestration.id,
      status: orchestration.status,
      model: orchestration.model,
      repository: orchestration.repository_url
    });

    // 2. Validate and fix model
    const currentModel = orchestration.model || null; // null = Auto mode
    const validationResult = await validateModel(currentModel, apiKey, {
      allowDeprecated: false,
      useFallback: true,
      forceRefreshCache: true
    });

    const updates: Record<string, unknown> = {};
    let needsUpdate = false;

    // 3. Update model if needed
    if (validationResult.fallbackUsed || !validationResult.isValid) {
      updates.model = validationResult.normalizedModel;
      needsUpdate = true;
      logger.info('Model will be updated', {
        original: currentModel,
        new: validationResult.normalizedModel,
        reason: validationResult.reason
      });
    }

    // 4. Reset status to queued
    if (orchestration.status === 'error') {
      updates.status = 'queued';
      updates.error_summary = null;
      needsUpdate = true;
      logger.info('Status will be reset to queued');
    }

    // 5. Update orchestration
    if (needsUpdate) {
      updates.updated_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('orchestrations')
        .update(updates)
        .eq('id', orchestrationId);

      if (updateError) {
        throw new Error(`Failed to update orchestration: ${updateError.message}`);
      }

      logger.info('Orchestration updated', {
        id: orchestrationId,
        updates
      });

      // 6. Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: orchestrationId,
        level: 'info',
        step_key: 'orchestration_fixed_and_retried',
        step_phase: 'end',
        message: `Orchestration fixed and queued for retry. Model: ${currentModel} → ${validationResult.normalizedModel}`,
        payload: {
          previousStatus: orchestration.status,
          newStatus: 'queued',
          previousModel: currentModel,
          newModel: validationResult.normalizedModel,
          reason: validationResult.reason,
          fixedAt: new Date().toISOString()
        }
      });

      // 7. Create new outbox job
      const { error: jobError } = await supabase
        .from('orchestration_outbox_jobs')
        .insert({
          orchestration_id: orchestrationId,
          type: 'start-orchestration',
          status: 'pending',
          payload: {
            prompt: orchestration.prompt,
            repository: orchestration.repository_url,
            ref: orchestration.ref || 'main',
            model: validationResult.normalizedModel,
            apiKey: apiKey,
            options: orchestration.options || {}
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (jobError) {
        logger.error('Failed to create outbox job', {
          error: jobError.message
        });
        throw new Error(`Failed to create outbox job: ${jobError.message}`);
      }

      logger.info('Outbox job created successfully', {
        orchestrationId
      });

      console.log('\n✅ Orchestration fixed and queued for retry!');
      console.log(`   ID: ${orchestrationId}`);
      console.log(`   Model: ${currentModel} → ${validationResult.normalizedModel}`);
      console.log(`   Status: ${orchestration.status} → queued`);
      console.log(`   Worker will process it automatically\n`);

    } else {
      logger.info('No updates needed', {
        orchestrationId
      });
      console.log('\n✅ Orchestration is already in good state\n');
    }

  } catch (error) {
    logger.error('Failed to fix orchestration', {
      orchestrationId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Get orchestration ID from command line
const orchestrationId = process.argv[2];

if (!orchestrationId) {
  console.error('Usage: npm run fix-and-retry-orchestration <orchestration-id>');
  console.error('Example: npm run fix-and-retry-orchestration eeb989eb-a715-4b41-ac4d-bb3c2edd7d25');
  process.exit(1);
}

// Run
fixAndRetryOrchestration(orchestrationId)
  .then(() => {
    logger.info('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed', { error });
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

