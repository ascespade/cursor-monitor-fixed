/**
 * POST /api/cloud-agents/webhook
 *
 * Purpose:
 * - Receive webhooks from the Cursor Cloud Agents API.
 * - Handle statusChange events (currently the only supported event type by Cursor).
 * - Optionally forward important events to Slack.
 *
 * Supported Event Types (per Cursor documentation):
 * - statusChange: Triggered when an agent transitions to ERROR or FINISHED state.
 *   Payload includes: event, timestamp, id, status, source (repository, ref), 
 *   target (url, branchName, prUrl), summary
 *
 * Webhook Headers:
 * - X-Webhook-Signature: HMAC-SHA256 signature (format: sha256=<hex_digest>)
 * - X-Webhook-ID: Unique identifier for the delivery
 * - X-Webhook-Event: Event type (currently "statusChange")
 * - User-Agent: "Cursor-Agent-Webhook/1.0"
 *
 * Notes:
 * - Currently, Cursor only supports statusChange events (not message events).
 * - This endpoint is prepared for future event types (message_added, etc.) but will handle them gracefully.
 * - Configure the webhook URL in the Cursor dashboard settings.
 * - Signature verification should be implemented for production use.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';

import { sendSlackMessage } from '@/shared/utils/slack';
import { logger } from '@/shared/utils/logger';
import { executeWebhookActions, type WebhookActionType } from '@/features/cloud-agents/services/webhook-actions.service';
import { orchestratorQueue } from '@/features/cloud-agents/orchestrator/queue/redis';
import { env } from '@/config/env';

interface CursorWebhookPayload {
  event?: string; // Currently "statusChange"
  timestamp?: string;
  id?: string; // Agent ID
  status?: string; // FINISHED, ERROR, etc.
  source?: {
    repository?: string;
    ref?: string;
  };
  target?: {
    url?: string;
    branchName?: string;
    prUrl?: string;
  };
  summary?: string;
  // Legacy format support (if Cursor uses different structure)
  eventType?: string;
  agent?: {
    id?: string;
    status?: string;
    name?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Verify webhook signature using HMAC-SHA256
 * Cursor sends signature in format: sha256=<hex_digest>
 */
function verifyWebhookSignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature || !secret) {
    return false;
  }

  // Remove 'sha256=' prefix if present
  const signatureValue = signature.startsWith('sha256=') 
    ? signature.slice(7) 
    : signature;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signatureValue),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // Get headers for verification
  const webhookEvent = request.headers.get('X-Webhook-Event') ?? 'unknown';
  const webhookId = request.headers.get('X-Webhook-ID') ?? 'unknown';
  const signature = request.headers.get('X-Webhook-Signature');
  const userAgent = request.headers.get('User-Agent');

  // Get raw body for signature verification
  const rawBody = await request.text();
  let body: CursorWebhookPayload;
  
  try {
    body = JSON.parse(rawBody) as CursorWebhookPayload;
  } catch {
    body = {} as CursorWebhookPayload;
  }

  // Verify signature if WEBHOOK_SECRET is configured
  if (env.WEBHOOK_SECRET) {
    const isValid = verifyWebhookSignature(env.WEBHOOK_SECRET, rawBody, signature);
    
    if (!isValid) {
      logger.warn('Webhook signature verification failed', {
        webhookId,
        hasSignature: !!signature,
        userAgent
      });
      
      return NextResponse.json(
        { ok: false, error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    logger.info('Webhook signature verified', { webhookId });
  } else {
    logger.warn('WEBHOOK_SECRET not configured - skipping signature verification', {
      webhookId
    });
  }

  // Handle Cursor's official webhook format (statusChange event)
  const event = body.event ?? body.eventType ?? 'unknown';
  const agentId = body.id ?? body.agent?.id ?? 'unknown';
  const status = body.status ?? body.agent?.status ?? 'unknown';
  const summary = body.summary ?? body.agent?.name ?? 'Agent status changed';
  const targetUrl = body.target?.url;
  const prUrl = body.target?.prUrl;

  // Log all webhook events for debugging
  logger.info('Received Cloud Agent webhook', {
    webhookEvent,
    webhookId,
    hasSignature: !!signature,
    event,
    agentId,
    status,
    summary,
    prUrl,
    payload: JSON.stringify(body)
  });

  // Handle statusChange events (the only currently supported event type by Cursor)
  if (event === 'statusChange' || webhookEvent === 'statusChange' || status === 'FINISHED' || status === 'ERROR' || status === 'EXPIRED') {
    const emoji = status === 'FINISHED' ? '✅' : status === 'ERROR' ? '❌' : status === 'EXPIRED' ? '⏰' : '📊';
    
    let text = `${emoji} Cloud Agent *${agentId}* status changed to *${status}*`;
    
    if (summary) {
      text += `\n\n*Summary:* ${summary}`;
    }
    
    if (prUrl) {
      text += `\n*PR:* ${prUrl}`;
    } else if (targetUrl) {
      text += `\n*View:* ${targetUrl}`;
    }

    // Send to Slack (if configured)
    await sendSlackMessage({ text }).catch((error) => {
      logger.error('Failed to send Slack notification', { error, agentId, status });
    });

    // Execute automated actions based on webhook event
    // You can configure which actions to execute via environment variables or database
    const actionsToExecute: WebhookActionType[] = [
      'log_event',
      'send_notification'
      // Add more actions as needed:
      // 'launch_followup_agent', // Launch another agent automatically
      // 'trigger_workflow' // Trigger external workflow
    ];

    await executeWebhookActions(
      {
        agentId,
        status,
        summary,
        repository: body.source?.repository,
        prUrl
      },
      actionsToExecute
    ).catch((error) => {
      logger.error('Failed to execute webhook actions', { error, agentId, status });
      // Don't fail the webhook if actions fail
    });

    // ═══════════════════════════════════════════════
    // 🚀 Orchestrator Queue (Hybrid Architecture)
    // ═══════════════════════════════════════════════
    // Queue webhook event for processing by Local Server orchestrator
    // This runs async - doesn't block the webhook response
    
    if (status === 'FINISHED' || status === 'ERROR') {
      if (orchestratorQueue) {
        orchestratorQueue
          .add(
          'process-webhook',
          {
            webhookData: body,
            agentId,
            status,
            event,
            summary,
            repository: body.source?.repository,
            branchName: body.target?.branchName,
            prUrl: body.target?.prUrl,
            timestamp: new Date().toISOString()
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000
            },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 1000 }
          }
        )
        .then(() => {
          logger.info('Webhook queued for orchestrator processing', { agentId, status });
        })
        .catch((error) => {
          // ⚠️ Don't fail the webhook if queue fails - system continues to work
          logger.error('Failed to queue webhook for orchestrator', { 
            error: error instanceof Error ? error.message : String(error),
            agentId,
            status
          });
        });
      } else {
        logger.debug('Redis not available - webhook event not queued (will be processed via outbox if needed)', { agentId, status });
      }
    }
  } else {
    // Log unknown events for debugging and future support
    logger.warn('Received webhook with unsupported event type', {
      event,
      webhookEvent,
      agentId,
      payload: JSON.stringify(body)
    });
  }

  // Always return success to acknowledge receipt
  return NextResponse.json({ 
    ok: true,
    received: {
      event,
      webhookEvent,
      agentId,
      status,
      processed: true
    }
  });
}




