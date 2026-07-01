// Core engine: claim, release, force-end, expire, fulfill-queue.
// Treat this as the single source of truth for slot lifecycle transitions.

import { db, schema } from "@/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import {
  findOpenSlotNumber,
  getActiveSlotForUser,
  getActiveSlots,
  plannedEndAt,
} from "@/lib/slots";
import { activeRestrictions, hasActiveOverride, lastForceKillAt, quotaFor } from "@/lib/quota";
import { isAdminBypass } from "@/lib/role";

export type ClaimDecision =
  | { ok: true; slot: typeof schema.slots.$inferSelect; reason: "allocated" | "override" | "admin_bypass" }
  | { ok: false; reason: "no_capacity"; queued?: { id: string; position: number; etaMin: number } }
  | { ok: false; reason: "exceeds_max_minutes"; cap: number }
  | { ok: false; reason: "paused" | "banned" }
  | { ok: false; reason: "cooldown"; until: Date }
  | { ok: false; reason: "quota_daily" | "quota_weekly"; resetMinutes: number }
  | { ok: false; reason: "freeze"; until: Date | null }
  | { ok: false; reason: "already_active"; slot: typeof schema.slots.$inferSelect };

export async function tryClaim(opts: {
  userId: string;
  email: string;
  role?: string | null;
  desiredMinutes?: number;
  purpose?: string | null;
  cwd?: string | null;
  projectName?: string | null;
  joinQueueIfFull?: boolean;
  note?: string | null;
}): Promise<ClaimDecision> {
  const cfg = await getConfig();
  const adminBypass = isAdminBypass(opts.role);
  // TLs are exempt from the slot duration cap entirely — they pick whatever
  // duration they ask for (still floored at 15m to avoid junk slots).
  const desired = adminBypass
    ? Math.max(15, opts.desiredMinutes ?? 60)
    : Math.min(Math.max(15, opts.desiredMinutes ?? 60), cfg.maxSlotMinutes);

  // System freeze and member restrictions don't apply to TLs.
  if (
    !adminBypass &&
    cfg.freezeUntil &&
    new Date(cfg.freezeUntil).getTime() > Date.now()
  ) {
    return { ok: false, reason: "freeze", until: cfg.freezeUntil };
  }

  const existing = await getActiveSlotForUser(opts.userId);
  if (existing) {
    return { ok: false, reason: "already_active", slot: existing.slot };
  }

  if (!adminBypass) {
    const restr = await activeRestrictions(opts.userId);
    if (restr.banned) return { ok: false, reason: "banned" };
    if (restr.paused) return { ok: false, reason: "paused" };
    if (restr.cooldownUntil && new Date(restr.cooldownUntil).getTime() > Date.now()) {
      return { ok: false, reason: "cooldown", until: restr.cooldownUntil };
    }
  }

  const override = await hasActiveOverride(opts.userId);

  if (!override.active && !adminBypass) {
    const q = await quotaFor(opts.userId);
    if (q.dailyRemainingMinutes <= 0) {
      return { ok: false, reason: "quota_daily", resetMinutes: minutesUntilNextDay() };
    }
    if (q.weeklyRemainingMinutes <= 0) {
      return { ok: false, reason: "quota_weekly", resetMinutes: minutesUntilNextWeek() };
    }
  }

  const slotNumber = await findOpenSlotNumber();
  if (!slotNumber && !override.active && !adminBypass) {
    if (opts.joinQueueIfFull) {
      const existingQ = await db
        .select()
        .from(schema.queue)
        .where(and(eq(schema.queue.userId, opts.userId), eq(schema.queue.status, "queued")))
        .limit(1);
      let qid: string;
      if (existingQ[0]) {
        qid = existingQ[0].id;
      } else {
        const [created] = await db
          .insert(schema.queue)
          .values({
            userId: opts.userId,
            desiredMinutes: desired,
            note: opts.note ?? null,
          })
          .returning();
        qid = created.id;
        await audit({
          action: "queue.joined",
          actorUserId: opts.userId,
          actorEmail: opts.email,
          targetUserId: opts.userId,
          targetEmail: opts.email,
          queueId: qid,
          metadata: { desiredMinutes: desired, note: opts.note ?? null },
        });
      }
      const all = await db
        .select()
        .from(schema.queue)
        .where(eq(schema.queue.status, "queued"))
        .orderBy(desc(schema.queue.urgent), asc(schema.queue.requestedAt));
      const position = Math.max(1, all.findIndex((q) => q.id === qid) + 1);
      return {
        ok: false,
        reason: "no_capacity",
        queued: { id: qid, position, etaMin: 0 },
      };
    }
    return { ok: false, reason: "no_capacity" };
  }

  const startedAt = new Date();
  // slotNumber 0 = out-of-band capacity (TL bypass or member override).
  // Members fall through here only when slotNumber is 1..N.
  const slotNum = adminBypass ? 0 : slotNumber ?? 0;
  const [slot] = await db
    .insert(schema.slots)
    .values({
      userId: opts.userId,
      slotNumber: slotNum,
      startedAt,
      plannedEndAt: plannedEndAt(startedAt, desired),
      durationMinutes: desired,
      purpose: opts.purpose ?? null,
      cwd: opts.cwd ?? null,
      projectName: opts.projectName ?? null,
      lastHeartbeatAt: startedAt,
      lastActivityAt: startedAt,
      overrideApprovalId: override.active ? override.approval?.id ?? null : null,
      status: "active",
    })
    .returning();

  if (override.active && override.approval) {
    await db
      .update(schema.approvals)
      .set({ consumedSlotId: slot.id })
      .where(eq(schema.approvals.id, override.approval.id));
    await audit({
      action: "approval.consumed",
      actorUserId: opts.userId,
      actorEmail: opts.email,
      targetUserId: opts.userId,
      targetEmail: opts.email,
      slotId: slot.id,
      approvalId: override.approval.id,
    });
  }

  // Clear kill flag for this user
  await db.delete(schema.killFlags).where(eq(schema.killFlags.userId, opts.userId));

  // If user was queued, mark that queue entry fulfilled
  await db
    .update(schema.queue)
    .set({
      status: "completed",
      fulfilledSlotId: slot.id,
      fulfilledAt: new Date(),
    })
    .where(and(eq(schema.queue.userId, opts.userId), eq(schema.queue.status, "queued")));

  await audit({
    action: "slot.claimed",
    actorUserId: opts.userId,
    actorEmail: opts.email,
    actorRole: opts.role ?? null,
    targetUserId: opts.userId,
    targetEmail: opts.email,
    slotId: slot.id,
    metadata: {
      slotNumber: slotNum,
      durationMinutes: desired,
      override: override.active,
      adminBypass,
      purpose: opts.purpose ?? null,
    },
  });

  return {
    ok: true,
    slot,
    reason: adminBypass ? "admin_bypass" : override.active ? "override" : "allocated",
  };
}

