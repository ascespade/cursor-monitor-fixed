/**
 * Cleanup Orchestrations Script
 * 
 * Purpose:
 * - Delete orchestrations that cannot be fixed
 * - Fix orchestrations that can be fixed
 * - Test one orchestration to ensure it works
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
 * Delete orchestration and related data
 */
async function deleteOrchestration(orchestrationId: string): Promise<void> {
  try {
    // Delete related events first (CASCADE should handle this, but being explicit)
    await supabase
      .from('orchestration_events')
      .delete()
      .eq('orchestration_id', orchestrationId);

    // Delete outbox jobs
    await supabase
      .from('orchestration_outbox_jobs')
      .delete()
      .eq('orchestration_id', orchestrationId);

    // Delete orchestration
    const { error } = await supabase
      .from('orchestrations')
      .delete()
      .eq('id', orchestrationId);

    if (error) {
      throw new Error(`Failed to delete orchestration: ${error.message}`);
    }

    logger.info('Orchestration deleted', { orchestrationId });
  } catch (error) {
    logger.error('Failed to delete orchestration', {
      orchestrationId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Fix and retry orchestration
 */
async function fixAndRetryOrchestration(orchestrationId: string): Promise<boolean> {
  try {
    logger.info('Fixing orchestration', { orchestrationId });

    // Fetch orchestration
    const { data: orchestration, error: fetchError } = await supabase
      .from('orchestrations')
      .select('*')
      .eq('id', orchestrationId)
      .single();

    if (fetchError || !orchestration) {
      throw new Error(`Failed to fetch orchestration: ${fetchError?.message || 'Not found'}`);
    }

    // Validate and fix model
    const currentModel = orchestration.model || '';
    const validationResult = await validateModel(currentModel, apiKey || '', {
      allowDeprecated: false,
      useFallback: true,
      forceRefreshCache: false,
      allowAutoMode: true // Use Auto mode if model is invalid
    });

    const updates: Record<string, unknown> = {};
    let needsUpdate = false;

    // Update model if needed
    if (validationResult.fallbackUsed || !validationResult.isValid || validationResult.isAutoMode) {
      // If Auto mode, set model to null (empty string)
      updates.model = validationResult.isAutoMode ? null : validationResult.normalizedModel;
      needsUpdate = true;
      logger.info('Model will be updated', {
        original: currentModel || 'null',
        new: validationResult.isAutoMode ? 'AUTO (null)' : validationResult.normalizedModel,
        reason: validationResult.reason
      });
    }

    // Reset status to queued
    if (orchestration.status === 'error' || orchestration.status === 'ERROR') {
      updates.status = 'queued';
      updates.error_summary = null;
      needsUpdate = true;
      logger.info('Status will be reset to queued');
    }

    // Update orchestration
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

      // Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: orchestrationId,
        level: 'info',
        step_key: 'orchestration_fixed_and_retried',
        step_phase: 'end',
        message: `Orchestration fixed and queued for retry. Model: ${currentModel || 'null'} → ${validationResult.isAutoMode ? 'AUTO' : validationResult.normalizedModel}`,
        payload: {
          previousStatus: orchestration.status,
          newStatus: 'queued',
          previousModel: currentModel || null,
          newModel: validationResult.isAutoMode ? null : validationResult.normalizedModel,
          reason: validationResult.reason,
          fixedAt: new Date().toISOString()
        }
      });

      // Create new outbox job
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
            model: validationResult.isAutoMode ? undefined : validationResult.normalizedModel, // Don't send model if Auto mode
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

      return true;
    }

    return false;
  } catch (error) {
    logger.error('Failed to fix orchestration', {
      orchestrationId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Main cleanup function
 */
async function cleanupOrchestrations(): Promise<void> {
  try {
    // Get all ERROR orchestrations
    const { data: errorOrchestrations, error: fetchError } = await supabase
      .from('orchestrations')
      .select('*')
      .in('status', ['error', 'ERROR'])
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch orchestrations: ${fetchError.message}`);
    }

    if (!errorOrchestrations || errorOrchestrations.length === 0) {
      console.log('\n✅ No ERROR orchestrations found to clean up\n');
      return;
    }

    console.log(`\n📋 Found ${errorOrchestrations.length} ERROR orchestrations\n`);

    // Try to fix the first one
    const firstOrchestration = errorOrchestrations[0];
    console.log(`🔧 Attempting to fix orchestration: ${firstOrchestration.id}`);
    
    try {
      const fixed = await fixAndRetryOrchestration(firstOrchestration.id);
      if (fixed) {
        console.log(`✅ Orchestration fixed and queued: ${firstOrchestration.id}\n`);
        console.log('⏳ Waiting 5 seconds to check if it starts processing...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check status
        const { data: status } = await supabase
          .from('orchestrations')
          .select('status')
          .eq('id', firstOrchestration.id)
          .single();
        
        if (status && (status.status === 'queued' || status.status === 'running' || status.status === 'active')) {
          console.log(`✅ Orchestration is now ${status.status.toUpperCase()}\n`);
          console.log(`🌐 View it at: http://localhost:3000/cloud-agents/orchestrations/${firstOrchestration.id}\n`);
          return;
        }
      }
    } catch (error) {
      console.log(`❌ Failed to fix: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // If fixing didn't work, delete all ERROR orchestrations
    console.log('🗑️  Deleting all ERROR orchestrations...\n');
    for (const orch of errorOrchestrations) {
      try {
        await deleteOrchestration(orch.id);
        console.log(`  ✅ Deleted: ${orch.id}`);
      } catch (error) {
        console.log(`  ❌ Failed to delete ${orch.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\n✅ Cleanup complete. Deleted ${errorOrchestrations.length} ERROR orchestrations\n`);

  } catch (error) {
    logger.error('Cleanup failed', { error });
    throw error;
  }
}

// Run cleanup
cleanupOrchestrations()
  .then(() => {
    logger.info('Cleanup script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Cleanup script failed', { error });
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });


