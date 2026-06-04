import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listMembers, addMember, removeMember } from "@/lib/allowlist";

export const runtime = "nodejs";

async function requireTL() {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string; email?: string } | undefined;
  if (!me?.id || me.role !== "tl") return null;
  return me;
}

export async function GET() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const members = await listMembers();
  return NextResponse.json({ members });
}

export async function POST(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { email, role } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }
  const r = role === "tl" ? "tl" : "member";
  await addMember(email, r, me.email ?? "tl");
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
  return NextResponse.json({ ok: true });
}
