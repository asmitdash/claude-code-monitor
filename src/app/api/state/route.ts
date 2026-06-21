import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session-helper";
import {
  getActiveSlots,
  getQueue,
  getPresenceMap,
  getAllUsers,
  estimateQueueWaitMinutes,
} from "@/lib/slots";
import { maybeRunWarnings } from "@/lib/warnings";
import { maybeSweep } from "@/lib/cleanup";
import { getConfig } from "@/lib/config";
import { quotaFor, hasActiveOverride, activeRestrictions } from "@/lib/quota";
import { presenceState, STATE_ICON, STATE_LABEL } from "@/lib/presence-state";
import { scoreLabel } from "@/lib/activity";
import { isAdminBypass } from "@/lib/role";

export const runtime = "nodejs";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = me.realActorRole === "admin";
  const adminBypass = isAdminBypass(me.role);

  // opportunistic background work
  maybeRunWarnings().catch(() => {});
  maybeSweep().catch(() => {});

  const cfg = await getConfig();
  const activeSlots = await getActiveSlots();
  const queue = await getQueue();
  const presence = await getPresenceMap();

  const myQ = quotaFor(me.id);
  const myOverride = hasActiveOverride(me.id);
  const myRestr = activeRestrictions(me.id);
  const [quotaRaw, override, restr] = await Promise.all([myQ, myOverride, myRestr]);
  // Admins don't have quotas — flag unlimited so the UI hides the meter.
  // (Use 0/0 for the numeric fields rather than Infinity, which JSON-encodes
  // to null and trips the existing UI math.)
  const quota = adminBypass
    ? {
        ...quotaRaw,
        dailyUsedMinutes: 0,
        weeklyUsedMinutes: 0,
        dailyRemainingMinutes: 0,
        weeklyRemainingMinutes: 0,
        exhausted: false,
        unlimited: true,
      }
    : { ...quotaRaw, unlimited: false };

  const usersList = isAdmin ? await getAllUsers() : [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const myRecentSlots = await db
    .select()
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, me.id), gt(schema.slots.startedAt, sevenDaysAgo)))
    .orderBy(desc(schema.slots.startedAt));

  const allRecentSlots = isAdmin
    ? await db
        .select({ slot: schema.slots, user: schema.users })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
        .where(gt(schema.slots.startedAt, sevenDaysAgo))
        .orderBy(desc(schema.slots.startedAt))
    : [];

  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push(startOfDay(d).toISOString().slice(0, 10));
  }
  function bucket(rows: typeof myRecentSlots) {
    const map = new Map<string, { day: string; minutes: number; sessions: number }>();
    for (const day of days) map.set(day, { day, minutes: 0, sessions: 0 });
    for (const slot of rows) {
      const day = startOfDay(new Date(slot.startedAt)).toISOString().slice(0, 10);
      const end = slot.endedAt ?? new Date();
      const min = Math.max(
        0,
        (new Date(end).getTime() - new Date(slot.startedAt).getTime()) / 60000,
      );
      const e = map.get(day);
      if (e) {
        e.minutes += min;
        e.sessions += 1;
      }
    }
    return Array.from(map.values());
  }
  const myUsage = bucket(myRecentSlots);

  const allUsage = isAdmin
    ? Object.values(
        allRecentSlots.reduce<
          Record<
            string,
            {
              user: { id: string; email: string; name: string | null };
              days: ReturnType<typeof bucket>;
            }
          >
        >((acc, { slot, user }) => {
          if (!acc[user.id]) {
            acc[user.id] = {
              user: { id: user.id, email: user.email, name: user.name },
              days: days.map((day) => ({ day, minutes: 0, sessions: 0 })),
            };
          }
          const day = startOfDay(new Date(slot.startedAt)).toISOString().slice(0, 10);
          const end = slot.endedAt ?? new Date();
          const min = Math.max(
            0,
            (new Date(end).getTime() - new Date(slot.startedAt).getTime()) / 60000,
          );
          const b = acc[user.id].days.find((d) => d.day === day);
          if (b) {
            b.minutes += min;
            b.sessions += 1;
          }
          return acc;
        }, {}),
      )
    : [];

  const sixtySecAgo = new Date(Date.now() - 60_000);
  const fiveMinAgo = new Date(Date.now() - cfg.idleWarnMinutes * 60_000);

  const recentEventRows = isAdmin
    ? await db
        .select({
          userId: schema.events.userId,
          last: sql<Date>`max(${schema.events.createdAt})`.as("last"),
        })
        .from(schema.events)
        .where(gt(schema.events.createdAt, fiveMinAgo))
        .groupBy(schema.events.userId)
    : [];
  const recentEventByUser = new Map<string, Date>(
    recentEventRows.map((r) => [r.userId, new Date(r.last)]),
  );

  // Each user's last force-ended slot in last 5 minutes (for "ended" state)
  const recentEndsRows = isAdmin
    ? await db
        .select({
          userId: schema.slots.userId,
          last: sql<Date>`max(${schema.slots.endedAt})`.as("last"),
        })
        .from(schema.slots)
        .where(gt(schema.slots.endedAt, fiveMinAgo))
        .groupBy(schema.slots.userId)
    : [];
  const recentEndByUser = new Map<string, Date>(
    recentEndsRows.map((r) => [r.userId, new Date(r.last)]),
  );

  const overrideUsersRows = isAdmin
    ? await db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.status, "approved"))
    : [];
  const overrideUserSet = new Set(
    overrideUsersRows
      .filter(
        (a) =>
          !a.consumedSlotId &&
          (!a.expiresAt || new Date(a.expiresAt).getTime() > Date.now()),
      )
      .map((a) => a.userId),
  );

  const presenceArr = isAdmin
    ? usersList.map((u) => {
        const p = presence.get(u.id) ?? null;
        const lastEvt = recentEventByUser.get(u.id) ?? null;
        const recentEnded = recentEndByUser.get(u.id) ?? null;
        const state = presenceState({
          presence: p,
          lastEventAt: lastEvt,
          hasOverride: overrideUserSet.has(u.id),
          recentSlotEndedAt: recentEnded,
          staleHeartbeatMinutes: cfg.staleHeartbeatMinutes,
          idleWarnMinutes: cfg.idleWarnMinutes,
        });
        const userActiveSlot = activeSlots.find((s) => s.user.id === u.id);
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          state,
          stateIcon: STATE_ICON[state],
          stateLabel: STATE_LABEL[state],
          claudeRunning: !!lastEvt,
          extensionAlive:
            !!p?.lastSeenAt &&
            new Date(p.lastSeenAt).getTime() > Date.now() - 60_000,
          lastSeenAt: p?.lastSeenAt ?? null,
          lastEventAt: lastEvt ? lastEvt.toISOString() : null,
          activityScore: userActiveSlot?.slot.activityScore ?? 0,
          activityLabel: scoreLabel(userActiveSlot?.slot.activityScore ?? 0),
          vscodeWindow: p?.vscodeWindow ?? null,
          hostname: p?.hostname ?? null,
          extensionVersion: p?.extensionVersion ?? null,
          hasOverride: overrideUserSet.has(u.id),
          activeSlotNumber: userActiveSlot?.slot.slotNumber ?? null,
        };
      })
    : [];

  // Banner / freeze / broadcast
  const banner = await db
    .select()
    .from(schema.broadcasts)
    .where(eq(schema.broadcasts.active, true))
    .orderBy(desc(schema.broadcasts.createdAt))
    .limit(1);

  // Pending approvals (for admin); my approvals (for member)
  const pendingApprovals = isAdmin
    ? await db
        .select({ a: schema.approvals, user: schema.users })
        .from(schema.approvals)
        .innerJoin(schema.users, eq(schema.approvals.userId, schema.users.id))
        .where(eq(schema.approvals.status, "pending"))
        .orderBy(asc(schema.approvals.requestedAt))
    : [];

  const myApprovals = await db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.userId, me.id))
    .orderBy(desc(schema.approvals.requestedAt))
    .limit(5);

  const myActive = activeSlots.find((s) => s.user.id === me.id) ?? null;
  const myQueueEntry = queue.find((q) => q.user.id === me.id);
  const myPosition = myQueueEntry
    ? Math.max(1, queue.findIndex((q) => q.user.id === me.id) + 1)
    : null;
  const myEta = myPosition ? await estimateQueueWaitMinutes(myPosition) : null;

  const queueWithEta = await Promise.all(
    queue.map(async (q, i) => ({
      id: q.item.id,
      position: i + 1,
      etaMin: await estimateQueueWaitMinutes(i + 1),
      userId: q.user.id,
      email: q.user.email,
      name: q.user.name,
      requestedAt: q.item.requestedAt,
      desiredMinutes: q.item.desiredMinutes,
      urgent: q.item.urgent,
      note: q.item.note,
    })),
  );

  return NextResponse.json({
    me: {
      id: me.id,
      role: me.role,
      email: me.email,
      isImpersonating: me.isImpersonating,
      realActorEmail: me.realActorEmail,
      adminBypass,
    },
    config: {
      maxConcurrentSlots: cfg.maxConcurrentSlots,
      maxSlotMinutes: cfg.maxSlotMinutes,
      idleWarnMinutes: cfg.idleWarnMinutes,
      idleAutoEndMinutes: cfg.idleAutoEndMinutes,
      graceTimerSeconds: cfg.graceTimerSeconds,
    },
    banner: banner[0]
      ? {
          message: banner[0].message,
          severity: banner[0].severity,
          expiresAt: banner[0].expiresAt,
        }
      : null,
    freeze:
      cfg.freezeUntil && new Date(cfg.freezeUntil).getTime() > Date.now()
        ? { until: cfg.freezeUntil, banner: cfg.freezeBanner }
        : null,
    slots: activeSlots.map((s) => ({
      id: s.slot.id,
      slotNumber: s.slot.slotNumber,
      userId: s.user.id,
      email: s.user.email,
      name: s.user.name,
      role: s.user.role,
      startedAt: s.slot.startedAt,
      plannedEndAt: s.slot.plannedEndAt,
      durationMinutes: s.slot.durationMinutes,
      extendedMinutes: s.slot.extendedMinutes,
      purpose: s.slot.purpose,
      cwd: s.slot.cwd,
      activityScore: s.slot.activityScore,
      activityLabel: scoreLabel(s.slot.activityScore),
      toolCallCount: s.slot.toolCallCount,
      eventCount: s.slot.eventCount,
      estimatedTokens: s.slot.estimatedTokens,
      lastActivityAt: s.slot.lastActivityAt,
      lastHeartbeatAt: s.slot.lastHeartbeatAt,
      isOverride: s.slot.slotNumber === 0,
    })),
    queue: queueWithEta,
    myActive: myActive
      ? {
          id: myActive.slot.id,
          slotNumber: myActive.slot.slotNumber,
          startedAt: myActive.slot.startedAt,
          plannedEndAt: myActive.slot.plannedEndAt,
          durationMinutes: myActive.slot.durationMinutes,
          extendedMinutes: myActive.slot.extendedMinutes,
          purpose: myActive.slot.purpose,
        }
      : null,
    myQueueEntry: myQueueEntry
      ? {
          id: myQueueEntry.item.id,
          position: myPosition!,
          etaMin: myEta!,
          desiredMinutes: myQueueEntry.item.desiredMinutes,
          urgent: myQueueEntry.item.urgent,
          note: myQueueEntry.item.note,
        }
      : null,
    myQuota: quota,
    myOverride: override.active
      ? { id: override.approval!.id, expiresAt: override.approval!.expiresAt }
      : null,
    myRestriction:
      restr.banned || restr.paused || restr.cooldownUntil
        ? { ...restr }
        : null,
    myApprovals,
    pendingApprovals: pendingApprovals.map((p) => ({
      id: p.a.id,
      userId: p.user.id,
      email: p.user.email,
      name: p.user.name,
      requestedAt: p.a.requestedAt,
      reason: p.a.reason,
      desiredMinutes: p.a.desiredMinutes,
      expiresAt: p.a.expiresAt,
    })),
    myUsage,
    allUsage,
    presence: presenceArr,
    serverNow: new Date().toISOString(),
  });
}
