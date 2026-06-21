import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

// GET — list invites (most recent first, capped).
export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await db
    .select()
    .from(schema.invites)
    .orderBy(desc(schema.invites.createdAt))
    .limit(200);
  return NextResponse.json({
    invites: rows.map((r) => ({
      id: r.id,
      token: r.token,
      email: r.email,
      role: r.role,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      consumedAt: r.consumedAt,
      consumedByUserId: r.consumedByUserId,
      revokedAt: r.revokedAt,
      revokedBy: r.revokedBy,
      note: r.note,
      status:
        r.revokedAt
          ? "revoked"
          : r.consumedAt
          ? "consumed"
          : new Date(r.expiresAt).getTime() < Date.now()
          ? "expired"
          : "pending",
    })),
  });
}

// POST { email, role?, expiresInDays?, note? } — create a single-use invite.
// Email is locked: only the named recipient can redeem.
export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }
  const role = body.role === "admin" ? "admin" : "member";
  const days = Math.max(1, Math.min(60, Number(body.expiresInDays ?? 7)));
  const note = body.note ? String(body.note).slice(0, 300) : null;

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const [created] = await db
    .insert(schema.invites)
    .values({
      token,
      email,
      role,
      createdBy: me.realActorEmail,
      expiresAt,
      note,
    })
    .returning();

  await audit({
    action: "invite.created",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetEmail: email,
    metadata: { role, days, inviteId: created.id },
  });

  return NextResponse.json({
    ok: true,
    invite: {
      id: created.id,
      token: created.token,
      email: created.email,
      role: created.role,
      expiresAt: created.expiresAt,
    },
  });
}

// DELETE { id } — revoke an unused invite.
export async function DELETE(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.consumedAt) {
    return NextResponse.json({ error: "already_consumed" }, { status: 409 });
  }
  if (row.revokedAt) {
    return NextResponse.json({ error: "already_revoked" }, { status: 409 });
  }

  await db
    .update(schema.invites)
    .set({ revokedAt: new Date(), revokedBy: me.realActorEmail })
    .where(eq(schema.invites.id, id));

  await audit({
    action: "invite.revoked",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetEmail: row.email,
    metadata: { inviteId: id },
  });

  return NextResponse.json({ ok: true });
}
