"use client";
import { useEffect, useState } from "react";

export function Countdown({ to }: { to: string | Date }) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, target - now);
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  const overdue = target < now;
  return (
    <span className={`font-mono ${overdue ? "text-amber-400" : ""}`}>
      {overdue ? "+" : ""}
      {String(min).padStart(2, "0")}:{String(sec).padStart(2, "0")}
    </span>
  );
}
