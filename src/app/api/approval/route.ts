import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

// Member: request additional access from TL.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const reason = body.reason ? String(body.reason).slice(0, 300) : null;
  const desiredMinutes = Math.min(Math.max(15, Number(body.desiredMinutes ?? 60)), 240);

  const cfg = await getConfig();
  const existing = await db
    .select()
    .from(schema.approvals)
    .where(
      and(eq(schema.approvals.userId, me.id), eq(schema.approvals.status, "pending")),
    )
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({ ok: true, approvalId: existing[0].id, alreadyPending: true });
  }

  const [a] = await db
    .insert(schema.approvals)
    .values({
      userId: me.id,
      reason,
      desiredMinutes,
      expiresAt: new Date(Date.now() + cfg.approvalAutoExpireMinutes * 60_000),
    })
    .returning();

  await audit({
    action: "approval.requested",
    severity: "warn",
    actorUserId: me.id,
    actorEmail: me.email,
    targetUserId: me.id,
    targetEmail: me.email,
    approvalId: a.id,
    metadata: { reason, desiredMinutes },
  });

  return NextResponse.json({ ok: true, approvalId: a.id });
}

// Member: cancel my own pending approval.
export async function DELETE() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db
    .update(schema.approvals)
    .set({ status: "expired", decidedAt: new Date(), decidedBy: me.email })
    .where(
      and(eq(schema.approvals.userId, me.id), eq(schema.approvals.status, "pending")),
    )
    .returning();
  return NextResponse.json({ ok: true, cancelled: rows.length });
}

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.userId, me.id))
    .orderBy(desc(schema.approvals.requestedAt))
    .limit(20);
  return NextResponse.json({ approvals: rows });
}
