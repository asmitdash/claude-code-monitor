"use client";

import { useState, useTransition } from "react";
import { useStatePoll } from "@/components/use-state-poll";
import { UsageBars } from "@/components/usage-bars";
import { Countdown } from "@/components/countdown";

export function DashboardClient({ apiToken, myEmail }: { apiToken: string; myEmail: string }) {
  const { data, error } = useStatePoll(3000);
  const [purpose, setPurpose] = useState("");
  const [pending, startTransition] = useTransition();
  const [showToken, setShowToken] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  if (error && !data) {
    return <div className="p-6 text-red-400 text-sm">Error: {error}</div>;
  }
  if (!data) {
    return <div className="p-6 text-neutral-500 text-sm">Loading…</div>;
  }

  const isMine = data.active?.userId === data.me.id;
  const myQueueEntry = data.queue.find((q) => q.userId === data.me.id);

  async function claim() {
    setActionMsg(null);
    const res = await fetch("/api/slot/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setActionMsg(j.error ?? `failed (${res.status})`);
    } else {
      setPurpose("");
    }
  }

  async function release() {
    setActionMsg(null);
    await fetch("/api/slot/release", { method: "POST" });
  }

  async function queueUp() {
    setActionMsg(null);
    await fetch("/api/queue", { method: "POST" });
  }
  async function queueOff() {
    setActionMsg(null);
    await fetch("/api/queue", { method: "DELETE" });
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Current slot
          </h2>
          {data.active && (
            <span className="text-xs text-neutral-500">
              ends in <Countdown to={data.active.plannedEndAt} />
            </span>
          )}
        </div>
        {data.active ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-medium">
                {isMine ? "You" : data.active.name ?? data.active.email}
                {isMine && <span className="ml-2 text-emerald-400 text-sm">(you)</span>}
              </div>
              {data.active.purpose && (
                <div className="text-xs text-neutral-400 mt-0.5">{data.active.purpose}</div>
              )}
              <div className="text-xs text-neutral-500 mt-0.5">
                started {new Date(data.active.startedAt).toLocaleTimeString()}
              </div>
            </div>
            {isMine ? (
              <button
                onClick={() => startTransition(() => void release())}
                disabled={pending}
                className="rounded-md bg-neutral-100 text-neutral-900 hover:bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Done — release slot
              </button>
            ) : null}
          </div>
        ) : (
          <div className="text-neutral-500 text-sm">No one is currently using Claude Code.</div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-4">
          Action
        </h2>
        {actionMsg && (
          <div className="mb-3 text-xs text-amber-300">{actionMsg}</div>
        )}
        {isMine ? (
          <p className="text-sm text-neutral-300">You are the active user. Click "Done" above when finished.</p>
        ) : data.active ? (
          myQueueEntry ? (
            <div className="flex items-center justify-between">
              <div className="text-sm">
                Queued — position #{myQueueEntry.position}
              </div>
              <button
                onClick={() => startTransition(() => void queueOff())}
                disabled={pending}
                className="rounded-md border border-neutral-700 hover:bg-neutral-800 px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancel request
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm text-neutral-300">
                {data.active.name ?? data.active.email} is using Claude Code.
              </div>
              <button
                onClick={() => startTransition(() => void queueUp())}
                disabled={pending}
                className="rounded-md bg-amber-400 text-neutral-950 hover:bg-amber-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Request Claude Code
              </button>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="What are you working on? (optional)"
              className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
            />
            <button
              onClick={() => startTransition(() => void claim())}
              disabled={pending}
              className="w-full rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Use Claude Code
            </button>
          </div>
        )}
      </section>

      {data.queue.length > 0 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
            Queue
          </h2>
          <ul className="space-y-1.5">
            {data.queue.map((q) => (
              <li
                key={q.userId}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  <span className="text-neutral-500 font-mono mr-2">#{q.position}</span>
                  {q.name ?? q.email}
                  {q.email === myEmail && <span className="ml-2 text-emerald-400 text-xs">(you)</span>}
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
          Your last 7 days
        </h2>
        <UsageBars data={data.myUsage} />
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Extension API token
          </h2>
          <button
            onClick={() => setShowToken((s) => !s)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {showToken ? "Hide" : "Show"}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mb-2">
          Paste this into the Claude Monitor VS Code extension settings.
        </p>
        <code className="block break-all rounded bg-neutral-950 border border-neutral-800 px-3 py-2 text-[11px] font-mono">
          {showToken ? apiToken : "•".repeat(40)}
        </code>
      </section>
    </main>
  );
}
