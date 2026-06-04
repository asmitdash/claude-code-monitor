import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { and, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await db
    .select()
    .from(schema.queue)
    .where(
      and(
        eq(schema.queue.userId, userId),
        isNull(schema.queue.cancelledAt),
        isNull(schema.queue.fulfilledSlotId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return NextResponse.json({ ok: true, queueId: existing[0].id, alreadyQueued: true });
  }

  const [item] = await db
    .insert(schema.queue)
    .values({ userId })
    .returning();

  return NextResponse.json({ ok: true, queueId: item.id });
}

export async function DELETE(_req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await db
    .update(schema.queue)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(schema.queue.userId, userId),
        isNull(schema.queue.cancelledAt),
        isNull(schema.queue.fulfilledSlotId),
      ),
    );

  return NextResponse.json({ ok: true });
}
