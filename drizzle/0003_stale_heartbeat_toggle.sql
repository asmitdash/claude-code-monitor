-- Add a kill-switch for the stale-heartbeat sweeper. When false, the cleanup
-- sweep skips the stale_heartbeat check entirely (idle / expired / quota still
-- apply). Defaults to true so existing behavior is preserved on upgrade.

ALTER TABLE "quota_config"
  ADD COLUMN IF NOT EXISTS "stale_heartbeat_enabled" boolean NOT NULL DEFAULT true;
