// Admin-only team insights. All 6 telemetry additions from phase 3.
import { requireUser } from "@/lib/session-helper";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { and, eq, gt, sql, desc } from "drizzle-orm";
import Link from "next/link";

function fmt(n: number, unit: "s" | "ms" | "min"): string {
  if (!Number.isFinite(n)) return "—";
  if (unit === "ms") return `${Math.round(n)}ms`;
  if (unit === "s") return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}m`;
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: "7d" | "30d" }>;
}) {
  const me = await requireUser();
  if (!me) redirect("/login");
  if (me.realActorRole !== "admin") redirect("/dashboard");
  const { range = "7d" } = await searchParams;
  const days = range === "30d" ? 30 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [ttftByUser, activityByHour, cwdByUser, toolLeader, outcomeByUser, idleByUser] =
    await Promise.all([
      // Time-to-first-tool per user
      db
        .select({
          userId: schema.slots.userId,
          email: schema.users.email,
          p50: sql<number>`percentile_cont(0.5) within group (order by first_tool_at_ms)`,
          p95: sql<number>`percentile_cont(0.95) within group (order by first_tool_at_ms)`,
          n: sql<number>`count(first_tool_at_ms)`,
        })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.users.id, schema.slots.userId))
        .where(
          and(
            gt(schema.slots.startedAt, since),
            sql`${schema.slots.firstToolAtMs} is not null`,
          ),
        )
        .groupBy(schema.slots.userId, schema.users.email)
        .orderBy(
          sql`percentile_cont(0.5) within group (order by first_tool_at_ms) DESC`,
        ),
      // Activity intensity by hour of slot (tool calls per minute)
      db
        .select({
          userId: schema.slots.userId,
          email: schema.users.email,
          avgToolsPerMin: sql<number>`
            avg(
              case
                when extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60 > 0
                then tool_call_count / (extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60)
                else 0
              end
            )`,
          maxToolsPerMin: sql<number>`
            max(
              case
                when extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60 > 0
                then tool_call_count / (extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60)
                else 0
              end
            )`,
          slots: sql<number>`count(*)`,
        })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.users.id, schema.slots.userId))
        .where(gt(schema.slots.startedAt, since))
        .groupBy(schema.slots.userId, schema.users.email)
        .orderBy(
          sql`avg(case when extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60 > 0 then tool_call_count / (extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60) else 0 end) DESC`,
        ),
      // Per-user project breakdown
      db
        .select({
          userId: schema.slots.userId,
          email: schema.users.email,
          project: sql<string>`coalesce(project_name, split_part(cwd, '/', -1), '(none)')`,
          n: sql<number>`count(*)`,
          totalMin: sql<number>`coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60), 0)`,
        })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.users.id, schema.slots.userId))
        .where(gt(schema.slots.startedAt, since))
        .groupBy(
          schema.slots.userId,
          schema.users.email,
          sql`coalesce(project_name, split_part(cwd, '/', -1), '(none)')`,
        )
        .orderBy(sql`count(*) DESC`)
        .limit(50),
      // Tool leaderboard: per user, which tools do they use most
      db
        .select({
          email: schema.users.email,
          tool: schema.events.tool,
          n: sql<number>`count(*)`,
        })
        .from(schema.events)
        .innerJoin(schema.users, eq(schema.users.id, schema.events.userId))
        .where(
          and(
            gt(schema.events.createdAt, since),
            sql`${schema.events.tool} is not null`,
          ),
        )
        .groupBy(schema.users.email, schema.events.tool)
        .orderBy(sql`count(*) DESC`)
        .limit(30),
      // Outcome distribution per user
      db
        .select({
          email: schema.users.email,
          tag: sql<string>`coalesce(outcome_tag, '(untagged)')`,
          n: sql<number>`count(*)`,
        })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.users.id, schema.slots.userId))
        .where(gt(schema.slots.startedAt, since))
        .groupBy(schema.users.email, sql`coalesce(outcome_tag, '(untagged)')`)
        .orderBy(schema.users.email),
      // Idle-warn counter aggregate per user
      db
        .select({
          email: schema.users.email,
          totalWarns: sql<number>`coalesce(sum(idle_warn_count), 0)`,
          slots: sql<number>`count(*)`,
        })
        .from(schema.slots)
        .innerJoin(schema.users, eq(schema.users.id, schema.slots.userId))
        .where(gt(schema.slots.startedAt, since))
        .groupBy(schema.users.email)
        .orderBy(sql`sum(idle_warn_count) DESC`),
    ]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Team insights</h1>
          <p className="text-sm text-neutral-400">Range: last {days} days</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/admin/insights?range=7d"
            className={`rounded-md border px-3 py-1.5 ${
              range === "7d"
                ? "border-neutral-100 bg-neutral-900"
                : "border-neutral-800 hover:bg-neutral-900"
            }`}
          >
            7 days
          </Link>
          <Link
            href="/admin/insights?range=30d"
            className={`rounded-md border px-3 py-1.5 ${
              range === "30d"
                ? "border-neutral-100 bg-neutral-900"
                : "border-neutral-800 hover:bg-neutral-900"
            }`}
          >
            30 days
          </Link>
        </div>
      </div>

      <Section title="Time-to-first-tool per user">
        <SimpleTable
          headers={["User", "p50", "p95", "Slots"]}
          rows={ttftByUser.map((r) => ({
            key: r.userId ?? "n",
            cols: [
              r.email ?? "—",
              fmt(Number(r.p50 ?? 0), "s"),
              fmt(Number(r.p95 ?? 0), "s"),
              String(Number(r.n)),
            ],
          }))}
        />
      </Section>

      <Section title="Activity intensity (tool calls per minute)">
        <SimpleTable
          headers={["User", "Avg tools/min", "Peak tools/min", "Slots"]}
          rows={activityByHour.map((r) => ({
            key: r.userId ?? "n",
            cols: [
              r.email ?? "—",
              Number(r.avgToolsPerMin ?? 0).toFixed(2),
              Number(r.maxToolsPerMin ?? 0).toFixed(2),
              String(Number(r.slots)),
            ],
          }))}
        />
      </Section>

      <Section title="Projects worked on per user">
        <SimpleTable
          headers={["User", "Project", "Slots", "Total time"]}
          rows={cwdByUser.map((r) => ({
            key: `${r.userId}-${r.project}`,
            cols: [
              r.email ?? "—",
              String(r.project ?? "(none)"),
              String(Number(r.n)),
              fmt(Number(r.totalMin), "min"),
            ],
          }))}
        />
      </Section>

      <Section title="Tool leaderboard">
        <SimpleTable
          headers={["User", "Tool", "Calls"]}
          rows={toolLeader.map((r, i) => ({
            key: `${r.email}-${r.tool}-${i}`,
            cols: [r.email ?? "—", r.tool ?? "—", Number(r.n).toLocaleString()],
          }))}
        />
      </Section>

      <Section title="Session outcomes (self-tag)">
        <SimpleTable
          headers={["User", "Tag", "Count"]}
          rows={outcomeByUser.map((r, i) => ({
            key: `${r.email}-${r.tag}-${i}`,
            cols: [r.email ?? "—", r.tag, Number(r.n)],
          }))}
        />
      </Section>

      <Section title="Idle-warn counter (times a slot drifted past idle threshold)">
        <SimpleTable
          headers={["User", "Warnings", "Slots", "Avg per slot"]}
          rows={idleByUser.map((r) => ({
            key: r.email ?? "n",
            cols: [
              r.email ?? "—",
              String(Number(r.totalWarns)),
              String(Number(r.slots)),
              Number(r.slots) > 0
                ? (Number(r.totalWarns) / Number(r.slots)).toFixed(2)
                : "—",
            ],
          }))}
        />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-medium text-neutral-300 mb-2">{title}</h2>
      <div className="rounded-xl border border-neutral-800 overflow-hidden">{children}</div>
    </div>
  );
}

function SimpleTable({
  rows,
  headers,
}: {
  rows: Array<{ key: string; cols: (string | number)[] }>;
  headers: string[];
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-neutral-900/50 text-xs text-neutral-400">
        <tr>
          {headers.map((h, i) => (
            <th key={h} className={`px-4 py-2 ${i === 0 ? "text-left" : "text-right"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-neutral-800">
            {r.cols.map((c, i) => (
              <td
                key={i}
                className={`px-4 py-1.5 text-xs ${i === 0 ? "" : "text-right"}`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={headers.length} className="px-4 py-4 text-neutral-500 text-center">
              No data.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
