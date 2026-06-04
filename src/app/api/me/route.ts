import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user[0]) return NextResponse.json({ error: "no_user" }, { status: 404 });
  return NextResponse.json({
    id: user[0].id,
    email: user[0].email,
    name: user[0].name,
    role: user[0].role,
    apiToken: user[0].apiToken,
  });
}
