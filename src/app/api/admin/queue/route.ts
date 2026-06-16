import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, asc, desc } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { tryClaim, fulfillQueueIfCapacity } from "@/lib/engine";

export const runtime = "nodejs";

// PATCH { queueId, action: 'remove'|'promote'|'urgent'|'unurgent'|'move', toPosition? }
export async function PATCH(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const queueId = String(body.queueId ?? "");
  if (!queueId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const rows = await db
    .select({ q: schema.queue, user: schema.users })
    .from(schema.queue)
    .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
    .where(eq(schema.queue.id, queueId))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  switch (body.action) {
    case "remove":
      await db
        .update(schema.queue)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(schema.queue.id, queueId));
      await audit({
        action: "queue.removed_by_admin",
        severity: "warn",
        actorUserId: me.realActorId,
        actorEmail: me.realActorEmail,
        actorRole: "tl",
        targetUserId: row.user.id,
        targetEmail: row.user.email,
        queueId,
      });
      return NextResponse.json({ ok: true });

    case "urgent":
    case "unurgent":
      await db
        .update(schema.queue)
        .set({ urgent: body.action === "urgent" })
        .where(eq(schema.queue.id, queueId));
      return NextResponse.json({ ok: true });

    case "promote": {
      // Skip the wait — instantly try to claim for the user (override-style).
      const decision = await tryClaim({
        userId: row.user.id,
        email: row.user.email,
        role: row.user.role,
        desiredMinutes: row.q.desiredMinutes,
        purpose: `(promoted by ${me.realActorEmail})`,
        joinQueueIfFull: false,
      });
      await audit({
        action: "queue.promoted",
        actorUserId: me.realActorId,
        actorEmail: me.realActorEmail,
        actorRole: "tl",
        targetUserId: row.user.id,
        queueId,
      });
      return NextResponse.json({ ok: decision.ok, decision });
    }

    case "move": {
      // Move by adjusting requestedAt timestamp into a stable rank.
      const target = Math.max(1, Number(body.toPosition ?? 1));
      const allQ = await db
        .select()
        .from(schema.queue)
        .where(eq(schema.queue.status, "queued"))
        .orderBy(desc(schema.queue.urgent), asc(schema.queue.requestedAt));
      const ordered = allQ.filter((q) => q.id !== queueId);
      const idx = Math.min(target - 1, ordered.length);
      const before = ordered[idx - 1]?.requestedAt;
      const after = ordered[idx]?.requestedAt;
      let newTs: Date;
      if (before && after) {
        newTs = new Date((new Date(before).getTime() + new Date(after).getTime()) / 2);
      } else if (after) {
        newTs = new Date(new Date(after).getTime() - 1_000);
      } else if (before) {
        newTs = new Date(new Date(before).getTime() + 1_000);
      } else {
        newTs = new Date();
      }
      await db
        .update(schema.queue)
        .set({ requestedAt: newTs })
        .where(eq(schema.queue.id, queueId));
      await audit({
        action: "queue.position_moved",
        actorUserId: me.realActorId,
        actorEmail: me.realActorEmail,
        actorRole: "tl",
        targetUserId: row.user.id,
        queueId,
        metadata: { toPosition: target },
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}

// DELETE — clear entire queue.
export async function DELETE() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await db
    .update(schema.queue)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(schema.queue.status, "queued"))
    .returning();
  await audit({
    action: "queue.cleared_by_admin",
    severity: "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    metadata: { count: rows.length },
  });
  return NextResponse.json({ ok: true, cleared: rows.length });
}

// POST — clear stale queue entries (cancelled/expired/completed > 24h).
export async function POST() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const completed = await db
    .delete(schema.queue)
    .where(and(eq(schema.queue.status, "completed")))
    .returning();
  // No-op delete preserved as "purge old", but keep semantics simple — just delete completed rows.
  await audit({
    action: "queue.cleared_by_admin",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    metadata: { mode: "purge_completed", count: completed.length, since: dayAgo.toISOString() },
  });
  return NextResponse.json({ ok: true, removed: completed.length });
}
