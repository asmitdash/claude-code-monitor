import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Standalone download of just the MCP server script — for users whose
// auto-installer failed silently. They save this file, save their token
// in ~/.claude-monitor/token, then paste the mcpServers entry into the
// Edit Config UI in Claude Desktop.
export function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const version = "0.8.0";

  const script = `#!/usr/bin/env node
// Claude Monitor desktop MCP server v${version}
// Point Claude Desktop at this file via Edit Config -> mcpServers.
// The script reads ~/.claude-monitor/token for auth.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { execFile } from "node:child_process";

const KILL_FLAG = path.join(os.homedir(), ".claude-monitor", "blocked");
const TOKEN_FILE = path.join(os.homedir(), ".claude-monitor", "token");
const SERVER = ${JSON.stringify(origin)};
const VERSION = ${JSON.stringify(version)};
const SOURCE = "claude-desktop";

function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, "utf-8").trim(); } catch { return ""; }
}
function isBlocked() { return fs.existsSync(KILL_FLAG); }

async function report(eventType, extra) {
  const token = readToken();
  if (!token || !SERVER) return;
  try {
    await fetch(SERVER + "/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "X-Claude-Monitor-Ext": VERSION,
      },
      body: JSON.stringify({
        event_type: eventType,
        source: SOURCE,
        cwd: process.cwd(),
        ...(extra ?? {}),
      }),
    });
  } catch {}
}

// Kill Claude Desktop's process tree so a blocked user can't keep working.
// Best-effort per-OS: taskkill on Windows, pkill on macOS/Linux.
function killClaudeDesktop() {
  const targets =
    process.platform === "win32"
      ? ["Claude.exe", "Claude-3p.exe", "Claude Desktop.exe"]
      : ["Claude", "Claude Desktop", "claude-desktop"];
  for (const name of targets) {
    try {
      if (process.platform === "win32") {
        execFile("taskkill", ["/F", "/IM", name], () => {});
      } else {
        execFile("pkill", ["-f", name], () => {});
      }
    } catch {}
  }
}

async function heartbeat() {
  const token = readToken();
  if (!token || !SERVER) return;
  try {
    const r = await fetch(SERVER + "/api/extension/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        claudeRunning: true,
        claudeOpen: true,
        localSurface: true,
        vscodeOpen: false,
        windowFocused: true,
        hostname: os.hostname(),
        extensionVersion: VERSION,
        source: SOURCE,
      }),
    });
    if (!r.ok) return;
    const body = await r.json().catch(() => null);
    // Server-decided kill: no slot / banned / paused / kill flag set. Drop the
    // local kill flag so the tools/call gate refuses immediately, then take
    // out Claude Desktop.
    if (body && body.blocked === true && !body.adminBypass) {
      const reason = typeof body.reason === "string" ? body.reason : "ended by team lead";
      try {
        fs.mkdirSync(path.dirname(KILL_FLAG), { recursive: true });
        fs.writeFileSync(KILL_FLAG, JSON.stringify({ reason, setAt: new Date().toISOString() }));
      } catch {}
      setTimeout(() => killClaudeDesktop(), 500);
    }
  } catch {}
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function err(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

async function handle(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    report("SessionStart", { tool: null, model: null, session_id: params?.clientInfo?.name ?? null });
    return ok(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "claude-monitor", version: VERSION },
    });
  }
  if (method?.startsWith("notifications/")) return;
  if (method === "tools/list") {
    return ok(id, {
      tools: [{
        name: "monitor__ping",
        description: "Team-monitor presence ping. Safe no-op — its only purpose is to record Claude Desktop activity to your team dashboard.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }],
    });
  }
  if (method === "tools/call") {
    const toolName = params?.name ?? null;
    if (isBlocked()) {
      let reason = "ended by team lead";
      try { const parsed = JSON.parse(fs.readFileSync(KILL_FLAG, "utf-8")); if (parsed?.reason) reason = parsed.reason; } catch {}
      await report("PreToolUse", { tool: toolName, blocked: true, reason });
      return err(id, -32001, "Claude Monitor: " + reason);
    }
    await report("PreToolUse", { tool: toolName });
    return ok(id, { content: [{ type: "text", text: "ok" }] });
  }
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "ping") return ok(id, {});
  return err(id, -32601, "method not found: " + method);
}

// 10s cadence — matches the VS Code extension's enforcement window. Any
// blocked=true response triggers immediate local kill flag + Claude Desktop
// process termination, so the wall reforms within 10s of every relaunch.
setInterval(() => { void heartbeat(); }, 10_000);
void heartbeat();

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { return; }
  if (Array.isArray(req)) { for (const r of req) await handle(r); } else { await handle(req); }
});
rl.on("close", () => { void report("Stop", {}).finally(() => process.exit(0)); });
`;

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="desktop-mcp.mjs"',
    },
  });
}
