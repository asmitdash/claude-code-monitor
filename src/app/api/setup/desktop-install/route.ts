import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Serves a standalone Node.js installer for Claude Desktop users who don't
// have (or don't want) the VS Code extension. Team members run it with:
//
//   curl -fsSL <server>/api/setup/desktop-install > install.mjs
//   node install.mjs --token=<ccm_token>
//
// The installer verifies the token against /api/ingest, writes the MCP server
// script, and registers it in Claude Desktop's config file. Same MCP server
// behavior as the one the VS Code extension installs — presence heartbeats +
// tool-call logging + kill-flag enforcement.
export function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const version = "0.8.0";

  const script = `#!/usr/bin/env node
// Claude Monitor — Claude Desktop standalone installer (v${version})
//
// Usage:
//   node install.mjs --token=ccm_xxxxxxxxxxxxxxxxx
//   node install.mjs                 (will prompt for the token)
//
// This installs the MCP server that reports Claude Desktop presence and tool
// activity to your team's Claude Monitor dashboard.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SERVER = ${JSON.stringify(origin)};
const VERSION = ${JSON.stringify(version)};
const KILL_DIR = path.join(os.homedir(), ".claude-monitor");
const TOKEN_FILE = path.join(KILL_DIR, "token");
const MCP_SCRIPT = path.join(KILL_DIR, "desktop-mcp.mjs");

function log(msg) { console.log("[claude-monitor] " + msg); }
function fail(msg) { console.error("[claude-monitor] " + msg); process.exit(1); }

// Claude Desktop config lives in different places depending on the build.
// The consumer build (documented in Anthropic's public docs) uses
// %APPDATA%\\Claude on Windows and ~/Library/Application Support/Claude on
// Mac. The "3p" / enterprise builds put it under %LOCALAPPDATA%\\Claude-3p
// on Windows and ~/Library/Application Support/Claude-3p on Mac. We
// discover which one exists on this machine and write there; if neither
// exists (Claude Desktop never launched) we default to the consumer path
// so the file materializes for the first launch.
function claudeDesktopConfigCandidates() {
  const candidates = [];
  if (process.platform === "darwin") {
    const home = os.homedir();
    candidates.push(
      path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      path.join(home, "Library", "Application Support", "Claude-3p", "claude_desktop_config.json"),
    );
  } else if (process.platform === "win32") {
    const roaming = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    candidates.push(
      path.join(roaming, "Claude", "claude_desktop_config.json"),
      path.join(local, "Claude-3p", "claude_desktop_config.json"),
      path.join(roaming, "Claude-3p", "claude_desktop_config.json"),
    );
  } else {
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
    candidates.push(
      path.join(xdg, "Claude", "claude_desktop_config.json"),
      path.join(xdg, "Claude-3p", "claude_desktop_config.json"),
    );
  }
  return candidates;
}

async function verifyToken(token) {
  const r = await fetch(SERVER + "/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      "X-Claude-Monitor-Ext": VERSION,
    },
    body: JSON.stringify({
      event_type: "installer.verify",
      source: "claude-desktop-installer",
    }),
  });
  return r.ok;
}

async function getToken() {
  const arg = process.argv.find((a) => a.startsWith("--token="));
  if (arg) return arg.slice("--token=".length).trim();
  const rl = readline.createInterface({ input, output });
  const t = await rl.question("Paste your Claude Monitor API token (starts with ccm_): ");
  rl.close();
  return t.trim();
}

const MCP_SERVER_SCRIPT = \`#!/usr/bin/env node
// Claude Monitor desktop MCP server v${version}
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

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\\\n"); }
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
\`;

async function main() {
  log("Claude Monitor desktop installer v" + VERSION);
  log("Target server: " + SERVER);

  const token = await getToken();
  if (!token || !token.startsWith("ccm_")) fail("Token must start with ccm_. Copy it from your dashboard → Admin → Extension API token.");

  log("Verifying token...");
  const ok = await verifyToken(token);
  if (!ok) fail("Token rejected by server. Copy a fresh one from the dashboard.");

  log("Token OK. Writing files...");
  fs.mkdirSync(KILL_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  fs.writeFileSync(MCP_SCRIPT, MCP_SERVER_SCRIPT, { mode: 0o755 });
  log("  token       -> " + TOKEN_FILE);
  log("  mcp script  -> " + MCP_SCRIPT);

  // Update every existing Claude Desktop config we find (consumer + 3p can
  // coexist on the same machine). If none exist yet, write to the consumer
  // path so a first launch picks it up. We MERGE — preserving any other
  // mcpServers the user configured — and never overwrite unrelated keys.
  const candidates = claudeDesktopConfigCandidates();
  const existing = candidates.filter((p) => fs.existsSync(p));
  const toWrite = existing.length > 0 ? existing : [candidates[0]];
  const desired = {
    command: process.execPath || "node",
    args: [MCP_SCRIPT],
  };
  for (const cfgPath of toWrite) {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    let cfg = {};
    if (fs.existsSync(cfgPath)) {
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); } catch { cfg = {}; }
    }
    const mcpServers = cfg.mcpServers ?? {};
    mcpServers["claude-monitor"] = desired;
    cfg.mcpServers = mcpServers;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    log("  desktop cfg -> " + cfgPath);
  }

  log("");
  log("Done. Please FULLY QUIT Claude Desktop (not just close the window) and reopen it.");
  log("Once it restarts, your presence will show up on the dashboard within ~60s.");
}

main().catch((e) => fail(String(e)));
`;

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": 'inline; filename="install.mjs"',
    },
  });
}
