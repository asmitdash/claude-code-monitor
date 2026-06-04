"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Day = { day: string; minutes: number; sessions: number; events?: number };

export function UsageChart({ data, height = 220 }: { data: Day[]; height?: number }) {
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    hours: +(d.minutes / 60).toFixed(2),
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="areaUsage" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#525252"
            tick={{ fill: "#a3a3a3", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#525252"
            tick={{ fill: "#a3a3a3", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v) => `${v}h`}
          />
          <Tooltip
            contentStyle={{
              background: "#0a0a0a",
              border: "1px solid #262626",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#e5e5e5" }}
            formatter={(value, name) => {
              if (name === "hours") return [`${Number(value).toFixed(2)} h`, "Usage"];
              return [String(value), String(name)];
            }}
          />
          <Area
            type="monotone"
            dataKey="hours"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#areaUsage)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
