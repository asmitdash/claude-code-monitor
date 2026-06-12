// Per-tool activity weights and cost estimates.
// Weights are heuristic: write/edit > bash > read/glob/grep.

export type WeightedEvent = {
  eventType: string;
  tool: string | null;
  model: string | null;
};

const TOOL_WEIGHTS: Record<string, number> = {
  Edit: 8,
  edit: 8,
  Write: 10,
  write: 10,
  MultiEdit: 10,
  Bash: 6,
  bash: 6,
  Read: 2,
  read: 2,
  Glob: 1,
  glob: 1,
  Grep: 2,
  grep: 2,
  Task: 5,
  Agent: 5,
  WebSearch: 3,
  WebFetch: 3,
  TodoWrite: 1,
  NotebookEdit: 8,
};

const EVENT_WEIGHTS: Record<string, number> = {
  PreToolUse: 0,
  PostToolUse: 0,
  UserPromptSubmit: 4,
  SessionStart: 2,
  Stop: 0,
};

export function eventWeight(e: WeightedEvent): number {
  if (e.tool) {
    const w = TOOL_WEIGHTS[e.tool];
    if (w !== undefined) return w;
  }
  return EVENT_WEIGHTS[e.eventType] ?? 1;
}

// Approximate per-event token cost. Real numbers come from Claude responses,
// which the v0.1 hook payload doesn't always include; this is a useful proxy.
const TOOL_TOKEN_GUESS: Record<string, number> = {
  Edit: 1500,
  Write: 2500,
  MultiEdit: 3000,
  Bash: 800,
  Read: 1200,
  Glob: 200,
  Grep: 500,
  Task: 5000,
  Agent: 5000,
  WebSearch: 1000,
  WebFetch: 1500,
  TodoWrite: 200,
};

export function tokenGuess(e: WeightedEvent, payload: unknown): number {
  if (
    payload &&
    typeof payload === "object" &&
    "tool_response" in (payload as Record<string, unknown>)
  ) {
    const resp = (payload as Record<string, unknown>).tool_response as
      | Record<string, unknown>
      | undefined;
    if (resp && typeof resp === "object" && "usage" in resp) {
      const u = resp.usage as Record<string, unknown> | undefined;
      const inT = Number(u?.input_tokens ?? 0);
      const outT = Number(u?.output_tokens ?? 0);
      if (inT + outT > 0) return inT + outT;
    }
  }
  if (e.tool) {
    const guess = TOOL_TOKEN_GUESS[e.tool];
    if (guess !== undefined) return guess;
  }
  return 500;
}

// Per-million-token cost (USD) by model family — rough averages of input+output blended.
const MODEL_COST_PER_MILLION_USD: Record<string, number> = {
  "claude-opus-4-8": 60,
  "claude-opus-4-7": 60,
  "claude-opus-4-6": 60,
  "claude-opus-4-5": 60,
  "claude-sonnet-4-6": 6,
  "claude-sonnet-4-5": 6,
  "claude-haiku-4-5": 1.5,
  "claude-fable-5": 30,
  "default": 6,
};

export function costMicros(model: string | null, tokens: number): number {
  if (!model || tokens <= 0) return 0;
  const m = Object.keys(MODEL_COST_PER_MILLION_USD).find((k) =>
    model.toLowerCase().includes(k.toLowerCase()),
  );
  const usdPerM = MODEL_COST_PER_MILLION_USD[m ?? "default"];
  // micros = USD * 1_000_000; cost_usd = tokens / 1e6 * usdPerM
  return Math.round((tokens * usdPerM));
}

// Activity score buckets:
//   0           = idle
//   1-20        = light
//   20-100      = active
//   100+        = heavy
export function scoreLabel(score: number): "idle" | "light" | "active" | "heavy" {
  if (score <= 0) return "idle";
  if (score < 20) return "light";
  if (score < 100) return "active";
  return "heavy";
}
