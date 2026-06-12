"use client";
import { useEffect, useRef, useState } from "react";

export type SlotInfo = {
  id: string;
  slotNumber: number;
  userId: string;
  email: string;
  name: string | null;
  startedAt: string;
  plannedEndAt: string;
  durationMinutes: number;
  extendedMinutes: number;
  purpose: string | null;
  cwd: string | null;
  activityScore: number;
  activityLabel: "idle" | "light" | "active" | "heavy";
  toolCallCount: number;
  eventCount: number;
  estimatedTokens: number;
  lastActivityAt: string | null;
  lastHeartbeatAt: string | null;
  isOverride: boolean;
};

export type QueueEntry = {
  position: number;
  etaMin: number;
  userId: string;
  email: string;
  name: string | null;
  requestedAt: string;
  desiredMinutes: number;
  urgent: boolean;
  note: string | null;
};

export type PresenceItem = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  state: "active" | "claude_idle" | "vscode" | "offline" | "ended" | "override";
  stateIcon: string;
  stateLabel: string;
  claudeRunning: boolean;
  extensionAlive: boolean;
  lastSeenAt: string | null;
  lastEventAt: string | null;
  activityScore: number;
  activityLabel: "idle" | "light" | "active" | "heavy";
  vscodeWindow: string | null;
  hostname: string | null;
  extensionVersion: string | null;
  hasOverride: boolean;
  activeSlotNumber: number | null;
};

export type StatePayload = {
  me: {
    id: string;
    role: string;
    email: string;
    isImpersonating: boolean;
    realActorEmail: string;
  };
  config: {
    maxConcurrentSlots: number;
    maxSlotMinutes: number;
    idleWarnMinutes: number;
    idleAutoEndMinutes: number;
    graceTimerSeconds: number;
  };
  banner: { message: string; severity: string; expiresAt: string | null } | null;
  freeze: { until: string; banner: string | null } | null;
  slots: SlotInfo[];
  queue: QueueEntry[];
  myActive: {
    id: string;
    slotNumber: number;
    startedAt: string;
    plannedEndAt: string;
    durationMinutes: number;
    extendedMinutes: number;
    purpose: string | null;
  } | null;
  myQueueEntry: {
    id: string;
    position: number;
    etaMin: number;
    desiredMinutes: number;
    urgent: boolean;
    note: string | null;
  } | null;
  myQuota: {
    dailyMinutes: number;
    weeklyMinutes: number;
    dailyUsedMinutes: number;
    weeklyUsedMinutes: number;
    dailyRemainingMinutes: number;
    weeklyRemainingMinutes: number;
    exhausted: boolean;
  };
  myOverride: { id: string; expiresAt: string | null } | null;
  myRestriction:
    | {
        paused: boolean;
        banned: boolean;
        cooldownUntil: string | null;
        reason: string | null;
      }
    | null;
  myApprovals: Array<{
    id: string;
    status: string;
    reason: string | null;
    desiredMinutes: number;
    requestedAt: string;
    decidedAt: string | null;
    decidedBy: string | null;
    decisionNote: string | null;
    expiresAt: string | null;
    consumedSlotId: string | null;
  }>;
  pendingApprovals: Array<{
    id: string;
    userId: string;
    email: string;
    name: string | null;
    requestedAt: string;
    reason: string | null;
    desiredMinutes: number;
    expiresAt: string | null;
  }>;
  myUsage: Array<{ day: string; minutes: number; sessions: number }>;
  allUsage: Array<{
    user: { id: string; email: string; name: string | null };
    days: Array<{ day: string; minutes: number; sessions: number }>;
  }>;
  presence: PresenceItem[];
  serverNow: string;
};

export function useStatePoll(intervalMs = 3000) {
  const [data, setData] = useState<StatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as StatePayload;
        if (!stop.current) {
          setData(json);
          setError(null);
        }
      } catch (e: unknown) {
        if (!stop.current) setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        if (!stop.current) timer = setTimeout(tick, intervalMs);
      }
    }
    tick();
    return () => {
      stop.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return { data, error };
}
