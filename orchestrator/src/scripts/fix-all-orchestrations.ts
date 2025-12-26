/**
 * Fix All Orchestrations Script
 * 
 * Purpose:
 * - Check all orchestrations (ERROR, ACTIVE, etc.)
 * - Fix stuck orchestrations
 * - Update status for old/completed orchestrations
 * - Clean up invalid states
 */

import '../utils/env-loader'; // Load centralized .env
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] || process.env['SUPABASE_URL'];
const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface OrchestrationRecord {
  id: string;
  status: string;
  master_agent_id: string | null;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  error_summary: string | null;
  tasks_total: number | null;
  tasks_completed: number | null;
  active_agents: number | null;
  created_at: string;
}

/**
 * Check if orchestration is stuck (old and still active)
 */
function isStuck(orchestration: OrchestrationRecord): boolean {
  const now = new Date();
  const updatedAt = orchestration.updated_at ? new Date(orchestration.updated_at) : null;
  const createdAt = new Date(orchestration.created_at);
  
  // If updated more than 1 hour ago and still active/running
  if (['running', 'active', 'queued'].includes(orchestration.status.toLowerCase())) {
    if (updatedAt) {
      const hoursSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate > 1) {
        return true;
      }
    } else {
      // No update time, check creation time
      const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceCreation > 2) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if orchestration should be marked as completed
 */
function shouldBeCompleted(orchestration: OrchestrationRecord): boolean {
  // If has master agent ID but status is still running/active
  if (orchestration.master_agent_id && 
      ['running', 'active'].includes(orchestration.status.toLowerCase())) {
    // Check if tasks are completed
    if (orchestration.tasks_total && 
        orchestration.tasks_completed !== null &&
        orchestration.tasks_completed >= orchestration.tasks_total) {
      return true;
    }
    
    // Check if no active agents and tasks are done
    if (orchestration.active_agents === 0 && 
        orchestration.tasks_completed !== null &&
        orchestration.tasks_completed > 0) {
      return true;
    }
  }
  
  return false;
}

/**
 * Fix all orchestrations
 */
async function fixAllOrchestrations(): Promise<void> {
  try {
    logger.info('Starting comprehensive orchestration fix process', {
      timestamp: new Date().toISOString()
    });

    // Fetch ALL orchestrations
    const { data: orchestrations, error: fetchError } = await supabase
      .from('orchestrations')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch orchestrations: ${fetchError.message}`);
    }

    if (!orchestrations || orchestrations.length === 0) {
      logger.info('No orchestrations found');
      return;
    }

    logger.info('Found orchestrations to check', {
      total: orchestrations.length
    });

    let fixedCount = 0;
    let completedCount = 0;
    let errorToQueuedCount = 0;
    let stuckFixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each orchestration
    for (const orchestration of orchestrations as OrchestrationRecord[]) {
      try {
        const updates: Partial<OrchestrationRecord> = {};
        let needsUpdate = false;
        let fixReason = '';

        // 1. Check if stuck and should be marked as error
        if (isStuck(orchestration)) {
          if (['running', 'active', 'queued'].includes(orchestration.status.toLowerCase())) {
            updates.status = 'error';
            updates.error_summary = 'Orchestration stuck - no updates for more than 1 hour';
            needsUpdate = true;
            fixReason = 'stuck_orchestration';
            stuckFixedCount++;
            
            logger.info('Fixing stuck orchestration', {
              id: orchestration.id,
              previousStatus: orchestration.status,
              lastUpdate: orchestration.updated_at
            });
          }
        }

        // 2. Check if should be marked as completed
        if (shouldBeCompleted(orchestration) && !needsUpdate) {
          updates.status = 'completed';
          updates.completed_at = new Date().toISOString();
          needsUpdate = true;
          fixReason = 'auto_complete';
          completedCount++;
          
          logger.info('Marking orchestration as completed', {
            id: orchestration.id,
            previousStatus: orchestration.status,
            tasksCompleted: orchestration.tasks_completed,
            tasksTotal: orchestration.tasks_total
          });
        }

        // 3. Fix ERROR orchestrations
        if (orchestration.status.toLowerCase() === 'error' && !needsUpdate) {
          const createdAt = new Date(orchestration.created_at);
          const now = new Date();
          const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
          
          // For old errors (more than 24 hours), ensure they have proper error_summary
          if (hoursSinceCreation > 24) {
            if (!orchestration.error_summary) {
              // Add error summary if missing
              updates.error_summary = 'Orchestration failed - see events for details';
              needsUpdate = true;
              fixReason = 'add_error_summary';
              
              logger.info('Adding error summary to old error orchestration', {
                id: orchestration.id,
                hoursSinceCreation: Math.round(hoursSinceCreation)
              });
            } else {
              // Old error with summary - keep as is (it's a legitimate error)
              skippedCount++;
              logger.debug('Keeping old error orchestration as-is', {
                id: orchestration.id,
                hoursSinceCreation: Math.round(hoursSinceCreation),
                hasErrorSummary: !!orchestration.error_summary
              });
            }
          } else {
            // Recent error - check if we can retry
            // Only retry if it's a transient error (no error_summary or specific error types)
            if (!orchestration.error_summary || 
                orchestration.error_summary.includes('timeout') ||
                orchestration.error_summary.includes('connection') ||
                orchestration.error_summary.includes('stuck')) {
              updates.status = 'queued';
              updates.error_summary = null;
              needsUpdate = true;
              fixReason = 'retry_transient_error';
              errorToQueuedCount++;
              
              logger.info('Retrying transient error orchestration', {
                id: orchestration.id,
                errorSummary: orchestration.error_summary
              });
            } else {
              // Permanent error - keep as error
              skippedCount++;
            }
          }
        }

        // 4. Ensure updated_at is set
        if (!orchestration.updated_at) {
          updates.updated_at = orchestration.created_at;
          needsUpdate = true;
          if (!fixReason) fixReason = 'set_updated_at';
        }

        // Apply updates
        if (needsUpdate) {
          updates.updated_at = new Date().toISOString();
          
          const { error: updateError } = await supabase
            .from('orchestrations')
            .update(updates)
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
              step_key: 'orchestration_fixed',
              step_phase: 'end',
              message: `Orchestration fixed: ${fixReason}`,
              payload: {
                previousStatus: orchestration.status,
                newStatus: updates.status || orchestration.status,
                reason: fixReason,
                fixedAt: new Date().toISOString()
              }
            });
          }
        } else {
          skippedCount++;
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
      completed: completedCount,
      errorToQueued: errorToQueuedCount,
      stuckFixed: stuckFixedCount,
      skipped: skippedCount,
      errors: errorCount
    });

    // Print summary
    console.log('\n📊 Summary:');
    console.log(`   Total orchestrations: ${orchestrations.length}`);
    console.log(`   ✅ Fixed: ${fixedCount}`);
    console.log(`   ✅ Completed: ${completedCount}`);
    console.log(`   ✅ Retried errors: ${errorToQueuedCount}`);
    console.log(`   ✅ Fixed stuck: ${stuckFixedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}\n`);

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
  fixAllOrchestrations()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Script failed', { error });
      process.exit(1);
    });
}

export { fixAllOrchestrations };

