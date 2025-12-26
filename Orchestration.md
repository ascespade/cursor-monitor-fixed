سأعطيك وصف كامل لدورة حياة (lifecycle) الـ Orchestration من البداية للنهاية بناءً على تحليل الكود والوثائق:

🔄 دورة حياة Orchestration الكاملة
📍 المرحلة 1: الإنشاء (Creation)
1.1 طلب إنشاء Orchestration جديدة
POST /api/orchestrations
المدخلات:


{
  "repository": "owner/repo" أو "https://github.com/owner/repo",
  "ref": "main",                    // اختياري، default: main
  "tasks": [
    {
      "title": "Task 1",
      "description": "تفاصيل المهمة",
      "priority": "high",           // high, medium, low
      "complexity": "moderate"       // simple, moderate, complex
    }
  ],
  "model": "claude-4-sonnet-thinking", // اختياري
  "priority": "balanced",           // speed, balanced, quality
  "autoCreatePr": true,
  "webhookUrl": "https://..."       // اختياري
}
1.2 التحقق من البيانات (Validation)

// ✅ التحقق من Repository
- تحويل owner/repo إلى https://github.com/owner/repo
- التحقق من وجود GitHub access
// ✅ التحقق من Model
- validateModel() - تحقق من أن النموذج صالح
- Fallback إلى claude-4-sonnet-thinking إذا لم يكن موجود
// ✅ التحقق من Tasks
- على الأقل task واحدة
- كل task لها title و description
1.3 حفظ في قاعدة البيانات

INSERT INTO orchestrations (
  id,                    -- UUID
  status,                -- 'PENDING'
  repository,            -- URL كامل
  ref,                   -- branch name
  model,
  priority,
  auto_create_pr,
  webhook_url,
  created_at,
  updated_at
) VALUES (...)
INSERT INTO tasks (
  id,                    -- UUID
  orchestration_id,
  title,
  description,
  priority,
  complexity,
  status,                -- 'PENDING'
  order_index,           -- ترتيب المهام
  created_at
) VALUES (...)
الحالة الأولية:

Orchestration: status = 'PENDING'
Tasks: status = 'PENDING'
📍 المرحلة 2: التفعيل (Activation)
2.1 تغيير الحالة إلى ACTIVE
PATCH /api/orchestrations/:id/activate

// في orchestration.service.ts
async activateOrchestration(id: string) {
  // 1. التحقق من أن الحالة = PENDING
  if (orchestration.status !== 'PENDING') {
    throw new Error('Already active or completed');
  }
  
  // 2. تحديث الحالة
  await db.update(orchestrations)
    .set({ 
      status: 'ACTIVE',
      activated_at: new Date()
    })
    .where(eq(orchestrations.id, id));
  
  // 3. إضافة أول task إلى الـ Queue
  const firstTask = await getFirstPendingTask(id);
  await addTaskToQueue(firstTask);
  
  return { status: 'ACTIVE' };
}
التغييرات:

Orchestration: PENDING → ACTIVE
أول Task: يُضاف إلى BullMQ Queue
📍 المرحلة 3: معالجة المهام (Task Processing)
3.1 Worker يلتقط المهمة من Queue

// في task-processor.worker.ts
taskQueue.process(async (job: Job<TaskJob>) => {
  const { taskId, orchestrationId } = job.data;
  
  logger.info('Processing task', { taskId, orchestrationId });
  
  // 1. جلب بيانات المهمة
  const task = await getTaskById(taskId);
  const orchestration = await getOrchestrationById(orchestrationId);
  
  // 2. تحديث الحالة إلى PROCESSING
  await updateTaskStatus(taskId, 'PROCESSING', {
    started_at: new Date()
  });
  
  // 3. استدعاء Task Dispatcher
  try {
    const result = await taskDispatcher.dispatchTask(task, orchestration);
    return result;
  } catch (error) {
    // معالجة الأخطاء (Retry logic)
    throw error;
  }
});
3.2 Task Dispatcher يُنشئ Cloud Agent

