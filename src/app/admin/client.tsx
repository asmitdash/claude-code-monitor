"use client";

import { useEffect, useState, useTransition } from "react";
import { useStatePoll } from "@/components/use-state-poll";
import { UsageChart } from "@/components/usage-chart";
import { Countdown } from "@/components/countdown";

type Tab = "live" | "dashboard" | "members";

export function AdminClient({ apiToken }: { apiToken: string }) {
  const { data, error } = useStatePoll(2000);
  const [pending, startTransition] = useTransition();
  const [confirmKill, setConfirmKill] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [tab, setTab] = useState<Tab>("live");
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  if (error && !data) return <div className="p-6 text-red-400 text-sm">Error: {error}</div>;
  if (!data) return <div className="p-6 text-neutral-500 text-sm">Loading…</div>;

  const isMine = data.active?.userId === data.me.id;
  const myQueueEntry = data.queue.find((q) => q.userId === data.me.id);

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
  async function claim(purpose: string) {
    setActionMsg(null);
    const res = await fetch("/api/slot/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setActionMsg(j.error ?? `failed (${res.status})`);
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

  function formatLastSeen(iso: string | null) {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 30_000) return "just now";
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    return `${Math.floor(ms / 3_600_000)}h ago`;
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      <nav className="flex gap-1 border-b border-neutral-800">
        {(["live", "dashboard", "members"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition ${
              tab === t
                ? "border-emerald-400 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "live" && (
        <div className="space-y-6">
          <KillHistory pollMs={15000} />
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
                {isMine && (
                  <button
                    onClick={() => startTransition(() => void release())}
                    disabled={pending}
                    className="rounded-md bg-neutral-100 text-neutral-900 hover:bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Done — release slot
                  </button>
                )}
              </div>
            ) : (
              <div className="text-neutral-500 text-sm">No one is currently using Claude Code.</div>
            )}
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
            <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-4">
              Action
            </h2>
            {actionMsg && <div className="mb-3 text-xs text-amber-300">{actionMsg}</div>}
            {isMine ? (
              <p className="text-sm text-neutral-300">
                You are the active user. Click "Done" above when finished.
              </p>
            ) : data.active ? (
              myQueueEntry ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm">Queued — position #{myQueueEntry.position}</div>
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
              <ClaimForm onClaim={(p) => startTransition(() => void claim(p))} pending={pending} />
            )}
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
              Live presence · {data.presence.length} teammates
            </h2>
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
                          {p.id === data.me.id && (
                            <span className="ml-2 text-[10px] text-emerald-400">(you)</span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-500">{p.email}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            p.claudeRunning ? "bg-emerald-400 animate-pulse" : "bg-neutral-700"
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
                    {p.id !== data.me.id && (p.claudeRunning || isActive) && (
                      <div className="mt-3 pt-3 border-t border-neutral-800">
                        {isActive ? (
                          <div className="text-xs text-emerald-300 mb-2">
                            In active slot — ends in{" "}
                            <Countdown to={data.active!.plannedEndAt} />
                          </div>
                        ) : (
                          <div className="text-xs text-amber-300 mb-2">
                            Running Claude without claiming a slot
                          </div>
                        )}
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
                    {p.id !== data.me.id && !p.claudeRunning && !isActive && (
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
        </div>
      )}

      {tab === "dashboard" && <DashboardTab presence={data.presence} />}
      {tab === "members" && <MembersTab />}

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

type KillEntry = {
  slotId: string;
  userId: string;
  email: string;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  purpose: string | null;
  durationMin: number | null;
};

function KillHistory({ pollMs }: { pollMs: number }) {
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
      } catch {
        // ignore — admin won't be blocked by missing history
      }
    }
    load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);

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
                  killed by {k.endedBy ?? "?"}
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

function ClaimForm({
  onClaim,
  pending,
}: {
  onClaim: (purpose: string) => void;
  pending: boolean;
}) {
  const [purpose, setPurpose] = useState("");
  return (
    <div className="space-y-2">
      <input
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        placeholder="What are you working on? (optional)"
        className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
      />
      <button
        onClick={() => onClaim(purpose)}
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 text-neutral-950 hover:bg-emerald-400 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        Use Claude Code
      </button>
    </div>
  );
}

type UserDetail = {
  user: { id: string; email: string; name: string | null; role: string };
  daily: Array<{ day: string; minutes: number; sessions: number; events: number }>;
  presence: { lastSeenAt: string; claudeRunning: boolean; hostname: string | null } | null;
  recentSlots: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    endedBy: string | null;
    purpose: string | null;
  }>;
  topTools: Array<{ tool: string; count: number }>;
  totalSessions: number;
  totalMinutes: number;
};

function DashboardTab({
  presence,
}: {
  presence: Array<{ id: string; email: string; name: string | null; role: string }>;
}) {
  const [selected, setSelected] = useState<string | null>(presence[0]?.id ?? null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    fetch(`/api/admin/user/${selected}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      <aside className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-1 h-fit">
        {presence.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition ${
              selected === p.id
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800/50"
            }`}
          >
            <div className="truncate">{p.name ?? p.email}</div>
            <div className="text-[10px] text-neutral-500 truncate">{p.email}</div>
          </button>
        ))}
      </aside>
      <div className="space-y-4">
        {!selected && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
            Pick a teammate.
          </div>
        )}
        {selected && loading && !detail && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
            Loading…
          </div>
        )}
        {detail && (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {detail.user.name ?? detail.user.email}
                  </h2>
                  <div className="text-xs text-neutral-500">{detail.user.email}</div>
                </div>
                <div className="text-xs text-neutral-400">
                  {detail.totalSessions} sessions · {(detail.totalMinutes / 60).toFixed(1)}h total · 30d
                </div>
              </div>
              <UsageChart data={detail.daily} height={260} />
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
                <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
                  Top tools
                </h3>
                {detail.topTools.length === 0 ? (
                  <div className="text-xs text-neutral-500">No tool calls recorded yet.</div>
                ) : (
                  <ul className="space-y-1">
                    {detail.topTools.map((t) => (
                      <li
                        key={t.tool}
                        className="flex justify-between items-center text-sm border-b border-neutral-800/50 last:border-0 py-1"
                      >
                        <span className="font-mono text-xs">{t.tool}</span>
                        <span className="text-xs text-neutral-400">{t.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
                <h3 className="text-sm font-medium text-neutral-400 uppercase tracking-wide mb-3">
                  Recent sessions
                </h3>
                {detail.recentSlots.length === 0 ? (
                  <div className="text-xs text-neutral-500">No sessions yet.</div>
                ) : (
                  <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-2">
                    {detail.recentSlots.map((s) => {
                      const dur = s.endedAt
                        ? Math.round(
                            (new Date(s.endedAt).getTime() -
                              new Date(s.startedAt).getTime()) /
                              60000,
                          )
                        : null;
                      return (
                        <li
                          key={s.id}
                          className="text-xs border-b border-neutral-800/50 last:border-0 pb-1.5"
                        >
                          <div className="flex justify-between">
                            <span>{new Date(s.startedAt).toLocaleString()}</span>
                            <span className="text-neutral-400">
                              {dur != null ? `${dur} min` : "active"}
                            </span>
                          </div>
                          {s.purpose && (
                            <div className="text-neutral-500 truncate">{s.purpose}</div>
                          )}
                          {s.endedBy && s.endedBy !== "self" && (
                            <div className="text-red-400">ended by {s.endedBy}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Member = {
  email: string;
  role: "tl" | "member";
  addedBy: string | null;
  addedAt: string;
};

function MembersTab() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"tl" | "member">("member");
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
        <p className="text-xs text-neutral-500 mb-3">
          Adds the email to the allowlist. They sign in with that email + a password they pick on
          first login.
        </p>
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
            onChange={(e) => setRole(e.target.value as "tl" | "member")}
            className="rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="tl">Team Lead</option>
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
                    {m.addedBy ?? "—"} ·{" "}
                    {new Date(m.addedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      m.role === "tl"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-neutral-800 text-neutral-300"
                    }`}
                  >
                    {m.role === "tl" ? "TL" : "Member"}
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
