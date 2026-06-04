import { NextRequest, NextResponse } from "next/server";
import { userFromToken } from "@/lib/auth-token";
import { db, schema } from "@/db";
import { getActiveSlot } from "@/lib/slots";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const eventType = String(body.event_type ?? body.eventType ?? "unknown");
  const sessionId = body.session_id ? String(body.session_id) : null;
  const cwd = body.cwd ? String(body.cwd) : null;
  const tool = body.tool ? String(body.tool) : null;
  const model = body.model ? String(body.model) : null;

  const active = await getActiveSlot();
  const slotId = active && active.user.id === user.id ? active.slot.id : null;

  await db.insert(schema.events).values({
    userId: user.id,
    slotId,
    eventType,
    sessionId,
    cwd,
    tool,
    model,
    payload: body,
  });

  await db
    .insert(schema.presence)
    .values({
      userId: user.id,
      lastSeenAt: new Date(),
      claudeRunning: true,
    })
    .onConflictDoUpdate({
      target: schema.presence.userId,
      set: {
        lastSeenAt: new Date(),
        claudeRunning: true,
      },
    });

  const flag = await db
    .select()
    .from(schema.killFlags)
    .where(eq(schema.killFlags.userId, user.id))
    .limit(1);

  const blocked = flag[0]?.blocked ?? false;

  return NextResponse.json({
    ok: true,
    blocked,
    reason: blocked ? flag[0]?.reason ?? "blocked by team lead" : null,
    slot: active && active.user.id === user.id
      ? {
          plannedEndAt: active.slot.plannedEndAt,
          startedAt: active.slot.startedAt,
        }
      : null,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST with Authorization: Bearer <token>" });
}

export const _unused = sql;
