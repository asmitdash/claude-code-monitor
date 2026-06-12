import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL, IMPERSONATE_COOKIE_NAME } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { cookies } from "next/headers";

export const runtime = "nodejs";

// POST { userId } — start impersonating that member.
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });
  const target = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!target[0]) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const c = await cookies();
  c.set(IMPERSONATE_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60,
  });

  await audit({
    action: "impersonation.started",
    severity: "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    targetUserId: target[0].id,
    targetEmail: target[0].email,
  });
  return NextResponse.json({ ok: true });
}

// DELETE — stop impersonating.
export async function DELETE() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const c = await cookies();
  c.delete(IMPERSONATE_COOKIE_NAME);
  await audit({
    action: "impersonation.ended",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
  });
  return NextResponse.json({ ok: true });
}
