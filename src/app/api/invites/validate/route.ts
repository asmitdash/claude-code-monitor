import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// Public — called from the signup page to confirm an invite link is valid
// before showing the form. Returns minimal info: email + status only, never
// the token itself.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.token, token))
    .limit(1);
  if (!row) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (row.revokedAt) {
    return NextResponse.json({ ok: false, error: "revoked" }, { status: 410 });
  }
  if (row.consumedAt) {
    return NextResponse.json({ ok: false, error: "already_used" }, { status: 410 });
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
  });
}
