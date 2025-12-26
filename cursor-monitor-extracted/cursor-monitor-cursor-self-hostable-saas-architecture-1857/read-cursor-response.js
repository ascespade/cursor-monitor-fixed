#!/usr/bin/env node

/**
 * قراءة الرد من Cursor Docs
 * 
 * يقرأ محتوى الصفحة ويستخرج الرد
 */

const fs = require('fs');

// قراءة screenshot إذا كان موجوداً
if (fs.existsSync('cursor-response.png')) {
  console.log('📸 Screenshot موجود: cursor-response.png');
  console.log('   يمكنك فتحه لرؤية الصفحة\n');
}

// محاولة قراءة آخر output
if (fs.existsSync('cursor-session-output.log')) {
  const content = fs.readFileSync('cursor-session-output.log', 'utf8');
  console.log('📄 آخر output من Session:\n');
  console.log(content.substring(Math.max(0, content.length - 1000)));
}

console.log('\n💡 نصيحة:');
console.log('   - افتح cursor-response.png لرؤية الصفحة');
console.log('   - Session مفتوحة في الخلفية');
console.log('   - يمكنك فتح المتصفح يدوياً والتحقق من الرد');

