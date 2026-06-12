import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session-helper";
import { getActiveSlotForUser, getQueue } from "@/lib/slots";
import { endSlot, tryClaim } from "@/lib/engine";

export const runtime = "nodejs";

// Handoff: end my slot AND immediately give it to a specific queued user
// (or the head of the queue) without normal capacity wait.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetUserId = body.targetUserId ? String(body.targetUserId) : null;

  const active = await getActiveSlotForUser(me.id);
  if (!active) return NextResponse.json({ error: "no_active_slot" }, { status: 404 });

  const queue = await getQueue();
  const target = targetUserId
    ? queue.find((q) => q.user.id === targetUserId)
    : queue[0];
  if (!target) return NextResponse.json({ error: "no_target" }, { status: 404 });

  await endSlot({
    slotId: active.slot.id,
    reason: "handoff",
    endedBy: "handoff",
    actorUserId: me.id,
    actorEmail: me.email,
    actorRole: me.role,
    metadata: { handedTo: target.user.email },
  });

  // Mark target's queue entry as fulfilled (engine will overwrite with the new slot id)
  await db
    .update(schema.queue)
    .set({ status: "completed", fulfilledAt: new Date() })
    .where(eq(schema.queue.id, target.item.id));

  const decision = await tryClaim({
    userId: target.user.id,
    email: target.user.email,
    desiredMinutes: target.item.desiredMinutes,
    purpose: `(handed off by ${me.email})`,
    joinQueueIfFull: false,
  });

  return NextResponse.json({ ok: decision.ok, decision });
}
