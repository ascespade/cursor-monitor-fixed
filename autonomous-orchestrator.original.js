/**
 * Autonomous Cursor Orchestrator - Original Version
 * 
 * نظام ذكي مستقل لإدارة Cursor Cloud Agents
 * يستخدم Express server + SQLite + Cursor CLI/API للتحليل
 */

const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const crypto = require('crypto');
const app = express();

app.use(express.json());

// ═══════════════════════════════════════════════
// 🎯 الفكرة الأساسية
// ═══════════════════════════════════════════════
// 1. Cloud Agent يشتغل ويوقف
// 2. Webhook يستدعي Orchestrator
// 3. Orchestrator يحلل المحادثة باستخدام Cursor Agent محلي
// 4. يقرر: كمل / توقف / أصلح
// 5. يرسل Follow-up تلقائياً
// ═══════════════════════════════════════════════

const CURSOR_API_KEY = process.env.CURSOR_API_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const API_BASE_URL = 'https://api.cursor.com/v0';
const PROJECT_PATH = process.env.PROJECT_PATH || process.cwd();

// ═══════════════════════════════════════════════
// 🌐 Webhook Endpoint
// ═══════════════════════════════════════════════
app.post('/webhook/cursor', async (req, res) => {
  const { id, status } = req.body;
  
  console.log(`📨 Webhook: Agent ${id} - ${status}`);
  
  // التحقق من التوقيع
  const signature = req.headers['x-webhook-signature'];
  if (!verifyWebhookSignature(WEBHOOK_SECRET, JSON.stringify(req.body), signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // الرد السريع
  res.status(200).json({ received: true });
  
  // المعالجة في الخلفية
  if (status === 'FINISHED') {
    analyzeAndDecide(id).catch(console.error);
  }
});

// ═══════════════════════════════════════════════
// 🔍 التحليل واتخاذ القرار
// ═══════════════════════════════════════════════
async function analyzeAndDecide(agentId) {
  try {
    console.log(`\n🔍 جاري تحليل Agent ${agentId}...`);
    
    // 1. جلب المحادثة من Cloud Agent
    const conversation = await getAgentConversation(agentId);
    
    // 2. جلب حالة Agent (ملخص)
    const agentStatus = await getAgentStatus(agentId);
    
    // 3. استخدام Cursor Agent المحلي للتحليل
    const decision = await analyzeWithLocalAgent(conversation, agentStatus);
    
    console.log(`\n💡 القرار: ${decision.action}`);
    console.log(`📝 السبب: ${decision.reasoning}`);
    
    // 4. تنفيذ القرار
    if (decision.action === 'CONTINUE') {
      console.log(`✅ إرسال Follow-up...`);
      await sendFollowup(agentId, decision.followupMessage);
      
    } else if (decision.action === 'TEST') {
      console.log(`🧪 اختبار التغييرات أولاً...`);
      const testResult = await testChangesLocally(agentId, agentStatus);
      
      if (testResult.success) {
        console.log(`✅ الاختبارات نجحت! المهمة مكتملة.`);
        await notifySuccess(agentId);
      } else {
        console.log(`❌ الاختبارات فشلت. إرسال تعليمات الإصلاح...`);
        await sendFollowup(agentId, testResult.fixInstructions);
      }
      
    } else if (decision.action === 'COMPLETE') {
      console.log(`🎉 المهمة مكتملة تماماً!`);
      await notifySuccess(agentId);
    }
    
  } catch (error) {
    console.error('❌ خطأ في التحليل:', error);
  }
}

// ═══════════════════════════════════════════════
// 🎯 الجزء الأهم: استخدام Cursor Agent المحلي
// ═══════════════════════════════════════════════
async function analyzeWithLocalAgent(conversation, agentStatus) {
  const fs = require('fs');
  const conversationFile = '/tmp/agent-conversation.json';
  
  // حفظ المحادثة في ملف مؤقت
  fs.writeFileSync(conversationFile, JSON.stringify({
    messages: conversation.messages,
    summary: agentStatus.summary,
    branch: agentStatus.target?.branchName,
    prUrl: agentStatus.target?.prUrl
  }, null, 2));
  
  // Prompt للـ Agent المحلي
  const analysisPrompt = `
أنت مراقب ذكي لـ Cloud Agents. 
راجع هذه المحادثة من Cloud Agent وقرر الخطوة التالية.
المحادثة: انظر الملف ${conversationFile}

مهمتك:
1. راجع جميع الرسائل
2. افهم الهدف الأصلي من المهمة
3. حلل ما تم إنجازه
4. حدد ما المتبقي
5. قرر: هل نكمل أم نتوقف أم نختبر؟

أعطني JSON فقط بهذا الشكل:
\`\`\`json
{
  "action": "CONTINUE" | "TEST" | "COMPLETE",
  "reasoning": "شرح مفصل للقرار",
  "tasksCompleted": ["المهام المنجزة"],
  "tasksRemaining": ["المهام المتبقية"],
  "followupMessage": "الرسالة التي يجب إرسالها (إن وجدت)",
  "confidence": 0.95
}
\`\`\`

القواعد:
- إذا بقيت مهام كثيرة: CONTINUE
- إذا انتهى كل شيء ويحتاج اختبار: TEST  
- إذا اكتمل كل شيء واختُبر: COMPLETE
- كن دقيقاً ومحافظاً في قراراتك
`;
  
  try {
    // استدعاء Cursor CLI
    const command = `cursor-cli chat --prompt "${analysisPrompt.replace(/"/g, '\\"')}" --format json`;
    const { stdout } = await execPromise(command);
    
    // استخراج JSON من الناتج
    const jsonMatch = stdout.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    // fallback: محاولة parse مباشرة
    return JSON.parse(stdout);
    
  } catch (error) {
    console.error('❌ فشل استدعاء Cursor CLI:', error);
    
    // Fallback: تحليل بسيط بدون AI
    return fallbackAnalysis(conversation, agentStatus);
  }
}

// ═══════════════════════════════════════════════
// 🧪 اختبار التغييرات محلياً
// ═══════════════════════════════════════════════
async function testChangesLocally(agentId, agentStatus) {
  console.log(`\n🧪 بدء الاختبارات المحلية...`);
  
  try {
    const branchName = agentStatus.target?.branchName;
    
    if (!branchName) {
      throw new Error('لا يوجد برانش للاختبار');
    }
    
    // حفظ البرانش الحالي
    const { stdout: currentBranch } = await execPromise('git branch --show-current', { cwd: PROJECT_PATH });
    const originalBranch = currentBranch.trim();
    
    // Checkout البرانش الجديد
    console.log(`📥 جاري checkout البرانش: ${branchName}`);
    await execPromise(`git fetch origin ${branchName}`, { cwd: PROJECT_PATH });
    await execPromise(`git checkout ${branchName}`, { cwd: PROJECT_PATH });
    
    // تشغيل الاختبارات
    console.log(`🏃 تشغيل الاختبارات...`);
    
    const testCommands = [
      'npm install',
      'npm test',
      'npm run lint',
      'npm run build'
    ];
    
    const results = [];
    
    for (const cmd of testCommands) {
      try {
        const { stdout, stderr } = await execPromise(cmd, { 
          cwd: PROJECT_PATH,
          timeout: 300000
        });
        
        results.push({
          command: cmd,
          success: true,
          output: stdout
        });
        
        console.log(`✅ ${cmd}: نجح`);
        
      } catch (error) {
        results.push({
          command: cmd,
          success: false,
          error: error.message,
          output: error.stdout || error.stderr
        });
        
        console.log(`❌ ${cmd}: فشل`);
      }
    }
    
    // العودة للبرانش الأصلي
    await execPromise(`git checkout ${originalBranch}`, { cwd: PROJECT_PATH });
    
    // تحليل النتائج
    const allPassed = results.every(r => r.success);
    
    if (allPassed) {
      return { 
        success: true,
        results 
      };
    } else {
      const fixInstructions = await generateFixInstructions(results);
      
      return {
        success: false,
        results,
        fixInstructions
      };
    }
    
  } catch (error) {
    console.error('❌ خطأ في الاختبار:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function generateFixInstructions(testResults) {
  const failedTests = testResults.filter(t => !t.success);
  
  const prompt = `
لديك هذه الاختبارات الفاشلة:
${failedTests.map(t => `
الأمر: ${t.command}
الخطأ: ${t.error}
الناتج: ${t.output}
`).join('\n---\n')}

اكتب تعليمات واضحة لإصلاح هذه الأخطاء.
`;
  
  try {
    const command = `cursor-cli chat --prompt "${prompt.replace(/"/g, '\\"')}"`;
    const { stdout } = await execPromise(command);
    
    return stdout.trim();
  } catch (error) {
    return 'أصلح الأخطاء في الاختبارات الفاشلة وأعد المحاولة';
  }
}

// ═══════════════════════════════════════════════
// 📊 Fallback Analysis (بدون AI)
// ═══════════════════════════════════════════════
function fallbackAnalysis(conversation, agentStatus) {
  const messages = conversation.messages || [];
  const lastMessage = messages[messages.length - 1];
  
  if (!lastMessage) {
    return {
      action: 'COMPLETE',
      reasoning: 'No messages found',
      followupMessage: '',
      confidence: 0.3
    };
  }
  
  const text = lastMessage.text.toLowerCase();
  
  const keywords = {
    complete: ['completed', 'done', 'finished', 'اكتمل', 'انتهى', 'تم'],
    error: ['error', 'failed', 'خطأ', 'فشل'],
    waiting: ['waiting', 'pending', 'انتظار']
  };
  
  if (keywords.complete.some(k => text.includes(k))) {
    return {
      action: 'TEST',
      reasoning: 'يبدو أن المهمة اكتملت، يجب الاختبار',
      followupMessage: '',
      confidence: 0.7
    };
  }
  
  if (keywords.error.some(k => text.includes(k))) {
    return {
      action: 'CONTINUE',
      reasoning: 'هناك أخطاء تحتاج للإصلاح',
      followupMessage: 'أصلح الأخطاء المذكورة وأكمل المهمة',
      confidence: 0.8
    };
  }
  
  return {
    action: 'CONTINUE',
    reasoning: 'المهمة لم تكتمل بعد',
    followupMessage: 'استمر في المهمة حتى تكتمل جميع المتطلبات',
    confidence: 0.6
  };
}

// ═══════════════════════════════════════════════
// 🛠️ Helper Functions
// ═══════════════════════════════════════════════
async function getAgentConversation(agentId) {
  const response = await fetch(
    `${API_BASE_URL}/agents/${agentId}/conversation`,
    {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(CURSOR_API_KEY + ':').toString('base64')
      }
    }
  );
  return await response.json();
}

async function getAgentStatus(agentId) {
  const response = await fetch(
    `${API_BASE_URL}/agents/${agentId}`,
    {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(CURSOR_API_KEY + ':').toString('base64')
      }
    }
  );
  return await response.json();
}

async function sendFollowup(agentId, message) {
  const response = await fetch(
    `${API_BASE_URL}/agents/${agentId}/followup`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(CURSOR_API_KEY + ':').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: { text: message }
      })
    }
  );
  
  return await response.json();
}

function verifyWebhookSignature(secret, rawBody, signature) {
  if (!signature) return false;
  
  const expected = 'sha256=' + 
    crypto.createHmac('sha256', secret)
          .update(rawBody)
          .digest('hex');
  
  return signature === expected;
}

async function notifySuccess(agentId) {
  console.log(`🎉 Agent ${agentId} completed successfully!`);
  // يمكن إضافة Slack/Email notifications هنا
}

// ═══════════════════════════════════════════════
// 🚀 بدء السيرفر
// ═══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Autonomous Cursor Orchestrator Started!');
  console.log('='.repeat(60));
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook/cursor`);
  console.log('='.repeat(60));
  console.log(`\n⏳ Waiting for webhook events...\n`);
});

module.exports = app;


