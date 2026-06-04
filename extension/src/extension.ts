import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const TOKEN_KEY = "claudeMonitor.apiToken";
const KILL_DIR = path.join(os.homedir(), ".claude-monitor");
const KILL_FLAG = path.join(KILL_DIR, "blocked");
const HOOK_SCRIPT = path.join(KILL_DIR, "hook.mjs");
const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

let statusBar: vscode.StatusBarItem;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastBlocked = false;
let claudeProcessSeen = false;

function getServerUrl(): string {
  const url = vscode.workspace.getConfiguration("claudeMonitor").get<string>("serverUrl") || "";
  return url.replace(/\/+$/, "");
}

async function getToken(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  return ctx.secrets.get(TOKEN_KEY);
}

async function setToken(ctx: vscode.ExtensionContext, token: string) {
  await ctx.secrets.store(TOKEN_KEY, token);
}

async function clearToken(ctx: vscode.ExtensionContext) {
  await ctx.secrets.delete(TOKEN_KEY);
}

function detectClaudeRunning(): boolean {
  const ext = vscode.extensions.getExtension("anthropic.claude-code");
  if (ext?.isActive) return true;

  for (const t of vscode.window.terminals) {
    const name = (t.name ?? "").toLowerCase();
    if (name.includes("claude")) return true;
    const exec = t.shellIntegration?.executeCommand;
    if (exec) {
    }
  }

  return claudeProcessSeen;
}

function setStatus(text: string, color?: string, tooltip?: string) {
  statusBar.text = text;
  statusBar.tooltip = tooltip ?? text;
  if (color) {
    statusBar.color = color;
  } else {
    statusBar.color = undefined;
  }
}

async function writeKillFlag(reason: string) {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  fs.writeFileSync(KILL_FLAG, JSON.stringify({ reason, setAt: new Date().toISOString() }));
}

async function clearKillFlag() {
  if (fs.existsSync(KILL_FLAG)) fs.unlinkSync(KILL_FLAG);
}