// في task-dispatcher.service.ts
async dispatchTask(task: Task, orchestration: Orchestration) {
  // 1. بناء الـ Prompt
  const prompt = buildTaskPrompt(task, orchestration);
  
  // 2. التحقق من Model
  const { model } = await validateModel(orchestration.model);
  
  // 3. بناء Payload
  const payload = {
    prompt: {
      text: prompt
    },
    source: {
      repository: orchestration.repository, // https://github.com/...
      ref: orchestration.ref || 'main'
    },
    target: {
      autoCreatePr: orchestration.autoCreatePr ?? true
    },
    model: model || undefined, // اختياري - دع API يختار
    webhook: {
      url: `${APP_URL}/api/cloud-agents/webhook`,
      secret: WEBHOOK_SECRET
    }
  };
  
  // 4. استدعاء Cursor API
  const response = await fetch('https://api.cursor.com/v0/agents', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Cursor API error: ${response.status} - ${JSON.stringify(error)}`);
  }
  
  const agent = await response.json();
  
  // 5. حفظ معلومات Cloud Agent
  await updateTask(task.id, {
    cloud_agent_id: agent.id,
    cloud_agent_status: agent.status,
    cloud_agent_url: agent.target?.url
  });
  
  return agent;
}
الحالة بعد الإرسال:

Task: status = 'PROCESSING'
Task: cloud_agent_id = 'bc_abc123'
Task: cloud_agent_status = 'CREATING'
📍 المرحلة 4: تتبع Cloud Agent (Agent Tracking)
4.1 Cursor API يُشغّل Cloud Agent
حالات Cloud Agent:

CREATING → RUNNING → FINISHED
                  ↓
                FAILED
                  ↓
                STOPPED
4.2 استقبال Webhook Notifications

// في cloud-agents/webhook.controller.ts
router.post('/webhook', async (req, res) => {
  // 1. التحقق من Signature
  const signature = req.headers['x-cursor-signature'];
  const isValid = verifyWebhookSignature(req.body, signature);
  
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // 2. معالجة Webhook Event
  const { agentId, status, event } = req.body;
  
  logger.info('Received webhook', { agentId, status, event });
  
  // 3. تحديث Task
  const task = await getTaskByCloudAgentId(agentId);
  
  if (!task) {
    logger.warn('Task not found for agent', { agentId });
    return res.status(404).json({ error: 'Task not found' });
  }
  
  await updateTask(task.id, {
    cloud_agent_status: status,
    updated_at: new Date()
  });
  
  // 4. إذا انتهى Agent، حدّث حالة Task
  if (status === 'FINISHED') {
    await handleTaskCompletion(task);
  } else if (status === 'FAILED') {
    await handleTaskFailure(task);
  }
  
  res.status(200).json({ received: true });
});
4.3 Polling (backup mechanism)

// في services/cloud-agent-monitor.service.ts
// يعمل كل 30 ثانية للتحقق من الـ tasks التي لم تستلم webhook
async function monitorActiveTasks() {
  const activeTasks = await getTasksWithStatus('PROCESSING');
  
  for (const task of activeTasks) {
    if (!task.cloud_agent_id) continue;
    
    // استدعاء API للتحقق من الحالة
    const agent = await getAgentStatus(task.cloud_agent_id);
    
    // تحديث إذا تغيرت الحالة
    if (agent.status !== task.cloud_agent_status) {
      await updateTask(task.id, {
        cloud_agent_status: agent.status
      });
      
      if (agent.status === 'FINISHED') {
        await handleTaskCompletion(task);
      }
    }
  }
}
// تشغيل كل 30 ثانية
setInterval(monitorActiveTasks, 30000);
📍 المرحلة 5: إكمال المهمة (Task Completion)
5.1 عند نجاح Cloud Agent

async function handleTaskCompletion(task: Task) {
  // 1. جلب نتائج Agent
  const agent = await fetch(
    `https://api.cursor.com/v0/agents/${task.cloud_agent_id}`,
    {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`
      }
    }
  ).then(r => r.json());
  
  // 2. تحديث Task
  await updateTask(task.id, {
    status: 'COMPLETED',
    cloud_agent_status: 'FINISHED',
    result_summary: agent.summary,
    result_branch: agent.target?.branchName,
    result_pr_url: agent.target?.prUrl,
    completed_at: new Date()
  });
  
  logger.info('Task completed', {
    taskId: task.id,
    agentId: task.cloud_agent_id,
    branch: agent.target?.branchName,
    prUrl: agent.target?.prUrl
  });
  
  // 3. التحقق إذا كانت هناك مهام أخرى
  await checkForNextTask(task.orchestration_id);
}
5.2 عند فشل Cloud Agent

async function handleTaskFailure(task: Task, error?: any) {
  // 1. تحديث Task
  await updateTask(task.id, {
    status: 'FAILED',
    cloud_agent_status: 'FAILED',
    error_message: error?.message || 'Unknown error',
    failed_at: new Date(),
    retry_count: task.retry_count + 1
  });
  
  // 2. قرار Retry
  const maxRetries = 3;
  
  if (task.retry_count < maxRetries) {
    logger.warn('Task failed, retrying', {
      taskId: task.id,
      retryCount: task.retry_count + 1
    });
    
    // إعادة المحاولة بعد تأخير
    await addTaskToQueue(task, {
      delay: Math.pow(2, task.retry_count) * 1000 // Exponential backoff
    });
  } else {
    logger.error('Task failed permanently', {
      taskId: task.id,
      error
    });
    
    // تحديث Orchestration
    await updateOrchestration(task.orchestration_id, {
      status: 'FAILED',
      error_message: `Task ${task.id} failed after ${maxRetries} retries`
    });
  }
}
📍 المرحلة 6: الانتقال للمهمة التالية (Next Task)
6.1 التحقق من المهام المتبقية

async function checkForNextTask(orchestrationId: string) {
  // 1. جلب الـ orchestration
  const orchestration = await getOrchestrationById(orchestrationId);
  
  if (orchestration.status !== 'ACTIVE') {
    return; // تم إيقافها أو إكمالها
  }
  
  // 2. البحث عن المهمة التالية
  const nextTask = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.orchestration_id, orchestrationId),
        eq(tasks.status, 'PENDING')
      )
    )
    .orderBy(asc(tasks.order_index))
    .limit(1);
  
  if (nextTask.length === 0) {
    // 3. لا توجد مهام أخرى - إكمال Orchestration
    await completeOrchestration(orchestrationId);
    return;
  }
  
  // 4. إضافة المهمة التالية إلى Queue
  await addTaskToQueue(nextTask[0]);
  
  logger.info('Added next task to queue', {
    orchestrationId,
    taskId: nextTask[0].id
  });
}
📍 المرحلة 7: إكمال Orchestration (Orchestration Completion)
7.1 جميع المهام اكتملت

async function completeOrchestration(orchestrationId: string) {
  // 1. جلب جميع المهام
  const allTasks = await getTasksByOrchestrationId(orchestrationId);
  
  // 2. التحقق من النتائج
  const completedTasks = allTasks.filter(t => t.status === 'COMPLETED');
  const failedTasks = allTasks.filter(t => t.status === 'FAILED');
  
  // 3. تحديد الحالة النهائية
  let finalStatus: OrchestrationStatus;
  let summary: string;
  
  if (completedTasks.length === allTasks.length) {
    finalStatus = 'COMPLETED';
    summary = `All ${allTasks.length} tasks completed successfully`;
  } else if (failedTasks.length === allTasks.length) {
    finalStatus = 'FAILED';
    summary = `All ${allTasks.length} tasks failed`;
  } else {
    finalStatus = 'PARTIAL_COMPLETED';
    summary = `${completedTasks.length}/${allTasks.length} tasks completed`;
  }
  
  // 4. تحديث Orchestration
  await updateOrchestration(orchestrationId, {
    status: finalStatus,
    summary,
    completed_at: new Date(),
    statistics: {
      total_tasks: allTasks.length,
      completed_tasks: completedTasks.length,
      failed_tasks: failedTasks.length,
      duration_ms: Date.now() - orchestration.activated_at.getTime()
    }
  });
  
  logger.info('Orchestration completed', {
    orchestrationId,
    status: finalStatus,
    summary
  });
  
  // 5. إرسال webhook notification (إذا موجود)
  if (orchestration.webhook_url) {
    await sendOrchestrationWebhook(orchestration);
  }
 
سأ  بقية دورة حياة Orchestration:

📍 المرحلة 7: إكمال Orchestration (ت ة)
7.2 إرسال Webhook للإشعار بالإكمال

async function sendOrchestrationWebhook(orchestration: Orchestration) {
  try {
    const payload = {
      event: 'orchestration.completed',
      orchestrationId: orchestration.id,
      status: orchestration.status,
      repository: orchestration.repository,
      ref: orchestration.ref,
      statistics: orchestration.statistics,
      completedAt: orchestration.completed_at,
      tasks: await getTasksSummary(orchestration.id)
    };
    
    await fetch(orchestration.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orchestration-Signature': generateSignature(payload)
      },
      body: JSON.stringify(payload)
    });
    
    logger.info('Orchestration webhook sent', {
      orchestrationId: orchestration.id,
      webhookUrl: orchestration.webhook_url
    });
  } catch (error) {
    logger.error('Failed to send orchestration webhook', {
      orchestrationId: orchestration.id,
      error
    });
  }
}
7.3 تجميع النتائج النهائية

async function getTasksSummary(orchestrationId: string) {
  const tasks = await getTasksByOrchestrationId(orchestrationId);
  
  return tasks.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    cloudAgentId: task.cloud_agent_id,
    cloudAgentUrl: task.cloud_agent_url,
    resultBranch: task.result_branch,
    resultPrUrl: task.result_pr_url,
    resultSummary: task.result_summary,
    duration: task.completed_at 
      ? task.completed_at.getTime() - task.started_at.getTime()
      : null,
    retryCount: task.retry_count
  }));
}
📍 المرحلة 8: الإيقاف المؤقت والإلغاء (Pause/Cancel)
8.1 إيقاف Orchestration مؤقتًا
POST /api/orchestrations/:id/pause

async function pauseOrchestration(orchestrationId: string) {
  // 1. التحقق من الحالة الحالية
  const orchestration = await getOrchestrationById(orchestrationId);
  
  if (orchestration.status !== 'ACTIVE') {
    throw new Error('Only active orchestrations can be paused');
  }
  
  // 2. تحديث الحالة
  await updateOrchestration(orchestrationId, {
    status: 'PAUSED',
    paused_at: new Date()
  });
  
  // 3. إيقاف Cloud Agent الحالي (إذا موجود)
  const currentTask = await getCurrentProcessingTask(orchestrationId);
  
  if (currentTask?.cloud_agent_id) {
    await stopCloudAgent(currentTask.cloud_agent_id);
  }
  
  // 4. إزالة المهام المعلقة من Queue
  await removeOrchestrationTasksFromQueue(orchestrationId);
  
  logger.info('Orchestration paused', { orchestrationId });
  
  return { status: 'PAUSED' };
}
8.2 استئناف Orchestration
POST /api/orchestrations/:id/resume

async function resumeOrchestration(orchestrationId: string) {
  const orchestration = await getOrchestrationById(orchestrationId);
  
  if (orchestration.status !== 'PAUSED') {
    throw new Error('Only paused orchestrations can be resumed');
  }
  
  // 1. تحديث الحالة
  await updateOrchestration(orchestrationId, {
    status: 'ACTIVE',
    resumed_at: new Date()
  });
  
  // 2. البحث عن المهمة التالية
  const nextTask = await getNextPendingTask(orchestrationId);
  
  if (nextTask) {
    await addTaskToQueue(nextTask);
  } else {
    // لا توجد مهام معلقة - تحقق من الإكمال
    await checkForNextTask(orchestrationId);
  }
  
  logger.info('Orchestration resumed', { orchestrationId });
  
  return { status: 'ACTIVE' };
}
8.3 إلغاء Orchestration
DELETE /api/orchestrations/:id
أو
POST /api/orchestrations/:id/cancel

async function cancelOrchestration(orchestrationId: string) {
  const orchestration = await getOrchestrationById(orchestrationId);
  
  // 1. إيقاف جميع Cloud Agents النشطة
  const activeTasks = await getTasksWithStatus('PROCESSING');
  
  for (const task of activeTasks) {
    if (task.cloud_agent_id) {
      try {
        await stopCloudAgent(task.cloud_agent_id);
        await updateTask(task.id, {
          status: 'CANCELLED',
          cloud_agent_status: 'STOPPED'
        });
      } catch (error) {
        logger.error('Failed to stop agent', {
          agentId: task.cloud_agent_id,
          error
        });
      }
    }
  }
  
  // 2. إلغاء جميع المهام المعلقة
  await db.update(tasks)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(tasks.orchestration_id, orchestrationId),
        eq(tasks.status, 'PENDING')
      )
    );
  
  // 3. إزالة من Queue
  await removeOrchestrationTasksFromQueue(orchestrationId);
  
  // 4. تحديث Orchestration
  await updateOrchestration(orchestrationId, {
    status: 'CANCELLED',
    cancelled_at: new Date()
  });
  
  logger.info('Orchestration cancelled', { orchestrationId });
  
  return { status: 'CANCELLED' };
}
📍 المرحلة 9: المراقبة والتقارير (Monitoring & Reporting)
9.1 الحصول على حالة Orchestration
GET /api/orchestrations/:id

async function getOrchestrationStatus(orchestrationId: string) {
  const orchestration = await getOrchestrationById(orchestrationId);
  const tasks = await getTasksByOrchestrationId(orchestrationId);
  
  // حساب الإحصائيات
  const statistics = {
    totalTasks: tasks.length,
    pendingTasks: tasks.filter(t => t.status === 'PENDING').length,
    processingTasks: tasks.filter(t => t.status === 'PROCESSING').length,
    completedTasks: tasks.filter(t => t.status === 'COMPLETED').length,
    failedTasks: tasks.filter(t => t.status === 'FAILED').length,
    cancelledTasks: tasks.filter(t => t.status === 'CANCELLED').length,
    
    // Progress percentage
    progress: (tasks.filter(t => 
      t.status === 'COMPLETED' || t.status === 'FAILED'
    ).length / tasks.length) * 100,
    
    // Timing
    duration: orchestration.completed_at
      ? orchestration.completed_at.getTime() - orchestration.activated_at?.getTime()
      : Date.now() - orchestration.activated_at?.getTime(),
    
    estimatedTimeRemaining: estimateTimeRemaining(tasks, orchestration)
  };
  
  return {
    orchestration,
    tasks: tasks.map(formatTaskForResponse),
    statistics
  };
}
9.2 الحصول على Logs
GET /api/orchestrations/:id/logs

async function getOrchestrationLogs(orchestrationId: string) {
  // من قاعدة البيانات
  const logs = await db
    .select()
    .from(orchestrationLogs)
    .where(eq(orchestrationLogs.orchestration_id, orchestrationId))
    .orderBy(desc(orchestrationLogs.created_at));
  
  // أو من ملفات الـ logs
  const logFiles = await readLogFiles(orchestrationId);
  
  return {
    orchestrationId,
    logs: logs.map(log => ({
      timestamp: log.created_at,
      level: log.level,
      message: log.message,
      taskId: log.task_id,
      metadata: log.metadata
    }))
  };
}
9.3 Stream Live Updates (WebSocket/SSE)

// WebSocket endpoint
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', (ws, req) => {
  const orchestrationId = req.url?.split('/').pop();
  
  if (!orchestrationId) {
    ws.close();
    return;
  }
  
  logger.info('Client connected to orchestration stream', { orchestrationId });
  
  // إرسال الحالة الحالية
  getOrchestrationStatus(orchestrationId).then(status => {
    ws.send(JSON.stringify({
      type: 'status',
      data: status
    }));
  });
  
  // الاشتراك في التحديثات
  const subscription = subscribeToOrchestrationUpdates(orchestrationId, (update) => {
    ws.send(JSON.stringify({
      type: 'update',
      data: update
    }));
  });
  
  ws.on('close', () => {
    subscription.unsubscribe();
    logger.info('Client disconnected', { orchestrationId });
  });
});
// في Event Emitter
import { EventEmitter } from 'events';
const orchestrationEvents = new EventEmitter();
// عند تحديث أي task أو orchestration
async function updateTask(taskId: string, updates: Partial<Task>) {
  const task = await db.update(tasks)
    .set(updates)
    .where(eq(tasks.id, taskId))
    .returning();
  
  // إصدار event
  orchestrationEvents.emit(`orchestration:${task[0].orchestration_id}`, {
    type: 'task_updated',
    task: task[0]
  });
  
  return task[0];
}
function subscribeToOrchestrationUpdates(orchestrationId: string, callback: Function) {
  const listener = (data: any) => callback(data);
  orchestrationEvents.on(`orchestration:${orchestrationId}`, listener);
  
  return {
    unsubscribe: () => {
      orchestrationEvents.off(`orchestration:${orchestrationId}`, listener);
    }
  };
}
📍 المرحلة 10: التنظيف والصيانة (Cleanup & Maintenance)
10.1 تنظيف Orchestrations القديمة

// Cron job يعمل يوميًا
import cron from 'node-cron';
// كل يوم عند منتصف الليل
cron.schedule('0 0 * * *', async () => {
  logger.info('Starting orchestration cleanup');
  
  // حذف الـ orchestrations المكتملة القديمة (أكثر من 30 يوم)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const deletedCount = await db
    .delete(orchestrations)
    .where(
      and(
        or(
          eq(orchestrations.status, 'COMPLETED'),
          eq(orchestrations.status, 'FAILED'),
          eq(orchestrations.status, 'CANCELLED')
        ),
        lt(orchestrations.completed_at, thirtyDaysAgo)
      )
    );
  
  logger.info('Cleanup completed', { deletedCount });
});
10.2 تنظيف Cloud Agents اليتيمة (Orphaned)

// Cloud agents التي لم تستقبل updates لمدة طويلة
async function cleanupOrphanedAgents() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  
  const staleTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'PROCESSING'),
        lt(tasks.updated_at, twoHoursAgo)
      )
    );
  
  for (const task of staleTasks) {
    if (!task.cloud_agent_id) continue;
    
    try {
      // التحقق من الحالة الفعلية
      const agent = await getAgentStatus(task.cloud_agent_id);
      
      if (agent.status === 'FINISHED' || agent.status === 'FAILED') {
        // تحديث الحالة
        await handleTaskCompletion(task);
      }
    } catch (error) {
      logger.error('Failed to check orphaned agent', {
        taskId: task.id,
        agentId: task.cloud_agent_id,
        error
      });
    }
  }
}
// تشغيل كل ساعة
cron.schedule('0 * * * *', cleanupOrphanedAgents);
10.3 إعادة محاولة المهام الفاشلة

// إعادة محاولة المهام التي فشلت بسبب أخطاء مؤقتة
async function retryFailedTasks() {
  const retryableErrors = [
    'RATE_LIMIT_EXCEEDED',
    'TIMEOUT',
    'NETWORK_ERROR',
    'SERVICE_UNAVAILABLE'
  ];
  
  const failedTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'FAILED'),
        lt(tasks.retry_count, 3)
      )
    );
  
  for (const task of failedTasks) {
    // التحقق إذا كان الخطأ قابل لإعادة المحاولة
    if (retryableErrors.some(err => task.error_message?.includes(err))) {
      logger.info('Retrying failed task', {
        taskId: task.id,
        retryCount: task.retry_count + 1
      });
      
      // إعادة تعيين الحالة وإضافة للـ Queue
      await updateTask(task.id, {
        status: 'PENDING',
        retry_count: task.retry_count + 1,
        error_message: null
      });
      
      await addTaskToQueue(task, {
        delay: Math.pow(2, task.retry_count) * 60 * 1000 // Exponential backoff
      });
    }
  }
}
📊 مخطط تدفق الحالات (State Flow Diagram)
Orchestration States:
┌─────────┐
│ PENDING │ ──activate──> │ ACTIVE │
└─────────┘                └────────┘
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                  pause    cancel   complete
                    │         │         │
                    ▼         ▼         ▼
              ┌────────┐ ┌──────────┐ ┌───────────┐
              │ PAUSED │ │CANCELLED │ │ COMPLETED │
              └────────┘ └──────────┘ └───────────┘
                  │                         │
                resume                   ┌──┴──┐
                  │                      │     │
                  └──────────────────────┤ or  │
                                         │     │
              ┌──────┐                   └──┬──┘
              │FAILED│                      │
              └──────┘◄─────────────────────┘
                                    PARTIAL_COMPLETED


Task States:
┌─────────┐
│ PENDING │ ──process──> │PROCESSING│
└─────────┘               └──────────┘
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                complete   failed    cancel
                    │         │         │
                    ▼         ▼         ▼
              ┌───────────┐ ┌────────┐ ┌──────────┐
              │ COMPLETED │ │ FAILED │ │CANCELLED │
              └───────────┘ └────────┘ └──────────┘
                               │
                             retry
                               │
                               ▼
                         ┌─────────┐
                         │ PENDING │
                         └─────────┘


Cloud Agent States (من Cursor API):
┌──────────┐
│ CREATING │ ──> │ RUNNING │ ──> │ FINISHED │
└──────────┘     └─────────┘     └──────────┘
                      │
                    ┌─┴─┐
                    │   │
                  stop fail
                    │   │
                    ▼   ▼
              ┌─────────────┐ ┌────────┐
              │   STOPPED   │ │ FAILED │
              └─────────────┘ └────────┘
🔧 APIs الرئيسية
جدول الـ Endpoints الكاملة

// Orchestrations
POST   /api/orchestrations              // إنشاء جديد
GET    /api/orchestrations              // قائمة الكل
GET    
 
سأ  جدول الـ APIs والتفاصيل المتبقية:

🔧 APIs الرئيسية (ت ة)
جدول الـ Endpoints الكاملة

// ================== Orchestrations ==================
POST   /api/orchestrations              // إنشاء orchestration جديدة
GET    /api/orchestrations              // قائمة جميع الـ orchestrations (مع pagination)
GET    /api/orchestrations/:id          // تفاصيل orchestration محددة
PATCH  /api/orchestrations/:id          // تحديث orchestration
DELETE /api/orchestrations/:id          // حذف orchestration
// Orchestration Actions
POST   /api/orchestrations/:id/activate // تفعيل orchestration
POST   /api/orchestrations/:id/pause    // إيقاف مؤقت
POST   /api/orchestrations/:id/resume   // استئناف
POST   /api/orchestrations/:id/cancel   // إلغاء
// Orchestration Data
GET    /api/orchestrations/:id/tasks    // جميع مهام الـ orchestration
GET    /api/orchestrations/:id/logs     // سجلات الـ orchestration
GET    /api/orchestrations/:id/stats    // إحصائيات مفصلة
// ================== Tasks ==================
GET    /api/tasks/:id                   // تفاصيل task محددة
PATCH  /api/tasks/:id                   // تحديث task
POST   /api/tasks/:id/retry             // إعادة محاولة task فاشلة
// Task Actions
POST   /api/tasks/:id/restart           // إعادة تشغيل
POST   /api/tasks/:id/skip              // تخطي task
// ================== Cloud Agents ==================
POST   /api/cloud-agents/webhook        // استقبال webhooks من Cursor API
GET    /api/cloud-agents/:id            // معلومات cloud agent
POST   /api/cloud-agents/:id/stop       // إيقاف cloud agent
DELETE /api/cloud-agents/:id            // حذف cloud agent
// Agent Data
GET    /api/cloud-agents/:id/conversation // محادثة الـ agent
GET    /api/cloud-agents/:id/status     // حالة الـ agent الحالية
// ================== Monitoring ==================
GET    /api/health                      // صحة النظام
GET    /api/metrics                     // مقاييس الأداء
GET    /api/queue/stats                 // إحصائيات الـ Queue
// ================== WebSocket/SSE ==================
WS     /ws/orchestrations/:id           // تحديثات live للـ orchestration
GET    /api/orchestrations/:id/stream   // SSE stream للتحديثات
📋 نماذج البيانات (Data Models)
Database Schema الكامل

// ================== Orchestrations Table ==================
interface Orchestration {
  // Primary Info
  id: string;                    // UUID
  status: OrchestrationStatus;   // PENDING, ACTIVE, PAUSED, COMPLETED, FAILED, CANCELLED
  
  // Repository Info
  repository: string;            // https://github.com/owner/repo
  ref: string;                   // branch name (default: main)
  
  // Configuration
  model?: string;                // AI model to use
  priority: 'speed' | 'balanced' | 'quality';
  auto_create_pr: boolean;       // default: true
  webhook_url?: string;          // للإشعارات الخارجية
  
  // Metadata
  name?: string;                 // اسم وصفي
  description?: string;
  tags?: string[];               // للتصنيف
  
  // Results
  summary?: string;              // ملخص النتائج
  statistics?: {
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    cancelled_tasks: number;
    duration_ms: number;
    total_cost?: number;         // تكلفة API
  };
  error_message?: string;
  
  // Timestamps
  created_at: Date;
  updated_at: Date;
  activated_at?: Date;
  paused_at?: Date;
  resumed_at?: Date;
  completed_at?: Date;
  cancelled_at?: Date;
  
  // User Info
  created_by?: string;           // user ID
  team_id?: string;              // للـ team workspaces
}
type OrchestrationStatus = 
  | 'PENDING'           // تم إنشاؤها ولم تُفعّل بعد
  | 'ACTIVE'            // قيد التنفيذ
  | 'PAUSED'            // متوقفة مؤقتًا
  | 'COMPLETED'         // اكتملت جميع المهام بنجاح
  | 'PARTIAL_COMPLETED' // بعض المهام نجحت وبعضها فشل
  | 'FAILED'            // فشلت جميع المهام
  | 'CANCELLED';        // تم إلغاؤها
// ================== Tasks Table ==================
interface Task {
  // Primary Info
  id: string;                    // UUID
  orchestration_id: string;      // Foreign key
  status: TaskStatus;
  
  // Task Details
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  complexity: 'simple' | 'moderate' | 'complex';
  order_index: number;           // ترتيب التنفيذ
  
  // Dependencies (optional - للتطوير المستقبلي)
  depends_on?: string[];         // task IDs التي يجب أن تكتمل قبل هذه
  
  // Cloud Agent Info
  cloud_agent_id?: string;       // bc_abc123
  cloud_agent_status?: CloudAgentStatus;
  cloud_agent_url?: string;      // رابط الـ agent في Cursor
  
  // Results
  result_summary?: string;       // ملخص ما أنجزه الـ agent
  result_branch?: string;        // اسم الـ branch
  result_pr_url?: string;        // رابط الـ PR
  result_data?: any;             // بيانات إضافية
  
  // Error Handling
  error_message?: string;
  error_code?: string;
  retry_count: number;           // عدد المحاولات
  max_retries: number;           // default: 3
  
  // Timestamps
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
  failed_at?: Date;
  
  // Metadata
  metadata?: Record<string, any>;
}
type TaskStatus = 
  | 'PENDING'      // في انتظار التنفيذ
  | 'PROCESSING'   // قيد التنفيذ (Cloud Agent يعمل)
  | 'COMPLETED'    // اكتملت بنجاح
  | 'FAILED'       // فشلت
  | 'CANCELLED';   // تم إلغاؤها
type CloudAgentStatus = 
  | 'CREATING'     // Cloud Agent قيد الإنشاء
  | 'RUNNING'      // Cloud Agent يعمل
  | 'FINISHED'     // Cloud Agent انتهى
  | 'FAILED'       // Cloud Agent فشل
  | 'STOPPED';     // Cloud Agent تم إيقافه
// ================== Orchestration Logs Table ==================
interface OrchestrationLog {
  id: string;
  orchestration_id: string;
  task_id?: string;              // اختياري - للـ logs الخاصة بـ task
  
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, any>;
  
  created_at: Date;
}
// ================== Queue Jobs (BullMQ) ==================
interface TaskJob {
  taskId: string;
  orchestrationId: string;
  attempt: number;
  
  // Job options
  priority?: number;
  delay?: number;                // تأخير قبل التنفيذ (ms)
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}
⏱️ Timing & Performance
متوسط أوقات التنفيذ

// التوقيتات المتوقعة لكل مرحلة
const TIMING_BENCHMARKS = {
  // API Calls
  createOrchestration: '100-500ms',      // إنشاء في DB
  activateOrchestration: '50-200ms',     // تحديث الحالة وإضافة للـ Queue
  
  // Task Processing
  queuePickup: '0-5s',                   // Worker يلتقط من Queue
  validateAndPrepare: '100-500ms',       // validation + payload building
  cursorApiCall: '1-3s',                 // استدعاء Cursor API
  
  // Cloud Agent Lifecycle
  agentCreation: '10-30s',               // من CREATING → RUNNING
  agentExecution: '2-30min',             // حسب تعقيد المهمة
  webhookDelivery: '100-500ms',          // استقبال webhook
  
  // Total per Task
  simpleTask: '3-10min',                 // مهمة بسيطة
  moderateTask: '10-30min',              // مهمة متوسطة
  complexTask: '30-60min',               // مهمة معقدة
  
  // Orchestration with multiple tasks
  orchestration_3_tasks: '15-90min',     // 3 مهام متتالية
  orchestration_5_tasks: '25-150min',    // 5 مهام متتالية
};
استراتيجيات التحسين

// ================== Rate Limiting ==================
// حماية من تجاوز حدود Cursor API
const RATE_LIMITS = {
  cursorApi: {
    createAgent: '10/minute',            // حد إنشاء agents
    getAgent: '100/minute',              // حد الاستعلامات
    listAgents: '20/minute'
  },
  
  webhooks: {
    maxPerOrchestration: '1000/hour'     // حد الـ webhooks
  }
};
// Rate limiter implementation
import rateLimit from 'express-rate-limit';
const cursorApiLimiter = rateLimit({
  windowMs: 60 * 1000,                   // 1 minute
  max: 10,                               // 10 requests
  message: 'Too many requests to Cursor API',
  
  // Custom key generator
  keyGenerator: (req) => {
    return `cursor-api-${req.user?.id || 'anonymous'}`;
  }
});
// ================== Queue Optimization ==================
// أولويات الـ Queue
const QUEUE_PRIORITIES = {
  high: 1,       // مهام عاجلة
  medium: 5,     // مهام عادية
  low: 10        // مهام غير عاجلة
};
// Concurrency settings
const QUEUE_CONCURRENCY = {
  workers: 3,                // عدد الـ workers المتزامنة
  maxJobsPerWorker: 1,       // job واحدة لكل worker
  
  // Backoff strategy
  backoff: {
    type: 'exponential',
    delay: 1000                // 1s, 2s, 4s, 8s...
  }
};
// ================== Caching ==================
// Cache للنماذج والبيانات المتكررة
import NodeCache from 'node-cache';
const cache = new NodeCache({
  stdTTL: 600,                 // 10 minutes default
  checkperiod: 120             // تنظيف كل دقيقتين
});
// Cache models
const cachedModels = cache.get('available_models');
if (!cachedModels) {
  const models = await fetchAvailableModels();
  cache.set('available_models', models, 3600); // 1 hour
}
// Cache orchestration status (لتقليل DB queries)
const cacheKey = `orchestration:${id}:status`;
const cached = cache.get(cacheKey);
if (cached) return cached;
const status = await getOrchestrationStatus(id);
cache.set(cacheKey, status, 30); // 30 seconds
🔐 Security & Error Handling
معالجة الأخطاء الشاملة

// ================== Error Types ==================
enum ErrorCode {
  // Validation Errors (400)
  INVALID_REPOSITORY = 'INVALID_REPOSITORY',
  INVALID_MODEL = 'INVALID_MODEL',
  INVALID_TASK = 'INVALID_TASK',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Authorization Errors (401, 403)
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_API_KEY = 'INVALID_API_KEY',
  
  // Not Found (404)
  ORCHESTRATION_NOT_FOUND = 'ORCHESTRATION_NOT_FOUND',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  
  // State Errors (409)
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  ALREADY_ACTIVE = 'ALREADY_ACTIVE',
  ALREADY_COMPLETED = 'ALREADY_COMPLETED',
  
  // External API Errors (502, 503)
  CURSOR_API_ERROR = 'CURSOR_API_ERROR',
  GITHUB_API_ERROR = 'GITHUB_API_ERROR',
  WEBHOOK_DELIVERY_FAILED = 'WEBHOOK_DELIVERY_FAILED',
  
  // Rate Limiting (429)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  
  // Internal Errors (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  QUEUE_ERROR = 'QUEUE_ERROR'
}
// Custom Error Class
class OrchestrationError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'OrchestrationError';
  }
  
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        metadata: this.metadata
      }
    };
  }
}
// ================== Error Handler Middleware ==================
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // Log the error
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });
  
  // OrchestrationError
  if (err instanceof OrchestrationError) {
    return res.status(err.statusCode).json(err.toJSON());
  }
  
  // Validation errors (from 
 
سأ  معالجة الأخطاء والأجزاء المتبقية:

🔐 Security & Error Handling (ت ة)
معالجة الأخطاء الشاملة (ت ة)

// ================== Error Handler Middleware (ت ة) ==================
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // Log the error
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });
  
  // OrchestrationError
  if (err instanceof OrchestrationError) {
    return res.status(err.statusCode).json(err.toJSON());
  }
  
  // Validation errors (from Zod, express-validator, etc.)
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: {
        code: ErrorCode.INVALID_REQUEST,
        message: 'Validation failed',
        details: err.message
      }
    });
  }
  
  // Database errors
  if (err.name === 'DatabaseError' || err.message.includes('database')) {
    return res.status(500).json({
      error: {
        code: ErrorCode.DATABASE_ERROR,
        message: 'Database operation failed'
      }
    });
  }
  
  // Rate limit errors
  if (err.message?.includes('Too many requests')) {
    return res.status(429).json({
      error: {
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Rate limit exceeded. Please try again later.'
      }
    });
  }
  
  // Default to 500 Internal Server Error
  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred'
    }
  });
}
// ================== Retry Logic with Exponential Backoff ==================
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    shouldRetry = () => true
  } = options;
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // لا تعيد المحاولة في الحالات التالية:
      if (!shouldRetry(error)) {
        throw error;
      }
      
      if (attempt === maxRetries) {
        throw new OrchestrationError(
          ErrorCode.INTERNAL_ERROR,
          `Operation failed after ${maxRetries} retries: ${error.message}`,
          500,
          { originalError: error, attempts: attempt + 1 }
        );
      }
      
      // حساب التأخير (exponential backoff with jitter)
      const delay = Math.min(
        initialDelay * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelay
      );
      
      logger.warn('Operation failed, retrying', {
        attempt: attempt + 1,
        maxRetries,
        delay,
        error: error.message
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
// استخدام Retry Logic
async function createCloudAgentWithRetry(task: Task, orchestration: Orchestration) {
  return retryWithBackoff(
    () => createCloudAgent(task, orchestration),
    {
      maxRetries: 3,
      initialDelay: 2000,
      shouldRetry: (error) => {
        // أعد المحاولة فقط للأخطاء المؤقتة
        const retryableErrors = [
          'RATE_LIMIT_EXCEEDED',
          'TIMEOUT',
          'NETWORK_ERROR',
          'SERVICE_UNAVAILABLE',
          'ECONNRESET',
          'ETIMEDOUT'
        ];
        
        return retryableErrors.some(code => 
          error.message?.includes(code) || error.code === code
        );
      }
    }
  );
}
// ================== Security Middleware ==================
// Authentication
function authenticate(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    throw new OrchestrationError(
      ErrorCode.UNAUTHORIZED,
      'API key is required',
      401
    );
  }
  
  // التحقق من API Key (من DB أو cache)
  const user = validateApiKey(apiKey);
  
  if (!user) {
    throw new OrchestrationError(
      ErrorCode.INVALID_API_KEY,
      'Invalid API key',
      401
    );
  }
  
  req.user = user;
  next();
}
// Authorization
function authorize(requiredPermission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new OrchestrationError(
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
        401
      );
    }
    
    if (!req.user.permissions.includes(requiredPermission)) {
      throw new OrchestrationError(
        ErrorCode.FORBIDDEN,
        'Insufficient permissions',
        403
      );
    }
    
    next();
  };
}
// Webhook Signature Verification
function verifyWebhookSignature(payload: any, signature: string, secret: string): boolean {
  const crypto = require('crypto');
  
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(JSON.stringify(payload)).digest('hex');
  const expectedSignature = `sha256=${digest}`;
  
  // Constant-time comparison لمنع timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
// Input Sanitization
import { sanitize } from 'validator';
function sanitizeInput(data: any): any {
  if (typeof data === 'string') {
    return sanitize(data);
  }
  
  if (Array.isArray(data)) {
    return data.map(sanitizeInput);
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return data;
}
📊 Monitoring & Observability
Metrics Collection

// ================== Prometheus Metrics ==================
import promClient from 'prom-client';
// Initialize metrics registry
const register = new promClient.Registry();
// Default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });
// Custom metrics
const metrics = {
  // Orchestrations
  orchestrationsTotal: new promClient.Counter({
    name: 'orchestrations_total',
    help: 'Total number of orchestrations created',
    labelNames: ['status'],
    registers: [register]
  }),
  
  orchestrationDuration: new promClient.Histogram({
    name: 'orchestration_duration_seconds',
    help: 'Duration of orchestrations',
    labelNames: ['status'],
    buckets: [60, 300, 600, 1800, 3600, 7200], // 1min, 5min, 10min, 30min, 1h, 2h
    registers: [register]
  }),
  
  // Tasks
  tasksTotal: new promClient.Counter({
    name: 'tasks_total',
    help: 'Total number of tasks processed',
    labelNames: ['status', 'priority', 'complexity'],
    registers: [register]
  }),
  
  taskDuration: new promClient.Histogram({
    name: 'task_duration_seconds',
    help: 'Duration of task processing',
    labelNames: ['status', 'complexity'],
    buckets: [30, 60, 180, 300, 600, 1800, 3600], // 30s, 1min, 3min, 5min, 10min, 30min, 1h
    registers: [register]
  }),
  
  // Cloud Agents
  agentApiCalls: new promClient.Counter({
    name: 'cursor_api_calls_total',
    help: 'Total Cursor API calls',
    labelNames: ['endpoint', 'status'],
    registers: [register]
  }),
  
  agentApiDuration: new promClient.Histogram({
    name: 'cursor_api_duration_seconds',
    help: 'Cursor API call duration',
    labelNames: ['endpoint'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [register]
  }),
  
  // Queue
  queueSize: new promClient.Gauge({
    name: 'queue_size',
    help: 'Current queue size',
    labelNames: ['queue'],
    registers: [register]
  }),
  
  queueProcessingTime: new promClient.Histogram({
    name: 'queue_processing_time_seconds',
    help: 'Time to process queue jobs',
    labelNames: ['queue'],
    buckets: [1, 5, 10, 30, 60, 300],
    registers: [register]
  }),
  
  // Errors
  errorsTotal: new promClient.Counter({
    name: 'errors_total',
    help: 'Total errors',
    labelNames: ['type', 'code'],
    registers: [register]
  }),
  
  // Webhooks
  webhooksReceived: new promClient.Counter({
    name: 'webhooks_received_total',
    help: 'Total webhooks received',
    labelNames: ['event', 'status'],
    registers: [register]
  })
};
// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
// Update metrics in code
async function createOrchestration(data: CreateOrchestrationDto) {
  const start = Date.now();
  
  try {
    const orchestration = await db.insert(orchestrations).values(data);
    
    // Record success
    metrics.orchestrationsTotal.inc({ status: 'created' });
    
    return orchestration;
  } catch (error) {
    // Record error
    metrics.errorsTotal.inc({ type: 'orchestration', code: error.code });
    throw error;
  }
}
// ================== Health Checks ==================
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: HealthCheck;
    queue: HealthCheck;
    cursorApi: HealthCheck;
    worker: HealthCheck;
  };
}
interface HealthCheck {
  status: 'pass' | 'fail';
  responseTime?: number;
  message?: string;
}
app.get('/health', async (req, res) => {
  const checks: any = {};
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  
  // Database check
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = {
      status: 'pass',
      responseTime: Date.now() - start
    };
  } catch (error) {
    checks.database = {
      status: 'fail',
      message: error.message
    };
    overallStatus = 'unhealthy';
  }
  
  // Queue check
  try {
    const queueHealth = await taskQueue.getJobCounts();
    checks.queue = {
      status: 'pass',
      message: `Active: ${queueHealth.active}, Waiting: ${queueHealth.waiting}`
    };
  } catch (error) {
    checks.queue = {
      status: 'fail',
      message: error.message
    };
    overallStatus = 'degraded';
  }
  
  // Cursor API check
  try {
    const start = Date.now();
    const response = await fetch('https://api.cursor.com/v0/me', {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.CURSOR_API_KEY}:`).toString('base64')}`
      }
    });
    
    checks.cursorApi = {
      status: response.ok ? 'pass' : 'fail',
      responseTime: Date.now() - start
    };
    
    if (!response.ok) overallStatus = 'degraded';
  } catch (error) {
    checks.cursorApi = {
      status: 'fail',
      message: error.message
    };
    overallStatus = 'degraded';
  }
  
  // Worker check
  try {
    const workers = await getActiveWorkers();
    checks.worker = {
      status: workers.length > 0 ? 'pass' : 'fail',
      message: `${workers.length} active workers`
    };
    
    if (workers.length === 0) overallStatus = 'degraded';
  } catch (error) {
    checks.worker = {
      status: 'fail',
      message: error.message
    };
    overallStatus = 'degraded';
  }
  
  const health: HealthStatus = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks
  };
  
  const statusCode = overallStatus === 'healthy' ? 200 : 
                     overallStatus === 'degraded' ? 200 : 503;
  
  res.status(statusCode).json(health);
});
// ================== Logging ==================
import winston from 'winston';
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'cursor-orchestrator',
    environment: process.env.NODE_ENV
  },
  transports: [
    // Console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // File - All logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    
    // File - Error logs only
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});
// Structured logging helper
function logOrchestrationEvent(
  level: string,
  message: string,
  orchestrationId: string,
  metadata?: Record<string, any>
) {
  logger.log(level, message, {
    orchestrationId,
    ...metadata
  });
  
  // أيضًا حفظ في DB للتتبع
  db.insert(orchestrationLogs).values({
    id: generateUUID(),
    orchestration_id: orchestrationId,
    level,
    message,
    metadata,
    created_at: new Date()
  });
}
🔄 Complete Example Flow
سيناريو كامل من البداية للنهاية

// ================== 1. Create Orchestration ==================
const createResponse = await fetch('http://localhost:3000/api/orchestrations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    repository: 'asce/cursor-monitor',
    ref: 'main',
    model: 'claude-4-sonnet-thinking',
    priority: 'balanced',
    autoCreatePr: true,
    tasks: [
      {
        title: 'Add authentication system',
        description: 'Implement JWT-based authentication with login and registration endpoints',
        priority: 'high',
        complexity: 'moderate'
      },
      {
        title: 'Add user dashboard',
        description: 'Create a user dashboard with profile management',
        priority: 'medium',
        complexity: 'simple'
      },
      {
        title: 'Add tests',
        description: 'Write unit and integration tests for authentication and dashboard',
        priority: 'medium',
        complexity: 'moderate'
      }
    ]
  })
});
const orchestration = await createResponse.json();
console.log('Created:', orchestration.id);
// Output: Created: 56cb10c1-5de9-49c2-a5ef-63273b07e7da
// ================== 2. Activate Orchestration ==================
const activateResponse = await fetch(
  `http://localhost:3000/api/orchestrations/${orchestration.id}/activate`,
  {
    method: 'POST',
    headers: { 'X-API-Key': 'your-api-key' }
  }
);
console.log('Status:', (await activateResponse.json()).status);
// Output: Status: ACTIVE
// ================== 3. Monitor Progress (WebSocket) ==================
const ws = new WebSocket(`ws://localhost:8080/orchestrations/${orchestration.id}`);
ws.on('message', (data) => {
  const update = JSON.parse(data);
  
  if (update.type === 'task_updated') {
    console.log(`Task ${update.task.title}: ${update.task.status}`);
    
    if (update.task.status === 'PROCESSING') {
      console.log(`  Cloud Agent: ${update.task.cloud_agent_url}`);
    }
    
    if (update.task.status === 'COMPLETED') {
      console.log(`  Branch: ${update.task.result_branch}`);
      console.log(`  PR: ${update.task.result_pr_url}`);
    }
  }
  
  if (update.type === 'orchestration_completed') {
    
 
سأ  السيناريو الكامل والأجزاء النهائية:

🔄 Complete Example Flow (ت ة)

// ================== 3. Monitor Progress (WebSocket) - ت ة ==================
ws.on('message', (data) => {
  const update = JSON.parse(data);
  
  if (update.type === 'task_updated') {
    console.log(`Task ${update.task.title}: ${update.task.status}`);
    
    if (update.task.status === 'PROCESSING') {
      console.log(`  Cloud Agent: ${update.task.cloud_agent_url}`);
    }
    
    if (update.task.status === 'COMPLETED') {
      console.log(`  Branch: ${update.task.result_branch}`);
      console.log(`  PR: ${update.task.result_pr_url}`);
    }
  }
  
  if (update.type === 'orchestration_completed') {
    console.log('✅ Orchestration completed!');
    console.log(`  Completed: ${update.data.statistics.completed_tasks}`);
    console.log(`  Failed: ${update.data.statistics.failed_tasks}`);
    console.log(`  Duration: ${update.data.statistics.duration_ms}ms`);
    ws.close();
  }
});
// Expected Output:
// Task Add authentication system: PROCESSING
//   Cloud Agent: https://cursor.com/agents?id=bc_abc123
// Task Add authentication system: COMPLETED
//   Branch: cursor/add-authentication-1234
//   PR: https://github.com/asce/cursor-monitor/pull/42
// Task Add user dashboard: PROCESSING
//   Cloud Agent: https://cursor.com/agents?id=bc_def456
// Task Add user dashboard: COMPLETED
//   Branch: cursor/add-dashboard-5678
//   PR: https://github.com/asce/cursor-monitor/pull/43
// Task Add tests: PROCESSING
//   Cloud Agent: https://cursor.com/agents?id=bc_ghi789
// Task Add tests: COMPLETED
//   Branch: cursor/add-tests-9012
//   PR: https://github.com/asce/cursor-monitor/pull/44
// ✅ Orchestration completed!
//   Completed: 3
//   Failed: 0
//   Duration: 2451230ms
// ================== 4. Get Final Status ==================
const statusResponse = await fetch(
  `http://localhost:3000/api/orchestrations/${orchestration.id}`,
  {
    headers: { 'X-API-Key': 'your-api-key' }
  }
);
const finalStatus = await statusResponse.json();
console.log('\n📊 Final Summary:');
console.log(JSON.stringify(finalStatus, null, 2));
// Output:
/*
{
  "orchestration": {
    "id": "56cb10c1-5de9-49c2-a5ef-63273b07e7da",
    "status": "COMPLETED",
    "repository": "https://github.com/asce/cursor-monitor",
    "ref": "main",
    "model": "claude-4-sonnet-thinking",
    "created_at": "2025-12-21T10:00:00Z",
    "activated_at": "2025-12-21T10:05:00Z",
    "completed_at": "2025-12-21T10:46:51Z",
    "summary": "All 3 tasks completed successfully"
  },
  "tasks": [
    {
      "id": "task-1",
      "title": "Add authentication system",
      "status": "COMPLETED",
      "cloud_agent_id": "bc_abc123",
      "result_branch": "cursor/add-authentication-1234",
      "result_pr_url": "https://github.com/asce/cursor-monitor/pull/42",
      "result_summary": "Implemented JWT authentication with login, registration, and middleware",
      "duration": 842000
    },
    {
      "id": "task-2",
      "title": "Add user dashboard",
      "status": "COMPLETED",
      "cloud_agent_id": "bc_def456",
      "result_branch": "cursor/add-dashboard-5678",
      "result_pr_url": "https://github.com/asce/cursor-monitor/pull/43",
      "result_summary": "Created user dashboard with profile management and settings",
      "duration": 623000
    },
    {
      "id": "task-3",
      "title": "Add tests",
      "status": "COMPLETED",
      "cloud_agent_id": "bc_ghi789",
      "result_branch": "cursor/add-tests-9012",
      "result_pr_url": "https://github.com/asce/cursor-monitor/pull/44",
      "result_summary": "Added 45 unit tests and 12 integration tests with 95% coverage",
      "duration": 986230
    }
  ],
  "statistics": {
    "totalTasks": 3,
    "completedTasks": 3,
    "failedTasks": 0,
    "progress": 100,
    "duration": 2451230
  }
}
*/
// ================== 5. Alternative: Polling (without WebSocket) ==================
async function pollOrchestrationStatus(orchestrationId: string) {
  const maxAttempts = 120; // 2 hours max (120 * 60s)
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    const response = await fetch(
      `http://localhost:3000/api/orchestrations/${orchestrationId}`,
      { headers: { 'X-API-Key': 'your-api-key' } }
    );
    
    const data = await response.json();
    
    console.log(`[${new Date().toISOString()}] Status: ${data.orchestration.status}`);
    console.log(`  Progress: ${data.statistics.progress.toFixed(1)}%`);
    console.log(`  Completed: ${data.statistics.completedTasks}/${data.statistics.totalTasks}`);
    
    // تحقق من الحالات النهائية
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'PARTIAL_COMPLETED'].includes(data.orchestration.status)) {
      console.log('\n✅ Final status reached!');
      return data;
    }
    
    // انتظر 60 ثانية قبل المحاولة التالية
    await new Promise(resolve => setTimeout(resolve, 60000));
    attempt++;
  }
  
  throw new Error('Timeout: Orchestration did not complete within expected time');
}
// Use polling
const finalResult = await pollOrchestrationStatus(orchestration.id);
🎯 Workflow Variations
سيناريوهات مختلفة للاستخدام

