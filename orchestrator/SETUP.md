# Setup Guide - Cursor Monitor Orchestrator

دليل الإعداد الكامل للمشروع المنفصل على السيرفر المحلي.

## المتطلبات الأساسية

- Node.js 20+
- Redis (للتواصل مع Vercel)
- Supabase (محلي أو cloud)
- PM2 (لإدارة العمليات)
- Git (لاختبار الكود)

## خطوات الإعداد

### 1. تثبيت Dependencies

```bash
cd orchestrator
npm install
```

### 2. إعداد Environment Variables

```bash
cp .env.example .env
# عدّل .env وأضف القيم المطلوبة
```

**المتغيرات المطلوبة:**
- `REDIS_HOST` - IP السيرفر المحلي أو Redis URL
- `REDIS_PORT` - 6379 (افتراضي)
- `REDIS_PASSWORD` - (اختياري)
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key
- `CURSOR_API_KEY` - من cursor.com/settings
- `WEBHOOK_SECRET` - نفس الـ secret في Vercel (32+ chars)
- `PROJECT_PATH` - مسار المشروع للاختبار المحلي

### 3. إعداد Supabase

#### أ) Supabase محلي (Self-hosted)

```bash
# Clone Supabase
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker

# إعداد .env
cp .env.example .env
# عدّل .env (generate secrets)

# تشغيل Supabase
docker-compose up -d

# الوصول: http://localhost:54323
```

#### ب) Supabase Cloud

استخدم Supabase Cloud من https://supabase.com

### 4. إنشاء جدول Database

افتح Supabase SQL Editor (محلي أو cloud) وشغّل:

```sql
-- انسخ محتوى supabase-schema.sql
```

أو شغّل الملف مباشرة:

```bash
# للـ Supabase محلي
psql -h localhost -U postgres -d postgres -f supabase-schema.sql
```

### 5. إعداد Redis

#### أ) Redis محلي

```bash
# تثبيت Redis
sudo apt-get install redis-server  # Ubuntu/Debian
# أو
brew install redis  # macOS

# تشغيل Redis
redis-server

# اختبار الاتصال
redis-cli ping  # يجب أن يرد: PONG
```

#### ب) فتح Redis للـ Vercel

إذا كان Vercel على سيرفر مختلف، افتح port 6379:

```bash
# Firewall (Ubuntu)
sudo ufw allow 6379/tcp

# أو استخدم VPN/Private network
```

### 6. تشغيل مع PM2

```bash
# تثبيت PM2 (إذا لم يكن مثبت)
npm install -g pm2

# تشغيل المشروع
pm2 start ecosystem.config.js

# حفظ الإعدادات
pm2 save

# إعداد PM2 للبدء تلقائياً
pm2 startup
# شغّل الأمر الذي يظهر

# مراقبة
pm2 status
pm2 logs cursor-monitor-orchestrator-worker
pm2 logs cursor-monitor-orchestrator-cron
```

### 7. اختبار النظام

#### أ) اختبار Worker

```bash
# تشغيل يدوي
npm run worker

# يجب أن ترى:
# [INFO] Redis connected
# [INFO] Orchestrator queue initialized
# [INFO] Orchestrator worker started
```

#### ب) اختبار Cron Job

```bash
npm run cron

# يجب أن يفحص Agents المعلقة
```

#### ج) اختبار End-to-End

1. تأكد أن Vercel webhook يضيف jobs للـ Redis
2. تأكد أن Worker يعالج jobs
3. راقب Logs:

```bash
pm2 logs --lines 100
```

## استكشاف الأخطاء

### Redis Connection Failed

```
[ERROR] Redis connection error
```

**الحل:**
- تأكد أن Redis يعمل: `redis-cli ping`
- تحقق من `REDIS_HOST` و `REDIS_PORT`
- تأكد من فتح Firewall

### Supabase Connection Failed

```
[ERROR] Failed to get agent state
```

**الحل:**
- تحقق من `NEXT_PUBLIC_SUPABASE_URL`
- تحقق من `SUPABASE_SERVICE_ROLE_KEY`
- تأكد من إنشاء جدول `agent_orchestrator_states`

### Cursor API Error

```
[ERROR] Cursor API error: 401
```

**الحل:**
- تحقق من `CURSOR_API_KEY`
- تأكد من صلاحية الـ API key

### PROJECT_PATH Not Set

```
[WARN] PROJECT_PATH not set - testing will be disabled
```

**الحل:**
- أضف `PROJECT_PATH` في `.env`
- تأكد من وجود المشروع في المسار المحدد

## Monitoring

### PM2 Commands

```bash
# الحالة
pm2 status

# Logs
pm2 logs

# Restart
pm2 restart cursor-monitor-orchestrator-worker

# Stop
pm2 stop cursor-monitor-orchestrator-worker

# Delete
pm2 delete cursor-monitor-orchestrator-worker
```

### Log Files

- `logs/pm2-worker-out.log` - Worker output
- `logs/pm2-worker-error.log` - Worker errors
- `logs/pm2-cron-out.log` - Cron output
- `logs/pm2-cron-error.log` - Cron errors

## Production Checklist

- [ ] Environment variables configured
- [ ] Supabase table created
- [ ] Redis accessible from Vercel
- [ ] PM2 processes running
- [ ] PM2 startup configured
- [ ] Logs directory exists
- [ ] Monitoring setup
- [ ] Backup strategy for database

## Support

للأسئلة أو المشاكل، راجع:
- `README.md` - الوثائق الكاملة
- Logs في `logs/` directory
- PM2 logs: `pm2 logs`
