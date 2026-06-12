import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session-helper";
import { getActiveSlotForUser } from "@/lib/slots";
import { endSlot, fulfillQueueIfCapacity } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = await getActiveSlotForUser(me.id);
  if (!active) return NextResponse.json({ error: "no_active_slot" }, { status: 404 });

  await endSlot({
    slotId: active.slot.id,
    reason: "self",
    endedBy: "self",
    actorUserId: me.id,
    actorEmail: me.email,
    actorRole: me.role,
  });
  await fulfillQueueIfCapacity();

  return NextResponse.json({ ok: true });
}
