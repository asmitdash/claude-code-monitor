"use client";

type Day = { day: string; minutes: number; sessions: number };

export function UsageBars({ data, label }: { data: Day[]; label?: string }) {
  const max = Math.max(60, ...data.map((d) => d.minutes));
  return (
    <div className="space-y-2">
      {label && <h3 className="text-sm font-medium text-neutral-400">{label}</h3>}
      <div className="flex items-end gap-2 h-32">
        {data.map((d) => {
          const h = (d.minutes / max) * 100;
          const date = new Date(d.day);
          const wd = date.toLocaleDateString(undefined, { weekday: "short" });
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
              <div
                title={`${d.minutes.toFixed(0)} min · ${d.sessions} sessions`}
                className="w-full rounded-t bg-emerald-500/70 hover:bg-emerald-400 transition"
                style={{ height: `${Math.max(2, h)}%`, minHeight: 2 }}
              />
              <div className="text-[10px] text-neutral-500">{wd}</div>
              <div className="text-[10px] text-neutral-300 font-mono">
                {d.sessions > 0 ? `${(d.minutes / 60).toFixed(1)}h` : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
