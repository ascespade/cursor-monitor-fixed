/**
 * Slack Notifications Helper
 *
 * Purpose:
 * - Send lightweight notifications (e.g. Cloud Agent status changes) to a
 *   Slack incoming webhook when configured via environment variables.
 */
import { env } from '@/config/env';
import { logger } from '@/shared/utils/logger';

interface SlackMessageOptions {
  text: string;
}

export async function sendSlackMessage(options: SlackMessageOptions): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) {
    return;
  }

  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: options.text })
    });
  } catch (error) {
    logger.error('Failed to send Slack message', { error: String(error) });
  }
}







