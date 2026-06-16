import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const slots = await db
    .select({ slot: schema.slots, user: schema.users })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(gt(schema.slots.startedAt, since))
    .orderBy(desc(schema.slots.startedAt));

  const approvals = await db
    .select()
    .from(schema.approvals)
    .where(gt(schema.approvals.requestedAt, since));

  // Per-user aggregates
  const perUser = new Map<
    string,
    {
      userId: string;
      email: string;
      name: string | null;
      totalMinutes: number;
      totalSessions: number;
      avgSessionMinutes: number;
      longestMinutes: number;
      forceEndedCount: number;
      idleEndedCount: number;
      tlOverrideCount: number;
      estimatedTokens: number;
      estimatedCostUsd: number;
    }
  >();
  for (const { slot, user } of slots) {
    const end = slot.endedAt ?? new Date();
    const min = Math.max(
      0,
      (new Date(end).getTime() - new Date(slot.startedAt).getTime()) / 60_000,
    );
    const e =
      perUser.get(user.id) ??
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        totalMinutes: 0,
        totalSessions: 0,
        avgSessionMinutes: 0,
        longestMinutes: 0,
        forceEndedCount: 0,
        idleEndedCount: 0,
        tlOverrideCount: 0,
        estimatedTokens: 0,
        estimatedCostUsd: 0,
      };
    e.totalMinutes += min;
    e.totalSessions += 1;
    if (min > e.longestMinutes) e.longestMinutes = min;
    if (slot.status === "force_ended") e.forceEndedCount += 1;
    if (slot.status === "expired" && slot.endedBy?.startsWith("auto-idle")) e.idleEndedCount += 1;
    if (slot.slotNumber === 0) e.tlOverrideCount += 1;
    e.estimatedTokens += slot.estimatedTokens;
    e.estimatedCostUsd += slot.estimatedCostMicros / 1_000_000;
    perUser.set(user.id, e);
  }
  for (const e of perUser.values()) {
    e.avgSessionMinutes = e.totalSessions ? Math.round(e.totalMinutes / e.totalSessions) : 0;
    e.totalMinutes = Math.round(e.totalMinutes);
    e.longestMinutes = Math.round(e.longestMinutes);
    e.estimatedCostUsd = Math.round(e.estimatedCostUsd * 100) / 100;
  }
  const perUserArr = Array.from(perUser.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes,
  );

  // Hourly heatmap (which hours of the day are busiest)
  const heatmap = new Array(24).fill(0);
  const hourSlotMin = new Array(24).fill(0);
  for (const { slot } of slots) {
    const startH = new Date(slot.startedAt).getHours();
    const end = new Date(slot.endedAt ?? Date.now());
    const start = new Date(slot.startedAt);
    let cursor = new Date(start);
    while (cursor < end) {
      const h = cursor.getHours();
      const next = new Date(cursor);
      next.setHours(cursor.getHours() + 1, 0, 0, 0);
      const slotEnd = next > end ? end : next;
      hourSlotMin[h] += (slotEnd.getTime() - cursor.getTime()) / 60_000;
      cursor = next;
    }
    heatmap[startH] += 1;
  }

  // Approval stats
  const approvalStats = {
    total: approvals.length,
    pending: approvals.filter((a) => a.status === "pending").length,
    approved: approvals.filter((a) => a.status === "approved").length,
    rejected: approvals.filter((a) => a.status === "rejected").length,
    expired: approvals.filter((a) => a.status === "expired").length,
  };

  // Slot utilization (numbered member slots only — TL bypass slots are
  // out-of-band capacity and shouldn't pollute the utilization signal).
  const memberSlotMinutes = slots.reduce(
    (acc, { slot }) =>
      slot.slotNumber > 0
        ? acc +
          Math.max(
            0,
            ((slot.endedAt ?? new Date()).getTime() - new Date(slot.startedAt).getTime()) / 60_000,
          )
        : acc,
    0,
  );
  const capacityMin = days * 24 * 60 * 2; // 2 = max concurrent slots default; UI may scale
  const utilization = capacityMin > 0 ? memberSlotMinutes / capacityMin : 0;
  const allMinutes = memberSlotMinutes;

  // Queue stats
  const queueRows = await db
    .select()
    .from(schema.queue)
    .where(gt(schema.queue.requestedAt, since));
  const completed = queueRows.filter((q) => q.status === "completed");
  const queueWaitMin = completed
    .map((q) =>
      q.fulfilledAt
        ? Math.max(
            0,
            (new Date(q.fulfilledAt).getTime() - new Date(q.requestedAt).getTime()) / 60_000,
          )
        : 0,
    )
    .filter((m) => m > 0);
  const avgQueueWait = queueWaitMin.length
    ? Math.round(queueWaitMin.reduce((a, b) => a + b, 0) / queueWaitMin.length)
    : 0;
  const p95QueueWait = queueWaitMin.length
    ? Math.round(
        queueWaitMin.sort((a, b) => a - b)[Math.floor(queueWaitMin.length * 0.95)] ?? 0,
      )
    : 0;

  return NextResponse.json({
    days,
    perUser: perUserArr,
    heatmap, // session starts per hour
    hourMinutes: hourSlotMin.map((v) => Math.round(v)),
    approvals: approvalStats,
    queue: {
      total: queueRows.length,
      completed: completed.length,
      cancelled: queueRows.filter((q) => q.status === "cancelled").length,
      expired: queueRows.filter((q) => q.status === "expired").length,
      avgWaitMin: avgQueueWait,
      p95WaitMin: p95QueueWait,
    },
    utilization: {
      activeMinutes: Math.round(allMinutes),
      capacityMinutes: capacityMin,
      ratio: Math.round(utilization * 1000) / 1000,
    },
    totals: {
      totalSessions: slots.length,
      totalMinutes: Math.round(allMinutes),
      totalTokens: slots.reduce((a, { slot }) => a + slot.estimatedTokens, 0),
      totalCostUsd: Math.round(
        (slots.reduce((a, { slot }) => a + slot.estimatedCostMicros, 0) / 1_000_000) * 100,
      ) / 100,
    },
  });
}
