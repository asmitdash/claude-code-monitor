import { db, schema } from "@/db";
import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { sendMail } from "@/lib/email";
import { getConfig } from "@/lib/config";

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
       <p>This is a soft reminder — if you need more time, request an extension from the dashboard.</p>`,
    ).catch((e) => console.error("[warnings] active mail failed", e));
  }

  const cfg = await getConfig();
  if (dueSlots.length > 0) {
    const next = await db
      .select({ q: schema.queue, user: schema.users })
      .from(schema.queue)
      .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
      .where(
        and(
          eq(schema.queue.status, "queued"),
          eq(schema.queue.notified10min, false),
        ),
      )
      .orderBy(desc(schema.queue.urgent), asc(schema.queue.requestedAt))
      .limit(cfg.maxConcurrentSlots);
    for (const n of next) {
      await db
        .update(schema.queue)
        .set({ notified10min: true })
        .where(eq(schema.queue.id, n.q.id));
      sendMail(
        n.user.email,
        "Claude Code: you're up in ~10 minutes",
        `<p>Heads up — a Claude Code slot ends in ~10 minutes.</p>
         <p>You'll be free to claim a slot next.</p>`,
      ).catch((e) => console.error("[warnings] queue mail failed", e));
    }
  }
}
