"use client";

const COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  claude_idle: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  vscode: "bg-neutral-800/60 text-neutral-300 border-neutral-700",
  offline: "bg-red-500/15 text-red-300 border-red-500/30",
  ended: "bg-red-700/30 text-red-200 border-red-700/40",
  override: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export function StateBadge({
  state,
  label,
  icon,
}: {
  state: string;
  label: string;
  icon: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded border font-medium ${
        COLORS[state] ?? "bg-neutral-800 text-neutral-300 border-neutral-700"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

const ACT_COLORS: Record<string, string> = {
  idle: "text-neutral-500",
  light: "text-amber-300",
  active: "text-emerald-300",
  heavy: "text-violet-300",
};

export function ActivityChip({
  score,
  label,
}: {
  score: number;
  label: "idle" | "light" | "active" | "heavy";
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px]">
      <span className="font-mono">{score}</span>
      <span className={`uppercase ${ACT_COLORS[label]}`}>{label}</span>
    </span>
  );
}
