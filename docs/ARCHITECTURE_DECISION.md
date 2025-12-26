# Architecture Decision: Supabase Cloud as System of Record

**Date:** 2024-12-20  
**Status:** Approved  
**Decision Makers:** Technical Lead

## Context

The Cursor Monitor orchestration system uses a hybrid deployment model:
- **Vercel**: Next.js UI/API (public-facing)
- **Local Worker**: PM2 worker on private server (executes jobs)

Previously, there was confusion about which Supabase instance to use:
- Vercel was using Supabase Cloud
- Local Worker was using Supabase Local

This caused data inconsistency where UI reads from Cloud but Worker writes to Local.

## Decision

**In Production:**
- **Vercel UI/API**: Uses Supabase Cloud (same project)
- **Local Worker**: Uses Supabase Cloud (same project)
- **Redis**: Private queue (localhost/Tailscale) - optional optimization only

**In Development:**
- Supabase Local can be used for local testing
- But production must use Supabase Cloud for both components

## Rationale

1. **Single Source of Truth**: Supabase Cloud is the System of Record for all orchestration state, events, and tasks
2. **Data Consistency**: Both Vercel and Worker must read/write from the same database
3. **Reliability**: UI must never depend on Redis availability (Redis is private to worker)
4. **Outbox Pattern**: When Redis is unreachable from Vercel, jobs are persisted to Supabase outbox table

## Implementation

- All API routes read from Supabase Cloud (not Redis)
- Worker writes all lifecycle events to Supabase Cloud
- Worker reads from Supabase outbox when Redis is unavailable
- UI subscribes to Supabase Realtime for live updates

## Consequences

- Worker must have network access to Supabase Cloud
- All orchestration state is persisted in Supabase (no ephemeral Redis-only state)
- UI can display orchestration status even if Redis is down
- Worker can process jobs even if Redis is down (via outbox)

