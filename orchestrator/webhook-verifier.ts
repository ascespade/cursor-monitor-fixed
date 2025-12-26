/**
 * Webhook Signature Verifier
 * 
 * Verifies HMAC-SHA256 signatures for incoming webhooks
 * from Cursor Cloud Agents to ensure authenticity.
 * 
 * Usage:
 *   import { verifyWebhookSignature } from './webhook-verifier'
 *   const isValid = verifyWebhookSignature(req.body, req.headers['x-signature'])
 */

import crypto from 'crypto';

/**
 * Verifies webhook signature using HMAC-SHA256
 * 
 * @param payload - Raw request body (string or Buffer)
 * @param signature - Signature from X-Signature header
 * @param secret - Shared webhook secret (from env)
 * @returns true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  if (!secret) {
    throw new Error('WEBHOOK_SECRET is not configured');
  }

  // Create HMAC hash
  const hmac = crypto.createHmac('sha256', secret);
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  hmac.update(payloadString);
  const expectedSignature = hmac.digest('hex');

  // Compare signatures (constant-time comparison to prevent timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Middleware function for Express/Next.js API routes
 * 
 * @param req - Request object
 * @param res - Response object
 * @param next - Next function
 */
export function webhookVerifierMiddleware(
  req: any,
  res: any,
  next: any
): void {
  const signature = req.headers['x-signature'] || req.headers['x-cursor-signature'];
  const secret = process.env['WEBHOOK_SECRET'];

  if (!secret) {
    return res.status(500).json({
      success: false,
      error: 'Webhook secret not configured'
    });
  }

  // Get raw body (should be available from body parser)
  const payload = req.body || req.rawBody || '';

  const isValid = verifyWebhookSignature(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    signature,
    secret
  );

  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: 'Invalid webhook signature'
    });
  }

  next();
}

/**
 * Async version for Next.js API routes
 */
export async function verifyWebhookSignatureAsync(
  request: Request,
  secret: string
): Promise<boolean> {
  const signature = request.headers.get('x-signature') || 
                   request.headers.get('x-cursor-signature');

  if (!signature) {
    return false;
  }

  // Get raw body
  const body = await request.text();

  return verifyWebhookSignature(body, signature, secret);
}
