/**
 * Webhook Actions Service
 *
 * Purpose:
 * - Define and execute automated actions when webhook events are received.
 * - Examples: Launch new agents, send follow-ups, trigger notifications, etc.
 *
 * Usage:
 * - Import this service in the webhook route to trigger actions based on event data.
 */

import { logger } from '@/shared/utils/logger';

export interface WebhookActionConfig {
  agentId: string;
  status: string;
  summary?: string;
  repository?: string;
  prUrl?: string;
}

/**
 * Execute automated actions based on webhook event
 *
 * @param config - Webhook event data
 * @param actions - Array of action types to execute
 */
export async function executeWebhookActions(
  config: WebhookActionConfig,
  actions: WebhookActionType[] = []
): Promise<void> {
  for (const action of actions) {
    try {
      switch (action) {
        case 'log_event':
          await logWebhookEvent(config);
          break;
        case 'launch_followup_agent':
          await launchFollowupAgent(config);
          break;
        case 'send_notification':
          await sendNotification(config);
          break;
        case 'trigger_workflow':
          await triggerWorkflow(config);
          break;
        default:
          logger.warn('Unknown webhook action type', { action, config });
      }
    } catch (error) {
      logger.error('Failed to execute webhook action', { action, error, config });
      // Continue with other actions even if one fails
    }
  }
}

export type WebhookActionType =
  | 'log_event'
  | 'launch_followup_agent'
  | 'send_notification'
  | 'trigger_workflow';

/**
 * Log webhook event (always executed)
 */
async function logWebhookEvent(config: WebhookActionConfig): Promise<void> {
  logger.info('Webhook event logged', {
    agentId: config.agentId,
    status: config.status,
    summary: config.summary,
    repository: config.repository,
    prUrl: config.prUrl
  });
}

/**
 * Launch a follow-up agent automatically when an agent finishes successfully
 *
 * Example: When Agent A finishes, automatically launch Agent B with a follow-up task
 *
 * To enable this, you need to:
 * 1. Set CURSOR_API_KEY environment variable
 * 2. Uncomment the launch_followup_agent action in webhook/route.ts
 * 3. Customize the followupPrompt logic below
 */
async function launchFollowupAgent(config: WebhookActionConfig): Promise<void> {
  // Only launch follow-up if agent finished successfully
  if (config.status !== 'FINISHED') {
    logger.info('Skipping follow-up agent launch (agent did not finish successfully)', {
      agentId: config.agentId,
      status: config.status
    });
    return;
  }

  // Get API key from environment (you can also store it in database/config)
  const apiKey = process.env['CURSOR_API_KEY'];
  if (!apiKey) {
    logger.warn('Cannot launch follow-up agent: CURSOR_API_KEY not configured');
    return;
  }

  // Validate repository is available
  if (!config.repository) {
    logger.warn('Cannot launch follow-up agent: repository not available in webhook payload');
    return;
  }

  try {
    // Import here to avoid circular dependencies
    const { launchAgent } = await import('@/infrastructure/cursor-cloud-agents/client');

    // Customize this prompt based on your needs
    const followupPrompt = config.summary
      ? `Review and improve the work done by the previous agent.\n\nPrevious agent summary: ${config.summary}\n\nPlease review the changes, run tests, and suggest improvements.`
      : `Review and improve the changes made by agent ${config.agentId}. Run tests and ensure code quality.`;

    logger.info('Launching follow-up agent', {
      originalAgentId: config.agentId,
      repository: config.repository,
      prompt: followupPrompt.substring(0, 100) + '...'
    });

    // Launch the follow-up agent
    const newAgent = await launchAgent(apiKey, {
      prompt: {
        text: followupPrompt
      },
      source: {
        repository: config.repository,
        ref: 'main'
      },
      model: 'auto', // or specify a model
      target: {
        autoCreatePr: true // automatically create PR
      }
    });

    logger.info('Follow-up agent launched successfully', {
      originalAgentId: config.agentId,
      newAgentId: newAgent.id,
      newAgentName: newAgent.name
    });
  } catch (error) {
    logger.error('Failed to launch follow-up agent', {
      error,
      originalAgentId: config.agentId,
      repository: config.repository
    });
    throw error; // Re-throw to be caught by executeWebhookActions
  }
}

/**
 * Send notification (Slack, email, etc.)
 */
async function sendNotification(config: WebhookActionConfig): Promise<void> {
  // This is already handled in the webhook route
  // But can be extended here for other notification channels
  logger.info('Notification sent', { agentId: config.agentId, status: config.status });
}

/**
 * Trigger custom workflow (webhook to external service, database update, etc.)
 */
async function triggerWorkflow(config: WebhookActionConfig): Promise<void> {
  // Example: Call external API, update database, trigger CI/CD, etc.
  logger.info('Workflow triggered', { agentId: config.agentId, status: config.status });
  
  // Example implementation:
  // await fetch('https://your-workflow-api.com/trigger', {
  //   method: 'POST',
  //   body: JSON.stringify(config)
  // });
}
