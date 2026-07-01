// Stale-data and lifecycle cleanup. Idempotent — safe to invoke from a cron
// endpoint or opportunistically from request handlers.

import { db, schema } from "@/db";
import { and, eq, lt, isNull } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { getActiveSlots } from "@/lib/slots";
import { endSlot } from "@/lib/engine";
import { getConfig } from "@/lib/config";
import { isAdminBypass } from "@/lib/role";

let lastSweepAt = 0;

export async function maybeSweep(force = false) {
  const now = Date.now();
  if (!force && now - lastSweepAt < 30_000) return null;
  lastSweepAt = now;
  return runSweep();
}

export type SweepReport = {
  expiredSlots: number;
  idleEnded: number;
  staleHeartbeatEnded: number;
  expiredQueue: number;
  expiredApprovals: number;
  expiredRestrictions: number;
  expiredBroadcasts: number;
};

export async function runSweep(): Promise<SweepReport> {
  const cfg = await getConfig();
  const now = Date.now();

  // 1. Expire slots whose plannedEndAt has passed.
  const active = await getActiveSlots();
  let expiredSlots = 0;
  let idleEnded = 0;
  let staleHeartbeatEnded = 0;
  for (const r of active) {
    // Admins are exempt from automatic lifecycle enforcement. Their slots run
    // until they release or hand them off; idle/stale/expired don't touch them.
    if (isAdminBypass(r.user.role)) continue;

    const planned = new Date(r.slot.plannedEndAt).getTime();
    const lastActivity = r.slot.lastActivityAt
      ? new Date(r.slot.lastActivityAt).getTime()
      : new Date(r.slot.startedAt).getTime();
    const lastHb = r.slot.lastHeartbeatAt
      ? new Date(r.slot.lastHeartbeatAt).getTime()
      : new Date(r.slot.startedAt).getTime();
    // Idle is measured against the most recent of the two signals. On slow
    // hardware the hook can lag, but the extension is still reporting
    // presence; either one counts as "user is here".
    const last = Math.max(lastActivity, lastHb);

    if (planned < now) {
      await endSlot({
        slotId: r.slot.id,
        reason: "expired",
        endedBy: "auto",
        actorEmail: "system",
      });
      expiredSlots++;
      continue;
    }
    if (now - last >= cfg.idleAutoEndMinutes * 60_000) {
      await endSlot({
        slotId: r.slot.id,
        reason: "idle",
        endedBy: "auto-idle",
        actorEmail: "system",
        metadata: {
          idleMinutes: Math.round((now - last) / 60_000),
          activityGapMin: Math.round((now - lastActivity) / 60_000),
          heartbeatGapMin: Math.round((now - lastHb) / 60_000),
        },
      });
      idleEnded++;
      continue;
    }
    if (
      cfg.staleHeartbeatEnabled &&
      now - lastHb >= cfg.staleHeartbeatMinutes * 60_000
    ) {
      await endSlot({
        slotId: r.slot.id,
        reason: "stale_heartbeat",
        endedBy: "auto-stale",
        actorEmail: "system",
        metadata: { staleMinutes: Math.round((now - lastHb) / 60_000) },
      });
      staleHeartbeatEnded++;
    }
  }

  // 2. Expire queue items older than 4h still queued (no one near them).
  const fourHrAgo = new Date(now - 4 * 60 * 60_000);
  const stuck = await db
    .select()
    .from(schema.queue)
    .where(and(eq(schema.queue.status, "queued"), lt(schema.queue.requestedAt, fourHrAgo)));
  for (const q of stuck) {
    await db
      .update(schema.queue)
      .set({ status: "expired", expiredAt: new Date() })
      .where(eq(schema.queue.id, q.id));
    await audit({
      action: "queue.expired",
      actorEmail: "system",
      targetUserId: q.userId,
      queueId: q.id,
    });
  }

  // 3. Expire pending approvals past their auto-expire window.
  const approvalCutoff = new Date(now - cfg.approvalAutoExpireMinutes * 60_000);
  const expiredApprovalsRows = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.status, "pending"), lt(schema.approvals.requestedAt, approvalCutoff)));
  for (const a of expiredApprovalsRows) {
    await db
      .update(schema.approvals)
      .set({ status: "expired", decidedAt: new Date(), decidedBy: "auto" })
      .where(eq(schema.approvals.id, a.id));
    await audit({
      action: "approval.expired",
      actorEmail: "system",
      targetUserId: a.userId,
      approvalId: a.id,
    });
  }

  // 4. Deactivate restrictions past their expiry.
  const restrRows = await db
    .select()
    .from(schema.restrictions)
    .where(eq(schema.restrictions.active, true));
  let expiredRestrictions = 0;
  for (const r of restrRows) {
    if (r.expiresAt && new Date(r.expiresAt).getTime() < now) {
      await db
        .update(schema.restrictions)
        .set({ active: false })
        .where(eq(schema.restrictions.id, r.id));
      expiredRestrictions++;
      if (r.type === "cooldown") {
        await audit({
          action: "user.cooldown_cleared",
          actorEmail: "system",
          targetUserId: r.userId,
        });
      }
    }
  }

  // 5. Deactivate broadcasts past expiry.
  const bcasts = await db
    .select()
    .from(schema.broadcasts)
    .where(eq(schema.broadcasts.active, true));
  let expiredBroadcasts = 0;
  for (const b of bcasts) {
    if (b.expiresAt && new Date(b.expiresAt).getTime() < now) {
      await db
        .update(schema.broadcasts)
        .set({ active: false })
        .where(eq(schema.broadcasts.id, b.id));
      expiredBroadcasts++;
    }
  }

  // 6. Approved-but-unconsumed approvals past their expiry → mark expired.
  const approvedRows = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.status, "approved"), isNull(schema.approvals.consumedSlotId)));
  for (const a of approvedRows) {
    if (a.expiresAt && new Date(a.expiresAt).getTime() < now) {
      await db
        .update(schema.approvals)
        .set({ status: "expired" })
        .where(eq(schema.approvals.id, a.id));
      await audit({
        action: "approval.expired",
        actorEmail: "system",
        targetUserId: a.userId,
        approvalId: a.id,
        metadata: { stage: "post-approval" },
      });
    }
  }

  return {
    expiredSlots,
    idleEnded,
    staleHeartbeatEnded,
    expiredQueue: stuck.length,
    expiredApprovals: expiredApprovalsRows.length,
    expiredRestrictions,
    expiredBroadcasts,
  };
}

export async function archiveOld() {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60_000);

  // Hard-delete old completed/cancelled/expired queue rows
  await db
    .delete(schema.queue)
    .where(
      and(
        lt(schema.queue.requestedAt, dayAgo),
        eq(schema.queue.status, "completed"),
      ),
    );
  await db
    .delete(schema.queue)
    .where(
      and(
        lt(schema.queue.requestedAt, dayAgo),
        eq(schema.queue.status, "cancelled"),
      ),
    );
  await db
    .delete(schema.queue)
    .where(
      and(
        lt(schema.queue.requestedAt, dayAgo),
        eq(schema.queue.status, "expired"),
      ),
    );

  // Trim audit log older than 90 days
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60_000);
  await db.delete(schema.auditLog).where(lt(schema.auditLog.createdAt, ninetyDaysAgo));

  // Trim raw events older than 60 days (slots themselves stay)
  const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60_000);
  await db.delete(schema.events).where(lt(schema.events.createdAt, sixtyDaysAgo));

  await audit({
    action: "cron.archive_run",
    actorEmail: "system",
    metadata: { archivedAt: new Date().toISOString() },
  });
}
