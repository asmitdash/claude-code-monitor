import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { userFromToken } from "@/lib/auth-token";

export const runtime = "nodejs";

// GET — extension polls for unconsumed file commands targeting itself.
// Returns the oldest first so writes apply in author-order.
export async function GET(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(schema.fileCommands)
    .where(and(eq(schema.fileCommands.userId, user.id), isNull(schema.fileCommands.consumedAt)))
    .orderBy(asc(schema.fileCommands.createdAt))
    .limit(20);

  return NextResponse.json({
    commands: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      filePath: r.filePath,
      payload: r.kind === "write" ? r.payload : null,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    })),
  });
}
