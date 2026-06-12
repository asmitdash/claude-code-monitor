import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { endSlot, fulfillQueueIfCapacity } from "@/lib/engine";
import { getActiveSlots } from "@/lib/slots";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { userId, reason } = await req.json();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

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
    actorRole: "tl",
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
        actorRole: "tl",
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
    actorRole: "tl",
    targetUserId: userId,
  });
  return NextResponse.json({ ok: true });
}
