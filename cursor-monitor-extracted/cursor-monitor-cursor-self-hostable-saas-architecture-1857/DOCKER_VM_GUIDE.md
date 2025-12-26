# 🚀 Docker-in-Docker Virtual Machine Guide

## الفكرة الذكية 💡

بدلاً من محاولة تثبيت Docker على الـ host مباشرة، نستخدم **Docker-in-Docker (DinD)** - نفتح container يعمل Docker daemon داخله!

## المميزات ✨

1. **عزل كامل**: Docker يعمل داخل container منفصل
2. **لا يؤثر على الـ host**: كل شيء داخل container
3. **سهل التنظيف**: حذف container = حذف كل شيء
4. **يعمل بدون sudo**: Docker client فقط يحتاج للوصول للـ daemon

## المتطلبات

- Docker daemon يعمل على الـ host
- Docker client متوفر

## الاستخدام

### 1. إعداد الـ VM:

```bash
./docker-vm-setup.sh
```

### 2. البناء داخل الـ VM:

```bash
docker exec -w /workspace dind-vm docker-compose build
```

### 3. التشغيل داخل الـ VM:

```bash
docker exec -w /workspace dind-vm docker-compose up -d
```

### 4. التحقق من الحالة:

```bash
docker exec dind-vm docker ps
docker exec dind-vm docker-compose ps
```

### 5. عرض الـ Logs:

```bash
docker exec dind-vm docker-compose logs -f app
docker exec dind-vm docker-compose logs -f worker
```

### 6. التنظيف:

```bash
docker stop dind-vm
docker rm dind-vm
docker volume rm dind-docker-data
```

## الأوامر السريعة

```bash
# Build everything
docker exec -w /workspace dind-vm docker-compose build --no-cache

# Start services
docker exec -w /workspace dind-vm docker-compose up -d

# Check status
docker exec dind-vm docker-compose ps

# View logs
docker exec dind-vm docker-compose logs --tail=50

# Stop services
docker exec -w /workspace dind-vm docker-compose down

# Rebuild and restart
docker exec -w /workspace dind-vm docker-compose up -d --build
```

## كيف يعمل؟ 🔧

1. **ننشئ container** مع `--privileged` flag
2. **نستخدم `docker:dind` image** - Docker-in-Docker official image
3. **نربط `/workspace`** من الـ host للـ container
4. **Docker daemon يعمل داخل الـ container**
5. **نستخدم `docker exec`** للوصول للـ Docker داخل الـ VM

## الملفات

- `docker-vm-setup.sh` - Script لإعداد الـ VM
- `DOCKER_VM_GUIDE.md` - هذا الدليل

## ملاحظات مهمة ⚠️

- الـ VM يحتاج `--privileged` flag (لأسباب أمنية)
- البيانات محفوظة في volume `dind-docker-data`
- الـ workspace مربوط من الـ host للـ container
- Docker daemon داخل الـ VM منفصل تماماً عن الـ host

## مثال كامل

```bash
# 1. Setup
./docker-vm-setup.sh

# 2. Build
docker exec -w /workspace dind-vm docker-compose build

# 3. Run
docker exec -w /workspace dind-vm docker-compose up -d

# 4. Test
curl http://localhost:3000/api/cloud-agents/health

# 5. Cleanup
docker exec -w /workspace dind-vm docker-compose down
docker stop dind-vm && docker rm dind-vm
```

---

**🎯 هذه الطريقة تسمح لك بتشغيل Docker كامل داخل container بدون تثبيت على الـ host!**
