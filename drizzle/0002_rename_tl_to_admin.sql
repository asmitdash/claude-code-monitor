-- Lossless rename of role enum value 'tl' -> 'admin'.
-- ALTER TYPE ... RENAME VALUE updates every existing row in place — no data loss,
-- no temporary column, no enum recreate. Postgres 10+.
--
-- Idempotency: ALTER TYPE ... RENAME VALUE has no IF EXISTS, so guard with a
-- DO block that checks the current enum labels first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role' AND e.enumlabel = 'tl'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role' AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE "public"."role" RENAME VALUE 'tl' TO 'admin';
  END IF;
END$$;
--> statement-breakpoint

-- Invite-only signup: single-use, email-locked, default 7-day expiry.
CREATE TABLE IF NOT EXISTS "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL,
  "email" text NOT NULL,
  "role" "public"."role" NOT NULL DEFAULT 'member',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "consumed_by_user_id" uuid,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "note" text,
  CONSTRAINT "invites_consumed_by_users_fk" FOREIGN KEY ("consumed_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invites_token_idx" ON "invites" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invites_email_idx" ON "invites" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invites_expires_idx" ON "invites" ("expires_at");
--> statement-breakpoint

-- Admin-issued file commands and their results. Path enum is a fixed allowlist
-- — the extension refuses any value not in this list, so admins cannot probe
-- arbitrary filesystem paths.
DO $$ BEGIN
  CREATE TYPE "public"."file_command_kind" AS ENUM('read', 'write');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."file_command_path" AS ENUM('memory_md', 'claude_md_user', 'claude_md_project', 'settings_json');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" "public"."file_command_kind" NOT NULL,
  "file_path" "public"."file_command_path" NOT NULL,
  "payload" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "consumed_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'pending',
  "error" text,
  CONSTRAINT "file_commands_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_commands_user_pending_idx" ON "file_commands" ("user_id", "consumed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_commands_created_idx" ON "file_commands" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "file_path" "public"."file_command_path" NOT NULL,
  "workspace" text,
  "content" text NOT NULL,
  "captured_at" timestamp with time zone NOT NULL DEFAULT now(),
  "source_command_id" uuid,
  CONSTRAINT "file_snapshots_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "file_snapshots_command_fk" FOREIGN KEY ("source_command_id")
    REFERENCES "file_commands"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_snapshots_user_path_idx" ON "file_snapshots" ("user_id", "file_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_snapshots_captured_idx" ON "file_snapshots" ("captured_at");
--> statement-breakpoint

-- Extension self-update releases. Admin uploads a .vsix as base64; clients poll
-- /api/extension/latest, compare versions, and install on user consent.
CREATE TABLE IF NOT EXISTS "releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version" text NOT NULL UNIQUE,
  "vsix_bytes" text NOT NULL,
  "size_bytes" integer NOT NULL DEFAULT 0,
  "uploaded_by" text NOT NULL,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "auto_update_enabled" boolean NOT NULL DEFAULT true,
  "notes" text,
  "is_latest" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_latest_idx" ON "releases" ("is_latest");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_uploaded_idx" ON "releases" ("uploaded_at");