export async function endSlot(opts: {
  slotId: string;
  reason:
    | "self"
    | "auto"
    | "idle"
    | "expired"
    | "force_end"
    | "stale_heartbeat"
    | "handoff";
  endedBy: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const slotRows = await db
    .select({ slot: schema.slots, user: schema.users })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(eq(schema.slots.id, opts.slotId))
    .limit(1);
  const row = slotRows[0];
  if (!row) return { ok: false as const, reason: "not_found" as const };
  if (row.slot.endedAt) return { ok: true as const, slot: row.slot, alreadyEnded: true };

  const status =
    opts.reason === "force_end"
      ? "force_ended"
      : opts.reason === "expired" || opts.reason === "idle" || opts.reason === "stale_heartbeat"
      ? "expired"
      : "ended";

  await db
    .update(schema.slots)
    .set({
      endedAt: new Date(),
      endedBy: opts.endedBy,
      status,
    })
    .where(eq(schema.slots.id, opts.slotId));

  const action =
    opts.reason === "force_end"
      ? "slot.force_ended"
      : opts.reason === "idle" || opts.reason === "stale_heartbeat"
      ? "slot.idle_ended"
      : opts.reason === "expired"
      ? "slot.expired"
      : opts.reason === "handoff"
      ? "slot.handed_off"
      : "slot.released";

  await audit({
    action: action as never,
    severity: opts.reason === "force_end" ? "alert" : "info",
    actorUserId: opts.actorUserId ?? row.user.id,
    actorEmail: opts.actorEmail ?? row.user.email,
    actorRole: opts.actorRole ?? null,
    targetUserId: row.user.id,
    targetEmail: row.user.email,
    slotId: row.slot.id,
    metadata: {
      reason: opts.reason,
      slotNumber: row.slot.slotNumber,
      ...(opts.metadata ?? {}),
    },
  });

  // Apply post-kill cooldown when force-ended.
  if (opts.reason === "force_end") {
    const cfg = await getConfig();
    if (cfg.cooldownAfterKillMinutes > 0) {
      await db.insert(schema.restrictions).values({
        userId: row.user.id,
        type: "cooldown",
        reason: "auto cooldown after force-end",
        setBy: opts.actorEmail ?? "system",
        expiresAt: new Date(Date.now() + cfg.cooldownAfterKillMinutes * 60_000),
      });
      await audit({
        action: "user.cooldown_started",
        actorEmail: opts.actorEmail ?? "system",
        targetUserId: row.user.id,
        targetEmail: row.user.email,
        metadata: { minutes: cfg.cooldownAfterKillMinutes },
      });
    }
  }

  return { ok: true as const, slot: { ...row.slot, endedAt: new Date(), status } };
}

export async function fulfillQueueIfCapacity() {
  const opens = (await getConfig()).maxConcurrentSlots - (await getActiveSlots()).length;
  if (opens <= 0) return [];
  const queued = await db
    .select({ q: schema.queue, user: schema.users })
    .from(schema.queue)
    .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
    .where(eq(schema.queue.status, "queued"))
    .orderBy(desc(schema.queue.urgent), asc(schema.queue.requestedAt))
    .limit(opens);

  const promoted: Array<{ userId: string; email: string; queueId: string }> = [];
  for (const q of queued) {
    promoted.push({ userId: q.user.id, email: q.user.email, queueId: q.q.id });
    // Notify they're up — soft signal; actual claim happens via grace-timer/UI.
    await audit({
      action: "queue.fulfilled",
      actorUserId: q.user.id,
      actorEmail: q.user.email,
      targetUserId: q.user.id,
      targetEmail: q.user.email,
      queueId: q.q.id,
      metadata: { graceSeconds: (await getConfig()).graceTimerSeconds },
    });
  }
  return promoted;
}

function minutesUntilNextDay() {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return Math.ceil((next.getTime() - Date.now()) / 60_000);
}

function minutesUntilNextWeek() {
  const d = new Date();
  const day = d.getDay() || 7;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (8 - day));
  return Math.ceil((next.getTime() - Date.now()) / 60_000);
}

