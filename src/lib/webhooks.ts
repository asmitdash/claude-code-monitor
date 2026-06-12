import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

let cache: { hooks: Array<typeof schema.webhooks.$inferSelect>; at: number } | null = null;

async function loadActive() {
  if (cache && Date.now() - cache.at < 30_000) return cache.hooks;
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.active, true));
  cache = { hooks: rows, at: Date.now() };
  return rows;
}

export function invalidateWebhookCache() {
  cache = null;
}

export async function dispatchWebhooks(entry: {
  action: string;
  severity?: string;
  actorEmail?: string | null;
  targetEmail?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const hooks = await loadActive();
  if (hooks.length === 0) return;
  const body = JSON.stringify({
    type: entry.action,
    severity: entry.severity ?? "info",
    actor: entry.actorEmail ?? null,
    target: entry.targetEmail ?? null,
    metadata: entry.metadata ?? {},
    text: humanText(entry),
    sentAt: new Date().toISOString(),
  });
  await Promise.all(
    hooks
      .filter((h) => {
        const events = h.events as unknown;
        if (!Array.isArray(events) || events.length === 0) return true;
        return events.includes(entry.action) || events.includes("*");
      })
      .map(async (h) => {
        try {
          const isSlack = /slack\.com|hooks\.slack/.test(h.url);
          const payload = isSlack
            ? JSON.stringify({ text: humanText(entry) })
            : body;
          await fetch(h.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          }).catch(() => {});
        } catch {}
      }),
  );
}

function humanText(entry: {
  action: string;
  severity?: string;
  actorEmail?: string | null;
  targetEmail?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sev = entry.severity === "alert" ? "🚨" : entry.severity === "warn" ? "⚠️" : "•";
  const target = entry.targetEmail ? ` for ${entry.targetEmail}` : "";
  const actor = entry.actorEmail ? ` by ${entry.actorEmail}` : "";
  const meta = entry.metadata && Object.keys(entry.metadata).length > 0
    ? ` ${JSON.stringify(entry.metadata)}`
    : "";
  return `${sev} ${entry.action}${target}${actor}${meta}`;
}
