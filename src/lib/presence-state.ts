// Computes the user-visible presence state from raw signals.
//
// States (in priority order):
//   override   👑 — user has an active TL approval
//   active     🟢 — actively using Claude (recent tool events)
//   claude_idle 🟡 — Claude open / surface seen but no activity for >= idleWarnMinutes
//   vscode     ⚪ — VS Code heartbeat alive but no Claude surface
//   ended      ⛔ — slot ended/expired/force-ended in last 5 min, hasn't re-engaged
//   offline    🔴 — no heartbeat within staleHeartbeatMinutes

import type { Presence } from "@/db/schema";

export type PresenceState =
  | "active"
  | "claude_idle"
  | "vscode"
  | "offline"
  | "ended"
  | "override";

export function presenceState(input: {
  presence: Presence | null | undefined;
  lastEventAt: Date | null;
  hasOverride: boolean;
  recentSlotEndedAt: Date | null;
  staleHeartbeatMinutes: number;
  idleWarnMinutes: number;
}): PresenceState {
  const now = Date.now();
  const lastSeen = input.presence?.lastSeenAt
    ? new Date(input.presence.lastSeenAt).getTime()
    : 0;
  const lastEvt = input.lastEventAt ? input.lastEventAt.getTime() : 0;
  const lastActivity = Math.max(
    lastEvt,
    input.presence?.lastActivityAt
      ? new Date(input.presence.lastActivityAt).getTime()
      : 0,
  );

  const heartbeatFresh = lastSeen > now - input.staleHeartbeatMinutes * 60_000;
  const recentlyActive = lastActivity > now - input.idleWarnMinutes * 60_000;

  if (input.hasOverride) return "override";
  if (
    input.recentSlotEndedAt &&
    now - input.recentSlotEndedAt.getTime() < 5 * 60_000 &&
    !recentlyActive
  ) {
    return "ended";
  }
  if (!heartbeatFresh) return "offline";
  if (recentlyActive) return "active";
  if (input.presence?.claudeOpen || input.presence?.claudeRunning) return "claude_idle";
  if (input.presence?.vscodeOpen) return "vscode";
  return "offline";
}

export const STATE_ICON: Record<PresenceState, string> = {
  active: "🟢",
  claude_idle: "🟡",
  vscode: "⚪",
  offline: "🔴",
  ended: "⛔",
  override: "👑",
};

export const STATE_LABEL: Record<PresenceState, string> = {
  active: "Actively using Claude",
  claude_idle: "Claude open (idle)",
  vscode: "VS Code open",
  offline: "Offline",
  ended: "Session ended",
  override: "TL approved override",
};
