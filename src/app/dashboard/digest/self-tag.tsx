"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const OPTS: Array<{ key: "progress" | "stuck" | "exploratory"; label: string; tone: string }> = [
  { key: "progress", label: "Made progress", tone: "border-emerald-800/60 text-emerald-300" },
  { key: "stuck", label: "Stuck", tone: "border-amber-800/60 text-amber-300" },
  { key: "exploratory", label: "Exploratory", tone: "border-neutral-700 text-neutral-300" },
];

export function SelfTag({ slotId }: { slotId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function tag(t: "progress" | "stuck" | "exploratory") {
    setErr(null);
    startTransition(async () => {
      const res = await fetch("/api/slot/tag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slotId, tag: t }),
      });
      if (!res.ok) {
        setErr(`${res.status}`);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) return <span className="text-emerald-400 text-xs">tagged ✓</span>;

  return (
    <span className="inline-flex items-center gap-1">
      {OPTS.map((o) => (
        <button
          key={o.key}
          onClick={() => tag(o.key)}
          disabled={pending}
          className={`rounded-md border ${o.tone} px-2 py-0.5 text-[10px] hover:bg-neutral-900 disabled:opacity-40`}
        >
          {o.label}
        </button>
      ))}
      {err && <span className="text-red-400 text-[10px]">err {err}</span>}
    </span>
  );
}
