-- 0001_two_slot_redesign.sql (idempotent)
-- Adds 2-slot capacity, queue states, TL approvals, audit log, restrictions, quotas,
-- broadcasts, webhooks, grants, and rich activity tracking on slots.
-- Safe to re-run: every DDL guards with IF NOT EXISTS / DO blocks.

DO $$ BEGIN
  CREATE TYPE "public"."slot_status" AS ENUM('active', 'ended', 'expired', 'force_ended');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."queue_status" AS ENUM('queued', 'active', 'completed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."restriction_type" AS ENUM('pause', 'ban', 'cooldown');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "allowed_emails" (
  "email" text PRIMARY KEY NOT NULL,
  "role" "role" DEFAULT 'member' NOT NULL,
  "added_by" text,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "slot_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "status" "slot_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "duration_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "extended_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "extended_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "override_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "activity_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "event_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "tool_call_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "estimated_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "estimated_cost_micros" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "cwd" text;--> statement-breakpoint

UPDATE "slots" SET "status" = CASE
  WHEN "ended_at" IS NULL THEN 'active'::slot_status
  WHEN "ended_by" = 'self' THEN 'ended'::slot_status
  WHEN "ended_by" = 'auto' THEN 'expired'::slot_status
  ELSE 'force_ended'::slot_status
END WHERE "status" = 'active' AND ("ended_at" IS NOT NULL);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "slots_status_idx" ON "slots" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slots_started_idx" ON "slots" USING btree ("started_at");--> statement-breakpoint

ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "fulfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "status" "queue_status" DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "desired_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN IF NOT EXISTS "notified_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint

UPDATE "queue" SET "status" = CASE
  WHEN "fulfilled_slot_id" IS NOT NULL THEN 'completed'::queue_status
  WHEN "cancelled_at" IS NOT NULL THEN 'cancelled'::queue_status
  ELSE 'queued'::queue_status
END WHERE "status" = 'queued' AND ("fulfilled_slot_id" IS NOT NULL OR "cancelled_at" IS NOT NULL);--> statement-breakpoint

UPDATE "queue" SET "fulfilled_at" = "requested_at"
  WHERE "fulfilled_slot_id" IS NOT NULL AND "fulfilled_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queue_status_idx" ON "queue" USING btree ("status");--> statement-breakpoint

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "activity_weight" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "estimated_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_slot_idx" ON "events" USING btree ("slot_id");--> statement-breakpoint

ALTER TABLE "presence" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "presence" ADD COLUMN IF NOT EXISTS "claude_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "presence" ADD COLUMN IF NOT EXISTS "vscode_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "presence" ADD COLUMN IF NOT EXISTS "window_focused" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "presence" ADD COLUMN IF NOT EXISTS "extension_version" text;--> statement-breakpoint
ALTER TABLE "presence" ADD COLUMN IF NOT EXISTS "activity_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reason" text,
  "desired_minutes" integer DEFAULT 60 NOT NULL,
  "status" "approval_status" DEFAULT 'pending' NOT NULL,
  "decided_at" timestamp with time zone,
  "decided_by" text,
  "decision_note" text,
  "expires_at" timestamp with time zone,
  "consumed_slot_id" uuid
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_user_idx" ON "approvals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_requested_idx" ON "approvals" USING btree ("requested_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor_user_id" uuid,
  "actor_email" text,
  "actor_role" text,
  "target_user_id" uuid,
  "target_email" text,
  "action" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "slot_id" uuid,
  "queue_id" uuid,
  "approval_id" uuid,
  "metadata" jsonb
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_time_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_target_idx" ON "audit_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "restrictions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" "restriction_type" NOT NULL,
  "reason" text,
  "set_by" text,
  "set_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restrictions_user_idx" ON "restrictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restrictions_active_idx" ON "restrictions" USING btree ("active");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "quota_config" (
  "scope" text PRIMARY KEY NOT NULL,
  "daily_minutes" integer DEFAULT 240 NOT NULL,
  "weekly_minutes" integer DEFAULT 1200 NOT NULL,
  "max_slot_minutes" integer DEFAULT 120 NOT NULL,
  "cooldown_after_kill_minutes" integer DEFAULT 15 NOT NULL,
  "approval_auto_expire_minutes" integer DEFAULT 30 NOT NULL,
  "idle_auto_end_minutes" integer DEFAULT 15 NOT NULL,
  "idle_warn_minutes" integer DEFAULT 5 NOT NULL,
  "stale_heartbeat_minutes" integer DEFAULT 2 NOT NULL,
  "grace_timer_seconds" integer DEFAULT 60 NOT NULL,
  "max_concurrent_slots" integer DEFAULT 2 NOT NULL,
  "freeze_banner" text,
  "freeze_until" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);--> statement-breakpoint
INSERT INTO "quota_config" ("scope") VALUES ('global') ON CONFLICT (scope) DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "broadcasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "set_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_active_idx" ON "broadcasts" USING btree ("active");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label" text NOT NULL,
  "url" text NOT NULL,
  "events" jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "approval_id" uuid,
  "minutes" integer DEFAULT 60 NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "granted_by" text,
  "note" text
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "grants" ADD CONSTRAINT "grants_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_user_idx" ON "grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_expires_idx" ON "grants" USING btree ("expires_at");--> statement-breakpoint