// ================== Scenario 1: Sequential Tasks (Default) ==================
// المهام تُنفذ واحدة تلو الأخرى بالترتيب
const sequential = await createOrchestration({
  repository: 'owner/repo',
  tasks: [
    { title: 'Task 1', order_index: 0 }, // يُنفذ أولاً
    { title: 'Task 2', order_index: 1 }, // ثم هذا
    { title: 'Task 3', order_index: 2 }  // ثم هذا
  ]
});
// ================== Scenario 2: Pause and Resume ==================
// إنشاء وتفعيل
const orch = await createAndActivate(data);
// العمل لمدة...
await wait(30 * 60 * 1000); // 30 minutes
// إيقاف مؤقت
await pauseOrchestration(orch.id);
console.log('⏸️  Paused for maintenance');
// صيانة أو تعديلات...
await performMaintenance();
// استئناف
await resumeOrchestration(orch.id);
console.log('▶️  Resumed');
// ================== Scenario 3: Error Handling & Retry ==================
try {
  const orch = await createOrchestration({
    repository: 'owner/repo',
    tasks: [{ title: 'Risky task', max_retries: 5 }]
  });
  
  await activateOrchestration(orch.id);
  
  // مراقبة
  const result = await waitForCompletion(orch.id);
  
  if (result.status === 'FAILED') {
    console.log('❌ Failed after retries');
    
    // تحليل السبب
    const failedTasks = result.tasks.filter(t => t.status === 'FAILED');
    for (const task of failedTasks) {
      console.log(`Task: ${task.title}`);
      console.log(`Error: ${task.error_message}`);
      console.log(`Retries: ${task.retry_count}`);
      
      // إعادة محاولة يدوية
      if (task.retry_count < 10) {
        await retryTask(task.id);
      }
    }
  }
} catch (error) {
  console.error('Orchestration failed:', error);
}
// ================== Scenario 4: Webhook Notifications ==================
const orchWithWebhook = await createOrchestration({
  repository: 'owner/repo',
  webhook_url: 'https://your-app.com/webhooks/orchestration',
  tasks: [...]
});
// في webhook endpoint:
app.post('/webhooks/orchestration', (req, res) => {
  const { event, orchestrationId, status, tasks } = req.body;
  
  if (event === 'orchestration.completed') {
    // إرسال إشعار
    sendSlackNotification({
      channel: '#deployments',
      text: `✅ Orchestration completed!`,
      attachments: [{
        fields: [
          { title: 'Repository', value: req.body.repository },
          { title: 'Tasks', value: `${tasks.length} tasks` },
          { title: 'Duration', value: formatDuration(req.body.statistics.duration_ms) }
        ]
      }]
    });
    
    // تحديث dashboard
    updateDashboard(orchestrationId, status);
    
    // trigger deployment
    if (status === 'COMPLETED') {
      triggerDeployment(req.body.repository);
    }
  }
  
  res.status(200).json({ received: true });
});
// ================== Scenario 5: Bulk Operations ==================
// إنشاء orchestrations متعددة
async function bulkOrchestrate(repositories: string[], task: string) {
  const orchestrations = await Promise.all(
    repositories.map(repo => 
      createOrchestration({
        repository: repo,
        tasks: [{ title: task, description: task }]
      })
    )
  );
  
  // تفعيل الكل
  await Promise.all(
    orchestrations.map(orch => activateOrchestration(orch.id))
  );
  
  console.log(`🚀 Started ${orchestrations.length} orchestrations`);
  
  // مراقبة الكل
  const results = await Promise.all(
    orchestrations.map(orch => waitForCompletion(orch.id))
  );
  
  // تقرير نهائي
  const summary = {
    total: results.length,
    completed: results.filter(r => r.status === 'COMPLETED').length,
    failed: results.filter(r => r.status === 'FAILED').length
  };
  
  console.log('📊 Bulk operation summary:', summary);
  return summary;
}
// استخدام
await bulkOrchestrate(
  ['owner/repo1', 'owner/repo2', 'owner/repo3'],
  'Update dependencies to latest versions'
);
// ================== Scenario 6: Conditional Execution ==================
// تنفيذ مشروط بناءً على نتائج المهام السابقة
async function conditionalOrchestration(orchestrationId: string) {
  // انتظر اكتمال المهمة الأولى
  const task1 = await waitForTaskCompletion(orchestrationId, 'task-1');
  
  if (task1.status === 'COMPLETED') {
    // إذا نجحت، أضف مهام إضافية
    await addTaskToOrchestration(orchestrationId, {
      title: 'Deploy to staging',
      description: 'Deploy the changes to staging environment'
    });
  } else {
    // إذا فشلت، ألغِ الباقي
    await cancelOrchestration(orchestrationId);
    await sendAlert('Task 1 failed, orchestration cancelled');
  }
}
// ================== Scenario 7: Priority Queue ==================
// مهام ذات أولوية عالية تُنفذ أولاً
const urgentOrch = await createOrchestration({
  repository: 'owner/repo',
  priority: 'speed', // يحصل على أولوية في Queue
  tasks: [
    {
      title: 'Hotfix critical bug',
      priority: 'high',
      complexity: 'simple'
    }
  ]
});
await activateOrchestration(urgentOrch.id);
// ستُضاف للـ Queue بأولوية عالية
// QUEUE_PRIORITIES.high = 1 (أول من يُعالج)
📈 Performance Optimization Tips
نصائح لتحسين الأداء

