import { NextRequest, NextResponse } from "next/server";
import { requireTL } from "@/lib/session-helper";
import { getConfig, updateConfig } from "@/lib/config";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

const ALLOW = new Set([
  "dailyMinutes",
  "weeklyMinutes",
  "maxSlotMinutes",
  "cooldownAfterKillMinutes",
  "approvalAutoExpireMinutes",
  "idleAutoEndMinutes",
  "idleWarnMinutes",
  "staleHeartbeatMinutes",
  "staleHeartbeatEnabled",
  "bypassPermissionsEnabled",
  "requiredExtensionVersion",
  "requiredMcpVersion",
  "enforceStaleClientsAfter",
  "graceTimerSeconds",
  "maxConcurrentSlots",
  "freezeBanner",
  "freezeUntil",
]);

export async function GET() {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ config: await getConfig() });
}

export async function PATCH(req: NextRequest) {
  const me = await requireTL();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (!ALLOW.has(k)) continue;
    if (k === "freezeUntil" || k === "enforceStaleClientsAfter") {
      patch[k] = body[k] ? new Date(body[k]) : null;
    } else if (k === "freezeBanner") {
      patch[k] = body[k] ? String(body[k]).slice(0, 300) : null;
    } else if (k === "requiredExtensionVersion" || k === "requiredMcpVersion") {
      const raw = body[k];
      if (raw === null || raw === "") {
        patch[k] = null;
      } else if (typeof raw === "string" && /^\d+(\.\d+){0,2}$/.test(raw.trim())) {
        patch[k] = raw.trim();
      }
    } else if (k === "staleHeartbeatEnabled" || k === "bypassPermissionsEnabled") {
      patch[k] = Boolean(body[k]);
    } else {
      const n = Number(body[k]);
      if (Number.isFinite(n) && n >= 0) patch[k] = n;
    }
  }
  const updated = await updateConfig(patch as never, me.realActorEmail);
  await audit({
    action: "config.updated",
    actorUserId: me.realActorId,
    actorEmail: me.realActorEmail,
    actorRole: "admin",
    metadata: { patch },
  });
  return NextResponse.json({ ok: true, config: updated });
}
