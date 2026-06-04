import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, isNull, and } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string; email?: string } | undefined;
  if (!me?.id || me.role !== "tl") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId, reason } = await req.json();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

  await db
    .insert(schema.killFlags)
    .values({
      userId,
      blocked: true,
      reason: reason ?? "ended by team lead",
      setBy: me.email ?? "tl",
      setAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.killFlags.userId,
      set: {
        blocked: true,
        reason: reason ?? "ended by team lead",
        setBy: me.email ?? "tl",
        setAt: new Date(),
      },
    });

  await db
    .update(schema.slots)
    .set({ endedAt: new Date(), endedBy: me.email ?? "tl" })
    .where(and(eq(schema.slots.userId, userId), isNull(schema.slots.endedAt)));

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string } | undefined;
  if (!me?.id || me.role !== "tl") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });

  await db.delete(schema.killFlags).where(eq(schema.killFlags.userId, userId));
  return NextResponse.json({ ok: true });
}
