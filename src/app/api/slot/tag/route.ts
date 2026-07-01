// Post-hoc self-tag on an ended slot. Owner-only. Accepts one of:
//   'progress' | 'stuck' | 'exploratory'
// Optional free-form note. Idempotent — later tags overwrite.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session-helper";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

const ALLOWED = new Set(["progress", "stuck", "exploratory"]);

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const slotId = body.slotId ? String(body.slotId) : null;
  const tag = body.tag ? String(body.tag) : null;
  const note = body.note ? String(body.note).slice(0, 500) : null;
  if (!slotId || !tag || !ALLOWED.has(tag)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const [row] = await db
    .select()
    .from(schema.slots)
    .where(eq(schema.slots.id, slotId))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.userId !== me.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db
    .update(schema.slots)
    .set({
      outcomeTag: tag,
      outcomeNote: note,
      outcomeTaggedAt: new Date(),
    })
    .where(and(eq(schema.slots.id, slotId), eq(schema.slots.userId, me.id)));
  return NextResponse.json({ ok: true });
}