export async function noteHeartbeat(slotId: string, opts?: {
  activityWeight?: number;
  tokens?: number;
  costMicros?: number;
  toolCallDelta?: number;
  eventDelta?: number;
  // presence=true means "user is present with Claude Code open" — advance
  // lastActivityAt so the idle-sweep doesn't kill a live slot when the hook
  // is flaky/slow (e.g. on old hardware), but don't touch the scoring
  // counters. presence-only advances never increment activityScore/eventCount.
  presence?: boolean;
}) {
  const set: Record<string, unknown> = {
    lastHeartbeatAt: new Date(),
  };
  if ((opts?.activityWeight ?? 0) > 0 || opts?.presence) {
    set.lastActivityAt = new Date();
  }
  await db
    .update(schema.slots)
    .set(set)
    .where(eq(schema.slots.id, slotId));

  if (opts && !opts.presence) {
    const inc = opts;
    // bump counters (only for real activity, not presence pings)
    await db
      .update(schema.slots)
      .set({
        activityScore: sql<number>`${schema.slots.activityScore} + ${inc.activityWeight ?? 0}`,
        eventCount: sql<number>`${schema.slots.eventCount} + ${inc.eventDelta ?? 1}`,
        toolCallCount: sql<number>`${schema.slots.toolCallCount} + ${inc.toolCallDelta ?? 0}`,
        estimatedTokens: sql<number>`${schema.slots.estimatedTokens} + ${inc.tokens ?? 0}`,
        estimatedCostMicros: sql<number>`${schema.slots.estimatedCostMicros} + ${inc.costMicros ?? 0}`,
      } as never)
      .where(eq(schema.slots.id, slotId));

    // Time-to-first-tool: stamp the ms delta from slot start on the very
    // first tool call (or first event, if no tool was involved).
    if ((inc.toolCallDelta ?? 0) > 0 || (inc.eventDelta ?? 0) > 0) {
      await db
        .update(schema.slots)
        .set({
          firstToolAtMs: sql<number>`
            case
              when ${schema.slots.firstToolAtMs} is not null then ${schema.slots.firstToolAtMs}
              else extract(epoch from (now() - ${schema.slots.startedAt})) * 1000
            end`,
        } as never)
        .where(eq(schema.slots.id, slotId));
    }
  }
}

