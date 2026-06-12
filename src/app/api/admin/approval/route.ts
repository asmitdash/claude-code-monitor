import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

// Approve or reject a pending approval. Approved approvals create a window
// during which the user can claim a slot even when capacity is full
// (override mode).
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.approvalId ?? "");
  const decision = body.decision === "reject" ? "reject" : "approve";
  const note = body.note ? String(body.note).slice(0, 300) : null;

  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const rows = await db
    .select({ a: schema.approvals, user: schema.users })
    .from(schema.approvals)
    .innerJoin(schema.users, eq(schema.approvals.userId, schema.users.id))
    .where(eq(schema.approvals.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.a.status !== "pending") {
    return NextResponse.json({ error: `already_${row.a.status}` }, { status: 409 });
  }

  const cfg = await getConfig();
  const newStatus = decision === "approve" ? "approved" : "rejected";
  await db
    .update(schema.approvals)
    .set({
      status: newStatus,
      decidedAt: new Date(),
      decidedBy: me.realActorEmail,
      decisionNote: note,
      expiresAt:
        decision === "approve"
          ? new Date(Date.now() + cfg.approvalAutoExpireMinutes * 60_000)
          : row.a.expiresAt,
    })
    .where(eq(schema.approvals.id, id));

  await audit({
    action: decision === "approve" ? "approval.approved" : "approval.rejected",
    severity: "info",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    targetUserId: row.user.id,
    targetEmail: row.user.email,
    approvalId: row.a.id,
    metadata: { note, desiredMinutes: row.a.desiredMinutes },
  });

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const rows = await db
    .select({ a: schema.approvals, user: schema.users })
    .from(schema.approvals)
    .innerJoin(schema.users, eq(schema.approvals.userId, schema.users.id))
    .where(
      status ? eq(schema.approvals.status, status as "pending" | "approved" | "rejected" | "expired") : undefined,
    )
    .orderBy(desc(schema.approvals.requestedAt))
    .limit(200);
  return NextResponse.json({
    approvals: rows.map((r) => ({
      id: r.a.id,
      userId: r.user.id,
      email: r.user.email,
      name: r.user.name,
      status: r.a.status,
      reason: r.a.reason,
      desiredMinutes: r.a.desiredMinutes,
      requestedAt: r.a.requestedAt,
      decidedAt: r.a.decidedAt,
      decidedBy: r.a.decidedBy,
      decisionNote: r.a.decisionNote,
      expiresAt: r.a.expiresAt,
      consumedSlotId: r.a.consumedSlotId,
    })),
  });
}
