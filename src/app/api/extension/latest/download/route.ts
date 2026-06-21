import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// Public — streams the latest .vsix bytes. No auth: the only thing this leaks
// is the extension binary itself, which is also what would be in the .vsix
// people manually installed.
export async function GET() {
  const [row] = await db
    .select({
      version: schema.releases.version,
      vsixBytes: schema.releases.vsixBytes,
      autoUpdateEnabled: schema.releases.autoUpdateEnabled,
    })
    .from(schema.releases)
    .where(eq(schema.releases.isLatest, true))
    .limit(1);
  if (!row || !row.autoUpdateEnabled) {
    return new NextResponse("no_release", { status: 404 });
  }
  const bytes = Buffer.from(row.vsixBytes, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="claude-monitor-${row.version}.vsix"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
