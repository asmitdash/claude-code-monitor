import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/session-helper";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

const ALLOWED_PATHS = ["memory_md", "claude_md_user", "claude_md_project", "settings_json"] as const;
type AllowedPath = (typeof ALLOWED_PATHS)[number];

// POST { userId, kind: 'read' | 'write', filePath, payload? } — admin queues a
// file command. The extension picks it up on its next heartbeat.
//
// For 'write', payload is the new file content. settings.json writes go through
// a deep-merge in the extension (preserving unknown keys). MEMORY.md / CLAUDE.md
// are straight overwrites.
export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const kind = body.kind === "write" ? "write" : body.kind === "read" ? "read" : null;
  const filePath = String(body.filePath ?? "") as AllowedPath;
  const payload = kind === "write" ? String(body.payload ?? "") : null;

  if (!userId || !kind || !ALLOWED_PATHS.includes(filePath)) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  if (kind === "write" && payload === null) {
    return NextResponse.json({ error: "missing_payload" }, { status: 400 });
  }

  const target = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!target[0]) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const [created] = await db
    .insert(schema.fileCommands)
    .values({
      userId,
      kind,
      filePath,
      payload,
      createdBy: me.realActorEmail,
    })
    .returning();

  await audit({
    action: kind === "read" ? "file.read" : "file.written",
    severity: "warn",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    targetUserId: userId,
    targetEmail: target[0].email,
    metadata: { filePath, kind, commandId: created.id, byteLen: payload?.length ?? null },
  });

  return NextResponse.json({ ok: true, commandId: created.id });
}

// GET ?userId=&filePath= — admin browses snapshots (history of previous reads).
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const filePath = url.searchParams.get("filePath") as AllowedPath | null;

  if (!userId) return NextResponse.json({ error: "missing_userId" }, { status: 400 });

  const where =
    filePath && ALLOWED_PATHS.includes(filePath)
      ? and(eq(schema.fileSnapshots.userId, userId), eq(schema.fileSnapshots.filePath, filePath))
      : eq(schema.fileSnapshots.userId, userId);

  const snapshots = await db
    .select()
    .from(schema.fileSnapshots)
    .where(where)
    .orderBy(desc(schema.fileSnapshots.capturedAt))
    .limit(50);

  // Also surface unconsumed commands so the UI can show "request pending".
  const pending = await db
    .select()
    .from(schema.fileCommands)
    .where(and(eq(schema.fileCommands.userId, userId), isNull(schema.fileCommands.consumedAt)))
    .orderBy(desc(schema.fileCommands.createdAt))
    .limit(20);

  return NextResponse.json({ snapshots, pending });
}
