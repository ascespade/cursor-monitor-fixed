# 🚀 Quick Start Guide

دليل سريع لتشغيل المشروع بدون Docker.

## ⚡ البدء السريع

### 1. إعداد Environment Variables

```bash
cp .env.example .env
# عدّل .env وأضف قيمك
```

### 2. تثبيت Dependencies

```bash
npm install
cd orchestrator && npm install && cd ..
```

### 3. تشغيل المشروع

```bash
npm run dev:start
```

### 4. الوصول للتطبيق

- **Next.js App**: http://localhost:3000
- **Health Check**: http://localhost:3000/api/cloud-agents/health

---

## 📝 الأوامر الأساسية

```bash
# تشغيل
npm run dev:start

# إيقاف
npm run dev:stop

# إعادة تشغيل
npm run dev:restart

# عرض الحالة
npm run dev:pm2:status

# عرض Logs
npm run dev:pm2:logs
```

---

## 🔄 الانتقال للـ Docker

عندما تكون جاهزاً:

```bash
docker-compose up -d
```

نفس ملف `.env` يعمل مع Docker - لا حاجة لتغيير أي شيء!

---

## 📚 للمزيد

- [DEVELOPMENT.md](./DEVELOPMENT.md) - دليل التطوير الكامل
- [SELF-HOSTING.md](./SELF-HOSTING.md) - دليل الـ self-hosting

