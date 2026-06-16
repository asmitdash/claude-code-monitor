import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { endSlot, fulfillQueueIfCapacity } from "@/lib/engine";
import { isTLBypass } from "@/lib/role";

export const runtime = "nodejs";

// POST { slotId, reason? } — TL force-end without setting kill flag.
// TL-owned slots cannot be force-ended by another TL — TL access is immune by
// policy. The owning TL releases their own slot via /api/slot/release.
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const slotId = String(body.slotId ?? "");
  if (!slotId) return NextResponse.json({ error: "missing_slot" }, { status: 400 });

  const slotOwner = await db
    .select({ user: schema.users })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(eq(schema.slots.id, slotId))
    .limit(1);
  if (slotOwner[0] && isTLBypass(slotOwner[0].user.role) && slotOwner[0].user.id !== me.realActorId) {
    return NextResponse.json(
      { error: "tl_immune", message: "TL slots can only be released by the owning TL" },
      { status: 409 },
    );
  }

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