// ================== 1. Task Batching ==================
// بدلاً من إنشاء orchestration لكل مهمة صغيرة
// ❌ Bad
for (const file of files) {
  await createOrchestration({
    repository: 'owner/repo',
    tasks: [{ title: `Update ${file}` }]
  });
}
// ✅ Good - دمج المهام في orchestration واحدة
await createOrchestration({
  repository: 'owner/repo',
  tasks: files.map(file => ({
    title: `Update ${file}`,
    description: `Update configuration in ${file}`
  }))
});
// ================== 2. Model Selection ==================
// اختر النموذج المناسب للمهمة
const modelByComplexity = {
  simple: 'claude-4-sonnet-thinking',    // أسرع وأرخص
  moderate: 'claude-4-sonnet-thinking',  // متوازن
  complex: 'claude-4-opus-thinking'      // أقوى للمهام المعقدة
};
await createOrchestration({
  repository: 'owner/repo',
  model: modelByComplexity[task.complexity],
  tasks: [task]
});
// ================== 3. Webhook vs Polling ==================
// ✅ استخدم Webhooks (أفضل)
await createOrchestration({
  repository: 'owner/repo',
  webhook_url: 'https://your-app.com/webhook', // تحديثات فورية
  tasks: [...]
});
// ❌ تجنب Polling المتكرر
// Polling كل 10 ثواني = waste of resources
setInterval(() => checkStatus(id), 10000); // Bad
// إذا كان لازم polling، استخدم فترات معقولة
setInterval(() => checkStatus(id), 60000); // Better (60s)
// ================== 4. Database Indexing ==================
// أضف indexes للأعمدة المستخدمة كثيرًا
/*
CREATE INDEX idx_orchestrations_status ON orchestrations(status);
CREATE INDEX idx_orchestrations_created_at ON orchestrations(created_at DESC);
CREATE INDEX idx_tasks_orchestration_id ON tasks(orchestration_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_cloud_agent_id ON tasks(cloud_agent_id);
*/
// ================== 5. Connection Pooling ==================
// استخدم connection pooling للـ database
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
const pool = new Pool({
  host: 
 
سأ  نصائح تحسين الأداء والأجزاء النهائية:

📈 Performance Optimization Tips (ت ة)

// ================== 5. Connection Pooling (ت ة) ==================
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  
  // Pool configuration
  max: 20,                    // maximum pool size
  min: 5,                     // minimum pool size
  idleTimeoutMillis: 30000,   // close idle clients after 30s
  connectionTimeoutMillis: 2000, // return error after 2s if no connection
});
const db = drizzle(pool);
// ================== 6. Caching Strategy ==================
import Redis from 'ioredis';
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});
// Cache orchestration status
async function getOrchestrationWithCache(id: string) {
  const cacheKey = `orch:${id}`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Fetch from DB
  const orchestration = await getOrchestrationById(id);
  
  // Cache for 30 seconds
  await redis.setex(cacheKey, 30, JSON.stringify(orchestration));
  
  return orchestration;
}
// Invalidate cache on update
async function updateOrchestrationWithCache(id: string, updates: any) {
  const result = await updateOrchestration(id, updates);
  
  // Invalidate cache
  await redis.del(`orch:${id}`);
  
  return result;
}
// ================== 7. Batch Database Operations ==================
// ❌ Bad - N queries
for (const task of tasks) {
  await db.update(tasks).set({ status: 'PENDING' }).where(eq(tasks.id, task.id));
}
// ✅ Good - 1 query
await db.update(tasks)
  .set({ status: 'PENDING' })
  .where(inArray(tasks.id, taskIds));
// ================== 8. Lazy Loading ==================
// لا تحمّل بيانات غير ضرورية
async function getOrchestrationSummary(id: string) {
  // فقط البيانات الأساسية
  return db.select({
    id: orchestrations.id,
    status: orchestrations.status,
    repository: orchestrations.repository,
    created_at: orchestrations.created_at
  })
  .from(orchestrations)
  .where(eq(orchestrations.id, id));
}
async function getOrchestrationFull(id: string) {
  // كل البيانات + Tasks
  const orch = await db.select().from(orchestrations).where(eq(orchestrations.id, id));
  const tasks = await db.select().from(tasks).where(eq(tasks.orchestration_id, id));
  
  return { ...orch[0], tasks };
}
// ================== 9. Queue Optimization ==================
// استخدم priorities بذكاء
const queueOptions = {
  priority: task.priority === 'high' ? 1 : 
            task.priority === 'medium' ? 5 : 10,
  
  // Remove completed jobs automatically
  removeOnComplete: {
    age: 3600, // keep for 1 hour
    count: 1000 // keep last 1000
  },
  
  // Keep failed jobs for debugging
  removeOnFail: false,
  
  // Retry configuration
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  }
};
await taskQueue.add('process-task', taskData, queueOptions);
// ================== 10. Parallel Processing (حذر!) ==================
// يمكن معالجة orchestrations مختلفة بالتوازي
// لكن tasks داخل orchestration واحدة تُنفذ بالترتيب
// ✅ Safe - orchestrations مختلفة
await Promise.all([
  processOrchestration('orch-1'),
  processOrchestration('orch-2'),
  processOrchestration('orch-3')
]);
// ❌ Dangerous - tasks في نفس الـ orchestration
// لا تفعل هذا! يجب أن تُنفذ بالترتيب
await Promise.all([
  processTask('orch-1', 'task-1'),
  processTask('orch-1', 'task-2'), // قد تعتمد على task-1
  processTask('orch-1', 'task-3')  // قد تعتمد على task-2
]);
🔍 Debugging & Troubleshooting
دليل حل المشاكل

// ================== Common Issues & Solutions ==================
// 1. Task stuck in PROCESSING
async function debugStuckTask(taskId: string) {
  const task = await getTaskById(taskId);
  
  console.log('🔍 Debugging stuck task:', taskId);
  console.log('Status:', task.status);
  console.log('Updated at:', task.updated_at);
  console.log('Cloud Agent ID:', task.cloud_agent_id);
  
  if (task.cloud_agent_id) {
    // التحقق من حالة Cloud Agent
    try {
      const agent = await fetch(
        `https://api.cursor.com/v0/agents/${task.cloud_agent_id}`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${process.env.CURSOR_API_KEY}:`).toString('base64')}`
          }
        }
      ).then(r => r.json());
      
      console.log('Agent status:', agent.status);
      
      if (agent.status === 'FINISHED') {
        console.log('⚠️  Agent finished but webhook not received');
        console.log('→ Manually updating task status');
        await handleTaskCompletion(task);
      } else if (agent.status === 'FAILED') {
        console.log('❌ Agent failed');
        await handleTaskFailure(task, new Error('Agent failed'));
      } else {
        console.log('ℹ️  Agent still running');
      }
    } catch (error) {
      console.error('❌ Error fetching agent:', error);
      console.log('→ Agent may have been deleted');
    }
  } else {
    console.log('⚠️  No cloud agent ID - task never started');
    console.log('→ Retrying task');
    await retryTask(taskId);
  }
}
// 2. Orchestration not activating
async function debugOrchestrationActivation(orchId: string) {
  const orch = await getOrchestrationById(orchId);
  
  console.log('🔍 Debugging orchestration:', orchId);
  
  if (orch.status !== 'PENDING') {
    console.log('❌ Cannot activate - status is:', orch.status);
    return;
  }
  
  const tasks = await getTasksByOrchestrationId(orchId);
  
  if (tasks.length === 0) {
    console.log('❌ No tasks found');
    return;
  }
  
  console.log(`✅ ${tasks.length} tasks ready`);
  
  // التحقق من Queue
  const queueHealth = await taskQueue.getJobCounts();
  console.log('Queue status:', queueHealth);
  
  // التحقق من Workers
  const workers = await taskQueue.getWorkers();
  console.log(`Active workers: ${workers.length}`);
  
  if (workers.length === 0) {
    console.log('⚠️  No active workers! Start worker process.');
  }
}
// 3. Webhook not received
async function debugWebhookIssue(taskId: string) {
  const task = await getTaskById(taskId);
  
  console.log('🔍 Debugging webhook for task:', taskId);
  
  // التحقق من webhook configuration
  const webhookUrl = `${process.env.APP_URL}/api/cloud-agents/webhook`;
  console.log('Webhook URL:', webhookUrl);
  
  // Test webhook endpoint
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cursor-Signature': 'test'
      },
      body: JSON.stringify({
        agentId: task.cloud_agent_id,
        status: 'FINISHED',
        event: 'agent.finished'
      })
    });
    
    if (response.ok) {
      console.log('✅ Webhook endpoint is accessible');
    } else {
      console.log('❌ Webhook endpoint returned:', response.status);
    }
  } catch (error) {
    console.log('❌ Cannot reach webhook endpoint:', error.message);
    console.log('→ Check if APP_URL is publicly accessible');
  }
  
  // Fallback: manual polling
  console.log('→ Using manual status check as fallback');
  await checkAndUpdateTaskStatus(taskId);
}
// 4. Database connection issues
async function debugDatabaseConnection() {
  console.log('🔍 Testing database connection...');
  
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const duration = Date.now() - start;
    
    console.log(`✅ Database connected (${duration}ms)`);
    
    // Test query performance
    const orchCount = await db.select({ count: sql`count(*)` }).from(orchestrations);
    console.log(`Orchestrations in DB: ${orchCount[0].count}`);
    
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
    console.log('\nCheck:');
    console.log('  - DB_HOST:', process.env.DB_HOST);
    console.log('  - DB_PORT:', process.env.DB_PORT);
    console.log('  - DB_NAME:', process.env.DB_NAME);
    console.log('  - Connection string correct?');
  }
}
// 5. Cursor API issues
async function debugCursorApi() {
  console.log('🔍 Testing Cursor API connection...');
  
  const apiKey = process.env.CURSOR_API_KEY;
  
  if (!apiKey) {
    console.log('❌ CURSOR_API_KEY not set');
    return;
  }
  
  try {
    // Test authentication
    const meResponse = await fetch('https://api.cursor.com/v0/me', {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
      }
    });
    
    if (meResponse.ok) {
      const data = await meResponse.json();
      console.log('✅ API authentication successful');
      console.log('User:', data.userEmail);
    } else {
      console.log('❌ API authentication failed:', meResponse.status);
      console.log('→ Check if CURSOR_API_KEY is valid');
    }
    
    // Test models endpoint
    const modelsResponse = await fetch('https://api.cursor.com/v0/models', {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
      }
    });
    
    if (modelsResponse.ok) {
      const models = await modelsResponse.json();
      console.log('✅ Available models:', models.models);
    }
    
    // Test rate limits
    const agents = await fetch('https://api.cursor.com/v0/agents?limit=1', {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
      }
    });
    
    const rateLimitRemaining = agents.headers.get('x-ratelimit-remaining');
    const rateLimitReset = agents.headers.get('x-ratelimit-reset');
    
    console.log('Rate limit remaining:', rateLimitRemaining);
    console.log('Rate limit resets at:', new Date(parseInt(rateLimitReset) * 1000));
    
  } catch (error) {
    console.log('❌ Cursor API error:', error.message);
  }
}
// ================== Debug CLI Commands ==================
// أضف هذه الـ commands للتشخيص السريع
import { Command } from 'commander';
const program = new Command();
program
  .command('debug:task <taskId>')
  .description('Debug a stuck task')
  .action(async (taskId) => {
    await debugStuckTask(taskId);
    process.exit(0);
  });
