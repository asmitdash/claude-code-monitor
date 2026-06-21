import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { endSlot } from "@/lib/engine";
import { isAdminBypass } from "@/lib/role";

export const runtime = "nodejs";

// POST { userId } — full reset for a user: end any active slot, cancel queue,
// expire pending approvals, deactivate restrictions, clear kill flag.
// Cannot target other admins.
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

  const target = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (target[0] && isAdminBypass(target[0].role) && target[0].id !== me.realActorId) {
    return NextResponse.json(
      { error: "admin_immune", message: "Cannot reset another admin's state" },
      { status: 409 },
    );
  }

  const slots = await db
    .select()
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, userId), eq(schema.slots.status, "active")));
  for (const s of slots) {
    await endSlot({
      slotId: s.id,
      reason: "force_end",
      endedBy: me.realActorEmail,
      actorUserId: me.realActorId,
      actorEmail: me.realActorEmail,
      actorRole: "admin",
      metadata: { mode: "reset_state" },
    });
  }
  await db
    .update(schema.queue)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(schema.queue.userId, userId), eq(schema.queue.status, "queued")));
  await db
    .update(schema.approvals)
    .set({ status: "expired", decidedAt: new Date(), decidedBy: me.realActorEmail })
    .where(and(eq(schema.approvals.userId, userId), eq(schema.approvals.status, "pending")));
  await db
    .update(schema.restrictions)
    .set({ active: false })
    .where(and(eq(schema.restrictions.userId, userId), eq(schema.restrictions.active, true)));
  await db.delete(schema.killFlags).where(eq(schema.killFlags.userId, userId));

  await audit({
    action: "user.state_reset",
    severity: "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetUserId: userId,
  });
  return NextResponse.json({ ok: true });
}
