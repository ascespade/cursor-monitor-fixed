# 🔐 Webhook Integration Guide

## Overview

This guide shows how to integrate the webhook verifier into your Next.js API routes.

## 📦 Import the Verifier

### For Next.js API Routes (App Router)

```typescript
// app/api/cloud-agents/webhook/route.ts
import { verifyWebhookSignatureAsync } from '@/orchestrator/webhook-verifier'

export async function POST(request: Request) {
  const secret = process.env.WEBHOOK_SECRET
  
  if (!secret) {
    return Response.json(
      { success: false, error: 'Webhook secret not configured' },
      { status: 500 }
    )
  }

  // Verify signature
  const isValid = await verifyWebhookSignatureAsync(request, secret)
  
  if (!isValid) {
    return Response.json(
      { success: false, error: 'Invalid webhook signature' },
      { status: 401 }
    )
  }

  // Process webhook
  const body = await request.json()
  
  // ... your webhook logic here ...
  
  return Response.json({ success: true })
}
```

### For Express/Node.js Routes

```typescript
// Using middleware
import { webhookVerifierMiddleware } from './webhook-verifier'

app.post('/api/webhook', webhookVerifierMiddleware, (req, res) => {
  // req.body is already verified
  // ... process webhook ...
  res.json({ success: true })
})
```

### Manual Verification

```typescript
import { verifyWebhookSignature } from './webhook-verifier'

const isValid = verifyWebhookSignature(
  requestBody,
  request.headers['x-signature'],
  process.env.WEBHOOK_SECRET!
)
```

## 🔑 Environment Variables

Make sure `WEBHOOK_SECRET` is set in both:

- **Vercel**: Environment variables in dashboard
- **Local Server**: `.env` file in orchestrator directory

**Important**: The secret must be the same in both places!

## 📡 Cursor Webhook Headers

Cursor sends webhooks with these headers:

- `X-Signature` or `X-Cursor-Signature`: HMAC-SHA256 signature
- `Content-Type`: `application/json`

## 🧪 Testing

### Test Signature Generation

```typescript
import crypto from 'crypto'

const secret = 'your-secret'
const payload = JSON.stringify({ test: 'data' })
const hmac = crypto.createHmac('sha256', secret)
hmac.update(payload)
const signature = hmac.digest('hex')

console.log('Signature:', signature)
```

### Test Webhook Endpoint

```bash
# Generate test signature
SIGNATURE=$(echo -n '{"test":"data"}' | openssl dgst -sha256 -hmac "your-secret" | cut -d' ' -f2)

# Send test webhook
curl -X POST http://localhost:3000/api/cloud-agents/webhook \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -d '{"test":"data"}'
```

## 🛡️ Security Best Practices

1. **Never log the secret** - Keep it in environment variables only
2. **Use strong secrets** - Minimum 32 characters, random
3. **Rotate secrets** - Change periodically
4. **Verify before processing** - Always verify signature first
5. **Use HTTPS** - Always use encrypted connections in production

## 🔄 Integration with Current Project

The webhook route at `app/api/cloud-agents/webhook/route.ts` should:

1. Verify signature using `verifyWebhookSignatureAsync`
2. Parse webhook payload
3. Queue job to Redis
4. Return success response

Example integration:

```typescript
import { verifyWebhookSignatureAsync } from '@/orchestrator/webhook-verifier'
import { queue } from '@/features/cloud-agents/orchestrator/queue/redis'

export async function POST(request: Request) {
  // 1. Verify signature
  const secret = process.env.WEBHOOK_SECRET!
  const isValid = await verifyWebhookSignatureAsync(request, secret)
  
  if (!isValid) {
    return Response.json(
      { success: false, error: 'Invalid signature' },
      { status: 401 }
    )
  }

  // 2. Parse payload
  const payload = await request.json()
  
  // 3. Queue job
  await queue.add('cursor-orchestrator', {
    agentId: payload.agent_id,
    conversationId: payload.conversation_id,
    event: payload.event,
    data: payload.data
  })
  
  // 4. Return success
  return Response.json({ success: true })
}
```

## 📝 Notes

- The verifier uses **constant-time comparison** to prevent timing attacks
- Supports both `X-Signature` and `X-Cursor-Signature` headers
- Works with both string and JSON payloads
- Handles missing signatures gracefully