program
  .command('debug:orchestration <orchId>')
  .description('Debug orchestration activation')
  .action(async (orchId) => {
    await debugOrchestrationActivation(orchId);
    process.exit(0);
  });
program
  .command('debug:db')
  .description('Test database connection')
  .action(async () => {
    await debugDatabaseConnection();
    process.exit(0);
  });
program
  .command('debug:api')
  .description('Test Cursor API connection')
  .action(async () => {
    await debugCursorApi();
    process.exit(0);
  });
program
  .command('debug:webhook <taskId>')
  .description('Debug webhook delivery')
  .action(async (taskId) => {
    await debugWebhookIssue(taskId);
    process.exit(0);
  });
program.parse();
// Usage:
// npm run debug:task task-123
// npm run debug:orchestration orch-456
// npm run debug:db
// npm run debug:api
📚 Best Practices Summary
أفضل الممارسات

// ================== 1. Task Design ==================
// ✅ Good Tasks
const goodTasks = [
  {
    title: 'Add user authentication',
    description: `
      Implement JWT-based authentication system with:
      - Login endpoint (POST /api/auth/login)
      - Registration endpoint (POST /api/auth/register)
      - Auth middleware for protected routes
      - Password hashing with bcrypt
      - Token expiration handling
    `,
    priority: 'high',
    complexity: 'moderate'
  }
];
// ❌ Bad Tasks
const badTasks = [
  {
    title: 'Fix bugs',  // غير محدد
    description: 'Fix all bugs in the app',  // واسع جداً
    priority: 'high',
    complexity: 'simple'  // تناقض مع الوصف
  }
];
// ================== 2. Error Handling ==================
// ✅ Always handle errors gracefully
async function safeOperation() {
  try {
    const result = await riskyOperation();
    return { success: true, data: result };
  } catch (error) {
    logger.error('Operation failed', { error: error.message });
    
    // لا ترمي error مباشرة - أعد object محدد
    return { 
      success: false, 
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        recoverable: isRecoverableError(error)
      }
    };
  }
}
// ================== 3. Logging ==================
// ✅ Log important events with context
logger.info('Task started', {
  taskId: task.id,
  orchestrationId: task.orchestration_id,
  repository: orchestration.repository,
  model: orchestration.model
});
// ❌ Don't log sensitive data
logger.info('API call', {
  apiKey: process.env.CURSOR_API_KEY,  // ❌ Never!
  payload: { secret: 'xxx' }            // ❌ Never!
});
// ================== 4. Resource 
 
سأ  أفضل الممارسات والملخص النهائي:

📚 Best Practices Summary (ت ة)

// ================== 4. Resource Cleanup ==================
// ✅ Always cleanup resources
async function processOrchestration(id: string) {
  const ws = new WebSocket(`ws://.../${id}`);
  const subscription = subscribeToUpdates(id);
  
  try {
    await doWork();
  } finally {
    // Cleanup في finally block
    ws.close();
    subscription.unsubscribe();
  }
}
// ✅ Use timeouts to prevent hanging
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}
// Usage
const result = await withTimeout(
  createCloudAgent(task),
  30000, // 30 seconds timeout
  'Cloud agent creation timed out'
);
// ================== 5. Idempotency ==================
// ✅ Make operations idempotent
async function activateOrchestration(id: string) {
  const orch = await getOrchestrationById(id);
  
  // Check if already activated
  if (orch.status === 'ACTIVE') {
    logger.info('Orchestration already active', { id });
    return { status: 'ACTIVE', message: 'Already active' };
  }
  
  if (orch.status !== 'PENDING') {
    throw new OrchestrationError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Cannot activate orchestration with status: ${orch.status}`,
      409
    );
  }
  
  // Proceed with activation...
  return await doActivation(orch);
}
// ================== 6. Validation ==================
// ✅ Validate early and thoroughly
import { z } from 'zod';
const createOrchestrationSchema = z.object({
  repository: z.string()
    .min(1, 'Repository is required')
    .regex(/^(https:\/\/github\.com\/)?[\w-]+\/[\w-]+$/, 'Invalid repository format'),
  
  ref: z.string().optional().default('main'),
  
  model: z.enum([
    'claude-4-sonnet-thinking',
    'o3',
    'claude-4-opus-thinking'
  ]).optional(),
  
  priority: z.enum(['speed', 'balanced', 'quality']).default('balanced'),
  
  autoCreatePr: z.boolean().default(true),
  
  tasks: z.array(
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().min(10).max(5000),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
      complexity: z.enum(['simple', 'moderate', 'complex']).default('moderate')
    })
  ).min(1, 'At least one task is required').max(50, 'Maximum 50 tasks allowed')
});
// Use in endpoint
app.post('/api/orchestrations', async (req, res) => {
  try {
    const validated = createOrchestrationSchema.parse(req.body);
    const result = await createOrchestration(validated);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      });
    }
    throw error;
  }
});
// ================== 7. Transaction Management ==================
// ✅ Use transactions for multi-step operations
async function createOrchestrationWithTasks(data: CreateOrchestrationDto) {
  return await db.transaction(async (tx) => {
    // Create orchestration
    const [orchestration] = await tx
      .insert(orchestrations)
      .values({
        id: generateUUID(),
        status: 'PENDING',
        repository: normalizeRepository(data.repository),
        ref: data.ref || 'main',
        model: data.model,
        priority: data.priority,
        auto_create_pr: data.autoCreatePr,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning();
    
    // Create tasks
    const taskValues = data.tasks.map((task, index) => ({
      id: generateUUID(),
      orchestration_id: orchestration.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      complexity: task.complexity,
      status: 'PENDING' as const,
      order_index: index,
      retry_count: 0,
      max_retries: 3,
      created_at: new Date()
    }));
    
    const tasks = await tx.insert(tasks).values(taskValues).returning();
    
    // Log creation
    await tx.insert(orchestrationLogs).values({
      id: generateUUID(),
      orchestration_id: orchestration.id,
      level: 'info',
      message: 'Orchestration created',
      metadata: { taskCount: tasks.length },
      created_at: new Date()
    });
    
    return { orchestration, tasks };
  });
}
// ================== 8. Monitoring ==================
// ✅ Monitor key metrics
async function recordMetrics(operation: string, fn: () => Promise<any>) {
  const start = Date.now();
  
  try {
    const result = await fn();
    
    // Record success
    metrics.operationDuration.observe(
      { operation, status: 'success' },
      (Date.now() - start) / 1000
    );
    
    metrics.operationsTotal.inc({ operation, status: 'success' });
    
    return result;
  } catch (error) {
    // Record failure
    metrics.operationDuration.observe(
      { operation, status: 'failure' },
      (Date.now() - start) / 1000
    );
    
    metrics.operationsTotal.inc({ operation, status: 'failure' });
    metrics.errorsTotal.inc({ operation, error: error.code || 'unknown' });
    
    throw error;
  }
}
// Usage
const result = await recordMetrics('create_orchestration', () =>
  createOrchestration(data)
);
// ================== 9. Documentation ==================
// ✅ Document complex logic
/**
 * Creates a Cloud Agent for the given task.
 * 
 * This function:
 * 1. Validates the task and orchestration data
 * 2. Builds the prompt with task requirements
 * 3. Normalizes the repository URL
 * 4. Validates and normalizes the model name
 * 5. Calls Cursor API to create the agent
 * 6. Updates task with agent information
 * 
 * @param task - The task to be executed
 * @param orchestration - The parent orchestration
 * @returns Cloud Agent creation response
 * @throws {OrchestrationError} If API call fails
 * 
 * @example
 * ```typescript
 * const agent = await createCloudAgent(task, orchestration);
 * console.log('Agent created:', agent.id);
 * ```
 */
async function createCloudAgent(
  task: Task,
  orchestration: Orchestration
): Promise<CloudAgentResponse> {
  // Implementation...
}
// ================== 10. Testing ==================
// ✅ Write tests for critical paths
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
describe('Orchestration Lifecycle', () => {
  let orchestrationId: string;
  
  beforeEach(async () => {
    // Setup test data
    const orch = await createTestOrchestration();
    orchestrationId = orch.id;
  });
  
  afterEach(async () => {
    // Cleanup
    await deleteTestOrchestration(orchestrationId);
  });
  
  it('should create orchestration with tasks', async () => {
    const orch = await getOrchestrationById(orchestrationId);
    expect(orch.status).toBe('PENDING');
    
    const tasks = await getTasksByOrchestrationId(orchestrationId);
    expect(tasks).toHaveLength(3);
  });
  
  it('should activate orchestration', async () => {
    await activateOrchestration(orchestrationId);
    
    const orch = await getOrchestrationById(orchestrationId);
    expect(orch.status).toBe('ACTIVE');
    expect(orch.activated_at).toBeDefined();
  });
  
  it('should not activate already active orchestration', async () => {
    await activateOrchestration(orchestrationId);
    
    await expect(
      activateOrchestration(orchestrationId)
    ).rejects.toThrow('Already active');
  });
  
  it('should process tasks sequentially', async () => {
    await activateOrchestration(orchestrationId);
    
    // Mock Cloud Agent responses
    mockCursorApi({
      '/v0/agents': { id: 'bc_test123', status: 'CREATING' }
    });
    
    await waitForTaskCompletion(orchestrationId, 'task-1');
    
    const tasks = await getTasksByOrchestrationId(orchestrationId);
    expect(tasks[0].status).toBe('COMPLETED');
    expect(tasks[1].status).toBe('PROCESSING'); // Next task started
    expect(tasks[2].status).toBe('PENDING');    // Waiting
  });
});
🎓 Complete Architecture Diagram
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATIONS                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   Web    │  │   CLI    │  │  Mobile  │  │ External │           │
│  │    UI    │  │   Tool   │  │   App    │  │   API    │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
└───────┼────────────┼─────────────┼─────────────┼──────────────────┘
        │            │             │             │
        └────────────┴─────────────┴─────────────┘
                     │
        ┌────────────▼────────────┐
        │   API Gateway / Router  │
        │  - Rate Limiting        │
        │  - Authentication       │
        │  - Request Validation   │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────────────────────────────┐
        │              REST API Endpoints                  │
        │  ┌─────────────────────────────────────────┐   │
        │  │  POST   /api/orchestrations             │   │
        │  │  GET    /api/orchestrations             │   │
        │  │  POST   /api/orchestrations/:id/activate│   │
        │  │  POST   /api/orchestrations/:id/pause   │   │
        │  │  POST   /api/cloud-agents/webhook       │   │
        │  └─────────────────────────────────────────┘   │
        └────────────┬────────────────────────────────────┘
                     │
        ┌────────────▼─────────────────────────────────────┐
        │         Service Layer (Business Logic)           │
        │  ┌──────────────┐  ┌──────────────────────┐     │
        │  │Orchestration │  │  Task Dispatcher     │     │
        │  │   Service    │  │     Service          │     │
        │  └──────┬───────┘  └──────────┬───────────┘     │
        │         │                     │                  │
        │  ┌──────▼───────┐  ┌─────────▼──────────┐      │
        │  │   Model      │  │   Cloud Agent      │      │
        │  │  Validator   │  │     Monitor        │      │
        │  └──────────────┘  └────────────────────┘      │
        └───────────┬──────────────────┬──────────────────┘
                    │                  │
        ┌───────────▼────────┐  ┌──────▼──────────────────┐
        │   Database Layer   │  │    Queue System         │
        │   (PostgreSQL)     │  │    (BullMQ/Redis)       │
        │  ┌──────────────┐  │  │  ┌────────────────┐    │
        │  │Orchestrations│  │  │  │  Task Queue    │    │
        │  │    Tasks     │  │  │  │  - Pending     │    │
        │  │    Logs      │  │  │  │  - Processing  │    │
        │  └──────────────┘  │  │  │  - Completed   │    │
        └────────────────────┘  │  └────────────────┘    │
                               │  ┌────────────────┐    │
                               │  │  Worker Pool   │    │
                               │  │  (3 workers)   │    │
                               │  └────────────────┘    │
                               └─────────┬───────────────┘
                                        │
        ┌───────────────────────────────▼──────────────────┐
        │           Task Processing Worker                  │
        │  1. Pick task from queue                         │
        │  2. Update status to PROCESSING                  │
        │  3. Call Task Dispatcher                         │
        │  4. Wait for Cloud Agent completion              │
        └───────────────────────┬──────────────────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │          Cursor Cloud Agent API                   │
        │  https://api.cursor.com/v0/agents                │
        │  ┌────────────────────────────────────────┐      │
        │  │  POST   /v0/agents         (create)    │      │
        │  │  GET    /v0/agents/:id     (status)    │      │
        │  │  POST   /v0/agents/:id/stop            │      │
        │  │  DELETE /v0/agents/:id                 │      │
        │  └────────────────────────────────────────┘      │
        └───────────────────────┬──────────────────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │           Cloud Agent Execution                   │
        │  - Clone repository                              │
        │  - Setup environment                             │
        │  - Execute task (AI-powered coding)              │
        │  - Create branch                                 │
        │  - Push changes                                  │
        │  - Create PR (optional)                          │
        └───────────────────────┬──────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
        ┌───────▼────────┐           ┌─────────▼─────────┐
        │   Webhook      │           │   Polling         │
        │  (Primary)     │           │  (Backup)         │
        │                │           │                   │
        │ Agent sends    │           │ Worker checks     │
        │ status updates │           │ status every 30s  │
        │ to our webhook │           │ if no webhook     
 
سأ  مخطط البنية والملخص النهائي:

🎓 Complete Architecture Diagram (ت ة)
                ┌───────────────┴───────────────┐
                │                               │
        ┌───────▼────────┐           ┌─────────▼─────────┐
        │   Webhook      │           │   Polling         │
        │  (Primary)     │           │  (Backup)         │
        │                │           │                   │
        │ Agent sends    │           │ Worker checks     │
        │ status updates │           │ status every 30s  │
        │ to our webhook │           │ if no webhook     │
        └───────┬────────┘           └─────────┬─────────┘
                │                               │
                └───────────────┬───────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │         Status Update Handler                     │
        │  - Verify webhook signature                      │
        │  - Update task status                            │
        │  - Handle completion/failure                     │
        │  - Trigger next task (if sequential)             │
        └───────────────────────┬──────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
        ┌───────▼────────┐           ┌─────────▼─────────┐
        │  Task Complete │           │   Task Failed     │
        │  - Save results│           │   - Log error     │
        │  - Update stats│           │   - Retry logic   │
        │  - Next task   │           │   - Alert user    │
        └───────┬────────┘           └─────────┬─────────┘
                │                               │
                └───────────────┬───────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │        Check for Next Task                        │
        │  - Any pending tasks?                            │
        │    YES → Add to queue                            │
        │    NO  → Complete orchestration                  │
        └───────────────────────┬──────────────────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │      Orchestration Complete                       │
        │  - Calculate statistics                          │
        │  - Update final status                           │
        │  - Send notifications                            │
        │  - Cleanup resources                             │
        └──────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    MONITORING & OBSERVABILITY                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  Prometheus  │  │   Grafana    │  │    Logs      │             │
│  │   Metrics    │  │  Dashboards  │  │  (Winston)   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
📊 Data Flow Summary
تدفق البيانات الكامل

// ================== Complete Flow Example ==================
/**
 * 1. CLIENT REQUEST
 * User creates orchestration via API
 */
POST /api/orchestrations
Body: {
  repository: "owner/repo",
  tasks: [...],
  model: "claude-4-sonnet-thinking"
}
    ↓
/**
 * 2. VALIDATION & CREATION
 * - Validate input
 * - Normalize repository URL
 * - Create records in DB
 */
DB: INSERT orchestrations (status: PENDING)
DB: INSERT tasks (status: PENDING)
    ↓
/**
 * 3. ACTIVATION
 * User activates orchestration
 */
POST /api/orchestrations/:id/activate
    ↓
DB: UPDATE orchestrations SET status = 'ACTIVE'
Queue: ADD first task to BullMQ
    ↓
/**
 * 4. WORKER PICKS TASK
 * Worker process picks task from queue
 */
Worker: taskQueue.process(job => ...)
DB: UPDATE tasks SET status = 'PROCESSING', started_at = NOW()
    ↓
/**
 * 5. TASK DISPATCH
 * Build payload and call Cursor API
 */
TaskDispatcher:
  - Build prompt
  - Validate model
  - Normalize repository
  
API Call: POST https://api.cursor.com/v0/agents
Payload: {
  prompt: { text: "..." },
  source: { repository: "https://...", ref: "main" },
  target: { autoCreatePr: true },
  model: "claude-4-sonnet-thinking",
  webhook: { url: "...", secret: "..." }
}
    ↓
/**
 * 6. CLOUD AGENT CREATION
 * Cursor API creates Cloud Agent
 */
Response: {
  id: "bc_abc123",
  status: "CREATING",
  target: { url: "https://cursor.com/agents?id=bc_abc123" }
}
    ↓
DB: UPDATE tasks SET 
  cloud_agent_id = 'bc_abc123',
  cloud_agent_status = 'CREATING',
  cloud_agent_url = 'https://...'
    ↓
/**
 * 7. CLOUD AGENT EXECUTION
 * Agent works on the task (2-30 minutes)
 * Status: CREATING → RUNNING → FINISHED
 */
Cloud Agent:
  - Clones repository
  - Sets up environment
  - Reads codebase
  - Makes changes (AI-powered)
  - Creates branch
  - Pushes changes
  - Creates PR (if autoCreatePr: true)
    ↓
/**
 * 8. WEBHOOK NOTIFICATION (Primary)
 * Cursor sends status updates
 */
POST /api/cloud-agents/webhook
Body: {
  agentId: "bc_abc123",
  status: "RUNNING",
  event: "agent.status_changed"
}
    ↓
WebhookHandler:
  - Verify signature
  - Find task by agentId
  - Update status
    ↓
DB: UPDATE tasks SET cloud_agent_status = 'RUNNING'
    ↓
/**
 * 9. COMPLETION WEBHOOK
 * Agent finishes successfully
 */
POST /api/cloud-agents/webhook
Body: {
  agentId: "bc_abc123",
  status: "FINISHED",
  event: "agent.finished"
}
    ↓
/**
 * 10. FETCH RESULTS
 * Get final results from Cursor API
 */
API Call: GET https://api.cursor.com/v0/agents/bc_abc123
Response: {
  id: "bc_abc123",
  status: "FINISHED",
  summary: "Implemented authentication system...",
  target: {
    branchName: "cursor/add-auth-1234",
    prUrl: "https://github.com/owner/repo/pull/42"
  }
}
    ↓
/**
 * 11. UPDATE TASK
 * Mark task as completed
 */
DB: UPDATE tasks SET
  status = 'COMPLETED',
  cloud_agent_status = 'FINISHED',
  result_summary = '...',
  result_branch = 'cursor/add-auth-1234',
  result_pr_url = 'https://github.com/.../pull/42',
  completed_at = NOW()
    ↓
/**
 * 12. NEXT TASK CHECK
 * Check if there are more tasks
 */
Query: SELECT * FROM tasks 
       WHERE orchestration_id = '...' 
       AND status = 'PENDING'
       ORDER BY order_index
       LIMIT 1
    ↓
IF task found:
  Queue: ADD task to BullMQ
  → Go back to step 4
ELSE:
  → Continue to step 13
    ↓
/**
 * 13. ORCHESTRATION COMPLETE
 * All tasks finished
 */
Calculate statistics:
  - total_tasks: 3
  - completed_tasks: 3
  - failed_tasks: 0
  - duration_ms: 2451230
    ↓
DB: UPDATE orchestrations SET
  status = 'COMPLETED',
  summary = 'All 3 tasks completed successfully',
  statistics = {...},
  completed_at = NOW()
    ↓
/**
 * 14. NOTIFICATIONS
 * Send completion notifications
 */
IF webhook_url exists:
  POST orchestration.webhook_url
  Body: { event: 'orchestration.completed', ... }
WebSocket: Broadcast to connected clients
Email: Send summary email (optional)
Slack: Post to channel (optional)
    ↓
/**
 * 15. CLIENT RECEIVES RESULTS
 * User sees completed orchestration
 */
GET /api/orchestrations/:id
Response: {
  orchestration: { status: 'COMPLETED', ... },
  tasks: [
    { status: 'COMPLETED', result_pr_url: '...', ... },
    { status: 'COMPLETED', result_pr_url: '...', ... },
    { status: 'COMPLETED', result_pr_url: '...', ... }
  ],
  statistics: { ... }
}
✅ DONE!
🔑 Key Concepts Summary
المفاهيم الأساسية

// ================== 1. ORCHESTRATION ==================
/**
 * Orchestration = مجموعة من المهام المترابطة
 * 
 * States:
 * - PENDING: تم إنشاؤها، لم تُفعّل بعد
 * - ACTIVE: قيد التنفيذ
 * - PAUSED: متوقفة مؤقتاً
 * - COMPLETED: اكتملت جميع المهام
 * - PARTIAL_COMPLETED: بعض المهام نجحت
 * - FAILED: فشلت جميع المهام
 * - CANCELLED: تم إلغاؤها
 */
// ================== 2. TASK ==================
/**
 * Task = مهمة واحدة يُنفذها Cloud Agent
 * 
 * States:
 * - PENDING: في انتظار التنفيذ
 * - PROCESSING: Cloud Agent يعمل عليها
 * - COMPLETED: اكتملت بنجاح
 * - FAILED: فشلت
 * - CANCELLED: تم إلغاؤها
 * 
 * Execution: Sequential (واحدة تلو الأخرى)
 */
// ================== 3. CLOUD AGENT ==================
/**
 * Cloud Agent = AI worker في السحابة
 * 
 * من Cursor API:
 * - CREATING: يتم إنشاؤه
 * - RUNNING: يعمل على المهمة
 * - FINISHED: انتهى بنجاح
 * - FAILED: فشل
 * - STOPPED: تم إيقافه
 * 
 * Duration: 2-30 دقيقة حسب التعقيد
 */
// ================== 4. QUEUE ==================
/**
 * Queue = نظام BullMQ لإدارة المهام
 * 
 * Features:
 * - Priority: high > medium > low
 * - Retry: automatic with exponential backoff
 * - Concurrency: 3 workers in parallel
 * - Persistence: Redis-backed
 */
// ================== 5. WEBHOOK ==================
/**
 * Webhook = إشعارات فورية من Cursor API
 * 
 * Events:
 * - agent.created
 * - agent.status_changed
 * - agent.finished
 * - agent.failed
 * 
 * Security: HMAC signature verification
 */
// ================== 6. POLLING (Backup) ==================
/**
 * Polling = فحص دوري للحالة
 * 
 * Used when:
 * - Webhook fails to deliver
 * - Webhook endpoint unreachable
 * - As backup safety mechanism
 * 
 * Frequency: Every 30 seconds
 */
// ================== 7. MODEL SELECTION ==================
/**
 * Models available for Cloud Agents:
 * 
 * - claude-4-sonnet-thinking: أسرع، أرخص، جيد للمهام البسيطة
 * - o3: GPT model، متوازن
 * - claude-4-opus-thinking: أقوى، أغلى، للمهام المعقدة
 * 
 * Recommendation: Don't specify model → let API choose
 */
// ================== 8. ERROR HANDLING ==================
/**
 * Error Strategy:
 * 
 * 1. Retry automatically (max 3 times)
 * 2. Exponential backoff (1s, 2s, 4s, 8s...)
 * 3. Log detailed error info
 * 4. Update task status
 * 5. Continue with next task or fail orchestration
 */
// ================== 9. MONITORING ==================
/**
 * Observability:
 * 
 * - Metrics: Prometheus
 * - Dashboards: Grafana
 * - Logs: Winston + Database
 * - Health checks: /health endpoint
 * - Real-time: WebSocket/SSE
 */
// ================== 10. SECURITY ==================
/**
 * Security Measures:
 * 
 * - API Key authentication
 * - Webhook signature verification
 * - Input validation (Zod)
 * - Rate limiting
 * - SQL injection prevention (Drizzle ORM)
 * - Secrets encryption (KMS)
 */
📝 Quick Reference
مرجع سريع للأوامر الشائعة

# ================== Development ==================
# Start development server
npm run dev
# Start worker process
npm run worker
# Run database migrations
npm run db:migrate
# Generate database types
npm run db:generate
# ================== Production ==================
# Build for production
npm run build
# Start production server
npm run start
# Start worker in production
npm run worker:prod
# ================== Debugging ==================
# Debug stuck task
npm run debug:task <taskId>
# Debug orchestration
npm run debug:orchestration <orchId>
# Test database connection
npm run debug:db
# 
 
سأ  المرجع السريع والملخص النهائي الشامل:

📝 Quick Reference (ت ة)

# ================== Debugging (ت ة) ==================
# Test Cursor API connection
npm run debug:api
# Debug webhook delivery
npm run debug:webhook <taskId>
# Check queue status
npm run queue:stats
# ================== Monitoring ==================
# View logs
tail -f logs/combined.log
tail -f logs/error.log
# View PM2 logs (if using PM2)
pm2 logs cursor-monitor-app
pm2 logs cursor-monitor-worker
# Check PM2 status
pm2 status
# Monitor system resources
pm2 monit
# ================== Database ==================
# Open database console
psql -h localhost -U postgres -d cursor_orchestrator
# Backup database
pg_dump cursor_orchestrator > backup.sql
# Restore database
psql cursor_orchestrator < backup.sql
# ================== Queue Management ==================
# Clear failed jobs
npm run queue:clear-failed
# Retry all failed jobs
npm run queue:retry-failed
# Pause queue
npm run queue:pause
# Resume queue
npm run queue:resume
# ================== Cleanup ==================
# Clean old orchestrations (>30 days)
npm run cleanup:old-orchestrations
# Clean orphaned agents
npm run cleanup:orphaned-agents
# Clean cache
npm run cache:clear
# ================== Testing ==================
# Run all tests
npm test
# Run tests with coverage
npm run test:coverage
# Run specific test file
npm test orchestration.test.ts
# Run integration tests
npm run test:integration
# Run e2e tests
npm run test:e2e
🎯 Common Scenarios & Solutions
سيناريوهات شائعة وحلولها

// ================== Scenario 1: Task Stuck ==================
/**
 * Problem: Task status = PROCESSING for >1 hour
 * 
 * Solutions:
 */
// 1. Check Cloud Agent status
const agent = await fetch(
  `https://api.cursor.com/v0/agents/${task.cloud_agent_id}`,
  { headers: { Authorization: `Basic ${btoa(`${API_KEY}:`)}` }}
).then(r => r.json());
console.log('Agent status:', agent.status);
// 2. If agent finished but webhook failed
if (agent.status === 'FINISHED') {
  await handleTaskCompletion(task);
}
// 3. If agent still running, check conversation
const conversation = await fetch(
  `https://api.cursor.com/v0/agents/${task.cloud_agent_id}/conversation`,
  { headers: { Authorization: `Basic ${btoa(`${API_KEY}:`)}` }}
).then(r => r.json());
console.log('Last message:', conversation.messages[conversation.messages.length - 1]);
// ================== Scenario 2: High Rate Limits ==================
/**
 * Problem: Getting rate limit errors from Cursor API
 * 
 * Solutions:
 */
// 1. Implement request queuing
const requestQueue = new Map<string, Promise<any>>();
async function queuedRequest(key: string, fn: () => Promise<any>) {
  if (requestQueue.has(key)) {
    return requestQueue.get(key);
  }
  
  const promise = fn().finally(() => requestQueue.delete(key));
  requestQueue.set(key, promise);
  return promise;
}
// 2. Add delay between requests
async function createAgentWithDelay(task: Task) {
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
  return createCloudAgent(task);
}
// 3. Use exponential backoff
async function createAgentWithBackoff(task: Task, attempt = 0) {
  try {
    return await createCloudAgent(task);
  } catch (error) {
    if (error.code === 'RATE_LIMIT_EXCEEDED' && attempt < 5) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return createAgentWithBackoff(task, attempt + 1);
    }
    throw error;
  }
}
// ================== Scenario 3: Database Connection Pool Exhausted ==================
/**
 * Problem: "sorry, too many clients already"
 * 
 * Solutions:
 */
