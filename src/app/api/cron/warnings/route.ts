import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, isNull, lt, gt } from "drizzle-orm";
import { sendMail } from "@/lib/email";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const tenFromNow = new Date(now.getTime() + 10 * 60_000);

  const dueSlots = await db
    .select({ slot: schema.slots, user: schema.users })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(
      and(
        isNull(schema.slots.endedAt),
        eq(schema.slots.warned10min, false),
        lt(schema.slots.plannedEndAt, tenFromNow),
        gt(schema.slots.plannedEndAt, now),
      ),
    );

  let activeWarned = 0;
  for (const { slot, user } of dueSlots) {
    await sendMail(
      user.email,
      "Claude Code: 10 minutes remaining in your slot",
      `<p>Hi ${user.name ?? user.email.split("@")[0]},</p>
       <p>Your Claude Code slot ends in ~10 minutes (at ${new Date(slot.plannedEndAt).toLocaleTimeString()}).</p>
       <p>This is a soft reminder — your session will not be auto-terminated.</p>`,
    );
    await db
      .update(schema.slots)
      .set({ warned10min: true })
      .where(eq(schema.slots.id, slot.id));
    activeWarned++;
  }

  const queued = await db
    .select({ q: schema.queue, user: schema.users })
    .from(schema.queue)
    .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
    .where(
      and(
        isNull(schema.queue.cancelledAt),
        isNull(schema.queue.fulfilledSlotId),
        eq(schema.queue.notified10min, false),
      ),
    );

  let queueWarned = 0;
  if (queued.length > 0 && dueSlots.length > 0) {
    const next = queued[0];
    await sendMail(
      next.user.email,
      "Claude Code: you're up in ~10 minutes",
      `<p>Heads up — the current Claude Code slot ends in ~10 minutes.</p>
       <p>You'll be free to claim a slot next.</p>`,
    );
    await db
      .update(schema.queue)
      .set({ notified10min: true })
      .where(eq(schema.queue.id, next.q.id));
    queueWarned++;
  }

  return NextResponse.json({ ok: true, activeWarned, queueWarned });
}
