/**
 * Cron Job - Check Stuck Agents
 * 
 * Runs every 30 minutes to check for stuck agents
 * Stops agents that haven't updated in 4+ hours
 */

import '../utils/env-loader'; // Load centralized .env from parent directory
import { stateManager } from '../services/state-manager.service';
import { logger } from '../utils/logger';

const AGENT_TIMEOUT_MS = (parseInt(process.env['AGENT_TIMEOUT_HOURS'] || '4', 10) * 60 * 60 * 1000);
const CURSOR_API_BASE = 'https://api.cursor.com/v0';
const apiKey = process.env['CURSOR_API_KEY']!;

async function checkStuckAgents(): Promise<void> {
  try {
    logger.info('Running stuck agents check', { timeoutHours: AGENT_TIMEOUT_MS / (60 * 60 * 1000) });

    const activeAgents = await stateManager.getActiveAgents();
    const now = Date.now();
    let stoppedCount = 0;

    for (const agent of activeAgents) {
      if (!agent.updated_at) continue;

      const lastUpdate = new Date(agent.updated_at).getTime();
      const timeSinceUpdate = now - lastUpdate;

      if (timeSinceUpdate > AGENT_TIMEOUT_MS) {
        const minutesStuck = Math.round(timeSinceUpdate / 1000 / 60);
        logger.warn('Found stuck agent', {
          agentId: agent.agent_id,
          minutesStuck,
          lastUpdate: agent.updated_at
        });

        try {
          // Stop agent via Cursor API
          const response = await fetch(`${CURSOR_API_BASE}/agents/${agent.agent_id}/stop`, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64')
            }
          });

          if (!response.ok) {
            throw new Error(`Cursor API error: ${response.status}`);
          }

          await stateManager.updateStatus(agent.agent_id, 'TIMEOUT');
          stoppedCount++;

          logger.info('Stopped stuck agent', { agentId: agent.agent_id });
        } catch (error) {
          logger.error('Failed to stop stuck agent', {
            agentId: agent.agent_id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    logger.info('Stuck agents check completed', {
      checked: activeAgents.length,
      stopped: stoppedCount
    });
  } catch (error) {
    logger.error('Failed to check stuck agents', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

// Run check
checkStuckAgents()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Cron job failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });

