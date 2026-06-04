"use client";
import { useEffect, useRef, useState } from "react";

export type StatePayload = {
  me: { id: string; role: string };
  active: {
    userId: string;
    email: string;
    name: string | null;
    startedAt: string;
    plannedEndAt: string;
    purpose: string | null;
  } | null;
  queue: Array<{
    position: number;
    userId: string;
    email: string;
    name: string | null;
    requestedAt: string;
  }>;
  myUsage: Array<{ day: string; minutes: number; sessions: number }>;
  allUsage: Array<{
    user: { id: string; email: string; name: string | null };
    days: Array<{ day: string; minutes: number; sessions: number }>;
  }>;
  presence: Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    claudeRunning: boolean;
    lastSeenAt: string | null;
    vscodeWindow: string | null;
    hostname: string | null;
  }>;
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
