#!/bin/bash
# 🚀 Docker-in-Docker Virtual Machine Setup
# This script creates a Docker container that runs its own Docker daemon
# Perfect for testing Docker builds without affecting the host system

set -e

echo "🚀 Setting up Docker-in-Docker Virtual Machine..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
fi

# Check if Docker daemon is running
if ! docker ps &> /dev/null; then
    echo "❌ Docker daemon is not running. Please start Docker first."
    exit 1
fi

# Clean up existing container if it exists
if docker ps -a --format '{{.Names}}' | grep -q '^dind-vm$'; then
    echo "🧹 Cleaning up existing container..."
    docker stop dind-vm 2>/dev/null || true
    docker rm dind-vm 2>/dev/null || true
fi

# Create Docker-in-Docker container
echo "📦 Creating Docker-in-Docker container..."
docker run -d \
  --name dind-vm \
  --privileged \
  -v /workspace:/workspace \
  -v dind-docker-data:/var/lib/docker \
  -e DOCKER_TLS_CERTDIR="" \
  docker:dind

echo "⏳ Waiting for Docker daemon to start inside container..."
sleep 5

# Install docker-compose inside the container
echo "📥 Installing docker-compose inside VM..."
docker exec dind-vm sh -c "
  apk add --no-cache curl && \
  curl -L 'https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64' \
    -o /usr/local/bin/docker-compose && \
  chmod +x /usr/local/bin/docker-compose && \
  docker-compose --version
"

# Verify setup
echo "✅ Verifying setup..."
docker exec dind-vm docker --version
docker exec dind-vm docker-compose --version

echo ""
echo "🎉 Docker-in-Docker VM is ready!"
echo ""
echo "📝 Usage:"
echo "  # Build inside VM:"
echo "  docker exec -w /workspace dind-vm docker-compose build"
echo ""
echo "  # Run inside VM:"
echo "  docker exec -w /workspace dind-vm docker-compose up -d"
echo ""
echo "  # Check status:"
echo "  docker exec dind-vm docker ps"
echo ""
echo "  # View logs:"
echo "  docker exec dind-vm docker-compose logs"
echo ""
echo "  # Stop and cleanup:"
echo "  docker stop dind-vm && docker rm dind-vm"