async function poll(ctx: vscode.ExtensionContext) {
  const url = getServerUrl();
  const token = await getToken(ctx);
  if (!url || !token) {
    setStatus("$(plug) Claude Monitor: not signed in", "#fbbf24");
    return;
  }

  const claudeRunning = detectClaudeRunning();
  const vscodeWindow = vscode.workspace.workspaceFolders?.[0]?.name ?? null;
  const hostname = os.hostname();

  let resp: Record<string, unknown> | null = null;
  try {
    const r = await fetch(`${url}/api/extension/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ claudeRunning, vscodeWindow, hostname }),
    });
    if (!r.ok) {
      setStatus(`$(error) Claude Monitor: ${r.status}`, "#f87171");
      return;
    }
    resp = (await r.json()) as Record<string, unknown>;
  } catch (e) {
    setStatus("$(warning) Claude Monitor: offline", "#fbbf24", String(e));
    return;
  }

  const blocked = Boolean(resp?.blocked);
  const reason = (resp?.reason as string | null) ?? "ended by team lead";

  if (blocked) {
    await writeKillFlag(reason);
    if (!lastBlocked) {
      vscode.window
        .showWarningMessage(
          `Claude Code BLOCKED: ${reason}`,
          { modal: true },
          "Open dashboard",
        )
        .then((sel) => {
          if (sel === "Open dashboard" && url) {
            vscode.env.openExternal(vscode.Uri.parse(url));
          }
        });
    }
    setStatus("$(circle-slash) Claude: BLOCKED", "#f87171", reason);
  } else {
    await clearKillFlag();
    if (claudeRunning) {
      setStatus("$(pulse) Claude: active", "#34d399");
    } else {
      const me = resp?.activeUser as { email?: string } | null | undefined;
      if (me?.email) {
        setStatus(`$(eye) Claude in use: ${me.email}`, "#fbbf24");
      } else {
        setStatus("$(check) Claude Monitor: idle");
      }
    }
  }
  lastBlocked = blocked;
}

async function ensureHookInstalled() {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  const url = getServerUrl();

  const hookScript = `#!/usr/bin/env node
// Claude Monitor hook — reports telemetry to the dashboard and blocks tool calls when the kill flag is set.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const KILL_FLAG = path.join(os.homedir(), ".claude-monitor", "blocked");
const TOKEN_FILE = path.join(os.homedir(), ".claude-monitor", "token");
const SERVER = ${JSON.stringify(url || "")};

let payload = {};
try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (raw) payload = JSON.parse(raw);
} catch {}

const eventType = payload.hook_event_name || payload.eventType || process.argv[2] || "unknown";
const sessionId = payload.session_id || payload.sessionId || null;
const cwd = payload.cwd || process.cwd();
const tool = payload.tool_name || (payload.tool_input && payload.tool_input.name) || null;

let token = "";
try { token = fs.readFileSync(TOKEN_FILE, "utf-8").trim(); } catch {}

if (token && SERVER) {
  try {
    await fetch(SERVER + "/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ event_type: eventType, session_id: sessionId, cwd, tool, payload }),
    }).catch(() => {});
  } catch {}
}

if (fs.existsSync(KILL_FLAG)) {
  let reason = "ended by team lead";
  try {
    const raw = fs.readFileSync(KILL_FLAG, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.reason) reason = parsed.reason;
  } catch {}
  process.stderr.write("Claude Monitor: " + reason + "\\n");
  process.exit(2);
}

process.exit(0);
`;
  fs.writeFileSync(HOOK_SCRIPT, hookScript, { mode: 0o755 });

  const settingsDir = path.dirname(SETTINGS_PATH);
  fs.mkdirSync(settingsDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      settings = {};
    }
  }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const command = `node "${HOOK_SCRIPT.replace(/\\/g, "\\\\")}"`;

  function ensureHookFor(eventName: string) {
    const arr = (hooks[eventName] as Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>) ?? [];
    let bucket = arr.find((b) => (b.matcher ?? "*") === "*");
    if (!bucket) {
      bucket = { matcher: "*", hooks: [] };
      arr.push(bucket);
    }
    if (!bucket.hooks) bucket.hooks = [];
    const exists = bucket.hooks.some(
      (h) => typeof h.command === "string" && (h.command as string).includes("claude-monitor"),
    );
    if (!exists) {
      bucket.hooks.push({ type: "command", command });
    }
    hooks[eventName] = arr;
  }

  ensureHookFor("PreToolUse");
  ensureHookFor("PostToolUse");
  ensureHookFor("UserPromptSubmit");
  ensureHookFor("Stop");
  ensureHookFor("SessionStart");

  settings.hooks = hooks;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

async function writeTokenFileFromSecret(ctx: vscode.ExtensionContext) {
  const token = await getToken(ctx);
  fs.mkdirSync(KILL_DIR, { recursive: true });
  const tokenFile = path.join(KILL_DIR, "token");
  if (token) {
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  } else if (fs.existsSync(tokenFile)) {
    fs.unlinkSync(tokenFile);
  }
}

export async function activate(ctx: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "claudeMonitor.openDashboard";
  statusBar.show();
  ctx.subscriptions.push(statusBar);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("claudeMonitor.signIn", async () => {
      const url = await vscode.window.showInputBox({
        prompt: "Server URL",
        value: getServerUrl() || "https://claude-code-monitor-theta.vercel.app",
        ignoreFocusOut: true,
      });
      if (url !== undefined) {
        await vscode.workspace
          .getConfiguration("claudeMonitor")
          .update("serverUrl", url.replace(/\/+$/, ""), vscode.ConfigurationTarget.Global);
      }
      const token = await vscode.window.showInputBox({
        prompt: "Paste your API token from the dashboard (Extension API token section)",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) =>
          v.startsWith("ccm_") && v.length > 10 ? null : "Token should start with ccm_",
      });
      if (token) {
        await setToken(ctx, token);
        await writeTokenFileFromSecret(ctx);
        await ensureHookInstalled();
        vscode.window.showInformationMessage(
          "Claude Monitor signed in. Hook installed in ~/.claude/settings.json.",
        );
        await poll(ctx);
      }
    }),
    vscode.commands.registerCommand("claudeMonitor.signOut", async () => {
      await clearToken(ctx);
      await writeTokenFileFromSecret(ctx);
      vscode.window.showInformationMessage("Claude Monitor signed out.");
      setStatus("$(plug) Claude Monitor: not signed in", "#fbbf24");
    }),
    vscode.commands.registerCommand("claudeMonitor.installHook", async () => {
      await ensureHookInstalled();
      vscode.window.showInformationMessage("Claude Monitor hook (re)installed.");
    }),
    vscode.commands.registerCommand("claudeMonitor.openDashboard", () => {
      const url = getServerUrl();
      if (!url) {
        vscode.commands.executeCommand("claudeMonitor.signIn");
        return;
      }
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand("claudeMonitor.clearKill", async () => {
      await clearKillFlag();
      vscode.window.showInformationMessage("Claude Monitor: local kill flag cleared.");
    }),
  );

  ctx.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => {
      if ((t.name ?? "").toLowerCase().includes("claude")) {
        claudeProcessSeen = true;
      }
    }),
    vscode.window.onDidCloseTerminal(() => {
      claudeProcessSeen = vscode.window.terminals.some((t) =>
        (t.name ?? "").toLowerCase().includes("claude"),
      );
    }),
  );

  await writeTokenFileFromSecret(ctx);

  const token = await getToken(ctx);
  if (!token) {
    vscode.window
      .showInformationMessage(
        "Claude Monitor: sign in to start reporting activity to the team dashboard.",
        "Sign in",
      )
      .then((s) => {
        if (s === "Sign in") vscode.commands.executeCommand("claudeMonitor.signIn");
      });
  } else {
    await ensureHookInstalled();
  }

  heartbeat = setInterval(() => void poll(ctx), 10_000);
  ctx.subscriptions.push({
    dispose: () => {
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  void poll(ctx);
}

export function deactivate() {
  if (heartbeat) clearInterval(heartbeat);
}
