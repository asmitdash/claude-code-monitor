import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/session-helper";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// Limit: 10 MB after base64 expansion. The current .vsix is ~13 KB so this is
// far above what we'll ever ship; it's the don't-DOS-the-DB ceiling.
const MAX_VSIX_BYTES = 10 * 1024 * 1024;

// GET — list releases (newest first).
export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await db
    .select({
      id: schema.releases.id,
      version: schema.releases.version,
      sizeBytes: schema.releases.sizeBytes,
      uploadedBy: schema.releases.uploadedBy,
      uploadedAt: schema.releases.uploadedAt,
      autoUpdateEnabled: schema.releases.autoUpdateEnabled,
      notes: schema.releases.notes,
      isLatest: schema.releases.isLatest,
    })
    .from(schema.releases)
    .orderBy(desc(schema.releases.uploadedAt))
    .limit(50);
  return NextResponse.json({ releases: rows });
}

// POST { version, vsixBase64, notes? } — upload a new release. Marks it latest.
export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const version = String(body.version ?? "").trim();
  const vsixBase64 = String(body.vsixBase64 ?? "");
  const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

  if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$/.test(version)) {
    return NextResponse.json({ error: "bad_version" }, { status: 400 });
  }
  if (!vsixBase64) return NextResponse.json({ error: "missing_vsix" }, { status: 400 });

  let bytes: Buffer;
  try {
    bytes = Buffer.from(vsixBase64, "base64");
  } catch {
    return NextResponse.json({ error: "bad_base64" }, { status: 400 });
  }
  if (bytes.length === 0) {
    return NextResponse.json({ error: "empty_vsix" }, { status: 400 });
  }
  if (bytes.length > MAX_VSIX_BYTES) {
    return NextResponse.json(
      { error: "too_large", maxBytes: MAX_VSIX_BYTES },
      { status: 413 },
    );
  }

  // Demote previous latest, insert new latest.
  await db
    .update(schema.releases)
    .set({ isLatest: false })
    .where(eq(schema.releases.isLatest, true));

  const [created] = await db
    .insert(schema.releases)
    .values({
      version,
      vsixBytes: vsixBase64,
      sizeBytes: bytes.length,
      uploadedBy: me.realActorEmail,
      notes,
      isLatest: true,
      autoUpdateEnabled: true,
    })
    .returning({
      id: schema.releases.id,
      version: schema.releases.version,
      sizeBytes: schema.releases.sizeBytes,
      uploadedAt: schema.releases.uploadedAt,
    });

  await audit({
    action: "release.published",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    metadata: {
      version,
      sizeBytes: bytes.length,
      releaseId: created.id,
    },
  });

  return NextResponse.json({ ok: true, release: created });
}

// PATCH { id, autoUpdateEnabled } — circuit-breaker. Flip to false to stop
// clients from offering this version on their next poll.
export async function PATCH(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const autoUpdateEnabled = Boolean(body.autoUpdateEnabled);
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await db
    .update(schema.releases)
    .set({ autoUpdateEnabled })
    .where(eq(schema.releases.id, id));
  await audit({
    action: "release.toggled",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    metadata: { releaseId: id, autoUpdateEnabled },
  });
  return NextResponse.json({ ok: true });
}
