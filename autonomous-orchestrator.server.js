/**
 * Autonomous Cursor Orchestrator - Hybrid Server Edition
 * 
 * نظام ذكي مستقل لإدارة Cursor Cloud Agents
 * Hybrid Architecture:
 * - Vercel: Webhook route يضيف jobs للـ Redis queue
 * - Local Server: مشروع منفصل يعالج jobs من Redis
 * - التواصل: Redis Queue فقط (لا HTTP calls)
 * - Database: Supabase محلي على السيرفر (أو cloud)
 */

// ═══════════════════════════════════════════════
// 📍 المكان: app/api/cloud-agents/webhook/route.ts (في المشروع الحالي على Vercel)
// ═══════════════════════════════════════════════
// تعديل بسيط فقط - لا تأثير على باقي المشروع

/**
 * POST /api/cloud-agents/webhook
 * 
 * التعديلات المطلوبة:
 * 1. إضافة Redis connection
 * 2. إضافة job للـ Redis queue (لا معالجة مباشرة)
 * 3. الرد السريع (200 OK) - المعالجة async في Local Server
 * 
 * ⚠️ مهم: هذا التعديل بسيط جداً - لا يؤثر على باقي المشروع
 */

import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import crypto from 'crypto';
import { logger } from '@/shared/utils/logger';