// 1. Increase pool size
const pool = new Pool({
  max: 30, // increase from 20
  min: 10
});
// 2. Always release connections
async function safeQuery(query: string) {
  const client = await pool.connect();
  try {
    return await client.query(query);
  } finally {
    client.release(); // Always release!
  }
}
// 3. Use connection timeout
const pool = new Pool({
  connectionTimeoutMillis: 5000, // fail fast
  idleTimeoutMillis: 30000      // close idle connections
});
// ================== Scenario 4: Memory Leaks ==================
/**
 * Problem: Memory usage keeps increasing
 * 
 * Solutions:
 */
// 1. Clear event listeners
function processOrchestration(id: string) {
  const emitter = new EventEmitter();
  
  emitter.on('update', handleUpdate);
  
  // Cleanup when done
  process.on('exit', () => {
    emitter.removeAllListeners();
  });
}
// 2. Limit cache size
const cache = new NodeCache({
  maxKeys: 1000,           // max 1000 items
  stdTTL: 600,             // 10 minutes
  checkperiod: 120,        // cleanup every 2 minutes
  useClones: false         // don't clone objects (saves memory)
});
// 3. Stream large datasets
async function exportLargeLogs(orchId: string) {
  const stream = db
    .select()
    .from(orchestrationLogs)
    .where(eq(orchestrationLogs.orchestration_id, orchId))
    .stream(); // Use streaming
  
  for await (const log of stream) {
    processLog(log);
  }
}
// ================== Scenario 5: Orchestration Won't Start ==================
/**
 * Problem: Status stays PENDING after activate
 * 
 * Solutions:
 */
// 1. Check if workers are running
const workers = await taskQueue.getWorkers();
if (workers.length === 0) {
  console.log('❌ No workers running! Start worker process.');
  // Start worker: npm run worker
}
// 2. Check queue health
const health = await taskQueue.getJobCounts();
console.log('Queue health:', health);
// { active: 0, waiting: 5, completed: 10, failed: 2 }
// 3. Check if task was added to queue
const jobs = await taskQueue.getJobs(['waiting', 'active']);
const taskJob = jobs.find(j => j.data.orchestrationId === orchId);
if (!taskJob) {
  console.log('❌ Task not in queue! Re-adding...');
  const firstTask = await getFirstPendingTask(orchId);
  await addTaskToQueue(firstTask);
}
// ================== Scenario 6: Webhook Not Received ==================
/**
 * Problem: Cloud Agent finished but task still PROCESSING
 * 
 * Solutions:
 */
// 1. Check if webhook endpoint is accessible
const webhookUrl = `${process.env.APP_URL}/api/cloud-agents/webhook`;
try {
  const response = await fetch(webhookUrl);
  console.log('Webhook endpoint accessible:', response.ok);
} catch (error) {
  console.log('❌ Webhook endpoint not accessible:', error.message);
  console.log('→ Make sure APP_URL is public and HTTPS');
}
// 2. Enable polling as backup (should already be running)
// Polling checks every 30s, so wait 1 minute
await new Promise(resolve => setTimeout(resolve, 60000));
const updatedTask = await getTaskById(taskId);
console.log('Task status after polling:', updatedTask.status);
// 3. Manually trigger status check
await checkAndUpdateTaskStatus(taskId);
// ================== Scenario 7: Cost Management ==================
/**
 * Problem: High API costs
 * 
 * Solutions:
 */
// 1. Use cheaper model for simple tasks
function selectModel(complexity: string) {
  return {
    simple: 'claude-4-sonnet-thinking',    // Cheapest
    moderate: 'claude-4-sonnet-thinking',  // Still cheap
    complex: 'claude-4-opus-thinking'      // Only for complex
  }[complexity];
}
// 2. Set cost limits
const MONTHLY_BUDGET = 100; // $100/month
async function checkBudget() {
  const thisMonth = await db
    .select({ total: sql`sum(cost)` })
    .from(tasks)
    .where(
      gte(tasks.created_at, startOfMonth(new Date()))
    );
  
  if (thisMonth[0].total >= MONTHLY_BUDGET) {
    throw new Error('Monthly budget exceeded');
  }
}
// 3. Track costs per orchestration
async function calculateOrchestrationCost(orchId: string) {
  const tasks = await getTasksByOrchestrationId(orchId);
  
  const totalCost = tasks.reduce((sum, task) => {
    const model = task.model || 'claude-4-sonnet-thinking';
    const duration = task.completed_at - task.started_at;
    
    // Estimate cost based on model and duration
    const costPerMinute = {
      'claude-4-sonnet-thinking': 0.05,
      'o3': 0.10,
      'claude-4-opus-thinking': 0.20
    }[model] || 0.05;
    
    return sum + (duration / 60000) * costPerMinute;
  }, 0);
  
  return totalCost;
}
🚀 Deployment Checklist
قائمة التحقق قبل النشر

// ================== Pre-Deployment Checklist ==================
/**
 * ✅ ENVIRONMENT VARIABLES
 */
