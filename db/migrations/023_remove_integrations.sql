-- Remove native Google and Todoist OAuth integration tables.
-- Integrations will later be provided via MCP servers.
DROP TABLE IF EXISTS integration_credentials;
DROP TABLE IF EXISTS integration_configs;
