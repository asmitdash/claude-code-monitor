import { NextRequest, NextResponse } from "next/server";
import { requireTL } from "@/lib/session-helper";
import { listMembers, addMember, removeMember } from "@/lib/allowlist";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ members: await listMembers() });
}

export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { email, role } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }
  const r = role === "admin" ? "admin" : "member";
  await addMember(email, r, me.realActorEmail);
  await audit({
    action: "member.added",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetEmail: email,
    metadata: { role: r },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });
  try {
    await removeMember(email);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  await audit({
    action: "member.removed",
    severity: "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetEmail: email,
  });
  return NextResponse.json({ ok: true });
}
