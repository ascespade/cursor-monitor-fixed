-- Supabase Schema for Chatwoot-style Self-hostable SaaS
-- Complete database schema for orchestrations, events, tasks, and outbox
-- Run this in Supabase SQL Editor (local or cloud)

-- ============================================================================
-- ORCHESTRATIONS TABLE (System of Record)
-- ============================================================================
CREATE TABLE IF NOT EXISTS orchestrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'AUTO',
  repository_url TEXT NOT NULL,
  ref TEXT DEFAULT 'main',
  prompt TEXT NOT NULL,
  prompt_length INTEGER NOT NULL,
  model TEXT DEFAULT NULL, -- NULL = Auto mode (let API choose - recommended)
  options JSONB DEFAULT '{}',
  tasks_total INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  active_agents INTEGER DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_summary TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestrations_status ON orchestrations(status);
CREATE INDEX IF NOT EXISTS idx_orchestrations_created_at ON orchestrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestrations_master_agent_id ON orchestrations(master_agent_id);

-- ============================================================================
-- ORCHESTRATION EVENTS TABLE (Event Store)
-- ============================================================================
CREATE TABLE IF NOT EXISTS orchestration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orchestration_id UUID NOT NULL REFERENCES orchestrations(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  step_key TEXT NOT NULL,
  step_phase TEXT DEFAULT 'end',
  message TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_events_orchestration_id ON orchestration_events(orchestration_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_events_created_at ON orchestration_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestration_events_step_key ON orchestration_events(step_key);

-- ============================================================================
-- ORCHESTRATION TASKS TABLE (Task Tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS orchestration_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orchestration_id UUID NOT NULL REFERENCES orchestrations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  task_description TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  order_index INTEGER NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_orchestration_id ON orchestration_tasks(orchestration_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_status ON orchestration_tasks(status);
CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_agent_id ON orchestration_tasks(agent_id);

-- ============================================================================
-- ORCHESTRATION OUTBOX TABLE (Outbox Pattern for Queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS orchestration_outbox_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orchestration_id UUID NOT NULL REFERENCES orchestrations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  next_run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_error TEXT,
  worker_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_outbox_jobs_status ON orchestration_outbox_jobs(status);
CREATE INDEX IF NOT EXISTS idx_orchestration_outbox_jobs_next_run_at ON orchestration_outbox_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_orchestration_outbox_jobs_orchestration_id ON orchestration_outbox_jobs(orchestration_id);

-- ============================================================================
-- WORKER HEARTBEATS TABLE (Worker Health Monitoring)
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_health_events_service ON service_health_events(service);
CREATE INDEX IF NOT EXISTS idx_service_health_events_created_at ON service_health_events(created_at DESC);

-- ============================================================================
-- AGENT ORCHESTRATOR STATES TABLE (Agent State Management)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_orchestrator_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  task_description TEXT,
  branch_name TEXT,
  repository TEXT,
  iterations INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  tasks_completed JSONB DEFAULT '[]',
  tasks_remaining JSONB DEFAULT '[]',
  last_analysis JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_orchestrator_agent_id ON agent_orchestrator_states(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_orchestrator_status ON agent_orchestrator_states(status);
CREATE INDEX IF NOT EXISTS idx_agent_orchestrator_updated_at ON agent_orchestrator_states(updated_at);

-- ============================================
-- 7. RATE_LIMITS TABLE (for database-based rate limiting)
-- ============================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP NOT NULL,
  reset_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for rate_limits
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);

-- Cleanup function for expired rate limits
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE reset_at < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS (Auto-update updated_at)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with updated_at
DROP TRIGGER IF EXISTS update_orchestrations_updated_at ON orchestrations;
CREATE TRIGGER update_orchestrations_updated_at
  BEFORE UPDATE ON orchestrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orchestration_tasks_updated_at ON orchestration_tasks;
CREATE TRIGGER update_orchestration_tasks_updated_at
  BEFORE UPDATE ON orchestration_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orchestration_outbox_jobs_updated_at ON orchestration_outbox_jobs;
CREATE TRIGGER update_orchestration_outbox_jobs_updated_at
  BEFORE UPDATE ON orchestration_outbox_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_orchestrator_states_updated_at ON agent_orchestrator_states;
CREATE TRIGGER update_agent_orchestrator_states_updated_at
  BEFORE UPDATE ON agent_orchestrator_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================
COMMENT ON TABLE orchestrations IS 'System of record for all orchestrations';
COMMENT ON TABLE orchestration_events IS 'Event store for orchestration lifecycle events';
COMMENT ON TABLE orchestration_tasks IS 'Individual tasks within an orchestration';
COMMENT ON TABLE orchestration_outbox_jobs IS 'Outbox pattern for reliable job processing (works without Redis)';
COMMENT ON TABLE service_health_events IS 'Worker heartbeat and health monitoring';
COMMENT ON TABLE agent_orchestrator_states IS 'State for each Cloud Agent being orchestrated';
COMMENT ON TABLE rate_limits IS 'Database-based rate limiting (works without Redis)';

COMMENT ON COLUMN orchestrations.status IS 'Status: queued, running, waiting, blocked, completed, error, stopped';
COMMENT ON COLUMN orchestration_outbox_jobs.status IS 'Status: pending, processing, completed, failed';
COMMENT ON COLUMN orchestration_tasks.status IS 'Status: pending, running, completed, failed';
