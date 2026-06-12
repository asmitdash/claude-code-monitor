import { db, schema } from "@/db";
import { and, desc, eq, gt, gte } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { userMinutesInWindow } from "@/lib/slots";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type QuotaStatus = {
  dailyMinutes: number;
  weeklyMinutes: number;
  dailyUsedMinutes: number;
  weeklyUsedMinutes: number;
  dailyRemainingMinutes: number;
  weeklyRemainingMinutes: number;
  exhausted: boolean;
};

export async function quotaFor(userId: string): Promise<QuotaStatus> {
  const cfg = await getConfig();
  const used24h = await userMinutesInWindow(userId, DAY_MS);
  const used7d = await userMinutesInWindow(userId, WEEK_MS);
  return {
    dailyMinutes: cfg.dailyMinutes,
    weeklyMinutes: cfg.weeklyMinutes,
    dailyUsedMinutes: Math.round(used24h),
    weeklyUsedMinutes: Math.round(used7d),
    dailyRemainingMinutes: Math.max(0, cfg.dailyMinutes - used24h),
    weeklyRemainingMinutes: Math.max(0, cfg.weeklyMinutes - used7d),
    exhausted: used24h >= cfg.dailyMinutes || used7d >= cfg.weeklyMinutes,
  };
}

export type RestrictionStatus = {
  paused: boolean;
  banned: boolean;
  cooldownUntil: Date | null;
  reason: string | null;
};

export async function activeRestrictions(userId: string): Promise<RestrictionStatus> {
  const rows = await db
    .select()
    .from(schema.restrictions)
    .where(and(eq(schema.restrictions.userId, userId), eq(schema.restrictions.active, true)));
  const now = Date.now();
  let paused = false;
  let banned = false;
  let cooldownUntil: Date | null = null;
  let reason: string | null = null;
  for (const r of rows) {
    if (r.expiresAt && new Date(r.expiresAt).getTime() < now) continue;
    if (r.type === "pause") {
      paused = true;
      reason = reason ?? r.reason ?? "paused by team lead";
    }
    if (r.type === "ban") {
      banned = true;
      reason = reason ?? r.reason ?? "banned";
    }
    if (r.type === "cooldown") {
      const until = r.expiresAt ?? null;
      if (until && (cooldownUntil === null || until > cooldownUntil)) cooldownUntil = until;
      reason = reason ?? r.reason ?? "cooldown after recent kill";
    }
  }
  return { paused, banned, cooldownUntil, reason };
}

export async function hasActiveOverride(userId: string): Promise<{
  active: boolean;
  approval: typeof schema.approvals.$inferSelect | null;
}> {
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.userId, userId), eq(schema.approvals.status, "approved")))
    .orderBy(desc(schema.approvals.requestedAt));
  const now = Date.now();
  for (const a of rows) {
    if (a.expiresAt && new Date(a.expiresAt).getTime() < now) continue;
    if (a.consumedSlotId) continue;
    return { active: true, approval: a };
  }
  return { active: false, approval: null };
}

export async function lastForceKillAt(userId: string): Promise<Date | null> {
  const rows = await db
    .select()
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, userId), eq(schema.slots.status, "force_ended")))
    .orderBy(desc(schema.slots.endedAt))
    .limit(1);
  return rows[0]?.endedAt ?? null;
}