// Redis connection (للتواصل مع Local Server)
const redis = new Redis({
  host: process.env.REDIS_HOST!, // IP السيرفر المحلي
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

// Queue للتواصل مع Local Server
const orchestratorQueue = new Queue('orchestrator', {
  connection: redis
});

// Webhook signature verification
function verifyWebhookSignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  
  const expected = 'sha256=' + 
    crypto.createHmac('sha256', secret)
          .update(rawBody)
          .digest('hex');
  
  return signature === expected;
}

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get('X-Webhook-Signature');
  const webhookId = request.headers.get('X-Webhook-ID');
  const eventType = request.headers.get('X-Webhook-Event');
  
  const body = await request.json();
  const { id: agentId, status } = body;
  
  logger.info('Received Cloud Agent webhook', {
    webhookId,
    eventType,
    agentId,
    status,
    hasSignature: !!signature
  });
  
  // التحقق من التوقيع
  const rawBody = JSON.stringify(body);
  if (!verifyWebhookSignature(process.env.WEBHOOK_SECRET!, rawBody, signature || '')) {
    logger.error('Invalid webhook signature', { agentId, webhookId });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  
  // ⚠️ الرد السريع فوراً - لا ننتظر المعالجة
  const response = NextResponse.json({ 
    received: true,
    agentId,
    timestamp: new Date().toISOString(),
    queued: false // سيتم تحديثه بعد إضافة job
  });
  
  // ✅ إضافة job للـ Redis queue (async - لا ننتظره)
  // المعالجة ستحدث في Local Server
  if (status === 'FINISHED' || status === 'ERROR') {
    orchestratorQueue.add(
      'process-webhook',
      {
        webhookData: body,
        agentId,
        status,
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
    ).then(() => {
      logger.info('Webhook queued for processing in Local Server', { agentId });
    }).catch((error) => {
      logger.error('Failed to queue webhook', { agentId, error });
      // ⚠️ لا نوقف العملية - المشروع يبقى شغال حتى لو فشل queue
    });
  }
  
  // ✅ الرد فوراً - لا ننتظر queue
  return response;
}

// ═══════════════════════════════════════════════
// 📍 المكان: src/services/orchestrator.service.ts (في المشروع المنفصل على Local Server)
// ═══════════════════════════════════════════════
// ⚠️ هذا الملف في مشروع منفصل تماماً: cursor-monitor-orchestrator/
// لا يستخدم imports من المشروع الحالي

import { createClient } from '@supabase/supabase-js';
import { stateManager } from './state-manager.service';
import { analyzer } from './analyzer.service';
import { tester } from './tester.service';
import { notifier } from './notifier.service';

// Logger بسيط (لا يعتمد على المشروع الحالي)
const logger = {
  info: (msg: string, data?: any) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg: string, data?: any) => console.warn(`[WARN] ${msg}`, data || '')
};

// Cursor API helpers (مباشر - لا يعتمد على client.ts)
const CURSOR_API_BASE = 'https://api.cursor.com/v0';

async function getCursorAPI(apiKey: string, endpoint: string) {
  const response = await fetch(`${CURSOR_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64')
    }
  });
  
  if (!response.ok) {
    throw new Error(`Cursor API error: ${response.status}`);
  }
  
  return response.json();
}

async function postCursorAPI(apiKey: string, endpoint: string, body: any) {
  const response = await fetch(`${CURSOR_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`Cursor API error: ${response.status}`);
  }
  
  return response.json();
}

export class OrchestratorService {
  private readonly maxIterations: number;
  
  constructor() {
    this.maxIterations = parseInt(process.env.MAX_ITERATIONS || '20');
  }
  
  /**
   * معالجة webhook event
   */
  async processWebhookEvent(webhookData: {
    id: string;
    status: string;
    source?: { repository?: string; ref?: string };
    target?: { branchName?: string; prUrl?: string };
    summary?: string;
  }): Promise<void> {
    const { id: agentId, status } = webhookData;
    
    logger.info('Processing webhook event', { agentId, status });
    
    if (status === 'FINISHED') {
      await this.handleAgentFinished(agentId, webhookData);
    } else if (status === 'ERROR') {
      await this.handleAgentError(agentId, webhookData);
    }
  }
  
  /**
   * معالج: Agent انتهى بنجاح
   */
  private async handleAgentFinished(
    agentId: string,
    webhookData: any
  ): Promise<void> {
    try {
      // 1. جلب أو إنشاء الحالة
      let state = await stateManager.getState(agentId);
      
      if (!state) {
        state = {
          agentId,
          taskDescription: webhookData.summary || 'Unknown task',
          branchName: webhookData.target?.branchName,
          repository: webhookData.source?.repository,
          iterations: 0,
          status: 'ACTIVE',
          tasksCompleted: [],
          tasksRemaining: []
        };
        
        await stateManager.saveState(agentId, state);
      }
      
      // 2. زيادة عدد التكرارات
      const currentIteration = await stateManager.incrementIterations(agentId);
      
      if (currentIteration >= this.maxIterations) {
        logger.warn('Max iterations reached', { agentId, iterations: currentIteration });
        await stateManager.updateStatus(agentId, 'MAX_ITERATIONS_REACHED');
        await notifier.notifyFailure(agentId, {
          message: `Max iterations (${this.maxIterations}) reached`
        });
        return;
      }
      
      // 3. جلب المحادثة والحالة من Cursor API (مباشر)
      const apiKey = process.env.CURSOR_API_KEY!;
      const conversation = await getCursorAPI(apiKey, `/agents/${agentId}/conversation`);
      const agentStatus = await getCursorAPI(apiKey, `/agents/${agentId}`);
      
      // 4. التحليل الذكي
      const analysis = await analyzer.analyzeProgress(
        agentId,
        conversation,
        agentStatus,
        state
      );
      
      // 5. حفظ التحليل
      state.lastAnalysis = analysis;
      state.tasksCompleted = analysis.tasksCompleted;
      state.tasksRemaining = analysis.tasksRemaining;
      await stateManager.saveState(agentId, state);
      
      // 6. إشعار بالتقدم
      await notifier.notifyProgress(agentId, currentIteration, analysis);
      
      // 7. تنفيذ القرار
      await this.executeDecision(agentId, analysis, state, agentStatus);
      
    } catch (error) {
      logger.error('Error handling finished agent', { agentId, error });
      throw error;
    }
  }
  
  /**
   * تنفيذ القرار
   */
  private async executeDecision(
    agentId: string,
    analysis: any,
    state: any,
    agentStatus: any
  ): Promise<void> {
    const apiKey = process.env.CURSOR_API_KEY!;
    
    switch (analysis.action) {
      case 'CONTINUE':
        if (!analysis.followupMessage) {
          analysis.followupMessage = 'استمر في المهمة حسب الخطة الأصلية';
        }
        
        await postCursorAPI(apiKey, `/agents/${agentId}/followup`, {
          prompt: { text: analysis.followupMessage }
        });
        logger.info('Follow-up sent', { agentId });
        break;
        
      case 'TEST':
        const branchName = agentStatus.target?.branchName;
        
        if (!branchName) {
          logger.error('No branch name found', { agentId });
          await this.handleCompletion(agentId, state, agentStatus, null);
          break;
        }
        
        const testResults = await tester.testBranch(branchName, agentId);
        
        if (testResults.success) {
          await this.handleCompletion(agentId, state, agentStatus, testResults);
        } else {
          const fixInstructions = await tester.generateFixInstructions(testResults);
          await postCursorAPI(apiKey, `/agents/${agentId}/followup`, {
            prompt: { text: fixInstructions }
          });
        }
        break;
        
      case 'FIX':
        if (!analysis.followupMessage) {
          analysis.followupMessage = 'أصلح الأخطاء المذكورة في الرسائل السابقة';
        }
        
        await postCursorAPI(apiKey, `/agents/${agentId}/followup`, {
          prompt: { text: analysis.followupMessage }
        });
        break;
        
      case 'COMPLETE':
        await this.handleCompletion(agentId, state, agentStatus, null);
        break;
    }
  }
  
  /**
   * معالج: المهمة اكتملت
   */
  private async handleCompletion(
    agentId: string,
    state: any,
    agentStatus: any,
    testResults: any
  ): Promise<void> {
    await stateManager.updateStatus(agentId, 'COMPLETED');
    
    await notifier.notifySuccess(agentId, {
      branchName: state.branchName,
      iterations: state.iterations,
      tasksCompleted: state.tasksCompleted,
      prUrl: agentStatus.target?.prUrl,
      testResults
    });
    
    await stateManager.deleteState(agentId);
    
    logger.info('Agent completed', { agentId });
  }
  
  /**
   * معالج: Agent فشل
   */
  private async handleAgentError(agentId: string, webhookData: any): Promise<void> {
    const state = await stateManager.getState(agentId);
    
    if (state) {
      await stateManager.updateStatus(agentId, 'ERROR');
    }
    
    await notifier.notifyFailure(agentId, {
      message: 'Cloud Agent encountered an error',
      details: webhookData
    });
  }
}

export const orchestratorService = new OrchestratorService();

// ═══════════════════════════════════════════════
// 📍 المكان: scripts/workers/orchestrator-worker.ts
// ═══════════════════════════════════════════════

/**
 * Background Worker - يعمل كـ PM2 process
 * يستمع لـ Redis queue ويعالج webhook events
 */

import { Queue, Worker } from 'bullmq';
import { orchestratorService } from '@/features/cloud-agents/orchestrator/services/orchestrator.service';
import { logger } from '@/shared/utils/logger';

// Redis connection (نفس الـ Redis الذي يتصل به Vercel)
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3
};

