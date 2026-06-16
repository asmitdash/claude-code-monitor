import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session-helper";
import { tryClaim } from "@/lib/engine";
import { estimateQueueWaitMinutes } from "@/lib/slots";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const purpose = body.purpose ? String(body.purpose).slice(0, 200) : null;
  const desiredMinutes = body.desiredMinutes ? Number(body.desiredMinutes) : 60;
  const cwd = body.cwd ? String(body.cwd).slice(0, 500) : null;
  const note = body.note ? String(body.note).slice(0, 200) : null;
  const joinQueueIfFull = Boolean(body.joinQueueIfFull ?? true);

  const decision = await tryClaim({
    userId: me.id,
    email: me.email,
    role: me.role,
    desiredMinutes,
    purpose,
    cwd,
    joinQueueIfFull,
    note,
  });

  if (decision.ok) {
    return NextResponse.json({
      ok: true,
      slot: decision.slot,
      reason: decision.reason,
    });
  }

  if (decision.reason === "no_capacity" && decision.queued) {
    const eta = await estimateQueueWaitMinutes(decision.queued.position);
    return NextResponse.json(
      {
        ok: false,
        error: "no_capacity",
        queued: { ...decision.queued, etaMin: eta },
      },
      { status: 202 },
    );
  }

  if (decision.reason === "already_active") {
    return NextResponse.json(
      {
        ok: false,
        error: "already_active",
        slot: decision.slot,
      },
      { status: 409 },
    );
  }

  const status =
    decision.reason === "banned" || decision.reason === "paused" ? 403 : 409;
  const { ok: _ok, ...rest } = decision;
  return NextResponse.json(
    { ok: false, error: decision.reason, ...rest },
    { status },
  );
}
