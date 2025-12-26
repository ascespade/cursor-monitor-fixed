# 🚀 Production Deployment Guide

## التحويل من Localhost إلى Production

هذا الدليل يشرح كيفية تحويل Orchestrator Settings UI من `localhost:3001` إلى **domain دائم مع HTTPS**.

---

## ✅ المرحلة 1: التحقق من PM2

تأكد أن كل الخدمات شغالة عبر PM2:

```bash
cd /home/asce/projects/nodejs/cursor-monitor/orchestrator
pm2 list
```

**يجب أن ترى:**
- ✅ `cursor-monitor-orchestrator-worker` - online
- ✅ `cursor-monitor-orchestrator-settings` - online (port 3001)
- ✅ `cursor-monitor-orchestrator-cron` - scheduled

**إذا لم تكن شغالة:**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # لتشغيل تلقائي بعد reboot
```

---

## 🌐 المرحلة 2: إعداد Nginx

### الخطوة 1: نسخ ملف الإعدادات

```bash
cd /home/asce/projects/nodejs/cursor-monitor/orchestrator
sudo cp nginx-settings-config.conf /etc/nginx/sites-available/orchestrator-settings
```

### الخطوة 2: تعديل Domain

افتح الملف وعدّل الـ domain:

```bash
sudo nano /etc/nginx/sites-available/orchestrator-settings
```

**غيّر:**
```nginx
server_name orchestrator.example.com;  # ← غيّر هذا
```

**إلى domain الحقيقي:**
```nginx
server_name orchestrator.yourdomain.com;  # أو IP إذا لم يكن عندك domain
```

### الخطوة 3: تفعيل الموقع

```bash
sudo ln -s /etc/nginx/sites-available/orchestrator-settings /etc/nginx/sites-enabled/
```

### الخطوة 4: اختبار الإعدادات

```bash
sudo nginx -t
```

**يجب أن ترى:**
```
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### الخطوة 5: إعادة تحميل Nginx

```bash
sudo systemctl reload nginx
```

---

## 🔒 المرحلة 3: إضافة SSL (HTTPS)

### الخطوة 1: تثبيت Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

### الخطوة 2: الحصول على شهادة SSL

```bash
sudo certbot --nginx -d orchestrator.yourdomain.com
```

**Certbot سيسألك:**
1. Email (للتذكيرات)
2. الموافقة على الشروط
3. مشاركة Email (اختياري)

**بعدها Certbot سيقوم تلقائياً:**
- ✅ الحصول على شهادة SSL
- ✅ تعديل Nginx config لإضافة HTTPS
- ✅ إعادة تحميل Nginx
- ✅ إعداد redirect من HTTP إلى HTTPS

### الخطوة 3: التحقق

افتح المتصفح:
```
https://orchestrator.yourdomain.com
```

**يجب أن ترى:**
- ✅ قفل أخضر (HTTPS)
- ✅ Settings UI يعمل
- ✅ لا تحذيرات SSL

---

## 🛡️ المرحلة 4: حماية الوصول

### خيار A: Basic Auth (سريع)

