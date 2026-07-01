"use client";

import { useStatePoll } from "@/components/use-state-poll";

export function TeamClient({ meId }: { meId: string }) {
  const { data } = useStatePoll(15_000);
  if (!data) return <div className="p-6 text-neutral-500 text-sm">Loading…</div>;

  const others = data.slots.filter((s) => s.userId !== meId);

  return (
    <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Team presence</h1>
        <p className="text-sm text-neutral-400">
          Passive view — see who else is active without pinging them. Refreshes every 15s.
        </p>
      </div>
      {others.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 p-6 text-center text-neutral-500 text-sm">
          Nobody else is active right now.
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900/50 text-xs text-neutral-400">
              <tr>
                <th className="text-left px-4 py-2">Teammate</th>
                <th className="text-left px-4 py-2">Started</th>
                <th className="text-left px-4 py-2">Ends</th>
                <th className="text-left px-4 py-2">Project</th>
                <th className="text-right px-4 py-2">Activity</th>
              </tr>
            </thead>
            <tbody>
              {others.map((s) => (
                <tr key={s.id} className="border-t border-neutral-800">
                  <td className="px-4 py-2 text-sm">{s.name ?? s.email}</td>
                  <td className="px-4 py-2 text-xs text-neutral-400">
                    {new Date(s.startedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-400">
                    {new Date(s.plannedEndAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2 text-xs">{s.cwd ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-xs">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 border ${
                        s.activityLabel === "heavy"
                          ? "border-emerald-500/60 text-emerald-300"
                          : s.activityLabel === "active"
                            ? "border-emerald-800/60 text-emerald-400"
                            : s.activityLabel === "light"
                              ? "border-amber-800/60 text-amber-300"
                              : "border-neutral-800 text-neutral-500"
                      }`}
                    >
                      {s.activityLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-neutral-600">
        No timestamps of what teammates typed — this is a "who's around" view, not surveillance.
      </div>
    </main>
  );
}
