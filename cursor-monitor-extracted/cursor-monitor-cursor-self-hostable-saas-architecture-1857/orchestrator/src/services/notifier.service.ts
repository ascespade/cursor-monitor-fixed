/**
 * Notifier Service
 * 
 * Sends notifications via multiple channels (Slack, etc.)
 */

import { logger } from '../utils/logger';

interface NotificationData {
  message?: string;
  branchName?: string;
  iterations?: number;
  tasksCompleted?: string[];
  prUrl?: string;
  testResults?: any;
  [key: string]: unknown;
}

class NotifierService {
  private readonly slackWebhookUrl: string | null;
  private readonly enableSlack: boolean;

  constructor() {
    this.slackWebhookUrl = process.env['SLACK_WEBHOOK_URL'] || null;
    this.enableSlack = process.env['ENABLE_SLACK_NOTIFICATIONS'] === 'true' && !!this.slackWebhookUrl;
  }

  /**
   * Notify progress update
   */
  async notifyProgress(agentId: string, iteration: number, analysis: any): Promise<void> {
    // Only notify every 3 iterations to avoid spam
    if (iteration % 3 !== 0) {
      return;
    }

    const message = `🔄 Agent *${agentId}* - Iteration ${iteration}\n` +
      `Action: *${analysis.action}*\n` +
      `Confidence: ${(analysis.confidence * 100).toFixed(0)}%\n` +
      `Tasks Completed: ${analysis.tasksCompleted?.length || 0}\n` +
      `Tasks Remaining: ${analysis.tasksRemaining?.length || 0}`;

    await this.sendToSlack({ text: message }).catch((error) => {
      logger.error('Failed to send progress notification', { agentId, error });
    });
  }

  /**
   * Notify success
   */
  async notifySuccess(agentId: string, data: NotificationData): Promise<void> {
    const message = `✅ Agent *${agentId}* completed successfully!\n\n` +
      `Branch: ${data.branchName || 'N/A'}\n` +
      `Iterations: ${data.iterations || 0}\n` +
      `Tasks Completed: ${data.tasksCompleted?.length || 0}\n` +
      (data.prUrl ? `PR: ${data.prUrl}\n` : '') +
      (data.testResults?.success ? '✅ Tests passed' : '');

    await this.sendToSlack({ text: message }).catch((error) => {
      logger.error('Failed to send success notification', { agentId, error });
    });

    logger.info('Agent completed successfully', { agentId, data });
  }

  /**
   * Notify failure
   */
  async notifyFailure(agentId: string, data: NotificationData): Promise<void> {
    const message = `❌ Agent *${agentId}* failed\n\n` +
      `Reason: ${data.message || 'Unknown error'}\n` +
      (data['details'] ? `Details: ${JSON.stringify(data['details'])}` : '');

    await this.sendToSlack({ text: message }).catch((error) => {
      logger.error('Failed to send failure notification', { agentId, error });
    });

    logger.error('Agent failed', { agentId, data });
  }

  /**
   * Send to Slack
   */
  private async sendToSlack(payload: { text: string }): Promise<void> {
    if (!this.enableSlack || !this.slackWebhookUrl) {
      return;
    }

    try {
      const response = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }
    } catch (error) {
      logger.error('Slack notification failed', { error });
      throw error;
    }
  }
}

export const notifier = new NotifierService();