#### الخطوة 1: إنشاء ملف كلمات المرور

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.orchestrator_htpasswd admin
```

**سيسألك:**
- Password: (أدخل كلمة مرور قوية)

#### الخطوة 2: تفعيل Basic Auth في Nginx

```bash
sudo nano /etc/nginx/sites-available/orchestrator-settings
```

**أزل التعليق من:**
```nginx
# auth_basic "Orchestrator Settings - Restricted Access";
# auth_basic_user_file /etc/nginx/.orchestrator_htpasswd;
```

**إلى:**
```nginx
auth_basic "Orchestrator Settings - Restricted Access";
auth_basic_user_file /etc/nginx/.orchestrator_htpasswd;
```

#### الخطوة 3: إعادة تحميل

```bash
sudo nginx -t
sudo systemctl reload nginx
```

**الآن عند فتح الموقع سيطلب username/password:**
- Username: `admin`
- Password: (اللي أدخلته)

---

### خيار B: Tailscale Only (أقوى)

إذا كنت تريد أن يكون الوصول فقط عبر Tailscale:

```bash
sudo nano /etc/nginx/sites-available/orchestrator-settings
```

**أزل التعليق من:**
```nginx
# allow 100.64.0.0/10;  # Tailscale network range
# deny all;
```

**إلى:**
```nginx
allow 100.64.0.0/10;  # Tailscale network range
deny all;
```

**ثم:**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

**الآن فقط الأجهزة المتصلة بـ Tailscale تستطيع الوصول.**

---

## 📝 المرحلة 5: تحديث التوثيق

### تحديث README

في أي ملف README أو documentation:

**قبل:**
```
Settings UI: http://localhost:3001
```

**بعد:**
```
Settings UI: https://orchestrator.yourdomain.com
(Internal: http://localhost:3001 - for debugging only)
```

---

## ✅ المرحلة 6: الاختبار النهائي

### Checklist:

- [ ] PM2 services running
- [ ] Nginx config valid (`sudo nginx -t`)
- [ ] Domain resolves correctly
- [ ] HTTP redirects to HTTPS
- [ ] SSL certificate valid (green lock)
- [ ] Settings UI loads correctly
- [ ] Can test Cursor API
- [ ] Can test Redis connection
- [ ] Can test Supabase connection
- [ ] Security (Basic Auth or Tailscale) working
- [ ] Server restart → everything still works

### اختبار شامل:

```bash
# 1. Test locally
curl http://localhost:3001/health

# 2. Test via domain (HTTP - should redirect)
curl -I http://orchestrator.yourdomain.com

# 3. Test via domain (HTTPS)
curl -I https://orchestrator.yourdomain.com

# 4. Test in browser
# Open: https://orchestrator.yourdomain.com
# Should see Settings UI
```

---

## 🔄 Auto-renewal SSL

Certbot يضيف cron job تلقائياً لتجديد الشهادة.

**للتحقق:**
```bash
sudo certbot renew --dry-run
```

**يجب أن ترى:**
```
The dry run was successful.
```

---

## 🐛 Troubleshooting

### المشكلة: Nginx لا يبدأ

```bash
sudo nginx -t  # Check for errors
sudo journalctl -u nginx -n 50  # Check logs
```

### المشكلة: Settings UI لا يفتح

```bash
# Check if Settings Server is running
pm2 list
pm2 logs cursor-monitor-orchestrator-settings

# Check if port 3001 is listening
sudo netstat -tlnp | grep 3001

# Test directly
curl http://localhost:3001
```

### المشكلة: SSL لا يعمل

```bash
# Check certificate
sudo certbot certificates

# Renew manually
sudo certbot renew

# Check Nginx SSL config
sudo nginx -t
```

### المشكلة: Basic Auth لا يعمل

```bash
# Check file exists
sudo ls -la /etc/nginx/.orchestrator_htpasswd

# Test password file
htpasswd -v /etc/nginx/.orchestrator_htpasswd admin
```

---

## 📊 Production Checklist

بعد اكتمال كل الخطوات:

- ✅ No `localhost` in production URLs
- ✅ HTTPS enabled (SSL certificate valid)
- ✅ Security enabled (Basic Auth or Tailscale)
- ✅ PM2 auto-start on reboot
- ✅ Nginx auto-start on reboot
- ✅ SSL auto-renewal configured
- ✅ All services running 24/7
- ✅ Documentation updated

---

## 🎯 النتيجة النهائية

**قبل:**
```
http://localhost:3001  ❌ (Internal only)
```

**بعد:**
```
https://orchestrator.yourdomain.com  ✅ (Production-ready)
```

**المميزات:**
- ✅ Domain دائم
- ✅ HTTPS مشفّر
- ✅ آمن (Basic Auth أو Tailscale)
- ✅ Production-grade
- ✅ Auto-restart
- ✅ SSL auto-renewal

---

**Status:** ✅ Production Ready  
**Last Updated:** 2024-12-19
