import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { isTLBypass } from "@/lib/role";

export const runtime = "nodejs";

// POST { userId, type: 'pause'|'ban'|'cooldown', minutes?, reason? }
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const type = body.type;
  if (!userId || !["pause", "ban", "cooldown"].includes(String(type))) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  // TLs are immune to restrictions — pause/ban/cooldown can only target members.
  const target = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (target[0] && isTLBypass(target[0].role)) {
    return NextResponse.json(
      { error: "tl_immune", message: "TLs have unrestricted access by policy" },
      { status: 409 },
    );
  }

  // Deactivate prior restrictions of the same type so the new one takes effect.
  await db
    .update(schema.restrictions)
    .set({ active: false })
    .where(
      and(
        eq(schema.restrictions.userId, userId),
        eq(schema.restrictions.type, type as "pause" | "ban" | "cooldown"),
        eq(schema.restrictions.active, true),
      ),
    );

  const minutes = body.minutes ? Number(body.minutes) : null;
  const expires = minutes && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;

  await db.insert(schema.restrictions).values({
    userId,
    type: type as "pause" | "ban" | "cooldown",
    reason: body.reason ? String(body.reason).slice(0, 300) : null,
    setBy: me.realActorEmail,
    expiresAt: expires,
  });

  const action =
    type === "ban"
      ? "user.banned"
      : type === "cooldown"
      ? "user.cooldown_started"
      : "user.paused";
  await audit({
    action,
    severity: type === "ban" ? "alert" : "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    targetUserId: userId,
    metadata: { minutes, reason: body.reason ?? null },
  });
  return NextResponse.json({ ok: true });
}

// DELETE { userId, type }
export async function DELETE(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const type = body.type;
  if (!userId || !["pause", "ban", "cooldown"].includes(String(type))) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  await db
    .update(schema.restrictions)
    .set({ active: false })
    .where(
      and(
        eq(schema.restrictions.userId, userId),
        eq(schema.restrictions.type, type as "pause" | "ban" | "cooldown"),
        eq(schema.restrictions.active, true),
      ),
    );
  const action =
    type === "ban"
      ? "user.unbanned"
      : type === "cooldown"
      ? "user.cooldown_cleared"
      : "user.unpaused";
  await audit({
    action,
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    targetUserId: userId,
    metadata: { type },
  });
  return NextResponse.json({ ok: true });
}
