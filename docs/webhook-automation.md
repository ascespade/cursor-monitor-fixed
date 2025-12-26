# Webhook Automation Guide

## نظرة عامة

هذا الدليل يشرح كيفية استخدام Webhook من Cursor Cloud Agents API لتنفيذ إجراءات تلقائية عندما ينتهي Agent من عمله.

## إعداد Webhook في Cursor

### الخطوة 1: إضافة Webhook URL في Cursor Dashboard

1. افتح [Cursor Dashboard](https://cursor.com)
2. اذهب إلى **Settings** → **Cloud Agents** → **Webhooks**
3. أضف Webhook URL:
   ```
   https://cursor-monitor.vercel.app/api/cloud-agents/webhook
   ```
4. احفظ الإعدادات

### الخطوة 2: التأكد من أن المشروع متاح على Vercel

- تأكد من أن المشروع منشور على Vercel
- الـ webhook endpoint متاح على: `/api/cloud-agents/webhook`

## أنواع الإجراءات التلقائية المدعومة

### 1. `log_event`
- يسجل الحدث في الـ logs
- يتم تنفيذه تلقائياً

### 2. `send_notification`
- يرسل إشعار إلى Slack (إذا كان `SLACK_WEBHOOK_URL` مضبوط)
- يتم تنفيذه تلقائياً

### 3. `launch_followup_agent`
- يبدأ Agent جديد تلقائياً بعد انتهاء Agent الحالي
- يحتاج إلى تكوين (API key, prompt, repository)

### 4. `trigger_workflow`
- يطلق workflow خارجي (مثل CI/CD، webhook آخر، etc.)
- قابل للتخصيص

## أمثلة عملية

### مثال 1: إشعار Slack بسيط

عندما ينتهي Agent، سيرسل إشعار تلقائي إلى Slack:

```typescript
// الكود موجود في webhook/route.ts
await executeWebhookActions(config, ['log_event', 'send_notification']);
```

**التكوين المطلوب:**
- `SLACK_WEBHOOK_URL` في environment variables

### مثال 2: Launch Agent جديد تلقائياً بعد انتهاء Agent

```typescript
// في webhook-actions.service.ts
async function launchFollowupAgent(config: WebhookActionConfig) {
  if (config.status !== 'FINISHED') return;
  
  const followupPrompt = `Review the changes made. Summary: ${config.summary}`;
  await launchCloudAgent({
    apiKey: process.env.CURSOR_API_KEY,
    promptText: followupPrompt,
    repository: config.repository || 'your-repo',
    model: 'auto'
  });
}
```

**كيفية تفعيله:**
```typescript
await executeWebhookActions(config, [
  'log_event',
  'send_notification',
  'launch_followup_agent' // ← أضف هذا
]);
```

### مثال 3: Trigger External Workflow

```typescript
// في webhook-actions.service.ts
async function triggerWorkflow(config: WebhookActionConfig) {
  if (config.status === 'FINISHED' && config.prUrl) {
    // Trigger CI/CD pipeline
    await fetch('https://your-ci-service.com/trigger', {
      method: 'POST',
      body: JSON.stringify({
        prUrl: config.prUrl,
        agentId: config.agentId
      })
    });
  }
}
```

## كيفية التخصيص

### إضافة إجراءات جديدة

1. افتح `src/features/cloud-agents/services/webhook-actions.service.ts`
2. أضف نوع جديد إلى `WebhookActionType`:
   ```typescript
   export type WebhookActionType = 
     | 'log_event'
     | 'your_new_action'; // ← جديد
   ```
3. أضف case جديد في `executeWebhookActions`:
   ```typescript
   case 'your_new_action':
     await yourNewActionFunction(config);
     break;
   ```
4. نفذ الوظيفة:
   ```typescript
   async function yourNewActionFunction(config: WebhookActionConfig) {
     // Your logic here
   }
   ```

### تفعيل/تعطيل إجراءات معينة

في `app/api/cloud-agents/webhook/route.ts`:

```typescript
const actionsToExecute: WebhookActionType[] = [
  'log_event',           // دائماً مفعّل
  'send_notification',   // دائماً مفعّل
  // 'launch_followup_agent', // ارفع التعليق لتفعيله
  // 'trigger_workflow'        // ارفع التعليق لتفعيله
];
```

## البيانات المتاحة في Webhook Event

```typescript
interface WebhookActionConfig {
  agentId: string;        // ID الخاص بالـ Agent
  status: string;         // FINISHED, ERROR, EXPIRED
  summary?: string;       // ملخص العمل المنجز
  repository?: string;    // رابط Repository
  prUrl?: string;         // رابط Pull Request (إن وجد)
}
```

## أمثلة متقدمة

### سلسلة Agents تلقائية

```typescript
// Agent 1 ينتهي → يبدأ Agent 2 → Agent 2 ينتهي → يبدأ Agent 3
async function launchFollowupAgent(config: WebhookActionConfig) {
  if (config.status === 'FINISHED') {
    // تحديد الـ Agent التالي بناءً على الـ Agent الحالي
    const nextAgentPrompts = {
      'agent-1': 'Review and test the code',
      'agent-2': 'Deploy to staging',
      'agent-3': 'Run integration tests'
    };
    
    const nextPrompt = nextAgentPrompts[config.agentId];
    if (nextPrompt) {
      await launchCloudAgent({ ... });
    }
  }
}
```

### Conditional Actions

```typescript
// تنفيذ إجراءات مختلفة حسب الحالة
if (config.status === 'FINISHED') {
  await executeWebhookActions(config, ['launch_followup_agent']);
} else if (config.status === 'ERROR') {
  await executeWebhookActions(config, ['send_notification', 'trigger_workflow']);
}
```

## نصائح مهمة

1. **Error Handling**: جميع الإجراءات محمية بـ try-catch حتى لو فشل أحدها، يستمر الباقي
2. **Logging**: كل شيء يُسجل في الـ logs للمتابعة
3. **Performance**: الـ webhook يجب أن يعيد استجابة سريعة (200 OK) ثم ينفذ الإجراءات في الخلفية
4. **Security**: تأكد من التحقق من الـ signature في production

## Debugging

لرؤية الـ webhook events:

1. تحقق من Vercel Logs
2. تحقق من Slack (إذا كان مفعّل)
3. تحقق من `logger.info` messages

## الخطوات التالية

- [ ] أضف webhook URL في Cursor Dashboard
- [ ] اختبر webhook بإرسال Agent وإنهائه
- [ ] راقب الـ logs للتأكد من استقبال الأحداث
- [ ] أضف إجراءات تلقائية حسب احتياجك
