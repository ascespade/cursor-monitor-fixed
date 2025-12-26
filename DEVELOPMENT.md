# دليل التطوير - Development Guide

دليل شامل لتشغيل المشروع بدون Docker للتطوير، مع إمكانية الانتقال للـ containerization بسهولة.

## 📋 المحتويات

- [المتطلبات](#المتطلبات)
- [الإعداد الأولي](#الإعداد-الأولي)
- [تشغيل المشروع](#تشغيل-المشروع)
- [الانتقال للـ Containerization](#الانتقال-للـ-containerization)
- [استكشاف الأخطاء](#استكشاف-الأخطاء)

---

## المتطلبات

### البرامج المطلوبة

```bash
# Node.js 20+ 
node --version  # يجب أن يكون >= 20.0.0

# npm
npm --version

# PM2 (سيتم تثبيته تلقائياً إذا لم يكن موجوداً)
pm2 --version
```

---

## الإعداد الأولي

### 1. تثبيت Dependencies

```bash
# تثبيت dependencies للمشروع الرئيسي
npm install

# تثبيت dependencies للـ Orchestrator
cd orchestrator
npm install
cd ..
```

### 2. إعداد ملف Environment Variables (موحد)

```bash
# نسخ ملف المثال
cp .env.example .env

# تعديل الملف وإضافة القيم المطلوبة
nano .env  # أو استخدم محرر النصوص المفضل لديك
```

#### المتغيرات المطلوبة في `.env`:

```bash
# ============================================================================
# SUPABASE (Required)
# ============================================================================
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ============================================================================
# CURSOR API (Required)
# ============================================================================
CURSOR_API_KEY=your-cursor-api-key

# ============================================================================
# WEBHOOK SECURITY (Required)
# ============================================================================
WEBHOOK_SECRET=your-32-chars-random-secret-minimum-32-characters

# ============================================================================
# REDIS (Optional - اتركه فارغاً لاستخدام database-only mode)
# ============================================================================
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=

# ============================================================================
# NODE ENVIRONMENT
# ============================================================================
NODE_ENV=development
```

> **ملاحظة مهمة**: ملف `.env` موحد - يستخدمه كل من Next.js App و Orchestrator Worker من نفس الملف.

### 3. إعداد Database Schema

تأكد من تطبيق الـ schema في Supabase:

```bash
# عرض الـ schema
cat supabase-schema.sql

# انسخ المحتوى وطبقه في Supabase SQL Editor
```

---

## تشغيل المشروع

### الطريقة الموصى بها: استخدام Scripts

```bash
# تشغيل كل شيء
npm run dev:start

# إيقاف كل شيء
npm run dev:stop

# إعادة تشغيل
npm run dev:restart
```

### الطريقة اليدوية: استخدام PM2 مباشرة

```bash
# تشغيل جميع الخدمات
pm2 start ecosystem.config.js --only cursor-monitor-app,cursor-monitor-worker

# أو تشغيل كل شيء
pm2 start ecosystem.config.js

# عرض الحالة
pm2 status

# عرض الـ logs
pm2 logs

# إيقاف
pm2 stop all

# حذف من PM2
pm2 delete all
```

### تشغيل منفصل (للتطوير)

**Terminal 1 - Next.js App:**
```bash
npm run dev
# يعمل على http://localhost:3000
```

**Terminal 2 - Orchestrator Worker:**
```bash
cd orchestrator
npm run dev
```

---

## مراقبة النظام

### PM2 Commands

```bash
# عرض حالة جميع الخدمات
pm2 status

# عرض logs لخدمة محددة
pm2 logs cursor-monitor-app
pm2 logs cursor-monitor-worker

# عرض logs لجميع الخدمات
pm2 logs

# مراقبة في الوقت الفعلي
pm2 monit

# إعادة تشغيل خدمة محددة
pm2 restart cursor-monitor-app
```

### Health Checks

```bash
# Next.js App Health
curl http://localhost:3000/api/cloud-agents/health

# Worker Health (من خلال database)
# تحقق من جدول service_health_events في Supabase
```

### Logs Location

```bash
# Logs موجودة في:
./logs/pm2-app-out.log
./logs/pm2-app-error.log
./logs/pm2-worker-out.log
./logs/pm2-worker-error.log
```

---

## الانتقال للـ Containerization

عندما تكون جاهزاً للـ self-hosting، يمكنك استخدام Docker بسهولة:

### 1. التأكد من ملف `.env`

```bash
# تأكد من أن ملف .env موجود ومكتمل
cat .env
```

### 2. بناء الصور

```bash
# بناء Next.js App
docker build -t cursor-monitor-app:latest .

# بناء Worker
docker build -t cursor-monitor-worker:latest -f orchestrator/Dockerfile .
```

### 3. تشغيل بـ Docker Compose

```bash
# تشغيل
docker-compose up -d

# عرض logs
docker-compose logs -f

# إيقاف
docker-compose down
```

> **ملاحظة**: `docker-compose.yml` يستخدم نفس ملف `.env` الموحد - لا حاجة لتغيير أي شيء!

---

## المزايا

### ✅ Centralized Configuration

- ملف `.env` واحد في root المشروع
- يستخدمه Next.js App و Orchestrator Worker
- لا حاجة لنسخ/مزامنة ملفات متعددة

### ✅ سهولة التطوير

- PM2 يدير جميع الخدمات
- Hot reload للـ Next.js
- Logs منظمة ومركزة

### ✅ سهولة الانتقال للـ Production

- نفس ملف `.env` يعمل مع Docker
- لا حاجة لتغيير أي إعدادات
- نفس الكود يعمل في Development و Production

---

## استكشاف الأخطاء

### المشكلة: Worker لا يعمل

```bash
# 1. تحقق من الـ logs
pm2 logs cursor-monitor-worker

# 2. تحقق من الاتصال بـ Supabase
# تأكد من أن SUPABASE_SERVICE_ROLE_KEY صحيح

# 3. تحقق من ملف .env
cat .env | grep SUPABASE
```

### المشكلة: Next.js App لا يعمل

```bash
# 1. تحقق من الـ logs
pm2 logs cursor-monitor-app

# 2. تحقق من الـ port
# تأكد من أن port 3000 غير مستخدم
lsof -i :3000

# 3. تحقق من Dependencies
npm install
```

### المشكلة: Environment Variables غير محملة

```bash
# تأكد من وجود ملف .env في root المشروع
ls -la .env

# تحقق من محتوى الملف
cat .env

# أعد تشغيل PM2
pm2 restart all
```

---

## نصائح إضافية

### حفظ PM2 Configuration

```bash
# حفظ الإعدادات الحالية
pm2 save

# إعداد PM2 للبدء تلقائياً عند إعادة التشغيل
pm2 startup
# اتبع التعليمات المعروضة
```

### Development vs Production

```bash
# Development (hot reload)
NODE_ENV=development npm run dev

# Production (PM2)
NODE_ENV=production pm2 start ecosystem.config.js --env production
```

### Redis (اختياري)

- إذا لم تقم بتعيين `REDIS_HOST`، النظام سيعمل في **database-only mode**
- هذا كافي تماماً للتطوير والاستخدام العادي
- Redis مفيد فقط للـ high-volume scenarios

---

## الدعم

للمزيد من المعلومات:

- [SELF-HOSTING.md](./SELF-HOSTING.md) - دليل الـ self-hosting
- [README.md](./README.md) - نظرة عامة على المشروع
- [PROJECT_RULES.md](./PROJECT_RULES.md) - قواعد المشروع

---

**آخر تحديث**: 2024-01-15

