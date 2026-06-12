import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";
import { audit } from "@/lib/audit";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

function generateToken() {
  return "ccm_" + randomBytes(32).toString("hex");
}

// POST { userId } — rotate the user's API token, invalidating the previous one.
export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  if (!userId) return NextResponse.json({ error: "missing_user" }, { status: 400 });
  const newToken = generateToken();
  const [u] = await db
    .update(schema.users)
    .set({ apiToken: newToken })
    .where(eq(schema.users.id, userId))
    .returning();
  if (!u) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await audit({
    action: "token.rotated",
    severity: "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "tl",
    targetUserId: u.id,
    targetEmail: u.email,
  });
  return NextResponse.json({ ok: true, apiToken: newToken });
}
