import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { endSlot, fulfillQueueIfCapacity } from "@/lib/engine";
import { getActiveSlots } from "@/lib/slots";
import { isAdminBypass } from "@/lib/role";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { userId, reason } = await req.json();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

  // Admins cannot be kill-flagged — they have unrestricted access by policy.
  const target = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (target[0] && isAdminBypass(target[0].role)) {
    return NextResponse.json(
      { error: "admin_immune", message: "Admins have unrestricted access by policy" },
      { status: 409 },
    );
  }

  await db
    .insert(schema.killFlags)
    .values({
      userId,
      blocked: true,
      reason: reason ?? "ended by team lead",
      setBy: me.realActorEmail,
      setAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.killFlags.userId,
      set: {
        blocked: true,
        reason: reason ?? "ended by team lead",
        setBy: me.realActorEmail,
        setAt: new Date(),
      },
    });

  await audit({
    action: "kill.set",
    severity: "alert",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetUserId: userId,
    metadata: { reason: reason ?? "ended by team lead" },
  });

  // Force-end any active slot for that user
  const active = await getActiveSlots();
  for (const s of active) {
    if (s.user.id === userId) {
      await endSlot({
        slotId: s.slot.id,
        reason: "force_end",
        endedBy: me.realActorEmail,
        actorUserId: me.realActorId,
        actorEmail: me.realActorEmail,
        actorRole: "admin",
        metadata: { reason: reason ?? "ended by team lead" },
      });
    }
  }
  await fulfillQueueIfCapacity();

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });
  await db.delete(schema.killFlags).where(eq(schema.killFlags.userId, userId));
  await audit({
    action: "kill.cleared",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetUserId: userId,
  });
  return NextResponse.json({ ok: true });
}
