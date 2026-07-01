import { NextRequest, NextResponse } from "next/server";
import { userFromToken } from "@/lib/auth-token";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  getActiveSlots,
  getQueue,
  estimateQueueWaitMinutes,
} from "@/lib/slots";
import { audit } from "@/lib/audit";
import { activeRestrictions, hasActiveOverride } from "@/lib/quota";
import { getConfig } from "@/lib/config";
import { noteHeartbeat } from "@/lib/engine";
import { isAdminBypass } from "@/lib/role";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {}

  const claudeRunning = Boolean(body.claudeRunning);
  const claudeOpen =
    Boolean(body.claudeOpen) || Boolean(body.localSurface);
  const vscodeOpen = Boolean(body.vscodeOpen ?? true);
  const windowFocused = Boolean(body.windowFocused ?? true);
  const vscodeWindow = body.vscodeWindow ? String(body.vscodeWindow).slice(0, 200) : null;
  const hostname = body.hostname ? String(body.hostname).slice(0, 100) : null;
  const extensionVersion = body.extensionVersion
    ? String(body.extensionVersion).slice(0, 30)
    : null;

  await db
    .insert(schema.presence)
    .values({
      userId: user.id,
      lastSeenAt: new Date(),
      claudeRunning,
      claudeOpen,
      vscodeOpen,
      windowFocused,
      vscodeWindow,
      hostname,
      extensionVersion,
    })
    .onConflictDoUpdate({
      target: schema.presence.userId,
      set: {
        lastSeenAt: new Date(),
        claudeRunning,
        claudeOpen,
        vscodeOpen,
        windowFocused,
        vscodeWindow,
        hostname,
        extensionVersion,
      },
    });

  // Bump heartbeat on user's slot if any. When the extension reports Claude
  // Code is running or open, treat that as user presence — advance
  // lastActivityAt so the idle-sweep doesn't kill a live slot when the hook
  // is flaky/slow (e.g. old hardware, CPU starvation, hook cold-starts).
  // Presence-only pings do NOT bump scoring counters.
  const active = await getActiveSlots();
  const myActive = active.find((s) => s.user.id === user.id);
  if (myActive) {
    await noteHeartbeat(myActive.slot.id, {
      presence: claudeRunning || claudeOpen,
    });
  }

  const queue = await getQueue();
  const cfg = await getConfig();
  const myQueuePos = queue.findIndex((q) => q.user.id === user.id);
  const eta =
    myQueuePos >= 0 ? await estimateQueueWaitMinutes(myQueuePos + 1) : null;

  const flag = await db
    .select()
    .from(schema.killFlags)
    .where(eq(schema.killFlags.userId, user.id))
    .limit(1);

  const adminBypass = isAdminBypass(user.role);
  const restr = adminBypass
    ? { paused: false, banned: false, cooldownUntil: null, reason: null }
    : await activeRestrictions(user.id);
  const override = await hasActiveOverride(user.id);

  // Server-side slot enforcement: if user is running Claude (claudeRunning OR
  // claudeOpen) but holds neither a slot nor an active override, log the
  // unauthorized attempt. TLs are exempt — they have unlimited access and
  // never count as unauthorized.
  let unauthorized = false;
  if (
    !adminBypass &&
    (claudeRunning || claudeOpen) &&
    !myActive &&
    !override.active
  ) {
    unauthorized = true;
    await audit({
      action: "unauthorized.attempt",
      severity: "warn",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      targetUserId: user.id,
      targetEmail: user.email,
      metadata: {
        source: "heartbeat",
        claudeRunning,
        claudeOpen,
        hostname,
        vscodeWindow,
      },
    });
  }

  const blocked =
    !adminBypass &&
    (flag[0]?.blocked === true ||
      restr.banned ||
      restr.paused ||
      (!myActive && !override.active && unauthorized));

  return NextResponse.json({
    ok: true,
    blocked,
    adminBypass,
    reason: adminBypass
      ? null
      : flag[0]?.reason ??
        (restr.banned
          ? "banned"
          : restr.paused
          ? "paused by team lead"
          : unauthorized
          ? "no active slot — request one in the dashboard"
          : null),
    activeUsers: active.map((s) => ({
      email: s.user.email,
      name: s.user.name,
      plannedEndAt: s.slot.plannedEndAt,
      slotNumber: s.slot.slotNumber,
    })),
    activeUser: active[0]
      ? {
          email: active[0].user.email,
          name: active[0].user.name,
          plannedEndAt: active[0].slot.plannedEndAt,
        }
      : null,
    mySlot: myActive
      ? {
          startedAt: myActive.slot.startedAt,
          plannedEndAt: myActive.slot.plannedEndAt,
          slotNumber: myActive.slot.slotNumber,
        }
      : null,
    myQueuePosition: myQueuePos >= 0 ? myQueuePos + 1 : null,
    myQueueEtaMin: eta,
    myOverride: override.active,
    config: {
      maxConcurrentSlots: cfg.maxConcurrentSlots,
      pollIntervalSeconds: 10,
    },
  });
}
