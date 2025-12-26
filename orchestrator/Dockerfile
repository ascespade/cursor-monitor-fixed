# Dockerfile for Orchestrator Worker (Chatwoot-style self-hostable)
# This container runs the background orchestration worker

FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY orchestrator/package.json orchestrator/package-lock.json* ./

# Install dependencies
RUN npm ci

# Build the worker
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY orchestrator/ ./orchestrator/
COPY . .

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

# Copy necessary files
COPY --from=builder /app/orchestrator ./orchestrator
COPY --from=builder /app/node_modules ./node_modules

# Set correct permissions
RUN chown -R worker:nodejs /app

USER worker

WORKDIR /app/orchestrator

# Start worker
CMD ["npm", "run", "worker"]
