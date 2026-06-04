import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getActiveSlot, plannedEndAt } from "@/lib/slots";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const purpose = body.purpose ? String(body.purpose).slice(0, 200) : null;

  const active = await getActiveSlot();
  if (active) {
    return NextResponse.json(
      {
        error: "slot_busy",
        activeUser: active.user.email,
        plannedEndAt: active.slot.plannedEndAt,
      },
      { status: 409 },
    );
  }

  const startedAt = new Date();
  const [slot] = await db
    .insert(schema.slots)
    .values({
      userId,
      startedAt,
      plannedEndAt: plannedEndAt(startedAt),
      purpose,
    })
    .returning();

  await db
    .delete(schema.killFlags)
    .where(eq(schema.killFlags.userId, userId));

  return NextResponse.json({ ok: true, slot });
}