// Queue (نفس الـ queue name من Vercel)
const orchestratorQueue = new Queue('orchestrator', { connection });

const worker = new Worker(
  'orchestrator',
  async (job) => {
    const { webhookData, agentId, status } = job.data;
    
    logger.info('Processing orchestrator job', { jobId: job.id, agentId });
    
    try {
      await orchestratorService.processWebhookEvent(webhookData);
      logger.info('Orchestrator job completed', { jobId: job.id, agentId });
    } catch (error) {
      logger.error('Orchestrator job failed', { jobId: job.id, agentId, error });
      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 }
  }
);

worker.on('completed', (job) => {
  logger.info('Worker job completed', { jobId: job.id });
});

worker.on('failed', (job, error) => {
  logger.error('Worker job failed', { jobId: job?.id, error });
});

logger.info('Orchestrator worker started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker');
  await worker.close();
  await orchestratorQueue.close();
  process.exit(0);
});

// ═══════════════════════════════════════════════
// 📍 المكان: src/cron/check-stuck-agents.ts (في المشروع المنفصل على Local Server)
// ═══════════════════════════════════════════════
// ⚠️ هذا الملف في مشروع منفصل تماماً: cursor-monitor-orchestrator/

/**
 * Cron Job - يعمل كل 30 دقيقة
 * يفحص agents المعلقة ويوقفها تلقائياً
 */

import { stateManager } from '../services/state-manager.service';

const logger = {
  info: (msg: string, data?: any) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg: string, data?: any) => console.warn(`[WARN] ${msg}`, data || '')
};

const AGENT_TIMEOUT = 4 * 60 * 60 * 1000; // 4 ساعات

async function checkStuckAgents(): Promise<void> {
  try {
    logger.info('Running stuck agents check');
    
    const activeAgents = await stateManager.getActiveAgents();
    const now = Date.now();
    
    for (const agent of activeAgents) {
      const lastUpdate = new Date(agent.updatedAt).getTime();
      const timeSinceUpdate = now - lastUpdate;
      
      if (timeSinceUpdate > AGENT_TIMEOUT) {
        logger.warn('Found stuck agent', { 
          agentId: agent.agentId, 
          minutesStuck: Math.round(timeSinceUpdate / 1000 / 60) 
        });
        
        try {
          const apiKey = process.env.CURSOR_API_KEY!;
          
          // إيقاف Agent عبر Cursor API (مباشر)
          await fetch(`https://api.cursor.com/v0/agents/${agent.agentId}/stop`, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64')
            }
          });
          
          await stateManager.updateStatus(agent.agentId, 'TIMEOUT');
          
          logger.info('Stopped stuck agent', { agentId: agent.agentId });
        } catch (error) {
          logger.error('Failed to stop stuck agent', { agentId: agent.agentId, error });
        }
      }
    }
    
    logger.info('Stuck agents check completed', { checked: activeAgents.length });
  } catch (error) {
    logger.error('Failed to check stuck agents', { error });
    process.exit(1);
  }
}

