#!/usr/bin/env node

/**
 * Cursor Docs Chat Session
 * 
 * يفتح session مع Cursor Docs ويسأل عن pricing
 * ويبقي الـ session مفتوحة
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🚀 بدء Session مع Cursor Docs...\n');
  
  // فتح browser headless مع تحسينات
  const browser = await chromium.launch({ 
    headless: true,  // headless للعمل بدون display
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    // 1. فتح صفحة الوثائق
    console.log('📄 فتح صفحة Cursor Docs...');
    await page.goto('https://cursor.com/docs', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    console.log('✅ تم فتح الصفحة\n');
    
    // 2. انتظار تحميل الصفحة
    await page.waitForTimeout(3000);
    
    // 3. محاولة فتح الشات - استخدام اختصار لوحة المفاتيح
    console.log('⌨️  محاولة فتح الشات باستخدام ⌘I...');
    await page.keyboard.press('Meta+i');
    await page.waitForTimeout(3000);
    
    // 4. البحث عن textarea للشات
    console.log('🔍 البحث عن textarea للشات...');
    
    const textareaSelectors = [
      'textarea[aria-label*="Chat"]',
      'textarea[aria-label*="chat"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="ask"]',
      'textarea[placeholder*="question"]',
      'textarea[placeholder*="docs"]'
    ];
    
    let textarea = null;
    let foundSelector = null;
    
    for (const selector of textareaSelectors) {
      try {
        textarea = await page.$(selector);
        if (textarea) {
          foundSelector = selector;
          console.log(`✅ تم العثور على textarea: ${selector}\n`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // 5. إرسال السؤال
    const question = 'هل لو قمت بانشاء ايجنت باستخدام كيرسور api cloud حيكلفني فلوس ولا مجاني؟';
    
    if (textarea) {
      console.log('📝 كتابة السؤال في textarea...');
      await textarea.fill(question);
      await page.waitForTimeout(500);
      await textarea.press('Enter');
      console.log('✅ تم إرسال السؤال\n');
    } else {
      // استخدام JavaScript مباشرة
      console.log('⚠️  لم يتم العثور على textarea، محاولة استخدام JavaScript...\n');
      
      const sent = await page.evaluate((q) => {
        // البحث عن textarea
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const chatTextarea = textareas.find(t => {
          const placeholder = t.placeholder?.toLowerCase() || '';
          const ariaLabel = t.getAttribute('aria-label')?.toLowerCase() || '';
          return placeholder.includes('ask') || 
                 placeholder.includes('question') || 
                 placeholder.includes('chat') ||
                 ariaLabel.includes('chat');
        }) || textareas[textareas.length - 1];
        
        if (chatTextarea) {
          chatTextarea.focus();
          chatTextarea.value = q;
          
          // Trigger events
          chatTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          chatTextarea.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Press Enter
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          chatTextarea.dispatchEvent(enterEvent);
          
          return true;
        }
        return false;
      }, question);
      
      if (sent) {
        console.log('✅ تم إرسال السؤال عبر JavaScript\n');
      } else {
        console.log('❌ فشل إرسال السؤال\n');
      }
    }
    
    // 6. انتظار الرد
    console.log('⏳ انتظار الرد من Cursor...');
    console.log('   (قد يستغرق 10-30 ثانية)\n');
    
    // انتظار ظهور الرد (محاولات متعددة)
    let response = null;
    let attempts = 0;
    const maxAttempts = 20; // زيادة المحاولات
    
    while (!response && attempts < maxAttempts) {
      await page.waitForTimeout(5000); // زيادة وقت الانتظار
      attempts++;
      
      console.log(`   محاولة ${attempts}/${maxAttempts}...`);
      
      response = await page.evaluate(() => {
        // طريقة 1: البحث عن عناصر الرد (تجاهل JSON و React internals)
        const selectors = [
          '.message-content',
          '[data-message]',
          '.chat-message',
          '.response',
          '.answer',
          'div[class*="message"]',
          'div[class*="response"]',
          'div[class*="answer"]',
          '[role="log"] > div',
          '[class*="Chat"] > div',
          'div[class*="chat"] > div',
          'p', 'div', 'span'
        ];
        
        for (const selector of selectors) {
          try {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              // البحث عن آخر عنصر يحتوي على نص طويل (الرد)
              for (let i = elements.length - 1; i >= 0; i--) {
                const text = elements[i].textContent || elements[i].innerText;
                // تجاهل JSON و React internals
                if (text && 
                    text.length > 100 && 
                    !text.includes('هل لو قمت') &&
                    !text.includes('__next_f') &&
                    !text.includes('$L') &&
                    !text.startsWith('self.') &&
                    !text.includes('"filePath"') &&
                    !text.includes('mdxFiles')) {
                  return text.trim();
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        // طريقة 2: البحث في كل النصوص بعد السؤال (تجاهل JSON)
        const allText = document.body.innerText || document.body.textContent;
        const questionIndex = allText.indexOf('هل لو قمت بانشاء ايجنت');
        if (questionIndex > -1) {
          const afterQuestion = allText.substring(questionIndex + 150);
          // تنظيف النص من JSON
          const cleanText = afterQuestion
            .split('\n')
            .filter(l => {
              const line = l.trim();
              return line.length > 30 && 
                     !line.includes('__next_f') &&
                     !line.includes('$L') &&
                     !line.startsWith('self.') &&
                     !line.includes('"filePath"');
            });
          
          if (cleanText.length > 0) {
            // أخذ أول 15 سطر نظيف
            return cleanText.slice(0, 15).join('\n').trim();
          }
        }
        
        // طريقة 3: البحث عن أي نص يحتوي على كلمات مفتاحية (تجاهل JSON)
        const keywords = ['free', 'cost', 'pricing', 'paid', 'مجاني', 'فلوس', 'تكلفة', 'agent', 'api'];
        const allElements = document.querySelectorAll('p, div, span, li');
        for (const el of allElements) {
          const text = el.textContent || el.innerText;
          if (text && text.length > 50) {
            const hasKeyword = keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
            const isNotJson = !text.includes('__next_f') && 
                             !text.includes('$L') && 
                             !text.startsWith('self.') &&
                             !text.includes('"filePath"');
            if (hasKeyword && !text.includes('هل لو قمت') && isNotJson) {
              return text.substring(0, 1500).trim();
            }
          }
        }
        
        return null;
      });
      
      if (response) {
        console.log('✅ تم العثور على رد!\n');
        break;
      }
    }
    
    // 7. عرض الرد
    if (response) {
      console.log('='.repeat(80));
      console.log('💬 الإجابة من Cursor:');
      console.log('='.repeat(80));
      console.log(response);
      console.log('='.repeat(80));
      console.log('\n');
    } else {
      console.log('⚠️  لم يتم العثور على رد واضح بعد');
      console.log('📸 أخذ screenshot للتحقق...\n');
      
      await page.screenshot({ 
        path: 'cursor-response.png',
        fullPage: true 
      });
      console.log('✅ تم حفظ screenshot في: cursor-response.png\n');
    }
    
    // 8. محاولة أخيرة لقراءة كل محتوى الصفحة
    if (!response) {
      console.log('\n🔄 محاولة أخيرة لقراءة كل محتوى الصفحة...\n');
      
      // انتظار إضافي
      await page.waitForTimeout(10000);
      
      const fullContent = await page.evaluate(() => {
        // محاولة قراءة كل النصوص في الصفحة
        const allText = document.body.innerText || document.body.textContent;
        
        // البحث عن السؤال
        const questionIndex = allText.indexOf('هل لو قمت');
        if (questionIndex > -1) {
          const afterQuestion = allText.substring(questionIndex);
          return afterQuestion;
        }
        
        return allText;
      });
      
      console.log('📄 محتوى الصفحة بعد السؤال:');
      console.log('='.repeat(80));
      console.log(fullContent.substring(0, 3000));
      console.log('='.repeat(80));
      
      // محاولة استخراج الرد من النص
      const lines = fullContent.split('\n');
      const questionLineIndex = lines.findIndex(l => l.includes('هل لو قمت'));
      if (questionLineIndex > -1) {
        const responseLines = lines.slice(questionLineIndex + 1).filter(l => l.trim().length > 20);
        if (responseLines.length > 0) {
          console.log('\n💬 محاولة استخراج الرد:');
          console.log('='.repeat(80));
          console.log(responseLines.slice(0, 15).join('\n'));
          console.log('='.repeat(80));
        }
      }
    }
    
    // 9. إبقاء الـ session مفتوحة
    console.log('\n🔓 الـ Session مفتوحة - المتصفح لن يُغلق');
    console.log('   اضغط Ctrl+C لإغلاق الـ session\n');
    console.log('📋 السؤال المرسل:');
    console.log(`   ${question}\n`);
    
    // انتظار غير محدد (Session مفتوحة)
    await new Promise(() => {}); // لا ينتهي أبداً
    
  } catch (error) {
    console.error('❌ خطأ:', error.message);
    console.error(error.stack);
    await page.screenshot({ path: 'error.png', fullPage: true });
    console.log('📸 تم حفظ screenshot الخطأ في: error.png');
  }
  // لا نغلق browser - Session تبقى مفتوحة
})();

