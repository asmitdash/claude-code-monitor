"use client";

import { useEffect, useState, useTransition } from "react";
import { useStatePoll, type StatePayload } from "@/components/use-state-poll";
import { UsageChart } from "@/components/usage-chart";
import { Countdown } from "@/components/countdown";
import { StateBadge, ActivityChip } from "@/components/state-badge";

type Tab =
  | "live"
  | "approvals"
  | "analytics"
  | "members"
  | "invites"
  | "files"
  | "releases"
  | "audit"
  | "config";

export function AdminClient({ apiToken }: { apiToken: string }) {
  const { data, error } = useStatePoll(2500);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("live");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  if (error && !data) return <div className="p-6 text-red-400 text-sm">Error: {error}</div>;
  if (!data) return <div className="p-6 text-neutral-500 text-sm">Loading…</div>;

  return (
    <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
      {data.banner && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 flex items-center justify-between">
          <span>📢 {data.banner.message}</span>
          <button
            onClick={() =>
              startTransition(async () => {
                await fetch("/api/admin/broadcast", { method: "DELETE" });
              })
            }
            className="text-xs text-amber-200 hover:text-white"
          >
            clear
          </button>
        </div>
      )}
      {data.me.isImpersonating && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm text-violet-200 flex items-center justify-between">
          <span>
            👁 Impersonating <strong>{data.me.email}</strong> as admin{" "}
            {data.me.realActorEmail}
          </span>
          <button
            onClick={() =>
              startTransition(async () => {
                await fetch("/api/admin/impersonate", { method: "DELETE" });
              })
            }
            className="text-xs underline"
          >
            stop impersonating
          </button>
        </div>
      )}

      <nav className="flex gap-1 border-b border-neutral-800 overflow-x-auto">
        {(
          [
            ["live", "Live"],
            ["approvals", `Approvals (${data.pendingApprovals.length})`],
            ["analytics", "Analytics"],
            ["members", "Members"],
            ["invites", "Invites"],
            ["files", "Files"],
            ["releases", "Releases"],
            ["audit", "Audit"],
            ["config", "Config"],
          ] as Array<[Tab, string]>
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition whitespace-nowrap ${
              tab === t
                ? "border-emerald-400 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {actionMsg && <div className="text-xs text-amber-300">{actionMsg}</div>}

      {tab === "live" && (
        <LiveTab data={data} pending={pending} startTransition={startTransition} setActionMsg={setActionMsg} />
      )}
      {tab === "approvals" && <ApprovalsTab data={data} pending={pending} startTransition={startTransition} />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "members" && <MembersTab />}
      {tab === "invites" && <InvitesTab />}
      {tab === "files" && <FilesTab data={data} />}
      {tab === "releases" && <ReleasesTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "config" && <ConfigTab />}

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

function LiveTab({
  data,
  pending,
  startTransition,
  setActionMsg,
}: {
  data: StatePayload;
  pending: boolean;
  startTransition: (cb: () => void) => void;
  setActionMsg: (s: string | null) => void;
}) {
  const cap = data.config.maxConcurrentSlots;

  async function forceEnd(slotId: string) {
    if (!confirm("Force-end this slot? User will be cooldown-restricted.")) return;
    await fetch("/api/admin/force-end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
  }
  async function killUser(userId: string) {
    if (!confirm("Force-end + set kill flag? Refuses Claude tool calls until cleared."))
      return;
    await fetch("/api/admin/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, reason: "ended by team lead" }),
    });
  }
  async function unblock(userId: string) {
    await fetch("/api/admin/kill", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }
  async function restrict(userId: string, type: "pause" | "ban") {
    const minutes =
      type === "pause" ? Number(prompt("Pause for how many minutes? (0 = indefinite)") ?? "0") : 0;
    const reason = prompt(`${type} reason?`) ?? "";
    await fetch("/api/admin/restrict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type, minutes, reason }),
    });
  }
  async function unrestrict(userId: string, type: "pause" | "ban" | "cooldown") {
    await fetch("/api/admin/restrict", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type }),
    });
  }
  async function impersonate(userId: string) {
    await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    location.reload();
  }
  async function rotateToken(userId: string) {
    if (!confirm("Rotate this user's API token? They'll need to re-paste it in their extension."))
      return;
    const r = await fetch("/api/admin/rotate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const j = await r.json();
    setActionMsg(j.apiToken ? `New token: ${j.apiToken}` : `failed: ${j.error}`);
  }
  async function resetState(userId: string) {
    if (!confirm("Full reset for user? Ends slot, cancels queue, clears flags.")) return;
    await fetch("/api/admin/reset-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }
  async function queueAction(queueId: string, action: string) {
    await fetch("/api/admin/queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId, action }),
    });
  }
  async function clearQueue() {
    if (!confirm("Clear entire queue? All queued users will be cancelled.")) return;
    await fetch("/api/admin/queue", { method: "DELETE" });
  }
  async function broadcast() {
    const message = prompt("Broadcast message:");
    if (!message) return;
    const minutes = Number(prompt("Auto-clear in (minutes)? 0 = no expiry") ?? "0");
    const severity = prompt("Severity (info/warn/alert):") ?? "info";
    await fetch("/api/admin/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, minutes, severity }),
    });
  }
  async function freeze() {
    const minutes = Number(prompt("Freeze for how many minutes?") ?? "0");
    if (!minutes) return;
    const banner = prompt("Freeze banner message:") ?? "Maintenance freeze";
    await fetch("/api/admin/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        freezeUntil: new Date(Date.now() + minutes * 60_000).toISOString(),
        freezeBanner: banner,
      }),
    });
  }

  return (
    <div className="space-y-5">
      <KillHistory />

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Active slots · {data.slots.filter((s) => s.slotNumber > 0).length} / {cap}
            {data.slots.filter((s) => s.slotNumber === 0).length > 0 && (
              <span className="ml-2 text-violet-300 normal-case">
                + {data.slots.filter((s) => s.slotNumber === 0).length} out-of-band
              </span>
            )}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => startTransition(() => void broadcast())}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800"
            >
              📢 Broadcast
            </button>
            <button
              onClick={() => startTransition(() => void freeze())}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
            >
              ❄️ Freeze
            </button>
            <button
              onClick={() => startTransition(() => void clearQueue())}
              disabled={pending || data.queue.length === 0}
              className="text-xs px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-30"
            >
              Clear queue
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: cap }).map((_, i) => {
            const s = data.slots.find((x) => x.slotNumber === i + 1);
            return (
              <div
                key={i}
                className={`rounded-xl p-4 border ${
                  s
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-dashed border-neutral-700 bg-neutral-900/20"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] uppercase text-neutral-500">Slot {i + 1}</div>
                  {s && !s.isOverride && s.role !== "admin" && (
                    <span className="text-xs text-neutral-400 font-mono">
                      ends in <Countdown to={s.plannedEndAt} />
                    </span>
                  )}
                  {s && s.role === "admin" && (
                    <span className="text-xs text-violet-300">unlimited</span>
                  )}
                </div>
                {s ? (
                  <>
                    <div className="font-medium mt-1">
                      {s.name ?? s.email}
                      {s.role === "admin" && (
                        <span className="ml-2 text-[10px] px-1 rounded bg-violet-500/20 text-violet-300">
                          Admin
                        </span>
                      )}
                    </div>
                    {s.purpose && (
                      <div className="text-xs text-neutral-400 mt-1">"{s.purpose}"</div>
                    )}
                    <div className="text-[11px] text-neutral-500 mt-1 flex items-center gap-2">
                      <ActivityChip score={s.activityScore} label={s.activityLabel} />
                      <span>· {s.toolCallCount} calls</span>
                      <span>· {(s.estimatedTokens / 1000).toFixed(1)}k tok</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {s.role === "admin" ? (
                        <span className="text-[11px] text-violet-300 italic">
                          Admin slot — only the owning admin can release it
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => startTransition(() => void forceEnd(s.id))}
                            disabled={pending}
                            className="text-[11px] rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 px-2 py-0.5"
                          >
                            Force end
                          </button>
                          <button
                            onClick={() => startTransition(() => void killUser(s.userId))}
                            disabled={pending}
                            className="text-[11px] rounded border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 px-2 py-0.5"
                          >
                            Kill + cooldown
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-neutral-500 mt-1">Open</div>
                )}
              </div>
            );
          })}
        </div>
        {data.slots.filter((s) => s.slotNumber === 0).length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] uppercase text-neutral-500 mb-2">
              Out-of-band slots (admin bypass / approved overrides)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.slots
                .filter((s) => s.slotNumber === 0)
                .map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-xl p-4 border ${
                      s.role === "admin"
                        ? "border-violet-500/30 bg-violet-500/5"
                        : "border-amber-500/30 bg-amber-500/5"
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <div className="text-[11px] uppercase text-neutral-500">
                        {s.role === "admin" ? "Admin bypass" : "Admin override"}
                      </div>
                      {s.role === "admin" ? (
                        <span className="text-xs text-violet-300">unlimited</span>
                      ) : (
                        <span className="text-xs text-neutral-400 font-mono">
                          ends in <Countdown to={s.plannedEndAt} />
                        </span>
                      )}
                    </div>
                    <div className="font-medium mt-1">
                      {s.name ?? s.email}
                      {s.role === "admin" && (
                        <span className="ml-2 text-[10px] px-1 rounded bg-violet-500/20 text-violet-300">
                          Admin
                        </span>
                      )}
                    </div>
                    {s.purpose && (
                      <div className="text-xs text-neutral-400 mt-1">"{s.purpose}"</div>
                    )}
                    <div className="text-[11px] text-neutral-500 mt-1 flex items-center gap-2">
                      <ActivityChip score={s.activityScore} label={s.activityLabel} />
                      <span>· {s.toolCallCount} calls</span>
                      <span>· {(s.estimatedTokens / 1000).toFixed(1)}k tok</span>
                    </div>
                    {s.role !== "admin" && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <button
                          onClick={() => startTransition(() => void forceEnd(s.id))}
                          disabled={pending}
                          className="text-[11px] rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 px-2 py-0.5"
                        >
                          Force end
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
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
                <div className="min-w-0">
                  <span className="text-neutral-500 font-mono mr-2">#{q.position}</span>
                  <span className="font-medium">{q.name ?? q.email}</span>
                  {q.urgent && (
                    <span className="ml-2 text-red-300 text-[10px] uppercase">urgent</span>
                  )}
                  {q.note && (
                    <div className="text-[11px] text-neutral-500 italic ml-7">"{q.note}"</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">~{q.etaMin}m</span>
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await fetch("/api/admin/queue", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ queueId: q.id, action: "promote" }),
                        });
                      })
                    }
                    className="text-xs text-emerald-300 hover:text-emerald-200"
                  >
                    promote
                  </button>
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await fetch("/api/admin/queue", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ queueId: q.id, action: "remove" }),
                        });
                      })
                    }
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-4">
          Live presence · {data.presence.length}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.presence.map((p) => (
            <div
              key={p.id}
              className="border border-neutral-800 rounded-xl p-4 bg-neutral-950/40"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {p.name ?? p.email}
                    {p.role === "admin" && (
                      <span className="ml-2 text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-300">
                        Admin
                      </span>
                    )}
                    {p.id === data.me.id && (
                      <span className="ml-2 text-[10px] text-emerald-400">(you)</span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">{p.email}</div>
                </div>
                <StateBadge state={p.state} label={p.stateLabel} icon={p.stateIcon} />
              </div>
              <div className="text-[11px] text-neutral-500 space-y-0.5">
                <div className="flex items-center gap-2">
                  <ActivityChip score={p.activityScore} label={p.activityLabel} />
                  {p.activeSlotNumber !== null && (
                    <span className="text-emerald-400">slot {p.activeSlotNumber}</span>
                  )}
                </div>
                <div>Last seen: {formatLastSeen(p.lastSeenAt)}</div>
                {p.hostname && <div>Host: {p.hostname}</div>}
                {p.vscodeWindow && <div className="truncate">VS Code: {p.vscodeWindow}</div>}
                {p.extensionVersion && (
                  <div className="text-neutral-600">v{p.extensionVersion}</div>
                )}
              </div>
              {p.id !== data.me.id && (
                <div className="mt-3 pt-3 border-t border-neutral-800 flex flex-wrap gap-1.5">
                  {p.role === "admin" && (
                    <span className="w-full text-[11px] text-violet-300 italic">
                      Admin — immune to kill / pause / ban / cooldown
                    </span>
                  )}
                  {p.role !== "admin" && (
                    <>
                      <button
                        onClick={() => startTransition(() => void killUser(p.id))}
                        disabled={pending}
                        className="text-[11px] rounded border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 px-2 py-0.5"
                      >
                        Kill
                      </button>
                      <button
                        onClick={() => startTransition(() => void unblock(p.id))}
                        disabled={pending}
                        className="text-[11px] rounded border border-neutral-700 hover:bg-neutral-800 px-2 py-0.5"
                      >
                        Clear flag
                      </button>
                      <button
                        onClick={() => startTransition(() => void restrict(p.id, "pause"))}
                        disabled={pending}
                        className="text-[11px] rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 px-2 py-0.5"
                      >
                        Pause
                      </button>
                      <button
                        onClick={() => startTransition(() => void restrict(p.id, "ban"))}
                        disabled={pending}
                        className="text-[11px] rounded border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 px-2 py-0.5"
                      >
                        Ban
                      </button>
                      <button
                        onClick={() => startTransition(() => void unrestrict(p.id, "pause"))}
                        disabled={pending}
                        className="text-[11px] rounded border border-neutral-700 hover:bg-neutral-800 px-2 py-0.5"
                      >
                        Unpause
                      </button>
                      <button
                        onClick={() => startTransition(() => void unrestrict(p.id, "ban"))}
                        disabled={pending}
                        className="text-[11px] rounded border border-neutral-700 hover:bg-neutral-800 px-2 py-0.5"
                      >
                        Unban
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => startTransition(() => void impersonate(p.id))}
                    disabled={pending}
                    className="text-[11px] rounded border border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 px-2 py-0.5"
                  >
                    Impersonate
                  </button>
                  <button
                    onClick={() => startTransition(() => void rotateToken(p.id))}
                    disabled={pending}
                    className="text-[11px] rounded border border-neutral-700 hover:bg-neutral-800 px-2 py-0.5"
                  >
                    Rotate token
                  </button>
                  <button
                    onClick={() => startTransition(() => void resetState(p.id))}
                    disabled={pending}
                    className="text-[11px] rounded border border-neutral-700 hover:bg-neutral-800 px-2 py-0.5"
                  >
                    Reset state
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ApprovalsTab({
  data,
  pending,
  startTransition,
}: {
  data: StatePayload;
  pending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    fetch("/api/admin/approval", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setHistory(j.approvals ?? []));
  }, [data.pendingApprovals.length]);

  async function decide(id: string, decision: "approve" | "reject") {
    const note = decision === "reject" ? prompt("Rejection reason (optional)") ?? "" : "";
    await fetch("/api/admin/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: id, decision, note }),
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6">
        <h2 className="text-sm font-medium text-violet-300 uppercase tracking-wide mb-3">
          Pending admin approval requests · {data.pendingApprovals.length}
        </h2>
        {data.pendingApprovals.length === 0 ? (
          <div className="text-sm text-neutral-500">No pending requests.</div>
        ) : (
          <ul className="space-y-2">
            {data.pendingApprovals.map((a) => (
              <li
                key={a.id}
                className="rounded-lg bg-neutral-900/40 border border-neutral-800 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{a.name ?? a.email}</div>
                    <div className="text-xs text-neutral-400 mt-0.5">
                      {a.reason ?? "(no reason)"}
                    </div>
                    <div className="text-[11px] text-neutral-600 mt-1">
                      {a.desiredMinutes}m · requested{" "}
                      {new Date(a.requestedAt).toLocaleTimeString()} · expires{" "}
                      {a.expiresAt ? new Date(a.expiresAt).toLocaleTimeString() : "never"}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => startTransition(() => void decide(a.id, "approve"))}
                      disabled={pending}
                      className="text-xs rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 px-3 py-1.5"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => startTransition(() => void decide(a.id, "reject"))}
                      disabled={pending}
                      className="text-xs rounded border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 px-3 py-1.5"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
          Recent approval decisions
        </h2>
        {history.length === 0 ? (
          <div className="text-sm text-neutral-500">None yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.slice(0, 30).map((h: any) => (
              <li
                key={h.id as string}
                className="flex items-center justify-between border-b border-neutral-800/50 last:border-0 py-1.5"
              >
                <div>
                  <span
                    className={`mr-2 text-[10px] uppercase px-1.5 py-0.5 rounded ${
                      h.status === "approved"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : h.status === "rejected"
                        ? "bg-red-500/20 text-red-300"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {h.status}
                  </span>
                  <span>{h.name ?? h.email}</span>
                  <span className="text-xs text-neutral-500 ml-2">
                    {h.reason ?? "(no reason)"}
                  </span>
                </div>
                <span className="text-xs text-neutral-500">
                  {h.decidedAt ? new Date(h.decidedAt).toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Analytics = {
  perUser: Array<{
    userId: string;
    email: string;
    name: string | null;
    totalMinutes: number;
    totalSessions: number;
    avgSessionMinutes: number;
    longestMinutes: number;
    forceEndedCount: number;
    idleEndedCount: number;
    tlOverrideCount: number;
    estimatedTokens: number;
    estimatedCostUsd: number;
  }>;
  heatmap: number[];
  hourMinutes: number[];
  approvals: Record<string, number>;
  queue: Record<string, number>;
  utilization: { activeMinutes: number; capacityMinutes: number; ratio: number };
  totals: { totalSessions: number; totalMinutes: number; totalTokens: number; totalCostUsd: number };
};
function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  useEffect(() => {
    fetch(`/api/admin/analytics?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, [days]);
  if (!data) return <div className="text-sm text-neutral-500">Loading…</div>;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
            Team analytics · last {days}d
          </h2>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs rounded bg-neutral-950 border border-neutral-800 px-2 py-1"
          >
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
          <Stat label="Sessions" value={data.totals.totalSessions} />
          <Stat label="Hours" value={(data.totals.totalMinutes / 60).toFixed(1)} />
          <Stat label="Tokens (M)" value={(data.totals.totalTokens / 1_000_000).toFixed(2)} />
          <Stat
            label="Est. cost"
            value={`$${data.totals.totalCostUsd.toFixed(2)}`}
          />
          <Stat
            label="Slot utilization"
            value={`${(data.utilization.ratio * 100).toFixed(0)}%`}
          />
          <Stat label="Avg queue wait" value={`${data.queue.avgWaitMin ?? 0}m`} />
          <Stat label="Approvals approved" value={data.approvals.approved ?? 0} />
          <Stat label="Approvals rejected" value={data.approvals.rejected ?? 0} />
        </div>
        <div>
          <h3 className="text-xs uppercase text-neutral-500 mb-2">Hour-of-day usage</h3>
          <div className="flex items-end gap-1 h-24">
            {data.hourMinutes.map((m, i) => {
              const max = Math.max(1, ...data.hourMinutes);
              const h = (m / max) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    title={`${i}:00 – ${m}m`}
                    className="w-full rounded-t bg-emerald-500/60"
                    style={{ height: `${Math.max(2, h)}%`, minHeight: 2 }}
                  />
                  {i % 3 === 0 && <div className="text-[9px] text-neutral-600">{i}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
          Per user
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-neutral-500 uppercase">
                <th className="text-left py-1">User</th>
                <th className="text-right">Min</th>
                <th className="text-right">Sessions</th>
                <th className="text-right">Avg</th>
                <th className="text-right">Long</th>
                <th className="text-right">Killed</th>
                <th className="text-right">Idle</th>
                <th className="text-right">Override</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.perUser.map((u) => (
                <tr key={u.userId} className="border-t border-neutral-800/40">
                  <td className="py-1">{u.name ?? u.email}</td>
                  <td className="text-right text-neutral-300">{u.totalMinutes}</td>
                  <td className="text-right">{u.totalSessions}</td>
                  <td className="text-right">{u.avgSessionMinutes}</td>
                  <td className="text-right">{u.longestMinutes}</td>
                  <td className="text-right text-red-300">{u.forceEndedCount}</td>
                  <td className="text-right text-amber-300">{u.idleEndedCount}</td>
                  <td className="text-right text-violet-300">{u.tlOverrideCount}</td>
                  <td className="text-right">{(u.estimatedTokens / 1000).toFixed(1)}k</td>
                  <td className="text-right">${u.estimatedCostUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
          Export
        </h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {(["audit", "slots", "approvals"] as const).map((d) => (
            <a
              key={d}
              href={`/api/admin/export?dataset=${d}&days=${days}`}
              className="px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800"
            >
              ⬇ {d}.csv
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}

type Member = { email: string; role: "admin" | "member"; addedBy: string | null; addedAt: string };
function MembersTab() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  async function reload() {
    const r = await fetch("/api/admin/members", { cache: "no-store" });
    const j = await r.json();
    setMembers(j.members ?? []);
  }
  useEffect(() => {
    reload();
  }, []);
  async function add() {
    setErr(null);
    if (!email.trim()) return;
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "failed");
      return;
    }
    setEmail("");
    setRole("member");
    await reload();
  }
  async function remove(target: string) {
    setErr(null);
    const res = await fetch("/api/admin/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: target }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "failed");
      return;
    }
    await reload();
  }
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-6">
      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-2">
          Add teammate
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 min-w-[240px] rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => startTransition(() => void add())}
            disabled={pending}
            className="rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
      </div>
      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
          Allowlist · {members?.length ?? 0}
        </h2>
        {!members ? (
          <div className="text-xs text-neutral-500">Loading…</div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {members.map((m) => (
              <li
                key={m.email}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <div>
                  <div>{m.email}</div>
                  <div className="text-[10px] text-neutral-500">
                    {m.addedBy ?? "—"} · {new Date(m.addedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      m.role === "admin"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-neutral-800 text-neutral-300"
                    }`}
                  >
                    {m.role === "admin" ? "Admin" : "Member"}
                  </span>
                  <button
                    onClick={() => startTransition(() => void remove(m.email))}
                    disabled={pending || m.addedBy === "env-bootstrap"}
                    title={
                      m.addedBy === "env-bootstrap"
                        ? "Bootstrapped from env vars — cannot remove"
                        : "Remove"
                    }
                    className="text-xs text-neutral-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  severity: string;
  actorEmail: string | null;
  targetEmail: string | null;
  metadata: Record<string, unknown> | null;
};
function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const t = setInterval(reload, 5000);
    reload();
    return () => clearInterval(t);
    async function reload() {
      const r = await fetch(`/api/admin/audit?sinceMin=1440&limit=300`, { cache: "no-store" });
      const j = await r.json();
      setEntries(j.entries ?? []);
    }
  }, []);
  const filtered = (entries ?? []).filter(
    (e) =>
      !filter ||
      e.action.includes(filter) ||
      (e.actorEmail ?? "").includes(filter) ||
      (e.targetEmail ?? "").includes(filter),
  );
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide">
          Audit log · last 24h
        </h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter (action, email)…"
          className="text-xs rounded bg-neutral-950 border border-neutral-800 px-2 py-1 w-56"
        />
      </div>
      {!entries ? (
        <div className="text-xs text-neutral-500">Loading…</div>
      ) : (
        <ul className="space-y-1 max-h-[600px] overflow-y-auto pr-2">
          {filtered.map((e) => (
            <li
              key={e.id}
              className="text-xs flex items-baseline justify-between gap-3 border-b border-neutral-800/40 last:border-0 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <span
                  className={`inline-block mr-2 text-[10px] uppercase px-1 rounded ${
                    e.severity === "alert"
                      ? "bg-red-500/20 text-red-300"
                      : e.severity === "warn"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-neutral-800 text-neutral-400"
                  }`}
                >
                  {e.action}
                </span>
                <span className="text-neutral-300">{e.actorEmail ?? "—"}</span>
                {e.targetEmail && (
                  <span className="text-neutral-500"> → {e.targetEmail}</span>
                )}
                {e.metadata && Object.keys(e.metadata).length > 0 && (
                  <span className="ml-2 text-neutral-600">
                    {JSON.stringify(e.metadata).slice(0, 120)}
                  </span>
                )}
              </div>
              <span className="text-neutral-600 whitespace-nowrap">
                {new Date(e.createdAt).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConfigTab() {
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    fetch("/api/admin/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCfg(j.config));
  }, []);
  if (!cfg) return <div className="text-sm text-neutral-500">Loading…</div>;
  function update(patch: Record<string, unknown>) {
    startTransition(async () => {
      const r = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      setCfg(j.config);
    });
  }
  const fields: Array<[string, string]> = [
    ["maxConcurrentSlots", "Concurrent slots"],
    ["maxSlotMinutes", "Max slot duration (min)"],
    ["dailyMinutes", "Daily quota per user (min)"],
    ["weeklyMinutes", "Weekly quota per user (min)"],
    ["idleAutoEndMinutes", "Idle auto-end (min)"],
    ["idleWarnMinutes", "Idle warn (min)"],
    ["staleHeartbeatMinutes", "Stale heartbeat (min)"],
    ["graceTimerSeconds", "Grace timer (sec)"],
    ["cooldownAfterKillMinutes", "Cooldown after kill (min)"],
    ["approvalAutoExpireMinutes", "Approval auto-expire (min)"],
  ];
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
      <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-2">
        System config
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(([k, label]) => (
          <label key={k} className="text-xs">
            <div className="text-neutral-400 mb-1">{label}</div>
            <input
              type="number"
              defaultValue={Number(cfg[k] ?? 0)}
              onBlur={(e) => update({ [k]: Number(e.target.value) })}
              disabled={pending}
              className="w-full rounded bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500 mt-3">
        Last updated: {cfg.updatedAt ? new Date(String(cfg.updatedAt)).toLocaleString() : "—"} by{" "}
        {String(cfg.updatedBy ?? "—")}
      </div>
    </section>
  );
}

type KillEntry = {
  slotId: string;
  userId: string;
  email: string;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  status: string;
  purpose: string | null;
  durationMin: number | null;
  activityScore: number;
};
function KillHistory() {
  const [kills, setKills] = useState<KillEntry[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/admin/kill-history", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setKills(j.kills ?? []);
      } catch {}
    }
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!kills || kills.length === 0) return null;
  return (
    <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-red-300 uppercase tracking-wide">
          Recent kills · last 14d · {kills.length}
        </h2>
        <button
          onClick={() => setCollapsed((s) => !s)}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {!collapsed && (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-2">
          {kills.map((k) => (
            <li
              key={k.slotId}
              className="flex items-baseline justify-between text-sm border-b border-red-500/10 last:border-0 pb-1.5"
            >
              <div className="min-w-0 flex-1 pr-3">
                <span className="font-medium">{k.name ?? k.email}</span>
                <span className="text-xs text-neutral-500 ml-2">
                  {k.status} · by {k.endedBy ?? "?"}
                </span>
                {k.purpose && (
                  <div className="text-xs text-neutral-500 truncate">{k.purpose}</div>
                )}
              </div>
              <div className="text-xs text-neutral-500 whitespace-nowrap">
                {k.endedAt ? new Date(k.endedAt).toLocaleString() : "—"}
                {k.durationMin != null && (
                  <span className="ml-2 text-neutral-600">{k.durationMin}m</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Release = {
  id: string;
  version: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  autoUpdateEnabled: boolean;
  notes: string | null;
  isLatest: boolean;
};

function ReleasesTab() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const r = await fetch("/api/admin/releases", { cache: "no-store" });
    const j = await r.json();
    setReleases(j.releases ?? []);
  }
  useEffect(() => {
    void reload();
  }, []);

  async function upload() {
    setMsg(null);
    if (!version.trim() || !file) {
      setMsg("Pick a .vsix file and enter the version.");
      return;
    }
    const buf = await file.arrayBuffer();
    // Browser-side base64
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const r = await fetch("/api/admin/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: version.trim(), vsixBase64: b64, notes: notes.trim() || null }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setMsg("Upload failed: " + (j.error ?? r.status));
      return;
    }
    setMsg(
      `Published v${version.trim()}. Connected extensions will prompt within ~5 min.`,
    );
    setVersion("");
    setNotes("");
    setFile(null);
    await reload();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch("/api/admin/releases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, autoUpdateEnabled: enabled }),
    });
    await reload();
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-6">
      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-2">
          Publish a new release
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Upload the new <code>.vsix</code>. Connected extensions check for updates every 5 min and prompt the user with a "Update now?" toast — two clicks (Yes → VS Code's Reload prompt) and they're on the new version.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            type="text"
            placeholder="0.4.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="md:col-span-2 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm font-mono"
          />
          <input
            type="file"
            accept=".vsix"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="md:col-span-5 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Release notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="md:col-span-3 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          />
          <button
            onClick={() => startTransition(() => void upload())}
            disabled={busy}
            className="md:col-span-2 rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Publish
          </button>
        </div>
        {msg && <div className="text-xs text-neutral-300 mt-2">{msg}</div>}
      </div>

      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
          Releases · {releases?.length ?? 0}
        </h2>
        {!releases ? (
          <div className="text-xs text-neutral-500">Loading…</div>
        ) : releases.length === 0 ? (
          <div className="text-xs text-neutral-500">None yet — upload your first .vsix above.</div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {releases.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <div className="font-mono">
                    v{r.version}
                    {r.isLatest && (
                      <span className="ml-2 text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        latest
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {Math.round(r.sizeBytes / 1024)} KB · uploaded {new Date(r.uploadedAt).toLocaleString()} · by {r.uploadedBy}
                  </div>
                  {r.notes && (
                    <div className="text-[11px] text-neutral-400 italic mt-0.5">{r.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      r.autoUpdateEnabled
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {r.autoUpdateEnabled ? "auto-update on" : "auto-update OFF"}
                  </span>
                  <button
                    onClick={() => startTransition(() => void toggle(r.id, !r.autoUpdateEnabled))}
                    disabled={busy}
                    className="text-xs text-neutral-500 hover:text-amber-300"
                  >
                    {r.autoUpdateEnabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type FilePathKey = "memory_md" | "claude_md_user" | "claude_md_project" | "settings_json";
const FILE_PATH_LABELS: Record<FilePathKey, string> = {
  memory_md: "MEMORY.md (project)",
  claude_md_user: "CLAUDE.md (user, ~/.claude/)",
  claude_md_project: "CLAUDE.md (project root)",
  settings_json: "settings.json (~/.claude/)",
};

type FileSnapshotRow = {
  id: string;
  userId: string;
  filePath: FilePathKey;
  workspace: string | null;
  content: string;
  capturedAt: string;
};

type PendingCmd = {
  id: string;
  kind: "read" | "write";
  filePath: FilePathKey;
  createdAt: string;
};

function FilesTab({ data }: { data: StatePayload }) {
  const [userId, setUserId] = useState<string>("");
  const [filePath, setFilePath] = useState<FilePathKey>("claude_md_user");
  const [snapshots, setSnapshots] = useState<FileSnapshotRow[]>([]);
  const [pending, setPending] = useState<PendingCmd[]>([]);
  const [editor, setEditor] = useState<string>("");
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Pre-pick the first non-self user so the picker isn't blank.
  useEffect(() => {
    if (!userId && data.presence.length > 0) {
      const first = data.presence.find((p) => p.id !== data.me.id) ?? data.presence[0];
      if (first) setUserId(first.id);
    }
  }, [data.presence, data.me.id, userId]);

  async function reload() {
    if (!userId) return;
    const r = await fetch(
      `/api/admin/files/command?userId=${encodeURIComponent(userId)}&filePath=${filePath}`,
      { cache: "no-store" },
    );
    const j = await r.json();
    setSnapshots(j.snapshots ?? []);
    setPending(j.pending ?? []);
    const latest = (j.snapshots ?? [])[0] as FileSnapshotRow | undefined;
    setEditor(latest?.content ?? "");
  }

  useEffect(() => {
    void reload();
  }, [userId, filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestRefresh() {
    if (!userId) return;
    setMsg(null);
    const r = await fetch("/api/admin/files/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, kind: "read", filePath }),
    });
    if (!r.ok) {
      setMsg("Failed to queue read command.");
      return;
    }
    setMsg("Read queued — extension will upload on its next heartbeat (≤15s).");
    await reload();
  }

  async function pushWrite() {
    if (!userId) return;
    setMsg(null);
    if (filePath === "settings_json") {
      try {
        JSON.parse(editor);
      } catch (e) {
        setMsg("settings.json must be valid JSON. " + String(e));
        return;
      }
    }
    const r = await fetch("/api/admin/files/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, kind: "write", filePath, payload: editor }),
    });
    if (!r.ok) {
      setMsg("Failed to queue write.");
      return;
    }
    setMsg("Write queued — applies on the user's next heartbeat (≤15s).");
    await reload();
  }

  const latestSnapshot = snapshots[0];

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-1">
          Team file oversight
        </h2>
        <p className="text-xs text-neutral-500">
          View and edit a teammate's CLAUDE.md, MEMORY.md, or Claude Code settings. Edits apply on their machine within ~15s. Members are told this capability exists during sign-in.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="md:col-span-5 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
        >
          <option value="">Pick a teammate…</option>
          {data.presence.map((p) => (
            <option key={p.id} value={p.id}>
              {p.email}
              {p.role === "admin" ? " (admin)" : ""}
              {p.id === data.me.id ? " — you" : ""}
            </option>
          ))}
        </select>
        <select
          value={filePath}
          onChange={(e) => setFilePath(e.target.value as FilePathKey)}
          className="md:col-span-5 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
        >
          {(Object.keys(FILE_PATH_LABELS) as FilePathKey[]).map((k) => (
            <option key={k} value={k}>
              {FILE_PATH_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          onClick={() => startTransition(() => void requestRefresh())}
          disabled={busy || !userId}
          className="md:col-span-2 rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Refresh from machine
        </button>
      </div>

      {pending.length > 0 && (
        <div className="text-[11px] text-amber-300">
          {pending.length} pending command(s) queued — waiting for the extension to pick up.
        </div>
      )}
      {msg && <div className="text-xs text-neutral-300">{msg}</div>}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-neutral-500">
            {latestSnapshot
              ? `Last captured ${new Date(latestSnapshot.capturedAt).toLocaleString()}${latestSnapshot.workspace ? ` · ${latestSnapshot.workspace}` : ""}`
              : "No snapshot yet — click Refresh."}
          </div>
          <button
            onClick={() => startTransition(() => void pushWrite())}
            disabled={busy || !userId || !latestSnapshot}
            className="rounded-md bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 px-3 py-1 text-xs disabled:opacity-50"
            title="Pushes the editor contents to the teammate's machine"
          >
            Save → push to machine
          </button>
        </div>
        <textarea
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
          rows={20}
          spellCheck={false}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-[12px] font-mono leading-relaxed focus:outline-none focus:border-neutral-600"
          placeholder={
            latestSnapshot ? "" : "Click Refresh to fetch the current contents from the teammate's machine."
          }
        />
      </div>

      {snapshots.length > 1 && (
        <div className="border-t border-neutral-800 pt-3">
          <div className="text-[11px] uppercase text-neutral-500 mb-2">Snapshot history</div>
          <ul className="text-xs text-neutral-400 space-y-1">
            {snapshots.slice(1, 10).map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span>
                  {new Date(s.capturedAt).toLocaleString()}
                  {s.workspace && (
                    <span className="text-neutral-600 ml-2">{s.workspace}</span>
                  )}
                </span>
                <button
                  onClick={() => setEditor(s.content)}
                  className="text-[11px] text-emerald-300 hover:underline"
                >
                  Load into editor
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type Invite = {
  id: string;
  token: string;
  email: string;
  role: "admin" | "member";
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedByUserId: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  note: string | null;
  status: "pending" | "consumed" | "expired" | "revoked";
};

function InvitesTab() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [days, setDays] = useState<number>(7);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{
    email: string;
    url: string;
  } | null>(null);

  async function reload() {
    const r = await fetch("/api/admin/invites", { cache: "no-store" });
    const j = await r.json();
    setInvites(j.invites ?? []);
  }
  useEffect(() => {
    reload();
  }, []);

  async function create() {
    setErr(null);
    setJustCreated(null);
    if (!email.trim()) return;
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        role,
        expiresInDays: days,
        note: note.trim() || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "failed");
      return;
    }
    const j = await res.json();
    const url = `${window.location.origin}/signup?invite=${encodeURIComponent(j.invite.token)}`;
    setJustCreated({ email: j.invite.email, url });
    setEmail("");
    setNote("");
    setRole("member");
    setDays(7);
    await reload();
  }

  async function revoke(id: string) {
    setErr(null);
    const res = await fetch("/api/admin/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "failed");
      return;
    }
    await reload();
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).catch(() => {});
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-6">
      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-2">
          Send invite
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Generates a one-time signup link locked to the email below. Share it however you like — it works once and only for that exact email.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            type="email"
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="md:col-span-5 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="md:col-span-2 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <input
            type="number"
            min={1}
            max={60}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 7)))}
            className="md:col-span-2 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
            title="Days until expiry"
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="md:col-span-3 rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          />
          <button
            onClick={() => startTransition(() => void create())}
            disabled={pending}
            className="md:col-span-12 rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Generate invite
          </button>
        </div>
        {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
        {justCreated && (
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-2">
            <div className="text-emerald-300">
              Invite ready for <strong>{justCreated.email}</strong>:
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={justCreated.url}
                className="flex-1 rounded bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-[11px] font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => copyUrl(justCreated.url)}
                className="rounded border border-neutral-700 hover:bg-neutral-800 px-2 py-1.5 text-[11px]"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
          Invites · {invites?.length ?? 0}
        </h2>
        {!invites ? (
          <div className="text-xs text-neutral-500">Loading…</div>
        ) : invites.length === 0 ? (
          <div className="text-xs text-neutral-500">None yet.</div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {invites.map((i) => {
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/signup?invite=${encodeURIComponent(i.token)}`;
              return (
                <li key={i.id} className="py-2.5 flex items-center justify-between text-sm gap-3">
                  <div className="min-w-0">
                    <div className="truncate">{i.email}</div>
                    <div className="text-[10px] text-neutral-500 flex items-center gap-2 flex-wrap">
                      <span>by {i.createdBy}</span>
                      <span>·</span>
                      <span>{new Date(i.createdAt).toLocaleDateString()}</span>
                      <span>·</span>
                      <span>{i.role}</span>
                      {i.note && (
                        <>
                          <span>·</span>
                          <span className="italic truncate max-w-[200px]">{i.note}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        i.status === "pending"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : i.status === "consumed"
                          ? "bg-neutral-800 text-neutral-400"
                          : i.status === "expired"
                          ? "bg-amber-500/10 text-amber-300"
                          : "bg-red-500/10 text-red-300"
                      }`}
                    >
                      {i.status}
                    </span>
                    {i.status === "pending" && (
                      <>
                        <button
                          onClick={() => copyUrl(url)}
                          className="text-xs text-neutral-500 hover:text-neutral-200"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => startTransition(() => void revoke(i.id))}
                          disabled={pending}
                          className="text-xs text-neutral-500 hover:text-red-400 disabled:opacity-30"
                        >
                          Revoke
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function formatLastSeen(iso: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 30_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
