import { db, schema } from "@/db";
import { and, asc, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";

export const SLOT_MINUTES = 60; // legacy default

export async function getActiveSlots() {
  const rows = await db
    .select({
      slot: schema.slots,
      user: schema.users,
    })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(and(isNull(schema.slots.endedAt), eq(schema.slots.status, "active")))
    .orderBy(asc(schema.slots.slotNumber), asc(schema.slots.startedAt));
  return rows;
}

// Back-compat shim for callers that still expect a single active slot.
// Returns the first one (lowest slot number).
export async function getActiveSlot() {
  const rows = await getActiveSlots();
  return rows[0] ?? null;
}

export async function getActiveSlotForUser(userId: string) {
  const rows = await getActiveSlots();
  return rows.find((r) => r.user.id === userId) ?? null;
}

export async function getQueue() {
  const rows = await db
    .select({
      item: schema.queue,
      user: schema.users,
    })
    .from(schema.queue)
    .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
    .where(eq(schema.queue.status, "queued"))
    .orderBy(desc(schema.queue.urgent), schema.queue.requestedAt);
  return rows;
}

export function plannedEndAt(startedAt: Date, minutes: number = SLOT_MINUTES) {
  return new Date(startedAt.getTime() + minutes * 60_000);
}

export async function getPresenceMap() {
  const rows = await db.select().from(schema.presence);
  return new Map(rows.map((r) => [r.userId, r]));
}

export async function getAllUsers() {
  return db.select().from(schema.users).orderBy(schema.users.email);
}

export async function recentEvents(
  userId: string,
  sinceMs = 7 * 24 * 60 * 60 * 1000,
) {
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), gt(schema.events.createdAt, since)))
    .orderBy(desc(schema.events.createdAt))
    .limit(2000);
}

// Find the first available slot number (1..maxConcurrent) that nobody currently owns.
export async function findOpenSlotNumber(): Promise<number | null> {
  const cfg = await getConfig();
  const max = cfg.maxConcurrentSlots;
  const active = await getActiveSlots();
  const used = new Set(active.map((r) => r.slot.slotNumber));
  for (let n = 1; n <= max; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}

// Average historical slot duration — used by queue ETA.
export async function avgRecentSlotMinutes(): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      avg: sql<number>`avg(extract(epoch from (${schema.slots.endedAt} - ${schema.slots.startedAt})) / 60)`,
    })
    .from(schema.slots)
    .where(
      and(
        gte(schema.slots.startedAt, since),
        inArray(schema.slots.status, ["ended", "expired", "force_ended"]),
      ),
    );
  const v = Number(rows[0]?.avg ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 30;
  return v;
}

// Estimated wait time for the user at the given queue position (1-indexed).
// Considers current active slots' remaining time + rolling average for items
// ahead of `position`.
export async function estimateQueueWaitMinutes(position: number): Promise<number> {
  if (position <= 0) return 0;
  const active = await getActiveSlots();
  const cfg = await getConfig();
  const ahead = position - 1;
  if (active.length < cfg.maxConcurrentSlots && ahead === 0) return 0;
  const avgMin = await avgRecentSlotMinutes();

  // Soonest ending active slot tells us when first capacity opens.
  const remainingMin = active
    .map((r) => Math.max(0, (new Date(r.slot.plannedEndAt).getTime() - Date.now()) / 60_000))
    .sort((a, b) => a - b);

  while (remainingMin.length < cfg.maxConcurrentSlots) remainingMin.push(0);

  let pending = ahead + 1; // including this user
  let wait = 0;
  // Heap-like simulation: assign next opening to the soonest-free slot, push back its end time.
  const ends = remainingMin.slice(0, cfg.maxConcurrentSlots);
  while (pending > 0) {
    ends.sort((a, b) => a - b);
    wait = ends[0];
    ends[0] = wait + avgMin;
    pending--;
  }
  return Math.max(0, Math.round(wait));
}

export async function userMinutesInWindow(userId: string, sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const slots = await db
    .select()
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, userId), gt(schema.slots.startedAt, since)));
  let mins = 0;
  for (const s of slots) {
    const end = s.endedAt ?? new Date();
    mins += Math.max(
      0,
      (new Date(end).getTime() - new Date(s.startedAt).getTime()) / 60_000,
    );
  }
  return mins;
}
