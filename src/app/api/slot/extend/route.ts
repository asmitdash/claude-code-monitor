import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session-helper";
import { getActiveSlotForUser, getQueue, plannedEndAt } from "@/lib/slots";
import { audit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { isTLBypass } from "@/lib/role";

export const runtime = "nodejs";

// Mid-session extension. If queue is empty → auto-grant. If anyone is queued →
// requires TL approval (creates a pending approval and the user has to ask).
// TLs are exempt — they always auto-grant, no cap, no queue-blocking.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const tlBypass = isTLBypass(me.role);
  const minutes = tlBypass
    ? Math.max(15, Number(body.minutes ?? 30))
    : Math.min(Math.max(15, Number(body.minutes ?? 30)), 120);

  const active = await getActiveSlotForUser(me.id);
  if (!active) return NextResponse.json({ error: "no_active_slot" }, { status: 404 });

  const cfg = await getConfig();
  const totalAfter = active.slot.durationMinutes + active.slot.extendedMinutes + minutes;
  if (!tlBypass && totalAfter > cfg.maxSlotMinutes) {
    return NextResponse.json(
      { error: "exceeds_max_minutes", cap: cfg.maxSlotMinutes },
      { status: 400 },
    );
  }

  const queue = await getQueue();
  if (queue.length > 0 && !tlBypass) {
    // Cannot self-grant; create an approval.
    const [a] = await db
      .insert(schema.approvals)
      .values({
        userId: me.id,
        reason: `Mid-session +${minutes}min — ${queue.length} queued`,
        desiredMinutes: minutes,
        expiresAt: new Date(Date.now() + cfg.approvalAutoExpireMinutes * 60_000),
      })
      .returning();
    await audit({
      action: "approval.requested",
      severity: "warn",
      actorUserId: me.id,
      actorEmail: me.email,
      targetUserId: me.id,
      targetEmail: me.email,
      approvalId: a.id,
      metadata: { reason: "mid_session_extend", minutes, queueLen: queue.length },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "queue_not_empty",
        approvalId: a.id,
        queueLen: queue.length,
      },
      { status: 202 },
    );
  }

  // Auto-grant.
  const newPlanned = plannedEndAt(
    new Date(active.slot.startedAt),
    active.slot.durationMinutes + active.slot.extendedMinutes + minutes,
  );
  await db
    .update(schema.slots)
    .set({
      plannedEndAt: newPlanned,
      extendedMinutes: sql<number>`${schema.slots.extendedMinutes} + ${minutes}`,
      extendedCount: sql<number>`${schema.slots.extendedCount} + 1`,
      warned10min: false,
    } as never)
    .where(eq(schema.slots.id, active.slot.id));

  await audit({
    action: "slot.extended",
    actorUserId: me.id,
    actorEmail: me.email,
    targetUserId: me.id,
    targetEmail: me.email,
    slotId: active.slot.id,
    metadata: { addedMinutes: minutes, newPlannedEndAt: newPlanned.toISOString() },
  });

  return NextResponse.json({ ok: true, plannedEndAt: newPlanned });
}
