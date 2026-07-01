import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export type GlobalConfig = typeof schema.quotaConfig.$inferSelect;

const DEFAULTS = {
  scope: "global",
  dailyMinutes: 240,
  weeklyMinutes: 1200,
  maxSlotMinutes: 120,
  cooldownAfterKillMinutes: 15,
  approvalAutoExpireMinutes: 30,
  idleAutoEndMinutes: 15,
  idleWarnMinutes: 5,
  staleHeartbeatMinutes: 5,
  staleHeartbeatEnabled: true,
  graceTimerSeconds: 60,
  maxConcurrentSlots: 2,
  freezeBanner: null,
  freezeUntil: null,
} as const;

let cache: { val: GlobalConfig; at: number } | null = null;

export async function getConfig(): Promise<GlobalConfig> {
  if (cache && Date.now() - cache.at < 5_000) return cache.val;
  const rows = await db
    .select()
    .from(schema.quotaConfig)
    .where(eq(schema.quotaConfig.scope, "global"))
    .limit(1);
  if (rows[0]) {
    cache = { val: rows[0], at: Date.now() };
    return rows[0];
  }
  const [created] = await db
    .insert(schema.quotaConfig)
    .values({ ...DEFAULTS })
    .onConflictDoNothing()
    .returning();
  if (created) {
    cache = { val: created, at: Date.now() };
    return created;
  }
  const again = await db
    .select()
    .from(schema.quotaConfig)
    .where(eq(schema.quotaConfig.scope, "global"))
    .limit(1);
  cache = { val: again[0], at: Date.now() };
  return again[0];
}

export async function updateConfig(
  patch: Partial<Omit<GlobalConfig, "scope" | "updatedAt">>,
  by: string,
) {
  await db
    .update(schema.quotaConfig)
    .set({ ...patch, updatedAt: new Date(), updatedBy: by })
    .where(eq(schema.quotaConfig.scope, "global"));
  cache = null;
  return getConfig();
}

export function invalidateConfigCache() {
  cache = null;
}