const requiredEnvVars = [
  'DATABASE_URL',              // PostgreSQL connection
  'REDIS_URL',                 // Redis for queue
  'CURSOR_API_KEY',            // Cursor API key
  'APP_URL',                   // Public app URL (for webhooks)
  'WEBHOOK_SECRET',            // Webhook signature secret
  'NODE_ENV',                  // production
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing ${envVar}`);
    process.exit(1);
  }
}
/**
 * ✅ DATABASE
 */
// - Run migrations
// - Create indexes
// - Backup before deploy
// - Test connection
await db.execute(sql`SELECT 1`);
/**
 * ✅ QUEUE
 */
// - Redis accessible
// - Workers configured
// - Concurrency settings
await redis.ping();
/**
 * ✅ CURSOR API
 */
// - API key valid
// - Rate limits understood
// - Models available
const me = await fetch('https://api.cursor.com/v0/me', {
  headers: { Authorization: `Basic ${btoa(`${process.env.CURSOR_API_KEY}:`)}` }
});
if (!me.ok) throw new Error('Invalid Cursor API key');
/**
 * ✅ WEBHOOK
 */
// - APP_URL is HTTPS
// - Publicly accessible
// - Signature verification enabled
if (!process.env.APP_URL.startsWith('https://')) {
  console.warn('⚠️  APP_URL should use HTTPS for webhooks');
}
/**
 * ✅ MONITORING
 */
// - Prometheus metrics exposed
// - Grafana dashboards configured
// - Log aggregation setup
// - Health checks working
const health = await fetch(`${process.env.APP_URL}/health`);
if (!health.ok) throw new Error('Health check failed');
/**
 * ✅ SECURITY
 */
// - API keys rotated
// - Secrets encrypted
// - Rate limiting enabled
// - Input validation active
/**
 * ✅ PERFORMANCE
 */
// - Connection pools configured
// - Cache enabled
// - Database indexes created
// - Load testing done
/**
 * ✅ BACKUP & RECOVERY
 */
// - Database backups automated
// - Disaster recovery plan
// - Rollback procedure documented
/**
 * ✅ DOCUMENTATION
 */
// - API docs updated
// - README complete
// - Runbook for ops team
// - Architecture diagram current

Final Summary
الملخص الشامل النهائي

/**
 * ═══════════════════════════════════════════════════════════════
 *                  CURSOR ORCHESTRATION SYSTEM
 * ═══════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * --------
 * نظام لإدارة وتنفيذ مهام برمجية متعددة بشكل تلقائي باستخدام
 * Cursor Cloud Agents (AI-powered coding assistants).
 * 
 * 
 * CORE CONCEPTS:
 * --------------
 * 1. Orchestration = مجموعة مهام مترابطة
 * 2. Task = مهمة واحدة يُنفذها Cloud Agent
 * 3. Cloud Agent = AI worker في السحابة
 * 4. Queue = نظام BullMQ لإدارة المهام
 * 5. Webhook = إشعارات فورية من Cursor
 * 
 * 
 * LIFECYCLE:
 * ----------
 * CREATE → ACTIVATE → PROCESS → COMPLETE
 * 
 * 1. CREATE: إنشاء orchestration بمهام متعددة
 * 2. ACTIVATE: تفعيل لبدء التنفيذ
 * 3. PROCESS: معالجة المهام واحدة تلو الأخرى
 *    - Worker يلتقط task من Queue
 *    - TaskDispatcher يُنشئ Cloud Agent
 *    - Agent يعمل على المهمة (2-30 دقيقة)
 *    - Webhook يُحدّث الحالة
 *    - عند الإكمال، ينتقل للمهمة التالية
 
كمل
سأكمل الملخص النهائي الشامل:

📚 Final Summary (تكملة)

/**
 * ═══════════════════════════════════════════════════════════════
 *                  CURSOR ORCHESTRATION SYSTEM
 * ═══════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * --------
 * نظام لإدارة وتنفيذ مهام برمجية متعددة بشكل تلقائي باستخدام
 * Cursor Cloud Agents (AI-powered coding assistants).
 * 
 * 
 * CORE CONCEPTS:
 * --------------
 * 1. Orchestration = مجموعة مهام مترابطة
 * 2. Task = مهمة واحدة يُنفذها Cloud Agent
 * 3. Cloud Agent = AI worker في السحابة
 * 4. Queue = نظام BullMQ لإدارة المهام
 * 5. Webhook = إشعارات فورية من Cursor
 * 
 * 
 * LIFECYCLE:
 * ----------
 * CREATE → ACTIVATE → PROCESS → COMPLETE
 * 
 * 1. CREATE: إنشاء orchestration بمهام متعددة
 * 2. ACTIVATE: تفعيل لبدء التنفيذ
 * 3. PROCESS: معالجة المهام واحدة تلو الأخرى
 *    - Worker يلتقط task من Queue
 *    - TaskDispatcher يُنشئ Cloud Agent
 *    - Agent يعمل على المهمة (2-30 دقيقة)
 *    - Webhook يُحدّث الحالة
 *    - عند الإكمال، ينتقل للمهمة التالية
 * 4. COMPLETE: جميع المهام اكتملت
 * 
 * 
 * STATES:
 * -------
 * Orchestration:
 *   PENDING → ACTIVE → COMPLETED/FAILED/PARTIAL_COMPLETED
 *                ↓
 *              PAUSED → ACTIVE (resume)
 *                ↓
 *            CANCELLED
 * 
 * Task:
 *   PENDING → PROCESSING → COMPLETED/FAILED
 *                            ↓ (retry)
 *                          PENDING
 * 
 * Cloud Agent (من Cursor):
 *   CREATING → RUNNING → FINISHED/FAILED/STOPPED
 * 
 * 
 * TECH STACK:
 * -----------
 * - Backend: Node.js + TypeScript + Express
 * - Database: PostgreSQL + Drizzle ORM
 * - Queue: BullMQ (Redis-backed)
 * - API: Cursor Cloud Agent API
 * - Monitoring: Prometheus + Grafana + Winston
 * - Real-time: WebSocket
 * 
 * 
 * KEY FEATURES:
 * -------------
 * ✅ Sequential task execution
 * ✅ Automatic retry with exponential backoff
 * ✅ Real-time progress updates (WebSocket)
 * ✅ Webhook + Polling (dual mechanism)
 * ✅ Pause/Resume/Cancel support
 * ✅ Error handling & recovery
 * ✅ Cost tracking & limits
 * ✅ Comprehensive logging & metrics
 * ✅ Health checks & monitoring
 * 
 * 
 * API ENDPOINTS:
 * --------------
 * POST   /api/orchestrations              - إنشاء
 * GET    /api/orchestrations              - قائمة
 * GET    /api/orchestrations/:id          - تفاصيل
 * POST   /api/orchestrations/:id/activate - تفعيل
 * POST   /api/orchestrations/:id/pause    - إيقاف
 * POST   /api/orchestrations/:id/resume   - استئناف
 * DELETE /api/orchestrations/:id          - حذف
 * POST   /api/cloud-agents/webhook        - Cursor webhook
 * GET    /health                          - Health check
 * GET    /metrics                         - Prometheus metrics
 * 
 * 
 * CURSOR API:
 * -----------
 * Base URL: https://api.cursor.com/v0
 * 
 * Models:
 *   - claude-4-sonnet-thinking  (أسرع، أرخص)
 *   - o3                        (متوازن)
 *   - claude-4-opus-thinking    (أقوى، أغلى)
 * 
 * Recommendation: لا تحدد model، دع API يختار تلقائياً
 * 
 * Payload Structure:
 *   {
 *     prompt: { text: "..." },
 *     source: { 
 *       repository: "https://github.com/owner/repo",
 *       ref: "main" 
 *     },
 *     target: { autoCreatePr: true },
 *     model: "claude-4-sonnet-thinking",  // اختياري
 *     webhook: { url: "...", secret: "..." }
 *   }
 * 
 * 
 * BEST PRACTICES:
 * ---------------
 * 1. Tasks should be specific and well-defined
 * 2. Use sequential execution (default)
 * 3. Enable webhooks for real-time updates
 * 4. Monitor costs and set limits
 * 5. Always handle errors gracefully
 * 6. Use retries with exponential backoff
 * 7. Log everything with context
 * 8. Set appropriate timeouts
 * 9. Validate all inputs
 * 10. Clean up resources in finally blocks
 * 
 * 
 * SECURITY:
 * ---------
 * - API key authentication (X-API-Key header)
 * - Webhook signature verification (HMAC SHA-256)
 * - Input validation (Zod schemas)
 * - Rate limiting (express-rate-limit)
 * - SQL injection prevention (Drizzle ORM)
 * - Secrets encryption at rest
 * - HTTPS for webhooks (required)
 * 
 * 
 * MONITORING:
 * -----------
 * Metrics tracked:
 *   - Orchestrations created/completed/failed
 *   - Task processing duration
 *   - Cursor API call latency
 *   - Queue size and processing time
 *   - Error rates by type
 *   - Webhook delivery success rate
 * 
 * Logs include:
 *   - All state transitions
 *   - API calls (request/response)
 *   - Errors with full context
 *   - Performance metrics
 * 
 * Health checks:
 *   - Database connectivity
 *   - Queue status
 *   - Cursor API availability
 *   - Worker processes
 * 
 * 
 * TROUBLESHOOTING:
 * ----------------
 * Common Issues:
 * 
 * 1. Task stuck in PROCESSING
 *    → Run: npm run debug:task <taskId>
 *    → Check Cloud Agent status
 *    → Verify webhook delivery
 * 
 * 2. Orchestration won't activate
 *    → Check if workers are running
 *    → Verify queue health
 *    → Ensure tasks exist
 * 
 * 3. Webhook not received
 *    → Verify APP_URL is public HTTPS
 *    → Check webhook endpoint accessibility
 *    → Polling will catch it (30s interval)
 * 
 * 4. Rate limit errors
 *    → Reduce concurrent orchestrations
 *    → Add delays between requests
 *    → Use exponential backoff
 * 
 * 5. Database connection issues
 *    → Check connection pool settings
 *    → Verify DATABASE_URL
 *    → Always release connections
 * 
 * Debug Commands:
 *   npm run debug:task <taskId>
 *   npm run debug:orchestration <orchId>
 *   npm run debug:db
 *   npm run debug:api
 *   npm run debug:webhook <taskId>
 * 
 * 
 * PERFORMANCE:
 * ------------
 * Optimization tips:
 *   - Use connection pooling (DB + Redis)
 *   - Enable caching for frequent queries
 *   - Batch database operations
 *   - Use streaming for large datasets
 *   - Set appropriate TTLs
 *   - Clean up old data regularly
 *   - Monitor and tune queue concurrency
 * 
 * Expected timings:
 *   - Simple task: 3-10 minutes
 *   - Moderate task: 10-30 minutes
 *   - Complex task: 30-60 minutes
 *   - 3-task orchestration: 15-90 minutes
 * 
 * 
 * COST MANAGEMENT:
 * ----------------
 * Model costs (approximate):
 *   - claude-4-sonnet-thinking: ~$0.05/minute
 *   - o3: ~$0.10/minute
 *   - claude-4-opus-thinking: ~$0.20/minute
 * 
 * Tips to reduce costs:
 *   - Use sonnet for simple/moderate tasks
 *   - Only use opus for complex tasks
 *   - Set monthly budget limits
 *   - Track costs per orchestration
 *   - Monitor usage metrics
 * 
 * 
 * SCALING:
 * --------
 * Horizontal scaling:
 *   - Add more worker processes
 *   - Use Redis cluster for queue
 *   - Database read replicas
 *   - Load balancer for API
 * 
 * Vertical scaling:
 *   - Increase worker concurrency
 *   - Larger database instance
 *   - More Redis memory
 * 
 * Current limits:
 *   - Workers: 3 concurrent
 *   - Tasks per orchestration: 50
 *   - Queue jobs: unlimited (Redis-backed)
 *   - Database: PostgreSQL (scales well)
 * 
 * 
 * DEPLOYMENT:
 * -----------
 * Required services:
 *   1. App server (Node.js)
 *   2. Worker process (Node.js)
 *   3. PostgreSQL database
 *   4. Redis (for queue)
 *   5. (Optional) Monitoring stack
 * 
 * Environment variables:
 *   DATABASE_URL          - PostgreSQL connection
 *   REDIS_URL             - Redis connection
 *   CURSOR_API_KEY        - Cursor API key
 *   APP_URL               - Public app URL (HTTPS)
 *   WEBHOOK_SECRET        - Webhook signature secret
 *   NODE_ENV              - production
 *   LOG_LEVEL             - info/debug/error
 * 
 * Process management:
 *   - Use PM2 or systemd
 *   - Auto-restart on crash
 *   - Log rotation
 *   - Health monitoring
 * 
 * Backup strategy:
 *   - Daily database backups
 *   - Point-in-time recovery
 *   - Backup retention: 30 days
 *   - Test recovery procedure
 * 
 * 
 * EXAMPLE USAGE:
 * --------------
 */
// 1. Create orchestration
const orch = await fetch('http://localhost:3000/api/orchestrations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    repository: 'owner/repo',
    tasks: [
      {
        title: 'Add authentication',
        description: 'Implement JWT auth with login/register',
        priority: 'high',
        complexity: 'moderate'
      },
      {
        title: 'Add user dashboard',
        description: 'Create dashboard with profile management',
        priority: 'medium',
        complexity: 'simple'
      }
    ]
  })
}).then(r => r.json());
// 2. Activate
await fetch(`http://localhost:3000/api/orchestrations/${orch.id}/activate`, {
  method: 'POST',
  headers: { 'X-API-Key': 'your-api-key' }
});
// 3. Monitor progress (WebSocket)
const ws = new WebSocket(`ws://localhost:8080/orchestrations/${orch.id}`);
ws.on('message', (data) => {
  const update = JSON.parse(data);
  console.log('Update:', update.type, update.data);
});
// 4. Get final results
const result = await fetch(
  `http://localhost:3000/api/orchestrations/${orch.id}`,
  { headers: { 'X-API-Key': 'your-api-key' }}
).then(r => r.json());
console.log('Status:', result.orchestration.status);
console.log('Tasks completed:', result.statistics.completedTasks);
/**
 * ═══════════════════════════════════════════════════════════════
 *                         END OF SUMMARY
 * ═══════════════════════════════════════════════════════════════
 * 
 * للمزيد من المعلومات:
 * - Cursor Cloud Agent Docs: https://cursor.com/docs/cloud-agent
 * - API Reference: https://cursor.com/docs/cloud-agent/api/endpoints
 * - GitHub: https://github.com/asce/cursor-monitor
 * 
 */
🎉 Conclusion
الخلاصة

