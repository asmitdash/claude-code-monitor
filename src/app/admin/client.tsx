"use client";

import { useState, useTransition } from "react";
import { useStatePoll } from "@/components/use-state-poll";
import { UsageBars } from "@/components/usage-bars";
import { Countdown } from "@/components/countdown";

export function AdminClient({ apiToken }: { apiToken: string }) {
  const { data, error } = useStatePoll(2000);
  const [pending, startTransition] = useTransition();
  const [confirmKill, setConfirmKill] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  if (error && !data) return <div className="p-6 text-red-400 text-sm">Error: {error}</div>;
  if (!data) return <div className="p-6 text-neutral-500 text-sm">Loading…</div>;

  async function killUser(userId: string) {
    await fetch("/api/admin/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, reason: "ended by team lead" }),
    });
    setConfirmKill(null);
  }

  async function unblock(userId: string) {
    await fetch("/api/admin/kill", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }

  function formatLastSeen(iso: string | null) {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 30_000) return "just now";
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    return `${Math.floor(ms / 3_600_000)}h ago`;
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Live presence
          </h2>
          <span className="text-xs text-neutral-500">
            polling · server {new Date(data.serverNow).toLocaleTimeString()}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.presence.map((p) => {
            const isActive = data.active?.userId === p.id;
            return (
              <div
                key={p.id}
                className="border border-neutral-800 rounded-xl p-4 bg-neutral-950/40"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium">
                      {p.name ?? p.email}
                      {p.role === "tl" && (
                        <span className="ml-2 text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-300">
                          TL
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-500">{p.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        p.claudeRunning
                          ? "bg-emerald-400 animate-pulse"
                          : "bg-neutral-700"
                      }`}
                    />
                    <span className="text-xs text-neutral-400">
                      {p.claudeRunning ? "Claude active" : "Idle"}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-neutral-500 space-y-0.5">
                  <div>Last seen: {formatLastSeen(p.lastSeenAt)}</div>
                  {p.hostname && <div>Host: {p.hostname}</div>}
                  {p.vscodeWindow && (
                    <div className="truncate">VS Code: {p.vscodeWindow}</div>
                  )}
                </div>
                {isActive && (
                  <div className="mt-3 pt-3 border-t border-neutral-800">
                    <div className="text-xs text-emerald-300 mb-2">
                      In active slot — ends in{" "}
                      <Countdown to={data.active!.plannedEndAt} />
                    </div>
                    {confirmKill === p.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => startTransition(() => void killUser(p.id))}
                          disabled={pending}
                          className="flex-1 rounded-md bg-red-500 hover:bg-red-400 text-white text-xs px-3 py-1.5 font-medium"
                        >
                          Confirm kill
                        </button>
                        <button
                          onClick={() => setConfirmKill(null)}
                          className="rounded-md border border-neutral-700 hover:bg-neutral-800 text-xs px-3 py-1.5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmKill(p.id)}
                        className="w-full rounded-md bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 text-xs px-3 py-1.5 font-medium"
                      >
                        Stop their Claude Code
                      </button>
                    )}
                  </div>
                )}
                {!isActive && (
                  <button
                    onClick={() => startTransition(() => void unblock(p.id))}
                    className="mt-2 text-[10px] text-neutral-500 hover:text-neutral-300"
                  >
                    Clear any kill flag
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {data.queue.length > 0 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
            Queue
          </h2>
          <ul className="space-y-1.5">
            {data.queue.map((q) => (
              <li key={q.userId} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-neutral-500 font-mono mr-2">#{q.position}</span>
                  {q.name ?? q.email}
                </span>
                <span className="text-xs text-neutral-500">
                  {new Date(q.requestedAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-4">
          Last 7 days · per teammate
        </h2>
        <div className="space-y-6">
          {data.allUsage.length === 0 && (
            <div className="text-sm text-neutral-500">No sessions recorded yet.</div>
          )}
          {data.allUsage.map((u) => (
            <div key={u.user.id}>
              <div className="text-sm font-medium mb-2">{u.user.name ?? u.user.email}</div>
              <UsageBars data={u.days} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Your extension API token
          </h2>
          <button
            onClick={() => setShowToken((s) => !s)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {showToken ? "Hide" : "Show"}
          </button>
        </div>
        <code className="block break-all rounded bg-neutral-950 border border-neutral-800 px-3 py-2 text-[11px] font-mono">
          {showToken ? apiToken : "•".repeat(40)}
        </code>
      </section>
    </main>
  );
}
