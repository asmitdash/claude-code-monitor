import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["tl", "member"]);

export const slotStatusEnum = pgEnum("slot_status", [
  "active",
  "ended",
  "expired",
  "force_ended",
]);

export const queueStatusEnum = pgEnum("queue_status", [
  "queued",
  "active",
  "completed",
  "cancelled",
  "expired",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);

export const restrictionTypeEnum = pgEnum("restriction_type", [
  "pause",
  "ban",
  "cooldown",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  role: roleEnum("role").notNull().default("member"),
  apiToken: text("api_token").notNull().unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const slots = pgTable(
  "slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slotNumber: integer("slot_number").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
    status: slotStatusEnum("status").notNull().default("active"),
    purpose: text("purpose"),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    extendedCount: integer("extended_count").notNull().default(0),
    extendedMinutes: integer("extended_minutes").notNull().default(0),
    overrideApprovalId: uuid("override_approval_id"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    activityScore: integer("activity_score").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    estimatedTokens: integer("estimated_tokens").notNull().default(0),
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
    cwd: text("cwd"),
    warned10min: boolean("warned_10min").notNull().default(false),
  },
  (t) => ({
    userIdx: index("slots_user_idx").on(t.userId),
    activeIdx: index("slots_active_idx").on(t.endedAt),
    statusIdx: index("slots_status_idx").on(t.status),
    startedIdx: index("slots_started_idx").on(t.startedAt),
  }),
);

export const queue = pgTable(
  "queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    fulfilledSlotId: uuid("fulfilled_slot_id").references(() => slots.id),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    status: queueStatusEnum("status").notNull().default("queued"),
    note: text("note"),
    desiredMinutes: integer("desired_minutes").notNull().default(60),
    urgent: boolean("urgent").notNull().default(false),
    notified10min: boolean("notified_10min").notNull().default(false),
    notifiedReady: boolean("notified_ready").notNull().default(false),
  },
  (t) => ({
    userIdx: index("queue_user_idx").on(t.userId),
    pendingIdx: index("queue_pending_idx").on(t.cancelledAt, t.fulfilledSlotId),
    statusIdx: index("queue_status_idx").on(t.status),
  }),
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slotId: uuid("slot_id").references(() => slots.id),
    eventType: text("event_type").notNull(),
    sessionId: text("session_id"),
    cwd: text("cwd"),
    tool: text("tool"),
    model: text("model"),
    payload: jsonb("payload"),
    activityWeight: integer("activity_weight").notNull().default(0),
    estimatedTokens: integer("estimated_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("events_user_idx").on(t.userId),
    timeIdx: index("events_time_idx").on(t.createdAt),
    slotIdx: index("events_slot_idx").on(t.slotId),
  }),
);

export const presence = pgTable("presence", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  claudeRunning: boolean("claude_running").notNull().default(false),
  claudeOpen: boolean("claude_open").notNull().default(false),
  vscodeOpen: boolean("vscode_open").notNull().default(false),
  windowFocused: boolean("window_focused").notNull().default(true),
  vscodeWindow: text("vscode_window"),
  hostname: text("hostname"),
  extensionVersion: text("extension_version"),
  activityScore: integer("activity_score").notNull().default(0),
});

export const killFlags = pgTable("kill_flags", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  blocked: boolean("blocked").notNull().default(false),
  reason: text("reason"),
  setBy: text("set_by"),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

export const allowedEmails = pgTable("allowed_emails", {
  email: text("email").primaryKey(),
  role: roleEnum("role").notNull().default("member"),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason"),
    desiredMinutes: integer("desired_minutes").notNull().default(60),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    consumedSlotId: uuid("consumed_slot_id"),
  },
  (t) => ({
    userIdx: index("approvals_user_idx").on(t.userId),
    statusIdx: index("approvals_status_idx").on(t.status),
    requestedIdx: index("approvals_requested_idx").on(t.requestedAt),
  }),
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    actorEmail: text("actor_email"),
    actorRole: text("actor_role"),
    targetUserId: uuid("target_user_id"),
    targetEmail: text("target_email"),
    action: text("action").notNull(),
    severity: text("severity").notNull().default("info"),
    slotId: uuid("slot_id"),
    queueId: uuid("queue_id"),
    approvalId: uuid("approval_id"),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    timeIdx: index("audit_time_idx").on(t.createdAt),
    actorIdx: index("audit_actor_idx").on(t.actorUserId),
    targetIdx: index("audit_target_idx").on(t.targetUserId),
    actionIdx: index("audit_action_idx").on(t.action),
  }),
);

export const restrictions = pgTable(
  "restrictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: restrictionTypeEnum("type").notNull(),
    reason: text("reason"),
    setBy: text("set_by"),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    userIdx: index("restrictions_user_idx").on(t.userId),
    activeIdx: index("restrictions_active_idx").on(t.active),
  }),
);

export const quotaConfig = pgTable("quota_config", {
  scope: text("scope").primaryKey(),
  dailyMinutes: integer("daily_minutes").notNull().default(240),
  weeklyMinutes: integer("weekly_minutes").notNull().default(1200),
  maxSlotMinutes: integer("max_slot_minutes").notNull().default(120),
  cooldownAfterKillMinutes: integer("cooldown_after_kill_minutes").notNull().default(15),
  approvalAutoExpireMinutes: integer("approval_auto_expire_minutes").notNull().default(30),
  idleAutoEndMinutes: integer("idle_auto_end_minutes").notNull().default(15),
  idleWarnMinutes: integer("idle_warn_minutes").notNull().default(5),
  staleHeartbeatMinutes: integer("stale_heartbeat_minutes").notNull().default(2),
  graceTimerSeconds: integer("grace_timer_seconds").notNull().default(60),
  maxConcurrentSlots: integer("max_concurrent_slots").notNull().default(2),
  freezeBanner: text("freeze_banner"),
  freezeUntil: timestamp("freeze_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    message: text("message").notNull(),
    severity: text("severity").notNull().default("info"),
    setBy: text("set_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    activeIdx: index("broadcasts_active_idx").on(t.active),
  }),
);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  events: jsonb("events").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id"),
    minutes: integer("minutes").notNull().default(60),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    grantedBy: text("granted_by"),
    note: text("note"),
  },
  (t) => ({
    userIdx: index("grants_user_idx").on(t.userId),
    expiresIdx: index("grants_expires_idx").on(t.expiresAt),
  }),
);

export type User = typeof users.$inferSelect;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type QueueItem = typeof queue.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Presence = typeof presence.$inferSelect;
export type KillFlag = typeof killFlags.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Restriction = typeof restrictions.$inferSelect;
export type QuotaConfig = typeof quotaConfig.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type Grant = typeof grants.$inferSelect;
