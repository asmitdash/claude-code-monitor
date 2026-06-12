import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// POST { message, severity?, minutes? } — set a banner everyone sees.
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const message = String(body.message ?? "").slice(0, 400);
  if (!message) return NextResponse.json({ error: "missing_message" }, { status: 400 });
  const severity = ["info", "warn", "alert"].includes(body.severity)
    ? String(body.severity)
    : "info";
  const minutes = body.minutes ? Number(body.minutes) : null;
  const expiresAt = minutes && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  // Deactivate prior active broadcasts.
  await db
    .update(schema.broadcasts)
    .set({ active: false })
    .where(eq(schema.broadcasts.active, true));

  await db.insert(schema.broadcasts).values({
    message,
    severity,
    expiresAt,
    setBy: me.realActorEmail,
  });

  await audit({
    action: "broadcast.set",
    severity: severity as "info" | "warn" | "alert",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    metadata: { message, minutes },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db
    .update(schema.broadcasts)
    .set({ active: false })
    .where(eq(schema.broadcasts.active, true));
  await audit({
    action: "broadcast.cleared",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
  });
  return NextResponse.json({ ok: true });
}
