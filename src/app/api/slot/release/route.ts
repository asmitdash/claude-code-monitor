import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getActiveSlot } from "@/lib/slots";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const active = await getActiveSlot();
  if (!active || active.user.id !== userId) {
    return NextResponse.json({ error: "no_active_slot" }, { status: 404 });
  }

  await db
    .update(schema.slots)
    .set({ endedAt: new Date(), endedBy: "self" })
    .where(eq(schema.slots.id, active.slot.id));

  return NextResponse.json({ ok: true });
}
