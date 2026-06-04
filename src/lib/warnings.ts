import { db, schema } from "@/db";
import { and, eq, isNull, lt, gt } from "drizzle-orm";
import { sendMail } from "@/lib/email";

let lastRun = 0;

export async function maybeRunWarnings() {
  const now = Date.now();
  if (now - lastRun < 30_000) return;
  lastRun = now;

  const tenFromNow = new Date(now + 10 * 60_000);
  const dueSlots = await db
    .select({ slot: schema.slots, user: schema.users })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(
      and(
        isNull(schema.slots.endedAt),
        eq(schema.slots.warned10min, false),
        lt(schema.slots.plannedEndAt, tenFromNow),
        gt(schema.slots.plannedEndAt, new Date(now)),
      ),
    );

  for (const { slot, user } of dueSlots) {
    await db
      .update(schema.slots)
      .set({ warned10min: true })
      .where(eq(schema.slots.id, slot.id));
    sendMail(
      user.email,
      "Claude Code: 10 minutes remaining in your slot",
      `<p>Hi ${user.name ?? user.email.split("@")[0]},</p>
       <p>Your Claude Code slot ends in ~10 minutes (at ${new Date(slot.plannedEndAt).toLocaleTimeString()}).</p>
       <p>This is a soft reminder — your session will not be auto-terminated.</p>`,
    ).catch((e) => console.error("[warnings] active mail failed", e));
  }

  if (dueSlots.length > 0) {
    const next = await db
      .select({ q: schema.queue, user: schema.users })
      .from(schema.queue)
      .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
      .where(
        and(
          isNull(schema.queue.cancelledAt),
          isNull(schema.queue.fulfilledSlotId),
          eq(schema.queue.notified10min, false),
        ),
      )
      .orderBy(schema.queue.requestedAt)
      .limit(1);
    if (next[0]) {
      await db
        .update(schema.queue)
        .set({ notified10min: true })
        .where(eq(schema.queue.id, next[0].q.id));
      sendMail(
        next[0].user.email,
        "Claude Code: you're up in ~10 minutes",
        `<p>Heads up — the current Claude Code slot ends in ~10 minutes.</p>
         <p>You'll be free to claim a slot next.</p>`,
      ).catch((e) => console.error("[warnings] queue mail failed", e));
    }
  }
}
