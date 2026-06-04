import { db, schema } from "@/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

export const SLOT_MINUTES = 60;

export async function getActiveSlot() {
  const rows = await db
    .select({
      slot: schema.slots,
      user: schema.users,
    })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.slots.userId, schema.users.id))
    .where(isNull(schema.slots.endedAt))
    .orderBy(desc(schema.slots.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getQueue() {
  const rows = await db
    .select({
      item: schema.queue,
      user: schema.users,
    })
    .from(schema.queue)
    .innerJoin(schema.users, eq(schema.queue.userId, schema.users.id))
    .where(and(isNull(schema.queue.cancelledAt), isNull(schema.queue.fulfilledSlotId)))
    .orderBy(schema.queue.requestedAt);
  return rows;
}

export function plannedEndAt(startedAt: Date) {
  return new Date(startedAt.getTime() + SLOT_MINUTES * 60_000);
}

export async function getPresenceMap() {
  const rows = await db
    .select()
    .from(schema.presence);
  return new Map(rows.map((r) => [r.userId, r]));
}

export async function getAllUsers() {
  return db.select().from(schema.users).orderBy(schema.users.email);
}

export async function recentEvents(userId: string, sinceMs = 7 * 24 * 60 * 60 * 1000) {
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), gt(schema.events.createdAt, since)))
    .orderBy(desc(schema.events.createdAt))
    .limit(2000);
}
