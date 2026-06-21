"use client";

import { useEffect, useState, useTransition } from "react";
import { useStatePoll } from "@/components/use-state-poll";
import { UsageChart } from "@/components/usage-chart";
import { Countdown } from "@/components/countdown";

const DOWNLOAD_URL = "/api/extension/latest/download";
const DISMISSED_KEY = "ccm.extension.dismissedVersion";

type ReleaseManifest = {
  ok: boolean;
  version?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  notes?: string | null;
};

function ExtensionUpdateBanner() {
  const [latest, setLatest] = useState<ReleaseManifest | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY));
    } catch {}
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/extension/latest", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as ReleaseManifest;
        if (!cancelled && j.ok && j.version) setLatest(j);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest?.version) return null;
  if (dismissed === latest.version) return null;

  function dismiss() {
    if (!latest?.version) return;
    try {
      localStorage.setItem(DISMISSED_KEY, latest.version);
    } catch {}
    setDismissed(latest.version);
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 flex flex-wrap items-center gap-3 justify-between">
      <div className="min-w-0">
        <div className="font-medium">
          🚀 Claude Monitor extension v{latest.version} is available
        </div>
        <div className="text-xs text-emerald-200/80 mt-0.5">
          {latest.notes ?? "New extension build available."}
          {typeof latest.sizeBytes === "number" && (
            <span className="text-emerald-300/60 ml-2">
              ({Math.round(latest.sizeBytes / 1024)} KB)
            </span>
          )}
          <span className="block text-emerald-300/60 mt-1">
            After download: <code className="font-mono">code --install-extension &lt;file&gt;</code> then reload VS Code. Future updates will auto-prompt from inside the editor.
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={DOWNLOAD_URL}
          download={`claude-monitor-${latest.version}.vsix`}
          className="rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-3 py-1.5 text-xs font-medium"
        >
          Download .vsix
        </a>
        <button
          onClick={dismiss}
          className="text-xs text-emerald-200/70 hover:text-emerald-100 px-2"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function DashboardClient({ apiToken, myEmail }: { apiToken: string; myEmail: string }) {
  const { data, error } = useStatePoll(3000);
  const [purpose, setPurpose] = useState("");
  const [duration, setDuration] = useState<15 | 60 | 120>(60);
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showToken, setShowToken] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [approvalReason, setApprovalReason] = useState("");

  if (error && !data) {
    return <div className="p-6 text-red-400 text-sm">Error: {error}</div>;
  }
  if (!data) {
    return <div className="p-6 text-neutral-500 text-sm">Loading…</div>;
  }

  // Out-of-band slots (slotNumber === 0) don't consume member capacity.
  const slotsBusy = data.slots.filter((s) => s.slotNumber > 0).length;
  const cap = data.config.maxConcurrentSlots;
  const isMine = !!data.myActive;
  const myQ = data.myQueueEntry;
  const adminBypass = data.me.adminBypass;
  const queueCanRequest = !isMine && !myQ;
  const queueExceedsCapacity = data.queue.length >= cap;
  const myPendingApproval = data.myApprovals.find((a) => a.status === "pending");

  async function claim() {
    setActionMsg(null);
    const res = await fetch("/api/slot/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, desiredMinutes: duration, joinQueueIfFull: true }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) {
      setActionMsg(j.error ?? `failed (${res.status})`);
    } else if (res.status === 202) {
      setActionMsg(
        `Both slots are full. You're #${j.queued?.position ?? "?"} in the queue (~${j.queued?.etaMin ?? "?"}m).`,
      );
    } else {
      setPurpose("");
    }
  }
  async function release() {
    setActionMsg(null);
    await fetch("/api/slot/release", { method: "POST" });
  }
  async function extend(minutes: number) {
    setActionMsg(null);
    const r = await fetch("/api/slot/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.error === "queue_not_empty") {
      setActionMsg(`Queue not empty — extension request sent to TL (auto-expires in 30m).`);
    } else if (!r.ok) {
      setActionMsg(j.error ?? `failed (${r.status})`);
    }
  }
  async function queueUp() {
    setActionMsg(null);
    await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, desiredMinutes: duration, urgent }),
    });
    setNote("");
    setUrgent(false);
  }
  async function queueOff() {
    setActionMsg(null);
    await fetch("/api/queue", { method: "DELETE" });
  }
  async function requestApproval() {
    setActionMsg(null);
    const r = await fetch("/api/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: approvalReason, desiredMinutes: duration }),
    });
    if (r.ok) setApprovalReason("");
  }
  async function cancelApproval() {
    await fetch("/api/approval", { method: "DELETE" });
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <ExtensionUpdateBanner />
      {data.banner && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-sm ${
            data.banner.severity === "alert"
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : data.banner.severity === "warn"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : "border-neutral-700 bg-neutral-900/40 text-neutral-200"
          }`}
        >
          <div className="font-medium">📢 {data.banner.message}</div>
        </div>
      )}
      {data.freeze && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          ❄️ Slot claims frozen until {new Date(data.freeze.until).toLocaleString()}.
          {data.freeze.banner && <span className="ml-2 text-red-300">{data.freeze.banner}</span>}
        </div>
      )}

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Slots · {data.slots.filter((s) => s.slotNumber > 0).length} / {cap}
          </h2>
          <span className="text-xs text-neutral-500">
            {(() => {
              const numbered = data.slots.filter((s) => s.slotNumber > 0).length;
              return numbered === 0
                ? "both open"
                : numbered < cap
                ? `${cap - numbered} open`
                : "full";
            })()}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: cap }).map((_, i) => {
            const slot = data.slots.find((s) => s.slotNumber === i + 1);
            return (
              <div
                key={i}
                className={`rounded-xl p-4 border ${
                  slot
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-dashed border-neutral-700 bg-neutral-900/20"
                }`}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-[11px] uppercase text-neutral-500">Slot {i + 1}</div>
                  {slot && (
                    <div className="text-xs text-neutral-400 font-mono">
                      ends in <Countdown to={slot.plannedEndAt} />
                    </div>
                  )}
                </div>
                {slot ? (
                  <div>
                    <div className="font-medium">
                      {slot.userId === data.me.id ? "You" : slot.name ?? slot.email}
                      {slot.userId === data.me.id && (
                        <span className="ml-2 text-emerald-400 text-xs">(you)</span>
                      )}
                    </div>
                    {slot.purpose && (
                      <div className="text-xs text-neutral-400 mt-1">{slot.purpose}</div>
                    )}
                    <div className="text-[11px] text-neutral-500 mt-1">
                      {slot.activityLabel} · {slot.toolCallCount} tool calls ·{" "}
                      {(slot.estimatedTokens / 1000).toFixed(1)}k tokens
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-neutral-500">Open</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-4">
          {isMine ? "Your slot" : myQ ? "Your queue spot" : "Use Claude Code"}
        </h2>
        {actionMsg && <div className="mb-3 text-xs text-amber-300">{actionMsg}</div>}

        {data.myRestriction?.banned && (
          <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-xs">
            🚫 You are banned. {data.myRestriction.reason ?? ""}
          </div>
        )}
        {data.myRestriction?.paused && (
          <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs">
            ⏸ You are paused. {data.myRestriction.reason ?? ""}
          </div>
        )}
        {data.myRestriction?.cooldownUntil && (
          <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs">
            🧊 Cooldown until {new Date(data.myRestriction.cooldownUntil).toLocaleTimeString()}.
          </div>
        )}

        {isMine ? (
          <div className="space-y-3">
            <div className="text-sm text-neutral-300">
              {data.myActive!.slotNumber === 0
                ? "TL bypass slot active. "
                : `Slot ${data.myActive!.slotNumber} active. `}
              {adminBypass ? (
                <span className="text-violet-300">Unlimited — release when done.</span>
              ) : (
                <>
                  Ends in <Countdown to={data.myActive!.plannedEndAt} />.
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => startTransition(() => void release())}
                disabled={pending}
                className="rounded-md bg-neutral-100 text-neutral-900 hover:bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Done — release slot
              </button>
              {!adminBypass && (
                <>
                  <button
                    onClick={() => startTransition(() => void extend(15))}
                    disabled={pending}
                    className="rounded-md border border-neutral-700 hover:bg-neutral-800 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    +15 min
                  </button>
                  <button
                    onClick={() => startTransition(() => void extend(30))}
                    disabled={pending}
                    className="rounded-md border border-neutral-700 hover:bg-neutral-800 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    +30 min
                  </button>
                </>
              )}
              {data.queue.length > 0 && (
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await fetch("/api/slot/handoff", { method: "POST", body: "{}" });
                    })
                  }
                  disabled={pending}
                  className="rounded-md bg-amber-400/20 border border-amber-400/40 text-amber-200 hover:bg-amber-400/30 px-3 py-2 text-xs disabled:opacity-50"
                >
                  Hand off to next in queue
                </button>
              )}
            </div>
          </div>
        ) : myQ ? (
          <div className="space-y-3">
            <div className="text-sm">
              Queued · position #{myQ.position} · est. wait ~{myQ.etaMin}m
              {myQ.urgent && <span className="ml-2 text-red-300 text-xs">URGENT</span>}
            </div>
            {myQ.note && (
              <div className="text-xs text-neutral-500 italic">"{myQ.note}"</div>
            )}
            <button
              onClick={() => startTransition(() => void queueOff())}
              disabled={pending}
              className="rounded-md border border-neutral-700 hover:bg-neutral-800 px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel request
            </button>

            {queueExceedsCapacity && !myPendingApproval && !data.myOverride && (
              <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 space-y-2">
                <div className="text-xs uppercase text-violet-300 tracking-wide">
                  Request additional access from TL
                </div>
                <div className="text-xs text-neutral-300">
                  Queue exceeds capacity. Ask the TL to grant a temporary override.
                </div>
                <input
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder="Why do you need this now?"
                  className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => startTransition(() => void requestApproval())}
                  disabled={pending}
                  className="rounded-md bg-violet-500 hover:bg-violet-400 text-neutral-950 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  Request TL Approval
                </button>
              </div>
            )}
          </div>
        ) : queueCanRequest ? (
          adminBypass ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
                👑 TL — unlimited access. No queue, no quota, no auto-end.
              </div>
              <input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="What are you working on? (optional)"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
              />
              <button
                onClick={() => startTransition(() => void claim())}
                disabled={pending}
                className="w-full rounded-md bg-violet-500 hover:bg-violet-400 text-neutral-950 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Use Claude Code (TL bypass)
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {([15, 60, 120] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setDuration(m)}
                    className={`rounded-md border px-3 py-1.5 text-xs ${
                      duration === m
                        ? "border-emerald-400 text-emerald-300 bg-emerald-500/10"
                        : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                    }`}
                  >
                    {m === 15 ? "Quick (15m)" : m === 60 ? "Normal (1h)" : "Long (2h)"}
                  </button>
                ))}
              </div>
              <input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="What are you working on? (optional)"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
              />
              {slotsBusy >= cap && (
                <div className="space-y-2">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note for active users (e.g. need 5min for one bug)"
                    className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs"
                  />
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={urgent}
                      onChange={(e) => setUrgent(e.target.checked)}
                      className="accent-red-400"
                    />
                    Mark urgent (TL sees this flag)
                  </label>
                </div>
              )}
              <button
                onClick={() => startTransition(() => (slotsBusy >= cap ? void queueUp() : void claim()))}
                disabled={pending}
                className={`w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${
                  slotsBusy >= cap
                    ? "bg-amber-400 text-neutral-950 hover:bg-amber-300"
                    : "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                }`}
              >
                {slotsBusy >= cap ? `Join queue (~${data.queue.length + 1})` : "Use Claude Code"}
              </button>
              <div className="text-[11px] text-neutral-500">
                Quota: {Math.round(data.myQuota.dailyUsedMinutes)} /{" "}
                {data.myQuota.dailyMinutes}m today ·{" "}
                {Math.round(data.myQuota.weeklyUsedMinutes)} /{" "}
                {data.myQuota.weeklyMinutes}m this week
                {data.myQuota.exhausted && (
                  <span className="ml-2 text-amber-400">(quota exhausted)</span>
                )}
              </div>
            </div>
          )
        ) : null}

        {myPendingApproval && (
          <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
            <div className="text-violet-200 mb-2">
              ⏳ Pending TL approval: {myPendingApproval.reason ?? "(no reason)"}
            </div>
            <button
              onClick={() => startTransition(() => void cancelApproval())}
              className="text-xs text-neutral-400 hover:text-neutral-200"
            >
              Cancel request
            </button>
          </div>
        )}
        {data.myOverride && (
          <div className="mt-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-200">
            👑 TL approved override active. Click "Use Claude Code" — bypasses capacity.
          </div>
        )}
      </section>

      {data.queue.length > 0 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
            Queue · {data.queue.length}
          </h2>
          <ul className="space-y-1.5">
            {data.queue.map((q) => (
              <li
                key={q.userId}
                className="flex items-center justify-between text-sm border-b border-neutral-800/40 last:border-0 py-1.5"
              >
                <span>
                  <span className="text-neutral-500 font-mono mr-2">#{q.position}</span>
                  {q.name ?? q.email}
                  {q.email === myEmail && (
                    <span className="ml-2 text-emerald-400 text-xs">(you)</span>
                  )}
                  {q.urgent && (
                    <span className="ml-2 text-red-300 text-[10px] uppercase">urgent</span>
                  )}
                  {q.note && (
                    <span className="ml-2 text-xs text-neutral-500 italic">"{q.note}"</span>
                  )}
                </span>
                <span className="text-xs text-neutral-500">~{q.etaMin}m</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-4">
          Your last 7 days
        </h2>
        <UsageChart data={data.myUsage} height={200} />
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
          Paste this into the Claude Monitor VS Code extension.
        </p>
        <code className="block break-all rounded bg-neutral-950 border border-neutral-800 px-3 py-2 text-[11px] font-mono">
          {showToken ? apiToken : "•".repeat(40)}
        </code>
      </section>
    </main>
  );
}
