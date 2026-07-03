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
  const version = "0.7.0";

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

function claudeDesktopConfigPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "Claude", "claude_desktop_config.json");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "Claude", "claude_desktop_config.json");
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

async function heartbeat() {
  const token = readToken();
  if (!token || !SERVER) return;
  try {
    await fetch(SERVER + "/api/extension/status", {
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

setInterval(() => { void heartbeat(); }, 60_000);
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

  const cfgPath = claudeDesktopConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); } catch { cfg = {}; }
  }
  const mcpServers = cfg.mcpServers ?? {};
  mcpServers["claude-monitor"] = {
    command: process.execPath || "node",
    args: [MCP_SCRIPT],
  };
  cfg.mcpServers = mcpServers;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  log("  desktop cfg -> " + cfgPath);

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
