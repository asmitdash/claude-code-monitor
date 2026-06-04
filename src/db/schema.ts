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
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["tl", "member"]);

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
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
    purpose: text("purpose"),
    warned10min: boolean("warned_10min").notNull().default(false),
  },
  (t) => ({
    userIdx: index("slots_user_idx").on(t.userId),
    activeIdx: index("slots_active_idx").on(t.endedAt),
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
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notified10min: boolean("notified_10min").notNull().default(false),
  },
  (t) => ({
    userIdx: index("queue_user_idx").on(t.userId),
    pendingIdx: index("queue_pending_idx").on(t.cancelledAt, t.fulfilledSlotId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("events_user_idx").on(t.userId),
    timeIdx: index("events_time_idx").on(t.createdAt),
  }),
);

export const presence = pgTable("presence", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  claudeRunning: boolean("claude_running").notNull().default(false),
  vscodeWindow: text("vscode_window"),
  hostname: text("hostname"),
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

export type User = typeof users.$inferSelect;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type QueueItem = typeof queue.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Presence = typeof presence.$inferSelect;
export type KillFlag = typeof killFlags.$inferSelect;
