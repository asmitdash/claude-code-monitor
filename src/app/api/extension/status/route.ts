import { NextRequest, NextResponse } from "next/server";
import { userFromToken } from "@/lib/auth-token";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getActiveSlot, getQueue } from "@/lib/slots";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {}

  const claudeRunning = Boolean(body.claudeRunning);
  const vscodeWindow = body.vscodeWindow ? String(body.vscodeWindow) : null;
  const hostname = body.hostname ? String(body.hostname) : null;

  await db
    .insert(schema.presence)
    .values({
      userId: user.id,
      lastSeenAt: new Date(),
      claudeRunning,
      vscodeWindow,
      hostname,
    })
    .onConflictDoUpdate({
      target: schema.presence.userId,
      set: {
        lastSeenAt: new Date(),
        claudeRunning,
        vscodeWindow,
        hostname,
      },
    });

  const flag = await db
    .select()
    .from(schema.killFlags)
    .where(eq(schema.killFlags.userId, user.id))
    .limit(1);

  const active = await getActiveSlot();
  const queue = await getQueue();
  const myActive = active && active.user.id === user.id ? active : null;
  const myQueuePos = queue.findIndex((q) => q.user.id === user.id);

  return NextResponse.json({
    ok: true,
    blocked: flag[0]?.blocked ?? false,
    reason: flag[0]?.reason ?? null,
    activeUser: active
      ? { email: active.user.email, name: active.user.name, plannedEndAt: active.slot.plannedEndAt }
      : null,
    mySlot: myActive
      ? { startedAt: myActive.slot.startedAt, plannedEndAt: myActive.slot.plannedEndAt }
      : null,
    myQueuePosition: myQueuePos >= 0 ? myQueuePos + 1 : null,
  });
}
