-- Add tools toggle and agent configuration
ALTER TABLE users ADD COLUMN tools_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN max_agent_steps INTEGER NOT NULL DEFAULT 10 CHECK (max_agent_steps BETWEEN 1 AND 50);

-- Store agent plan as JSON
ALTER TABLE chats ADD COLUMN agent_plan TEXT;

-- Track agent execution state
ALTER TABLE chats ADD COLUMN agent_step INTEGER NOT NULL DEFAULT 0;
