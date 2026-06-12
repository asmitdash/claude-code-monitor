import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { count, desc, eq, gt } from "drizzle-orm";
import { getActiveSlots, getQueue } from "@/lib/slots";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const start = Date.now();
  let dbOk = false;
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch (e) {
    dbOk = false;
  }

  const [activeSlots, queueLen, recentEvtRows, lastAudit, oldestActiveSlot] = await Promise.all([
    getActiveSlots(),
    getQueue(),
    db
      .select({ c: count() })
      .from(schema.events)
      .where(gt(schema.events.createdAt, new Date(Date.now() - 5 * 60 * 1000))),
    db
      .select()
      .from(schema.auditLog)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1),
    db
      .select()
      .from(schema.slots)
      .where(eq(schema.slots.status, "active"))
      .orderBy(schema.slots.startedAt)
      .limit(1),
  ]);

  const lastCronRun = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, "cron.cleanup_run"))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(1);

  return NextResponse.json({
    ok: dbOk,
    dbLatencyMs,
    activeSlotCount: activeSlots.length,
    queueLength: queueLen.length,
    eventsLast5Min: recentEvtRows[0]?.c ?? 0,
    lastAuditAt: lastAudit[0]?.createdAt ?? null,
    lastCleanupCronAt: lastCronRun[0]?.createdAt ?? null,
    oldestActiveSlotAgeMin: oldestActiveSlot[0]
      ? Math.round(
          (Date.now() - new Date(oldestActiveSlot[0].startedAt).getTime()) / 60_000,
        )
      : null,
    serverNow: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  });
}
