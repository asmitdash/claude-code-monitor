import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc, gt } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";

export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const head = headers.join(",");
  const body = rows
    .map((r) => headers.map((h) => csvEscape(r[h])).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

export async function GET(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const dataset = url.searchParams.get("dataset") ?? "audit";
  const days = Math.min(90, Number(url.searchParams.get("days") ?? 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);

  if (dataset === "audit") {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(gt(schema.auditLog.createdAt, since))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(20_000);
    const csv = rowsToCsv(
      [
        "createdAt",
        "action",
        "severity",
        "actorEmail",
        "actorRole",
        "targetEmail",
        "slotId",
        "queueId",
        "approvalId",
        "metadata",
      ],
      rows.map((r) => ({ ...r })),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-${days}d.csv"`,
      },
    });
  }
  if (dataset === "slots") {
    const rows = await db
      .select({ slot: schema.slots, user: schema.users })
      .from(schema.slots)
      .innerJoin(schema.users, gt(schema.slots.startedAt, since))
      .where(gt(schema.slots.startedAt, since))
      .orderBy(desc(schema.slots.startedAt))
      .limit(10_000);
    const flat = rows.map((r) => ({
      id: r.slot.id,
      email: r.user.email,
      slotNumber: r.slot.slotNumber,
      status: r.slot.status,
      startedAt: r.slot.startedAt,
      endedAt: r.slot.endedAt,
      endedBy: r.slot.endedBy,
      durationMinutes: r.slot.durationMinutes,
      extendedMinutes: r.slot.extendedMinutes,
      activityScore: r.slot.activityScore,
      toolCallCount: r.slot.toolCallCount,
      eventCount: r.slot.eventCount,
      estimatedTokens: r.slot.estimatedTokens,
      estimatedCostMicros: r.slot.estimatedCostMicros,
      purpose: r.slot.purpose,
      cwd: r.slot.cwd,
    }));
    const csv = rowsToCsv(Object.keys(flat[0] ?? { id: "" }), flat);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="slots-${days}d.csv"`,
      },
    });
  }
  if (dataset === "approvals") {
    const rows = await db
      .select({ a: schema.approvals, user: schema.users })
      .from(schema.approvals)
      .innerJoin(schema.users, gt(schema.approvals.requestedAt, since))
      .where(gt(schema.approvals.requestedAt, since))
      .orderBy(desc(schema.approvals.requestedAt))
      .limit(5000);
    const flat = rows.map((r) => ({
      id: r.a.id,
      email: r.user.email,
      status: r.a.status,
      reason: r.a.reason,
      desiredMinutes: r.a.desiredMinutes,
      requestedAt: r.a.requestedAt,
      decidedAt: r.a.decidedAt,
      decidedBy: r.a.decidedBy,
    }));
    const csv = rowsToCsv(Object.keys(flat[0] ?? { id: "" }), flat);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="approvals-${days}d.csv"`,
      },
    });
  }
  return NextResponse.json({ error: "unknown_dataset" }, { status: 400 });
}
