import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq, gt, isNotNull, ne } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";

export const runtime = "nodejs";

export async function GET() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      slotId: schema.slots.id,
      userId: schema.slots.userId,
      email: schema.users.email,
      name: schema.users.name,
      startedAt: schema.slots.startedAt,
      endedAt: schema.slots.endedAt,
      endedBy: schema.slots.endedBy,
      status: schema.slots.status,
      purpose: schema.slots.purpose,
      activityScore: schema.slots.activityScore,
    })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(
      and(
        gt(schema.slots.startedAt, fourteenDaysAgo),
        isNotNull(schema.slots.endedBy),
        ne(schema.slots.endedBy, "self"),
      ),
    )
    .orderBy(desc(schema.slots.endedAt))
    .limit(50);

  return NextResponse.json({
    kills: rows.map((r) => ({
      slotId: r.slotId,
      userId: r.userId,
      email: r.email,
      name: r.name,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      endedBy: r.endedBy,
      status: r.status,
      purpose: r.purpose,
      activityScore: r.activityScore,
      durationMin:
        r.endedAt && r.startedAt
          ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)
          : null,
    })),
  });
}
