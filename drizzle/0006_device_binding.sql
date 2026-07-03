-- Bind one email to one laptop. On first heartbeat with a device
-- fingerprint (hash of the machine's MAC addresses), we record it. Any
-- subsequent heartbeat with a different fingerprint gets blocked=true.
-- Admins can clear the binding from the dashboard to allow re-binding.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "bound_device_fingerprint" text,
  ADD COLUMN IF NOT EXISTS "bound_device_hostname" text,
  ADD COLUMN IF NOT EXISTS "bound_device_at" timestamptz;

-- Per-surface version tracking. The legacy single-column extension_version
-- was being clobbered by whichever surface last heartbeat'd (VS Code or the
-- Desktop MCP), so the update-required banner kept lying. Now each surface
-- writes only its own column, plus a seen-at timestamp so we can stop
-- trusting versions past a staleness window.
ALTER TABLE "presence"
  ADD COLUMN IF NOT EXISTS "vscode_extension_version" text,
  ADD COLUMN IF NOT EXISTS "vscode_extension_seen_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "desktop_mcp_version" text,
  ADD COLUMN IF NOT EXISTS "desktop_mcp_seen_at" timestamptz;