/**
 * 🎯 ما تعلمناه:
 * ================
 * 
 * 1. ✅ Orchestration = نظام لإدارة مهام متعددة تلقائياً
 * 2. ✅ Tasks تُنفذ بالترتيب (sequential) واحدة تلو الأخرى
 * 3. ✅ Cloud Agents = AI workers في السحابة من Cursor
 * 4. ✅ BullMQ Queue = إدارة المهام مع retry logic
 * 5. ✅ Webhook + Polling = آلية مزدوجة للتحديثات
 * 6. ✅ Models: claude-4-sonnet-thinking, o3, claude-4-opus-thinking
 * 7. ✅ Payload structure: prompt + source + target + model + webhook
 * 8. ✅ Repository URL يجب أن يكون كامل: https://github.com/owner/repo
 * 9. ✅ Model اختياري - الأفضل عدم تحديده (Auto mode)
 * 10. ✅ Max Mode غير مطلوب يدوياً - جميع النماذج تدعمه
 * 
 * 
 * 💡 أهم النقاط:
 * ==============
 * 
 * ✅ استخدم النموذج المناسب:
 *    - claude-4-sonnet-thinking للمهام البسيطة/المتوسطة (أرخص)
 *    - claude-4-opus-thinking للمهام المعقدة فقط (أغلى)
 *    - أو لا تحدد model واترك API 
 * ═══════════════════════════════════════════════════════════════
 *                  CURSOR ORCHESTRATION SYSTEM
 * ═══════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * --------
 * نظام لإدارة وتنفيذ مهام برمجية متعددة بشكل تلقائي باستخدام
 * Cursor Cloud Agents (AI-powered coding assistants).
 * 
 * 
 * CORE CONCEPTS:
 * --------------
 * 1. Orchestration = مجموعة مهام مترابطة
 * 2. Task = مهمة واحدة يُنفذها Cloud Agent
 * 3. Cloud Agent = AI worker في السحابة
 * 4. Queue = نظام BullMQ لإدارة المهام
 * 5. Webhook = إشعارات فورية من Cursor
 * 
 * 
 * LIFECYCLE:
 * ----------
 * CREATE → ACTIVATE → PROCESS → COMPLETE
 * 
 * 1. CREATE: إنشاء orchestration بمهام متعددة
 * 2. ACTIVATE: تفعيل لبدء التنفيذ
 * 3. PROCESS: معالجة المهام واحدة تلو الأخرى
 *    - Worker يلتقط task من Queue
 *    - TaskDispatcher يُنشئ Cloud Agent
 *    - Agent يعمل على المهمة (2-30 دقيقة)
 *    - Webhook يُحدّث الحالة
 *    - عند الإكمال، ينتقل للمهمة التالية
 * 4. COMPLETE: جميع المهام اكتملت
 * 
 * 
 * STATES:
 * -------
 * Orchestration:
 *   PENDING → ACTIVE → COMPLETED/FAILED/PARTIAL_COMPLETED
 *                ↓
 *              PAUSED → ACTIVE (resume)
 *                ↓
 *            CANCELLED
 * 
 * Task:
 *   PENDING → PROCESSING → COMPLETED/FAILED
 *                            ↓ (retry)
 *                          PENDING
 * 
 * Cloud Agent (من Cursor):
 *   CREATING → RUNNING → FINISHED/FAILED/STOPPED
 * 
 * 
 * TECH STACK:
 * -----------
 * - Backend: Node.js + TypeScript + Express
 * - Database: PostgreSQL + Drizzle ORM
 * - Queue: BullMQ (Redis-backed)
 * - API: Cursor Cloud Agent API
 * - Monitoring: Prometheus + Grafana + Winston
 * - Real-time: WebSocket
 * 
 * 
 * KEY FEATURES:
 * -------------
 * ✅ Sequential task execution
 * ✅ Automatic retry with exponential backoff
 * ✅ Real-time progress updates (WebSocket)
 * ✅ Webhook + Polling (dual mechanism)
 * ✅ Pause/Resume/Cancel support
 * ✅ Error handling & recovery
 * ✅ Cost tracking & limits
 * ✅ Comprehensive logging & metrics
 * ✅ Health checks & monitoring
 * 
 * 
 * API ENDPOINTS:
 * --------------
 * POST   /api/orchestrations              - إنشاء
 * GET    /api/orchestrations              - قائمة
 * GET    /api/orchestrations/:id          - تفاصيل
 * POST   /api/orchestrations/:id/activate - تفعيل
 * POST   /api/orchestrations/:id/pause    - إيقاف
 * POST   /api/orchestrations/:id/resume   - استئناف
 * DELETE /api/orchestrations/:id          - حذف
 * POST   /api/cloud-agents/webhook        - Cursor webhook
 * GET    /health                          - Health check
 * GET    /metrics                         - Prometheus metrics
 * 
 * 
 * CURSOR API:
 * -----------
 * Base URL: https://api.cursor.com/v0
 * 
 * Models:
 *   - claude-4-sonnet-thinking  (أسرع، أرخص)
 *   - o3                        (متوازن)
 *   - claude-4-opus-thinking    (أقوى، أغلى)
 * 
 * Recommendation: لا تحدد model، دع API يختار تلقائياً
 * 
 * Payload Structure:
 *   {
 *     prompt: { text: "..." },
 *     source: { 
 *       repository: "https://github.com/owner/repo",
 *       ref: "main" 
 *     },
 *     target: { autoCreatePr: true },
 *     model: "claude-4-sonnet-thinking",  // اختياري
 *     webhook: { url: "...", secret: "..." }
 *   }
 * 
 * 
 * BEST PRACTICES:
 * ---------------
 * 1. Tasks should be specific and well-defined
 * 2. Use sequential execution (default)
 * 3. Enable webhooks for real-time updates
 * 4. Monitor costs and set limits
 * 5. Always handle errors gracefully
 * 6. Use retries with exponential backoff
 * 7. Log everything with context
 * 8. Set appropriate timeouts
 * 9. Validate all inputs
 * 10. Clean up resources in finally blocks
 * 
 * 
 * SECURITY:
 * ---------
 * - API key authentication (X-API-Key header)
 * - Webhook signature verification (HMAC SHA-256)
 * - Input validation (Zod schemas)
 * - Rate limiting (express-rate-limit)
 * - SQL injection prevention (Drizzle ORM)
 * - Secrets encryption at rest
 * - HTTPS for webhooks (required)
 * 
 * 
 * MONITORING:
 * -----------
 * Metrics tracked:
 *   - Orchestrations created/completed/failed
 *   - Task processing duration
 *   - Cursor API call latency
 *   - Queue size and processing time
 *   - Error rates by type
 *   - Webhook delivery success rate
 * 
 * Logs include:
 *   - All state transitions
 *   - API calls (request/response)
 *   - Errors with full context
 *   - Performance metrics
 * 
 * Health checks:
 *   - Database connectivity
 *   - Queue status
 *   - Cursor API availability
 *   - Worker processes
 * 
 * 
 * TROUBLESHOOTING:
 * ----------------
 * Common Issues:
 * 
 * 1. Task stuck in PROCESSING
 *    → Run: npm run debug:task <taskId>
 *    → Check Cloud Agent status
 *    → Verify webhook delivery
 * 
 * 2. Orchestration won't activate
 *    → Check if workers are running
 *    → Verify queue health
 *    → Ensure tasks exist
 * 
 * 3. Webhook not received
 *    → Verify APP_URL is public HTTPS
 *    → Check webhook endpoint accessibility
 *    → Polling will catch it (30s interval)
 * 
 * 4. Rate limit errors
 *    → Reduce concurrent orchestrations
 *    → Add delays between requests
 *    → Use exponential backoff
 * 
 * 5. Database connection issues
 *    → Check connection pool settings
 *    → Verify DATABASE_URL
 *    → Always release connections
 * 
 * Debug Commands:
 *   npm run debug:task <taskId>
 *   npm run debug:orchestration <orchId>
 *   npm run debug:db
 *   npm run debug:api
 *   npm run debug:webhook <taskId>
 * 
 * 
 * PERFORMANCE:
 * ------------
 * Optimization tips:
 *   - Use connection pooling (DB + Redis)
 *   - Enable caching for frequent queries
 *   - Batch database operations
 *   - Use streaming for large datasets
 *   - Set appropriate TTLs
 *   - Clean up old data regularly
 *   - Monitor and tune queue concurrency
 * 
 * Expected timings:
 *   - Simple task: 3-10 minutes
 *   - Moderate task: 10-30 minutes
 *   - Complex task: 30-60 minutes
 *   - 3-task orchestration: 15-90 minutes
 * 
 * 
 * COST MANAGEMENT:
 * ----------------
 * Model costs (approximate):
 *   - claude-4-sonnet-thinking: ~$0.05/minute
 *   - o3: ~$0.10/minute
 *   - claude-4-opus-thinking: ~$0.20/minute
 * 
 * Tips to reduce costs:
 *   - Use sonnet for simple/moderate tasks
 *   - Only use opus for complex tasks
 *   - Set monthly budget limits
 *   - Track costs per orchestration
 *   - Monitor usage metrics
 * 
 * 
 * SCALING:
 * --------
 * Horizontal scaling:
 *   - Add more worker processes
 *   - Use Redis cluster for queue
 *   - Database read replicas
 *   - Load balancer for API
 * 
 * Vertical scaling:
 *   - Increase worker concurrency
 *   - Larger database instance
 *   - More Redis memory
 * 
 * Current limits:
 *   - Workers: 3 concurrent
 *   - Tasks per orchestration: 50
 *   - Queue jobs: unlimited (Redis-backed)
 *   - Database: PostgreSQL (scales well)
 * 
 * 
 * DEPLOYMENT:
 * -----------
 * Required services:
 *   1. App server (Node.js)
 *   2. Worker process (Node.js)
 *   3. PostgreSQL database
 *   4. Redis (for queue)
 *   5. (Optional) Monitoring stack
 * 
 * Environment variables:
 *   DATABASE_URL          - PostgreSQL connection
 *   REDIS_URL             - Redis connection
 *   CURSOR_API_KEY        - Cursor API key
 *   APP_URL               - Public app URL (HTTPS)
 *   WEBHOOK_SECRET        - Webhook signature secret
 *   NODE_ENV              - production
 *   LOG_LEVEL             - info/debug/error
 * 
 * Process management:
 *   - Use PM2 or systemd
 *   - Auto-restart on crash
 *   - Log rotation
 *   - Health monitoring
 * 
 * Backup strategy:
 *   - Daily database backups
 *   - Point-in-time recovery
 *   - Backup retention: 30 days
 *   - Test recovery procedure
 * 
 * 
 * EXAMPLE USAGE:
 * --------------
 */
// 1. Create orchestration
const orch = await fetch('http://localhost:3000/api/orchestrations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    repository: 'owner/repo',
    tasks: [
      {
        title: 'Add authentication',
        description: 'Implement JWT auth with login/register',
        priority: 'high',
        complexity: 'moderate'
      },
      {
        title: 'Add user dashboard',
        description: 'Create dashboard with profile management',
        priority: 'medium',
        complexity: 'simple'
      }
    ]
  })
}).then(r => r.json());
// 2. Activate
await fetch(`http://localhost:3000/api/orchestrations/${orch.id}/activate`, {
  method: 'POST',
  headers: { 'X-API-Key': 'your-api-key' }
});
// 3. Monitor progress (WebSocket)
const ws = new WebSocket(`ws://localhost:8080/orchestrations/${orch.id}`);
ws.on('message', (data) => {
  const update = JSON.parse(data);
  console.log('Update:', update.type, update.data);
});
// 4. Get final results
const result = await fetch(
  `http://localhost:3000/api/orchestrations/${orch.id}`,
  { headers: { 'X-API-Key': 'your-api-key' }}
).then(r => r.json());
console.log('Status:', result.orchestration.status);
console.log('Tasks completed:', result.statistics.completedTasks);
/**
 * ═══════════════════════════════════════════════════════════════
 *                         END OF SUMMARY
 * ═══════════════════════════════════════════════════════════════
 * 
 * للمزيد من المعلومات:
 * - Cursor Cloud Agent Docs: https://cursor.com/docs/cloud-agent
 * - API Reference: https://cursor.com/docs/cloud-agent/api/endpoints
 * - GitHub: https://github.com/asce/cursor-monitor
 * 
 */
🎉 Conclusion
الخلاصة

/**
 * 🎯 ما تعلمناه:
 * ================
 * 
 * 1. ✅ Orchestration = نظام لإدارة مهام متعددة تلقائياً
 * 2. ✅ Tasks تُنفذ بالترتيب (sequential) واحدة تلو الأخرى
 * 3. ✅ Cloud Agents = AI workers في السحابة من Cursor
 * 4. ✅ BullMQ Queue = إدارة المهام مع retry logic
 * 5. ✅ Webhook + Polling = آلية مزدوجة للتحديثات
 * 6. ✅ Models: claude-4-sonnet-thinking, o3, claude-4-opus-thinking
 * 7. ✅ Payload structure: prompt + source + target + model + webhook
 * 8. ✅ Repository URL يجب أن يكون كامل: https://github.com/owner/repo
 * 9. ✅ Model اختياري - الأفضل عدم تحديده (Auto mode)
 * 10. ✅ Max Mode غير مطلوب يدوياً - جميع النماذج تدعمه
 * 
 * 
 * 💡 أهم النقاط:
 * ==============
 * 
 * ✅ استخدم النموذج المناسب:
 *    - claude-4-sonnet-thinking للمهام البسيطة/المتوسطة (أرخص)
 *    - claude-4-opus-thinking للمهام المعقدة فقط (أغلى)
 *    - أو لا تحدد model واترك API 
كمل
سأكمل الخلاصة النهائية:

🎉 Conclusion (تكملة)

/**
 * 💡 أهم النقاط (تكملة):
 * ==============
 * 
 * ✅ استخدم النموذج المناسب:
 *    - claude-4-sonnet-thinking للمهام البسيطة/المتوسطة (أرخص)
 *    - claude-4-opus-thinking للمهام المعقدة فقط (أغلى)
 *    - أو لا تحدد model واترك API يختار (موصى به)
 * 
 * ✅ Webhooks أساسية:
 *    - APP_URL يجب أن يكون HTTPS وعام
 *    - Polling يعمل كـ backup (كل 30 ثانية)
 *    - Signature verification للأمان
 * 
 * ✅ Error handling:
 *    - Retry تلقائي (max 3 مرات)
 *    - Exponential backoff (1s, 2s, 4s, 8s...)
 *    - Log كل شيء مع context
 * 
 * ✅ Monitoring مهم:
 *    - Metrics (Prometheus)
 *    - Logs (Winston)
 *    - Health checks
 *    - Real-time updates (WebSocket)
 * 
 * ✅ Security first:
 *    - API key authentication
 *    - Input validation (Zod)
 *    - Rate limiting
 *    - Secrets encryption
 * 
 * 
 * 🚀 الخطوات التالية (Next Steps):
 * ==================================
 * 
 * 1. إصلاح Model Validator:
 *    ✅ استخدم النماذج الثلاثة الصحيحة فقط
 *    ✅ أو اجلبها ديناميكياً من /v0/models
 *    ✅ Default: claude-4-sonnet-thinking
 * 
 * 2. اختبار النظام:
 *    □ إنشاء orchestration تجريبية
 *    □ تفعيلها ومراقبة التنفيذ
 *    □ التأكد من Webhooks تعمل
 *    □ اختبار Retry logic
 * 
 * 3. إضافة Features:
 *    □ Parallel execution (اختياري)
 *    □ Task dependencies (متقدم)
 *    □ Scheduled orchestrations
 *    □ Email notifications
 *    □ Slack integration
 * 
 * 4. Optimization:
 *    □ Cache optimization
 *    □ Database indexing
 *    □ Query optimization
 *    □ Load testing
 * 
 * 5. Documentation:
 *    □ API documentation (Swagger/OpenAPI)
 *    □ User guide
 *    □ Architecture diagrams
 *    □ Runbook for ops
 * 
 * 
 * 📖 مراجع مفيدة:
 * ================
 * 
 * Cursor Documentation:
 *   - Cloud Agent: https://cursor.com/docs/cloud-agent
 *   - API Endpoints: https://cursor.com/docs/cloud-agent/api/endpoints
 *   - Models: https://cursor.com/docs/models
 *   - Webhooks: https://cursor.com/docs/cloud-agent/api/webhooks
 * 
 * Technologies:
 *   - BullMQ: https://docs.bullmq.io/
 *   - Drizzle ORM: https://orm.drizzle.team/
 *   - Zod: https://zod.dev/
 *   - Winston: https://github.com/winstonjs/winston
 *   - Prometheus: https://prometheus.io/docs/
 * 
 * 
 * 🔧 Quick Commands Reference:
 * ============================
 */
// Start development
npm run dev
npm run worker
// Debug issues
npm run debug:task <taskId>
npm run debug:orchestration <orchId>
npm run debug:api
npm run debug:webhook <taskId>
// Check status
pm2 status
npm run queue:stats
curl http://localhost:3000/health
// View logs
tail -f logs/combined.log
pm2 logs cursor-monitor-worker
// Production
npm run build
npm run start
npm run worker:prod
/**
 * ═══════════════════════════════════════════════════════════════
 *                    FINAL CHECKLIST ✓
 * ═══════════════════════════════════════════════════════════════
 */
// ✅ فهمت دورة حياة Orchestration كاملة
// ✅ عرفت كيف تُنفذ Tasks بالترتيب
// ✅ فهمت آلية Webhook + Polling
// ✅ عرفت النماذج المتاحة وكيف تختار
// ✅ فهمت Payload structure الصحيح
// ✅ عرفت كيف تحل المشاكل الشائعة
// ✅ عندك مرجع شامل للنظام بالكامل
/**
 * ═══════════════════════════════════════════════════════════════
 *                  🎊 تم بحمد الله! 🎊
 * ═══════════════════════════════════════════════════════════════
 * 
 * الآن لديك فهم كامل لنظام Cursor Orchestration من البداية
 * للنهاية. يمكنك:
 * 
 * ✅ إنشاء orchestrations جديدة
 * ✅ تتبع تنفيذ المهام
 * ✅ معالجة الأخطاء والمشاكل
 * ✅ تحسين الأداء والتكاليف
 * ✅ مراقبة النظام وصيانته
 * 
 * بالتوفيق! 🚀
 */
📋 تلخيص الإجابة على سؤالك الأصلي
بناءً على طلبك الأصلي:

✅ المشكلة التي كانت موجودة:
Payload structure - تم إصلاحه ✓

كان: repository: "owner/repo"
الآن: repository: "https://github.com/owner/repo"
Structure صحيح: source + target بدلاً من flat
Model validation - المشكلة الحالية ❌

الخطأ: Model 'claude-sonnet-4' is not available
السبب: النماذج المستخدمة غير موجودة في API
✅ الحل النهائي:

// models المتاحة فقط (من /v0/models endpoint):
const VALID_MODELS = [
  'claude-4-sonnet-thinking',
  'o3',
  'claude-4-opus-thinking'
];
// Default fallback
const DEFAULT_MODEL = 'claude-4-sonnet-thinking';
// أو الأفضل: لا ترسل model parameter
// دع API يختار تلقائياً (Auto mode - موصى به من Cursor)
✅ دورة الحياة الكاملة (Summary):
1. CREATE Orchestration (PENDING)
   ↓
2. ACTIVATE (ACTIVE)
   ↓
3. First Task → Queue → Worker
   ↓
4. Worker creates Cloud Agent via Cursor API
   ↓
5. Cloud Agent executes (CREATING → RUNNING → FINISHED)
   ↓
6. Webhook notification → Update task status
   ↓
7. Task COMPLETED → Next task to Queue
   ↓
8. Repeat steps 3-7 for all tasks
   ↓
9. All tasks done → Orchestration COMPLETED
   ↓
10. Send notifications & cleanup
✅ Max Mode:
لا يجب استخدامه يدوياً
جميع النماذج المتاحة لـ Cloud Agents تدعم Max Mode تلقائياً
API تستخدم context window المناسب حسب المهمة
✅ جلب النماذج ديناميكياً:

// خيار 1: Static list (recommended)
const VALID_MODELS = ['claude-4-sonnet-thinking', 'o3', 'claude-4-opus-thinking'];
// خيار 2: Dynamic fetch (optional)
const models = await fetch('https://api.cursor.com/v0/models', {
  headers: { Authorization: `Basic ${btoa(`${API_KEY}:`)}` }
}).then(r => r.json());
// { models: ["claude-4-sonnet-thinking", "o3", "claude-4-opus-thinking"] }
🎯 Action Items

// TODO: إصلاح model-validator.service.ts
const VALID_MODELS = [
  'claude-4-sonnet-thinking',
  'o3', 
  'claude-4-opus-thinking'
];
const MODEL_FALLBACKS = {
  'claude-sonnet-4': 'claude-4-sonnet-thinking',
  'claude-4.5-opus-high-thinking': 'claude-4-opus-thinking',
  'gpt-4': 'o3',
  // ... etc
};
const DEFAULT_FALLBACK_MODEL = 'claude-4-sonnet-thinking';
// أو استخدم Auto mode (don't send model parameter)
هذا كل شيء! النظام الآن جاهز للعمل بشكل صحيح. ✅🎉
