import { NextRequest, NextResponse } from "next/server";
import { userFromToken } from "@/lib/auth-token";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getActiveSlots } from "@/lib/slots";
import { eventWeight, tokenGuess, costMicros } from "@/lib/activity";
import { audit } from "@/lib/audit";
import { activeRestrictions, hasActiveOverride } from "@/lib/quota";
import { noteHeartbeat } from "@/lib/engine";

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
  const cwd = body.cwd ? String(body.cwd).slice(0, 500) : null;
  const tool = body.tool ? String(body.tool) : null;
  const model = body.model ? String(body.model) : null;

  const active = await getActiveSlots();
  const myActive = active.find((s) => s.user.id === user.id);
  const slotId = myActive?.slot.id ?? null;

  const weight = eventWeight({ eventType, tool, model });
  const tokens = tokenGuess({ eventType, tool, model }, body);
  const micros = costMicros(model, tokens);

  await db.insert(schema.events).values({
    userId: user.id,
    slotId,
    eventType,
    sessionId,
    cwd,
    tool,
    model,
    payload: body,
    activityWeight: weight,
    estimatedTokens: tokens,
  });

  await db
    .insert(schema.presence)
    .values({
      userId: user.id,
      lastSeenAt: new Date(),
      lastActivityAt: new Date(),
      claudeRunning: true,
      claudeOpen: true,
      activityScore: weight,
    })
    .onConflictDoUpdate({
      target: schema.presence.userId,
      set: {
        lastSeenAt: new Date(),
        lastActivityAt: new Date(),
        claudeRunning: true,
        claudeOpen: true,
      },
    });

  if (myActive) {
    await noteHeartbeat(myActive.slot.id, {
      activityWeight: weight,
      tokens,
      costMicros: micros,
      toolCallDelta: tool ? 1 : 0,
      eventDelta: 1,
    });
  }

  const flag = await db
    .select()
    .from(schema.killFlags)
    .where(eq(schema.killFlags.userId, user.id))
    .limit(1);
  const restr = await activeRestrictions(user.id);
  const override = await hasActiveOverride(user.id);

  // Slot enforcement: any tool call that doesn't have an owning slot or override
  // is recorded as an unauthorized attempt and treated as blocked by the server.
  let unauthorized = false;
  if (!myActive && !override.active && tool) {
    unauthorized = true;
    await audit({
      action: "unauthorized.attempt",
      severity: "alert",
      actorUserId: user.id,
      actorEmail: user.email,
      targetUserId: user.id,
      targetEmail: user.email,
      metadata: { source: "ingest", tool, eventType, cwd, model },
    });
  }

  const blocked =
    flag[0]?.blocked === true || restr.banned || restr.paused || unauthorized;

  return NextResponse.json({
    ok: true,
    blocked,
    reason:
      flag[0]?.reason ??
      (restr.banned
        ? "banned"
        : restr.paused
        ? "paused by team lead"
        : unauthorized
        ? "no active slot — request one in the dashboard"
        : null),
    slot: myActive
      ? {
          plannedEndAt: myActive.slot.plannedEndAt,
          startedAt: myActive.slot.startedAt,
          slotNumber: myActive.slot.slotNumber,
        }
      : null,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST with Authorization: Bearer <token>",
  });
}
