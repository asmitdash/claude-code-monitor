import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { and, desc, eq, gt } from "drizzle-orm";

export const runtime = "nodejs";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string } | undefined;
  if (!me?.id || me.role !== "tl") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId } = await ctx.params;

  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!userRows[0]) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = userRows[0];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const slots = await db
    .select()
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, userId), gt(schema.slots.startedAt, since)))
    .orderBy(desc(schema.slots.startedAt));

  const events = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), gt(schema.events.createdAt, since)))
    .orderBy(desc(schema.events.createdAt))
    .limit(500);

  const presence = await db
    .select()
    .from(schema.presence)
    .where(eq(schema.presence.userId, userId))
    .limit(1);

  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push(startOfDay(d).toISOString().slice(0, 10));
  }
  const dailyMap = new Map(days.map((day) => [day, { day, minutes: 0, sessions: 0, events: 0 }]));
  for (const slot of slots) {
    const day = startOfDay(new Date(slot.startedAt)).toISOString().slice(0, 10);
    const end = slot.endedAt ?? new Date();
    const min = Math.max(
      0,
      (new Date(end).getTime() - new Date(slot.startedAt).getTime()) / 60000,
    );
    const e = dailyMap.get(day);
    if (e) {
      e.minutes += min;
      e.sessions += 1;
    }
  }
  for (const ev of events) {
    const day = startOfDay(new Date(ev.createdAt)).toISOString().slice(0, 10);
    const e = dailyMap.get(day);
    if (e) e.events += 1;
  }

  const toolCounts: Record<string, number> = {};
  for (const ev of events) {
    if (ev.tool) toolCounts[ev.tool] = (toolCounts[ev.tool] ?? 0) + 1;
  }
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }));

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
    daily: Array.from(dailyMap.values()),
    presence: presence[0]
      ? {
          lastSeenAt: presence[0].lastSeenAt,
          claudeRunning: presence[0].claudeRunning,
          hostname: presence[0].hostname,
          vscodeWindow: presence[0].vscodeWindow,
        }
      : null,
    recentSlots: slots.slice(0, 25).map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      endedBy: s.endedBy,
      purpose: s.purpose,
    })),
    topTools,
    totalSessions: slots.length,
    totalMinutes: Math.round(
      slots.reduce(
        (acc, s) =>
          acc +
          Math.max(
            0,
            (new Date(s.endedAt ?? new Date()).getTime() -
              new Date(s.startedAt).getTime()) /
              60000,
          ),
        0,
      ),
    ),
  });
}
