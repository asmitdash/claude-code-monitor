-- Admin kill-switch for the timed bypass-permissions feature. When false, the
-- VS Code extension's toggleBypassMode command refuses to start a new bypass
-- (existing timed bypasses run out naturally). Defaults to true so upgrade is
-- a no-op.

ALTER TABLE "quota_config"
  ADD COLUMN IF NOT EXISTS "bypass_permissions_enabled" boolean NOT NULL DEFAULT true;
