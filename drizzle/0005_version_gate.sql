-- Admin-settable minimum extension/MCP versions and a hard enforcement
-- deadline. Below-min clients see a warning banner starting now; after the
-- deadline they get server-side blocked=true, which fires the existing local
-- kill-flag / process-termination path in v0.3+ clients.

ALTER TABLE "quota_config"
  ADD COLUMN IF NOT EXISTS "required_extension_version" text,
  ADD COLUMN IF NOT EXISTS "required_mcp_version" text,
  ADD COLUMN IF NOT EXISTS "enforce_stale_clients_after" timestamptz;
