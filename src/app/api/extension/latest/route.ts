import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// Public — extension polls this with no auth (it may not be signed in yet).
// Returns the latest release's version + download URL + auto-update flag.
// vsix bytes themselves come from /api/extension/latest/download to keep
// this endpoint cheap.
export async function GET() {
  const [row] = await db
    .select({
      version: schema.releases.version,
      sizeBytes: schema.releases.sizeBytes,
      autoUpdateEnabled: schema.releases.autoUpdateEnabled,
      uploadedAt: schema.releases.uploadedAt,
      notes: schema.releases.notes,
    })
    .from(schema.releases)
    .where(eq(schema.releases.isLatest, true))
    .limit(1);
  if (!row) {
    return NextResponse.json({ ok: false, error: "no_release" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    version: row.version,
    autoUpdateEnabled: row.autoUpdateEnabled,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt,
    notes: row.notes,
    vsixUrl: `/api/extension/latest/download`,
  });
}
