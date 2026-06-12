import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session-helper";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const note = body.note ? String(body.note).slice(0, 200) : null;
  const desiredMinutes = Math.min(Math.max(15, Number(body.desiredMinutes ?? 60)), 120);
  const urgent = Boolean(body.urgent);

  const existing = await db
    .select()
    .from(schema.queue)
    .where(and(eq(schema.queue.userId, me.id), eq(schema.queue.status, "queued")))
    .limit(1);

  if (existing[0]) {
    if (note !== null || urgent) {
      await db
        .update(schema.queue)
        .set({ note: note ?? existing[0].note, urgent: urgent || existing[0].urgent })
        .where(eq(schema.queue.id, existing[0].id));
    }
    return NextResponse.json({ ok: true, queueId: existing[0].id, alreadyQueued: true });
  }

  const [item] = await db
    .insert(schema.queue)
    .values({ userId: me.id, note, desiredMinutes, urgent })
    .returning();

  const all = await db
    .select()
    .from(schema.queue)
    .where(eq(schema.queue.status, "queued"))
    .orderBy(desc(schema.queue.urgent), asc(schema.queue.requestedAt));
  const position = Math.max(1, all.findIndex((q) => q.id === item.id) + 1);

  await audit({
    action: "queue.joined",
    actorUserId: me.id,
    actorEmail: me.email,
    targetUserId: me.id,
    targetEmail: me.email,
    queueId: item.id,
    metadata: { desiredMinutes, urgent, note },
  });

  return NextResponse.json({ ok: true, queueId: item.id, position });
}

export async function DELETE() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .update(schema.queue)
    .set({ cancelledAt: new Date(), status: "cancelled" })
    .where(and(eq(schema.queue.userId, me.id), eq(schema.queue.status, "queued")))
    .returning();
  for (const r of rows) {
    await audit({
      action: "queue.cancelled",
      actorUserId: me.id,
      actorEmail: me.email,
      targetUserId: me.id,
      targetEmail: me.email,
      queueId: r.id,
    });
  }
  return NextResponse.json({ ok: true, cancelled: rows.length });
}

export async function PATCH(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  await db
    .update(schema.queue)
    .set({
      note: body.note !== undefined ? String(body.note ?? "").slice(0, 200) : undefined,
      urgent: body.urgent !== undefined ? Boolean(body.urgent) : undefined,
      desiredMinutes:
        body.desiredMinutes !== undefined
          ? Math.min(Math.max(15, Number(body.desiredMinutes)), 120)
          : undefined,
    })
    .where(and(eq(schema.queue.userId, me.id), eq(schema.queue.status, "queued")));
  return NextResponse.json({ ok: true });
}
