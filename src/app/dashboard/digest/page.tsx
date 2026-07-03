// M2 in-app weekly personal digest. Server-rendered — no polling needed.
import { requireUser } from "@/lib/session-helper";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { and, eq, gt, sql, desc } from "drizzle-orm";
import { SelfTag } from "./self-tag";

function fmtMinutes(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  return `${Math.floor(n / 60)}h ${Math.round(n % 60)}m`;
}

export default async function DigestPage() {
  const me = await requireUser();
  if (!me) redirect("/login");

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totals, slots, byProject, byTool, byOutcome] = await Promise.all([
    db
      .select({
        n: sql<number>`count(*)`,
        totalMin: sql<number>`coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60), 0)`,
        avgTtft: sql<number>`avg(first_tool_at_ms)`,
        idleWarnSum: sql<number>`coalesce(sum(idle_warn_count), 0)`,
      })
      .from(schema.slots)
      .where(and(eq(schema.slots.userId, me.id), gt(schema.slots.startedAt, since))),
    db
      .select()
      .from(schema.slots)
      .where(and(eq(schema.slots.userId, me.id), gt(schema.slots.startedAt, since)))
      .orderBy(desc(schema.slots.startedAt)),
    db
      .select({
        project: sql<string>`coalesce(project_name, '(no project)')`,
        n: sql<number>`count(*)`,
        totalMin: sql<number>`coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60), 0)`,
      })
      .from(schema.slots)
      .where(and(eq(schema.slots.userId, me.id), gt(schema.slots.startedAt, since)))
      .groupBy(sql`coalesce(project_name, '(no project)')`)
      .orderBy(sql`count(*) DESC`),
    db
      .select({
        tool: schema.events.tool,
        n: sql<number>`count(*)`,
      })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.userId, me.id),
          gt(schema.events.createdAt, since),
          sql`${schema.events.tool} IS NOT NULL`,
        ),
      )
      .groupBy(schema.events.tool)
      .orderBy(sql`count(*) DESC`)
      .limit(20),
    db
      .select({
        tag: sql<string>`coalesce(outcome_tag, '(untagged)')`,
        n: sql<number>`count(*)`,
      })
      .from(schema.slots)
      .where(and(eq(schema.slots.userId, me.id), gt(schema.slots.startedAt, since)))
      .groupBy(sql`coalesce(outcome_tag, '(untagged)')`),
  ]);

  const t = totals[0] ?? { n: 0, totalMin: 0, avgTtft: 0, idleWarnSum: 0 };
  const untagged = slots.filter((s) => s.endedAt && !s.outcomeTag);

  const portwayUrl = process.env.NEXT_PUBLIC_PORTWAY_URL || "https://portway.app";

  return (
    <main className="max-w-4xl mx-auto px-6 py-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Weekly digest — {me.email}</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Last 7 days · non-punitive, just self-visibility.
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/90 flex items-start gap-2">
        <span aria-hidden>💬</span>
        <div>
          If you want to use the Claude Desktop app too, please contact Asmit Dash regarding the setup and API access using the{" "}
          <a
            href={portwayUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-amber-300/60 hover:text-amber-50"
          >
            Portway portal
          </a>
          .
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Slots" value={String(t.n)} />
        <Stat label="Total time" value={fmtMinutes(Number(t.totalMin))} />
        <Stat
          label="Avg time to 1st tool"
          value={t.avgTtft ? `${Math.round(Number(t.avgTtft) / 1000)}s` : "—"}
        />
        <Stat label="Idle warnings" value={String(t.idleWarnSum)} />
      </div>

      <Section title="Projects worked on">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-400">
            <tr>
              <th className="text-left px-3 py-1.5">Project</th>
              <th className="text-right px-3 py-1.5">Slots</th>
              <th className="text-right px-3 py-1.5">Time</th>
            </tr>
          </thead>
          <tbody>
            {byProject.map((r) => (
              <tr key={r.project} className="border-t border-neutral-800">
                <td className="px-3 py-1.5">{r.project}</td>
                <td className="px-3 py-1.5 text-right">{Number(r.n)}</td>
                <td className="px-3 py-1.5 text-right">{fmtMinutes(Number(r.totalMin))}</td>
              </tr>
            ))}
            {byProject.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-neutral-500 text-center">
                  No slots this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Top tools (last 7 days)">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-400">
            <tr>
              <th className="text-left px-3 py-1.5">Tool</th>
              <th className="text-right px-3 py-1.5">Calls</th>
            </tr>
          </thead>
          <tbody>
            {byTool.map((r) => (
              <tr key={r.tool ?? "null"} className="border-t border-neutral-800">
                <td className="px-3 py-1.5 font-mono text-xs">{r.tool}</td>
                <td className="px-3 py-1.5 text-right">{Number(r.n).toLocaleString()}</td>
              </tr>
            ))}
            {byTool.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-neutral-500 text-center">
                  No tool events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Outcomes (self-tag)">
        <div className="flex gap-3 flex-wrap mb-3">
          {byOutcome.map((r) => (
            <div
              key={r.tag}
              className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs bg-neutral-900/40"
            >
              <span className="text-neutral-400">{r.tag}:</span>{" "}
              <span className="text-neutral-100 font-medium">{Number(r.n)}</span>
            </div>
          ))}
        </div>
        {untagged.length > 0 ? (
          <>
            <div className="mb-2 text-xs text-neutral-400">
              {untagged.length} ended slot{untagged.length === 1 ? "" : "s"} still untagged:
            </div>
            <div className="space-y-2">
              {untagged.slice(0, 10).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 text-xs border border-neutral-800 rounded-md px-3 py-2"
                >
                  <span className="text-neutral-400">
                    {new Date(s.startedAt).toLocaleString()}
                  </span>
                  <span className="text-neutral-500">
                    {s.durationMinutes}m · {s.projectName ?? s.cwd ?? "(no project)"}
                  </span>
                  <div className="ml-auto">
                    <SelfTag slotId={s.id} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-neutral-500">All ended slots tagged. Nice.</div>
        )}
      </Section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-medium text-neutral-300 mb-2">{title}</h2>
      <div className="rounded-xl border border-neutral-800 p-3 bg-neutral-900/30">{children}</div>
    </div>
  );
}
