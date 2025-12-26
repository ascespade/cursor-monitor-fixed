-- Supabase Schema for Agent Orchestrator
-- Run this in Supabase SQL Editor (local or cloud)

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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_orchestrator_agent_id ON agent_orchestrator_states(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_orchestrator_status ON agent_orchestrator_states(status);
CREATE INDEX IF NOT EXISTS idx_agent_orchestrator_updated_at ON agent_orchestrator_states(updated_at);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_agent_orchestrator_states_updated_at ON agent_orchestrator_states;
CREATE TRIGGER update_agent_orchestrator_states_updated_at
  BEFORE UPDATE ON agent_orchestrator_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE agent_orchestrator_states IS 'Stores state for each Cloud Agent being orchestrated';
COMMENT ON COLUMN agent_orchestrator_states.agent_id IS 'Unique agent ID from Cursor (e.g., bc_xyz789)';
COMMENT ON COLUMN agent_orchestrator_states.status IS 'Agent status: ACTIVE, COMPLETED, ERROR, TIMEOUT, MAX_ITERATIONS_REACHED';
COMMENT ON COLUMN agent_orchestrator_states.iterations IS 'Number of analysis iterations performed';
COMMENT ON COLUMN agent_orchestrator_states.last_analysis IS 'JSON object containing last analysis result from Analyzer';
