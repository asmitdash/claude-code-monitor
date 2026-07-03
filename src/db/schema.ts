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

export const roleEnum = pgEnum("role", ["admin", "member"]);

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
  // Device binding: on first heartbeat with a fingerprint, we bind the user
  // to that device. Any later heartbeat with a different fingerprint is
  // refused ("email is bound to another laptop"). Admin can clear via the
  // dashboard, which lets the next device claim the binding.
  boundDeviceFingerprint: text("bound_device_fingerprint"),
  boundDeviceHostname: text("bound_device_hostname"),
  boundDeviceAt: timestamp("bound_device_at", { withTimezone: true }),
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
    // Telemetry expansion 2026-07: TTF (time-to-first-token) proxy is the
    // first `tool` or `model` event after slot start. Stored as ms delta.
    firstToolAtMs: integer("first_tool_at_ms"),
    // Warn-when-idle counter: how many times idle-warn fired for THIS slot.
    idleWarnCount: integer("idle_warn_count").notNull().default(0),
    // Post-hoc user tagging. Owner sets on slot end (M4).
    outcomeTag: text("outcome_tag"), // 'progress' | 'stuck' | 'exploratory' | null
    outcomeNote: text("outcome_note"),
    outcomeTaggedAt: timestamp("outcome_tagged_at", { withTimezone: true }),
    // M5: inferred project name from cwd basename or git remote — populated
    // by the extension at slot start if provided.
    projectName: text("project_name"),
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
  // Per-surface version tracking. Each source updates only its own column so
  // one surface's stale ping can't clobber the other's fresh number. The
  // legacy `extensionVersion` column is still written (backward-compat) but
  // clients should read the specific columns below.
  vscodeExtensionVersion: text("vscode_extension_version"),
  vscodeExtensionSeenAt: timestamp("vscode_extension_seen_at", { withTimezone: true }),
  desktopMcpVersion: text("desktop_mcp_version"),
  desktopMcpSeenAt: timestamp("desktop_mcp_seen_at", { withTimezone: true }),
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
  staleHeartbeatEnabled: boolean("stale_heartbeat_enabled").notNull().default(true),
  bypassPermissionsEnabled: boolean("bypass_permissions_enabled").notNull().default(true),
  // Version gate: extensions/MCPs below these versions get a warning banner
  // now and are blocked outright after `enforceStaleClientsAfter`. Null means
  // "no gate set" — banner off, no enforcement.
  requiredExtensionVersion: text("required_extension_version"),
  requiredMcpVersion: text("required_mcp_version"),
  enforceStaleClientsAfter: timestamp("enforce_stale_clients_after", { withTimezone: true }),
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

// Extension self-update releases. Admin uploads a .vsix; the extension polls
// `/api/extension/latest`, compares versions, and installs on user consent.
export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull().unique(),
    vsixBytes: text("vsix_bytes").notNull(), // base64-encoded .vsix
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    autoUpdateEnabled: boolean("auto_update_enabled").notNull().default(true),
    notes: text("notes"),
    isLatest: boolean("is_latest").notNull().default(false),
  },
  (t) => ({
    latestIdx: index("releases_latest_idx").on(t.isLatest),
    uploadedIdx: index("releases_uploaded_idx").on(t.uploadedAt),
  }),
);

// Admin-issued file commands consumed by the extension. The extension polls
// for unconsumed commands targeting itself, executes (read or write), and
// uploads results to file_snapshots.
export const fileCommandKindEnum = pgEnum("file_command_kind", ["read", "write"]);
export const fileCommandPathEnum = pgEnum("file_command_path", [
  "memory_md",
  "claude_md_user",
  "claude_md_project",
  "settings_json",
]);

export const fileCommands = pgTable(
  "file_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: fileCommandKindEnum("kind").notNull(),
    filePath: fileCommandPathEnum("file_path").notNull(),
    payload: text("payload"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    error: text("error"),
  },
  (t) => ({
    userPendingIdx: index("file_commands_user_pending_idx").on(t.userId, t.consumedAt),
    createdIdx: index("file_commands_created_idx").on(t.createdAt),
  }),
);

export const fileSnapshots = pgTable(
  "file_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filePath: fileCommandPathEnum("file_path").notNull(),
    workspace: text("workspace"),
    content: text("content").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    sourceCommandId: uuid("source_command_id").references(() => fileCommands.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    userPathIdx: index("file_snapshots_user_path_idx").on(t.userId, t.filePath),
    capturedIdx: index("file_snapshots_captured_idx").on(t.capturedAt),
  }),
);

// Single-use, email-locked invite tokens. An admin generates one per teammate;
// the recipient signs up via the URL and the token is consumed.
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("member"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByUserId: uuid("consumed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    note: text("note"),
  },
  (t) => ({
    tokenIdx: uniqueIndex("invites_token_idx").on(t.token),
    emailIdx: index("invites_email_idx").on(t.email),
    expiresIdx: index("invites_expires_idx").on(t.expiresAt),
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
export type Invite = typeof invites.$inferSelect;
export type FileCommand = typeof fileCommands.$inferSelect;
export type FileSnapshot = typeof fileSnapshots.$inferSelect;
export type Release = typeof releases.$inferSelect;
