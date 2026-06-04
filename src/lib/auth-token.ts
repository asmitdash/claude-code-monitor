import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function userFromToken(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(ccm_[a-f0-9]{64})$/i);
  if (!m) return null;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.apiToken, m[1]))
    .limit(1);
  return rows[0] ?? null;
}
