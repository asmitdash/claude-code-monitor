import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, gt, and, desc } from "drizzle-orm";
import { getActiveSlot, getQueue, getPresenceMap, getAllUsers } from "@/lib/slots";
import { maybeRunWarnings } from "@/lib/warnings";

export const runtime = "nodejs";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function GET() {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string } | undefined;
  if (!me?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isTL = me.role === "tl";

  maybeRunWarnings().catch(() => {});

  const active = await getActiveSlot();
  const queue = await getQueue();
  const presence = await getPresenceMap();

  const usersList = isTL ? await getAllUsers() : [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const myRecentSlots = await db
    .select()
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, me.id), gt(schema.slots.startedAt, sevenDaysAgo)))
    .orderBy(desc(schema.slots.startedAt));

  const allRecentSlots = isTL
    ? await db
        .select({ slot: schema.slots, user: schema.users })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
        .where(gt(schema.slots.startedAt, sevenDaysAgo))
        .orderBy(desc(schema.slots.startedAt))
    : [];

  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push(startOfDay(d).toISOString().slice(0, 10));
  }

  function bucketSlots(rows: typeof myRecentSlots) {
    const map = new Map<string, { day: string; minutes: number; sessions: number }>();
    for (const day of days) map.set(day, { day, minutes: 0, sessions: 0 });
    for (const slot of rows) {
      const day = startOfDay(new Date(slot.startedAt)).toISOString().slice(0, 10);
      const end = slot.endedAt ?? new Date();
      const min = Math.max(0, (new Date(end).getTime() - new Date(slot.startedAt).getTime()) / 60000);
      const e = map.get(day);
      if (e) {
        e.minutes += min;
        e.sessions += 1;
      }
    }
    return Array.from(map.values());
  }

  const myUsage = bucketSlots(myRecentSlots);

  const allUsage = isTL
    ? Object.values(
        allRecentSlots.reduce<Record<string, { user: { id: string; email: string; name: string | null }; days: ReturnType<typeof bucketSlots> }>>((acc, { slot, user }) => {
          if (!acc[user.id]) {
            acc[user.id] = {
              user: { id: user.id, email: user.email, name: user.name },
              days: days.map((day) => ({ day, minutes: 0, sessions: 0 })),
            };
          }
          const day = startOfDay(new Date(slot.startedAt)).toISOString().slice(0, 10);
          const end = slot.endedAt ?? new Date();
          const min = Math.max(0, (new Date(end).getTime() - new Date(slot.startedAt).getTime()) / 60000);
          const bucket = acc[user.id].days.find((d) => d.day === day);
          if (bucket) {
            bucket.minutes += min;
            bucket.sessions += 1;
          }
          return acc;
        }, {}),
      )
    : [];

  const presenceArr = isTL
    ? usersList.map((u) => {
        const p = presence.get(u.id);
        const lastSeen = p?.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
        const fresh = lastSeen > Date.now() - 60_000;
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          claudeRunning: fresh ? p?.claudeRunning ?? false : false,
          lastSeenAt: p?.lastSeenAt ?? null,
          vscodeWindow: p?.vscodeWindow ?? null,
          hostname: p?.hostname ?? null,
        };
      })
    : [];

  return NextResponse.json({
    me: { id: me.id, role: me.role },
    active: active
      ? {
          userId: active.user.id,
          email: active.user.email,
          name: active.user.name,
          startedAt: active.slot.startedAt,
          plannedEndAt: active.slot.plannedEndAt,
          purpose: active.slot.purpose,
        }
      : null,
    queue: queue.map((q, i) => ({
      position: i + 1,
      userId: q.user.id,
      email: q.user.email,
      name: q.user.name,
      requestedAt: q.item.requestedAt,
    })),
    myUsage,
    allUsage,
    presence: presenceArr,
    serverNow: new Date().toISOString(),
  });
}
