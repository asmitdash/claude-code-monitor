import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { requireTL } from "@/lib/session-helper";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const action = url.searchParams.get("action");
  const sinceParam = url.searchParams.get("sinceMin");
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200));
  const since =
    sinceParam && Number.isFinite(Number(sinceParam))
      ? new Date(Date.now() - Number(sinceParam) * 60_000)
      : new Date(Date.now() - 24 * 60 * 60_000);

  const where = and(
    gt(schema.auditLog.createdAt, since),
    userId ? eq(schema.auditLog.targetUserId, userId) : undefined,
    action ? eq(schema.auditLog.action, action) : undefined,
  );
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);
  return NextResponse.json({ entries: rows });
}
