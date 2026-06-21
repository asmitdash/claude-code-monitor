import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { userFromToken } from "@/lib/auth-token";

export const runtime = "nodejs";

const ALLOWED_PATHS = new Set([
  "memory_md",
  "claude_md_user",
  "claude_md_project",
  "settings_json",
]);

// POST { commandId, filePath, content, workspace?, error? } — extension uploads
// the result of a read command (or reports an error). For write commands the
// extension calls this with kind=write and may include the post-write content
// for verification (optional).
export async function POST(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const commandId = String(body.commandId ?? "");
  const filePath = String(body.filePath ?? "");
  const content = typeof body.content === "string" ? body.content : null;
  const workspace = body.workspace ? String(body.workspace).slice(0, 500) : null;
  const error = body.error ? String(body.error).slice(0, 1000) : null;

  if (!commandId) return NextResponse.json({ error: "missing_commandId" }, { status: 400 });
  if (!ALLOWED_PATHS.has(filePath)) {
    return NextResponse.json({ error: "bad_filePath" }, { status: 400 });
  }

  // Verify the command exists and targets this user — never let one user
  // upload snapshots for another.
  const [cmd] = await db
    .select()
    .from(schema.fileCommands)
    .where(and(eq(schema.fileCommands.id, commandId), eq(schema.fileCommands.userId, user.id)))
    .limit(1);
  if (!cmd) return NextResponse.json({ error: "command_not_found" }, { status: 404 });

  // Mark the command consumed.
  await db
    .update(schema.fileCommands)
    .set({
      consumedAt: new Date(),
      status: error ? "error" : "ok",
      error: error,
    })
    .where(eq(schema.fileCommands.id, commandId));

  // Persist the snapshot only when we have content. (Write-only commands may
  // skip this and just confirm.)
  if (content !== null && !error) {
    await db.insert(schema.fileSnapshots).values({
      userId: user.id,
      filePath: filePath as
        | "memory_md"
        | "claude_md_user"
        | "claude_md_project"
        | "settings_json",
      workspace,
      content,
      sourceCommandId: commandId,
    });
  }

  return NextResponse.json({ ok: true });
}
