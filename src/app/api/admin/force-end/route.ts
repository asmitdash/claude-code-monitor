import { NextRequest, NextResponse } from "next/server";
import { requireTL } from "@/lib/session-helper";
import { endSlot, fulfillQueueIfCapacity } from "@/lib/engine";

export const runtime = "nodejs";

// POST { slotId, reason? } — TL force-end without setting kill flag.
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const slotId = String(body.slotId ?? "");
  if (!slotId) return NextResponse.json({ error: "missing_slot" }, { status: 400 });

  const result = await endSlot({
    slotId,
    reason: "force_end",
    endedBy: me.realActorEmail,
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    metadata: { reason: body.reason ?? null, mode: "force_end_only" },
  });
  await fulfillQueueIfCapacity();
  return NextResponse.json(result);
}