checkStuckAgents()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Cron job failed', { error });
    process.exit(1);
  });

// ═══════════════════════════════════════════════
// 📍 المكان: ecosystem.config.js (في المشروع المنفصل على Local Server)
// ═══════════════════════════════════════════════
// ⚠️ هذا الملف في مشروع منفصل تماماً: cursor-monitor-orchestrator/

/**
 * PM2 Configuration
 * يدير: Background worker + Cron jobs فقط
 * 
 * ⚠️ لا يدير Next.js app - Next.js على Vercel
 */

module.exports = {
  apps: [
    {
      name: 'cursor-monitor-orchestrator-worker',
      script: 'tsx',
      args: 'src/workers/orchestrator-worker.ts',
      cwd: '/home/asce/projects/cursor-monitor-orchestrator',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-worker-error.log',
      out_file: './logs/pm2-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      name: 'cursor-monitor-orchestrator-cron',
      script: 'tsx',
      args: 'src/cron/check-stuck-agents.ts',
      cwd: '/home/asce/projects/cursor-monitor-orchestrator',
      cron_restart: '*/30 * * * *', // كل 30 دقيقة
      autorestart: false,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-cron-error.log',
      out_file: './logs/pm2-cron-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};

// ═══════════════════════════════════════════════
// 📋 ملخص البنية الهجينة (Hybrid Architecture)
// ═══════════════════════════════════════════════

/**
 * البنية الكاملة:
 * 
 * ┌─────────────────────────┐
 * │   Vercel                │
 * │   cursor-monitor        │
 * │   (المشروع الحالي)     │
 * │                         │
 * │   Webhook Route:        │
 * │   - يستقبل webhook      │
 * │   - يضيف job للـ Redis  │
 * │   - يرد 200 OK فوراً    │
 * └──────────┬──────────────┘
 *            │
 *            │ Redis Queue
 *            ↓
 * ┌─────────────────────────┐
 * │   Local Server          │
 * │   cursor-monitor-       │
 * │   orchestrator          │
 * │   (مشروع منفصل)        │
 * │                         │
 * │   - Worker (PM2)        │
 * │   - Analyzer            │
 * │   - Tester              │
 * │   - Cron Jobs           │
 * └──────────┬──────────────┘
 *            │
 *            │ Uses
 *            ↓
 * ┌─────────────────────────┐
 * │   Supabase (Local)      │
 * │   Self-hosted           │
 * │                         │
 * │   - agent_orchestrator_ │
 * │     states table        │
 * └─────────────────────────┘
 * 
 * التواصل:
 * - Vercel ↔ Local Server: Redis Queue فقط
 * - لا HTTP calls بينهما
 * - لا imports مشتركة
 * - مشروعان منفصلان تماماً
 * 
 * الملفات المطلوبة:
 * 
 * Vercel (cursor-monitor):
 * ├── app/api/cloud-agents/webhook/route.ts (تعديل بسيط)
 * └── package.json (إضافة ioredis, bullmq)
 * 
 * Local Server (cursor-monitor-orchestrator):
 * ├── src/
 * │   ├── services/
 * │   │   ├── orchestrator.service.ts
 * │   │   ├── analyzer.service.ts
 * │   │   ├── tester.service.ts
 * │   │   ├── state-manager.service.ts
 * │   │   └── notifier.service.ts
 * │   ├── workers/
 * │   │   └── orchestrator-worker.ts
 * │   ├── cron/
 * │   │   └── check-stuck-agents.ts
 * │   └── queue/
 * │       └── redis.ts
 * ├── ecosystem.config.js
 * ├── package.json
 * └── .env
 * 
 * خطوات التنفيذ:
 * 
 * 1. Vercel:
 *    - إضافة dependencies
 *    - تعديل webhook route
 *    - إضافة env vars
 *    - Deploy
 * 
 * 2. Local Server:
 *    - إنشاء مشروع جديد
 *    - إنشاء الملفات
 *    - إعداد Supabase
 *    - إعداد Redis
 *    - PM2 start
 * 
 * 3. Database:
 *    - Supabase محلي (أو cloud)
 *    - إنشاء جدول agent_orchestrator_states
 * 
 * 4. Testing:
 *    - Test webhook → Redis
 *    - Test worker processing
 *    - Test end-to-end
 * 
 * ⚠️ العزل الكامل:
 * - المشروع الحالي على Vercel يبقى شغال
 * - فقط تعديل بسيط في webhook route
 * - Local Server مشروع منفصل تماماً
 * - يمكن إيقاف Local Server بدون تأثير على Vercel
 */
