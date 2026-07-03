import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile } from "child_process";

const TOKEN_KEY = "claudeMonitor.apiToken";
const KILL_DIR = path.join(os.homedir(), ".claude-monitor");
const KILL_FLAG = path.join(KILL_DIR, "blocked");
const HOOK_SCRIPT = path.join(KILL_DIR, "hook.mjs");
const DESKTOP_MCP_SCRIPT = path.join(KILL_DIR, "desktop-mcp.mjs");
const BYPASS_STATE_PATH = path.join(KILL_DIR, "bypass-state.json");
const DISCLOSURE_PATH = path.join(KILL_DIR, "disclosure-accepted.json");
const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const CLAUDE_MD_USER = path.join(os.homedir(), ".claude", "CLAUDE.md");
const SERVER_URL = "https://claude-code-monitor-theta.vercel.app";
const EXT_VERSION = "0.7.0";
// Claude Desktop's config file location differs per OS. We write into whichever
// exists — if neither does yet, we default to the platform-native path so a
// first-time Claude Desktop launch will pick it up.
function claudeDesktopConfigPath(): string {
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

type BypassState = {
  expiresAt: string;
  originalMode: string | null;
  // Snapshot of permissions.ask at activation time. Restored on revert.
  // null = the field was absent in settings.json before bypass started.
  originalAsk: string[] | null;
  // Snapshot of the IDE-side flags. The Claude Code IDE extension reads these
  // VSCode-level settings and gates the --allow-dangerously-skip-permissions
  // CLI flag on them. Without `allowDangerouslySkipPermissions=true` the IDE
  // strips bypass mode before spawning the agent — that's why setting only
  // `defaultMode: bypassPermissions` in ~/.claude/settings.json wasn't
  // enough. We now flip both alongside.
  originalIdeAllowSkip: boolean | null | undefined;
  originalIdeInitialMode: string | null | undefined;
  activatedAt: string;
};

type FileCommand = {
  id: string;
  kind: "read" | "write";
  filePath: "memory_md" | "claude_md_user" | "claude_md_project" | "settings_json";
  payload: string | null;
  createdBy: string;
  createdAt: string;
};

let statusBar: vscode.StatusBarItem;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let bypassTicker: ReturnType<typeof setInterval> | null = null;
let lastBlocked = false;
let claudeProcessSeen = false;
let windowFocused = true;
let bypassActive = false;
// Server-controlled kill switch for the timed bypass-permissions feature.
// Populated by every /api/extension/status response. Default true so
// pre-upgrade servers (no field on response) don't accidentally lock the
// feature off.
let bypassPermissionsAllowed = true;

function getServerUrl(): string {
  return SERVER_URL;
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

function detectClaudeOpen(): boolean {
  // Terminal name match
  for (const t of vscode.window.terminals) {
    const name = (t.name ?? "").toLowerCase();
    if (name.includes("claude")) return true;
  }
  // Real "is Anthropic Claude Code extension currently active?"
  try {
    const ext = vscode.extensions.getExtension("anthropic.claude-code");
    if (ext?.isActive) return true;
  } catch {}
  return claudeProcessSeen;
}

function detectClaudeRunning(): boolean {
  // We approximate "running" as "the official Claude Code extension is active
  // OR a terminal with claude in the name is open." A truer signal would
  // require sniffing the extension's state machine, which is not exposed.
  try {
    const ext = vscode.extensions.getExtension("anthropic.claude-code");
    if (ext?.isActive) return true;
  } catch {}
  return claudeProcessSeen;
}

function setStatus(text: string, color?: string, tooltip?: string) {
  // When bypass is active, the bypass renderer owns the status bar.
  if (bypassActive) {
    renderBypassStatus();
    return;
  }
  statusBar.text = text;
  statusBar.tooltip = tooltip ?? text;
  statusBar.color = color;
  statusBar.backgroundColor = undefined;
  statusBar.command = "claudeMonitor.openDashboard";
}

function renderBypassStatus() {
  const state = readBypassState();
  if (!state) {
    bypassActive = false;
    return;
  }
  const remaining = formatRemaining(state.expiresAt);
  statusBar.text = `$(warning) BYPASS ${remaining}`;
  statusBar.tooltip = `Permission prompts bypassed (defaultMode + ask list). Click to cancel or extend. Reverts at ${new Date(state.expiresAt).toLocaleTimeString()}.`;
  statusBar.color = "#ffffff";
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  statusBar.command = "claudeMonitor.toggleBypassMode";
}

async function writeKillFlag(reason: string) {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  fs.writeFileSync(KILL_FLAG, JSON.stringify({ reason, setAt: new Date().toISOString() }));
}

async function clearKillFlag() {
  if (fs.existsSync(KILL_FLAG)) fs.unlinkSync(KILL_FLAG);
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>) {
  const settingsDir = path.dirname(SETTINGS_PATH);
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function readBypassState(): BypassState | null {
  if (!fs.existsSync(BYPASS_STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BYPASS_STATE_PATH, "utf-8")) as BypassState;
  } catch {
    return null;
  }
}

function writeBypassState(state: BypassState) {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  fs.writeFileSync(BYPASS_STATE_PATH, JSON.stringify(state, null, 2));
}

function clearBypassState() {
  if (fs.existsSync(BYPASS_STATE_PATH)) fs.unlinkSync(BYPASS_STATE_PATH);
}

// Read the IDE-side claudeCode.* settings without losing the inspect()
// distinction between "explicitly set to false" and "absent (so default)".
// Returns undefined when the key has no user-level entry.
function readIdeFlag<T>(key: string): T | undefined {
  try {
    const cfg = vscode.workspace.getConfiguration("claudeCode");
    const inspected = cfg.inspect<T>(key);
    if (inspected?.globalValue !== undefined) return inspected.globalValue;
    if (inspected?.workspaceValue !== undefined) return inspected.workspaceValue;
    return undefined;
  } catch {
    return undefined;
  }
}

async function writeIdeFlag<T>(key: string, value: T | undefined): Promise<void> {
  try {
    const cfg = vscode.workspace.getConfiguration("claudeCode");
    await cfg.update(key, value, vscode.ConfigurationTarget.Global);
  } catch {
    // VSCode rejects updates while configuration is being initialized — best
    // effort, the next heartbeat will retry through the ticker.
  }
}

async function activateBypass(durationMinutes: number) {
  const settings = readSettings();
  const permissions = (settings.permissions as Record<string, unknown> | undefined) ?? {};
  const currentMode = permissions.defaultMode;
  const originalMode = typeof currentMode === "string" ? currentMode : null;

  // Don't capture "bypassPermissions" as the original — that would turn revert
  // into a no-op if the user toggles while already bypassed via some other path.
  const safeOriginal = originalMode === "bypassPermissions" ? null : originalMode;

  // Capture the ask list so we can restore it. permissions.ask is a hard floor
  // that bypassPermissions does NOT skip by design — clearing it is the only
  // way to make timed bypass actually total. Saved verbatim.
  const currentAsk = permissions.ask;
  let originalAsk: string[] | null = null;
  if (Array.isArray(currentAsk)) {
    originalAsk = (currentAsk as unknown[]).filter((x) => typeof x === "string") as string[];
  }

  // Capture and flip the IDE-side flags. Without these the Claude Code IDE
  // extension strips bypass mode before spawning the agent.
  const originalIdeAllowSkip = readIdeFlag<boolean>("allowDangerouslySkipPermissions");
  const originalIdeInitialMode = readIdeFlag<string>("initialPermissionMode");
  await writeIdeFlag<boolean>("allowDangerouslySkipPermissions", true);
  await writeIdeFlag<string>("initialPermissionMode", "bypassPermissions");

  permissions.defaultMode = "bypassPermissions";
  permissions.ask = [];
  settings.permissions = permissions;
  writeSettings(settings);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  writeBypassState({
    expiresAt: expiresAt.toISOString(),
    originalMode: safeOriginal,
    originalAsk,
    originalIdeAllowSkip:
      originalIdeAllowSkip === undefined ? null : originalIdeAllowSkip,
    originalIdeInitialMode:
      originalIdeInitialMode === undefined ? null : originalIdeInitialMode,
    activatedAt: now.toISOString(),
  });
  bypassActive = true;
}

async function revertBypass() {
  const state = readBypassState();
  const settings = readSettings();
  const permissions = (settings.permissions as Record<string, unknown> | undefined) ?? {};

  // Only flip if we still own the bypass — never overwrite a manual change.
  if (permissions.defaultMode === "bypassPermissions") {
    if (state && state.originalMode !== null) {
      permissions.defaultMode = state.originalMode;
    } else {
      delete permissions.defaultMode;
    }
  }

  // Restore the ask list. Only do it when the current ask is still empty —
  // if the user manually added something during the bypass window, keep their
  // edit and just merge the original entries that aren't already there.
  if (state) {
    const currentAsk = Array.isArray(permissions.ask) ? (permissions.ask as string[]) : [];
    if (state.originalAsk === null) {
      // Field was absent before bypass — only delete if user didn't manually add.
      if (currentAsk.length === 0) {
        delete permissions.ask;
      }
    } else {
      // Merge: keep anything the user added during bypass, then append every
      // original entry that's missing. Order: user-added first, then originals.
      const merged: string[] = [...currentAsk];
      for (const orig of state.originalAsk) {
        if (!merged.includes(orig)) merged.push(orig);
      }
      permissions.ask = merged;
    }
  }

  settings.permissions = permissions;
  writeSettings(settings);

  // Restore IDE-side flags. null in state = key was absent before bypass, so
  // we delete it (passing undefined to cfg.update removes the user-level entry).
  if (state) {
    if (state.originalIdeAllowSkip === null || state.originalIdeAllowSkip === undefined) {
      await writeIdeFlag<boolean>("allowDangerouslySkipPermissions", undefined);
    } else {
      await writeIdeFlag<boolean>(
        "allowDangerouslySkipPermissions",
        state.originalIdeAllowSkip,
      );
    }
    if (state.originalIdeInitialMode === null || state.originalIdeInitialMode === undefined) {
      await writeIdeFlag<string>("initialPermissionMode", undefined);
    } else {
      await writeIdeFlag<string>("initialPermissionMode", state.originalIdeInitialMode);
    }
  }

  clearBypassState();
  bypassActive = false;
}

async function checkBypassExpiry() {
  const state = readBypassState();
  if (!state) {
    bypassActive = false;
    return;
  }
  bypassActive = true;
  const expiresAt = new Date(state.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await revertBypass();
  }
}

function formatRemaining(expiresAtIso: string): string {
  const remainMs = new Date(expiresAtIso).getTime() - Date.now();
  if (Number.isNaN(remainMs) || remainMs <= 0) return "0:00";
  const totalSec = Math.floor(remainMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------- Admin file access (disclosed) ----------

function disclosureAccepted(): boolean {
  if (!fs.existsSync(DISCLOSURE_PATH)) return false;
  try {
    const j = JSON.parse(fs.readFileSync(DISCLOSURE_PATH, "utf-8"));
    return Boolean(j?.acceptedAt);
  } catch {
    return false;
  }
}

function recordDisclosure() {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  fs.writeFileSync(
    DISCLOSURE_PATH,
    JSON.stringify(
      { acceptedAt: new Date().toISOString(), version: EXT_VERSION },
      null,
      2,
    ),
  );
}

async function ensureDisclosureAccepted(): Promise<boolean> {
  if (disclosureAccepted()) return true;
  const choice = await vscode.window.showWarningMessage(
    "Claude Monitor: your team admin has access to your CLAUDE.md, MEMORY.md, and Claude Code settings.json on this machine for team-policy oversight. They can view and edit these files via the dashboard. By signing in, you accept this. (Bypass-permissions toggle, kill-switch, and presence reporting are unaffected.)",
    { modal: true },
    "Accept and continue",
    "Cancel",
  );
  if (choice === "Accept and continue") {
    recordDisclosure();
    return true;
  }
  return false;
}

function projectClaudeMdPath(): string | null {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return null;
  return path.join(ws.uri.fsPath, "CLAUDE.md");
}

function sanitizedCwdSegment(): string | null {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return null;
  // Mirror Claude Code's per-project memory directory naming: drive letter
  // becomes lowercase, all separators and colons become single hyphens.
  return ws.uri.fsPath.replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function projectMemoryMdPath(): string | null {
  const seg = sanitizedCwdSegment();
  if (!seg) return null;
  return path.join(os.homedir(), ".claude", "projects", seg, "memory", "MEMORY.md");
}

function resolveFilePath(
  kind: FileCommand["filePath"],
): { absPath: string | null; workspace: string | null } {
  const ws = vscode.workspace.workspaceFolders?.[0];
  switch (kind) {
    case "settings_json":
      return { absPath: SETTINGS_PATH, workspace: null };
    case "claude_md_user":
      return { absPath: CLAUDE_MD_USER, workspace: null };
    case "claude_md_project":
      return { absPath: projectClaudeMdPath(), workspace: ws?.uri.fsPath ?? null };
    case "memory_md":
      return { absPath: projectMemoryMdPath(), workspace: ws?.uri.fsPath ?? null };
    default:
      return { absPath: null, workspace: null };
  }
}

function deepMergeJson(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      target[k] &&
      typeof target[k] === "object" &&
      !Array.isArray(target[k])
    ) {
      deepMergeJson(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}

async function executeFileCommand(
  cmd: FileCommand,
  ctx: vscode.ExtensionContext,
): Promise<void> {
  const url = getServerUrl();
  const token = await getToken(ctx);
  if (!url || !token) return;

  const { absPath, workspace } = resolveFilePath(cmd.filePath);

  async function reportSnapshot(args: {
    content: string | null;
    error: string | null;
  }) {
    try {
      await fetch(`${url}/api/extension/files/snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          commandId: cmd.id,
          filePath: cmd.filePath,
          workspace,
          content: args.content,
          error: args.error,
        }),
      });
    } catch {
      // ack failures will retry on next poll only if the command stays unconsumed
      // — but the server marks it consumed once snapshot lands, so this is best-effort
    }
  }

  if (!absPath) {
    await reportSnapshot({
      content: null,
      error: "no_workspace_open_for_project_file",
    });
    return;
  }

  if (cmd.kind === "read") {
    try {
      const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : "";
      await reportSnapshot({ content, error: null });
    } catch (e) {
      await reportSnapshot({ content: null, error: String(e).slice(0, 1000) });
    }
    return;
  }

  // write — special-case settings.json with a deep merge so unknown top-level
  // keys are preserved. CLAUDE.md / MEMORY.md are plain markdown, full
  // overwrite.
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    if (cmd.filePath === "settings_json") {
      let current: Record<string, unknown> = {};
      if (fs.existsSync(absPath)) {
        try {
          current = JSON.parse(fs.readFileSync(absPath, "utf-8"));
        } catch {
          current = {};
        }
      }
      let patch: Record<string, unknown> = {};
      try {
        patch = JSON.parse(cmd.payload ?? "{}");
      } catch (e) {
        await reportSnapshot({
          content: null,
          error: "settings_payload_not_json: " + String(e),
        });
        return;
      }
      deepMergeJson(current, patch);
      fs.writeFileSync(absPath, JSON.stringify(current, null, 2));
      await reportSnapshot({
        content: fs.readFileSync(absPath, "utf-8"),
        error: null,
      });
    } else {
      fs.writeFileSync(absPath, cmd.payload ?? "");
      await reportSnapshot({
        content: cmd.payload ?? "",
        error: null,
      });
    }
  } catch (e) {
    await reportSnapshot({ content: null, error: String(e).slice(0, 1000) });
  }
}

async function pollFileCommands(ctx: vscode.ExtensionContext) {
  if (!disclosureAccepted()) return; // no commands fetched until user accepts
  const url = getServerUrl();
  const token = await getToken(ctx);
  if (!url || !token) return;
  try {
    const r = await fetch(`${url}/api/extension/files/poll`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const j = (await r.json()) as { commands?: FileCommand[] };
    for (const cmd of j.commands ?? []) {
      await executeFileCommand(cmd, ctx);
    }
  } catch {
    // best-effort — next heartbeat retries
  }
}

// ---------- end admin file access ----------

// ---------- Self-update ----------

const UPDATE_DISMISSED_KEY = "claudeMonitor.dismissedUpdateVersion";

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((s) => Number(s) || 0);
  const pb = b.split(/[.\-+]/).map((s) => Number(s) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

let updatePromptInFlight = false;

async function checkForUpdates(ctx: vscode.ExtensionContext) {
  if (updatePromptInFlight) return;
  const url = getServerUrl();
  if (!url) return;
  type Manifest = {
    ok: boolean;
    version?: string;
    autoUpdateEnabled?: boolean;
    vsixUrl?: string;
    sizeBytes?: number;
  };
  let manifest: Manifest | null = null;
  try {
    const r = await fetch(`${url}/api/extension/latest`);
    if (!r.ok) return;
    manifest = (await r.json()) as Manifest;
  } catch {
    return;
  }
  if (!manifest?.ok || !manifest.version || !manifest.vsixUrl) return;
  if (manifest.autoUpdateEnabled === false) return;
  if (compareSemver(manifest.version, EXT_VERSION) <= 0) return;

  const dismissed = ctx.globalState.get<string>(UPDATE_DISMISSED_KEY);
  if (dismissed === manifest.version) return;

  updatePromptInFlight = true;
  try {
    const choice = await vscode.window.showInformationMessage(
      `Claude Monitor v${manifest.version} is available (you're on v${EXT_VERSION}). Install now? VS Code will prompt you to reload after install.`,
      "Update now",
      "Later",
    );
    if (choice === "Later" || !choice) {
      await ctx.globalState.update(UPDATE_DISMISSED_KEY, manifest.version);
      return;
    }
    if (choice === "Update now") {
      await runSelfUpdate(url + manifest.vsixUrl, manifest.version);
    }
  } finally {
    updatePromptInFlight = false;
  }
}

async function runSelfUpdate(vsixUrl: string, version: string) {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading Claude Monitor v${version}…` },
    async (progress) => {
      progress.report({ increment: 0 });
      let buf: Buffer;
      try {
        const res = await fetch(vsixUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = new Uint8Array(await res.arrayBuffer());
        buf = Buffer.from(arr);
      } catch (e) {
        vscode.window.showErrorMessage(`Claude Monitor: download failed (${e}). Try again later.`);
        return;
      }
      progress.report({ increment: 50, message: "Installing…" });
      const tmpPath = path.join(os.tmpdir(), `claude-monitor-${version}.vsix`);
      try {
        fs.writeFileSync(tmpPath, buf);
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          vscode.Uri.file(tmpPath),
        );
        progress.report({ increment: 100, message: "Done — reload to apply." });
      } catch (e) {
        vscode.window.showErrorMessage(`Claude Monitor: install failed (${e}).`);
        return;
      } finally {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
    },
  );
}

// ---------- end self-update ----------

function killProcessesByName(names: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      let pending = names.length;
      if (pending === 0) return resolve();
      for (const n of names) {
        execFile("taskkill", ["/F", "/T", "/IM", n], () => {
          if (--pending === 0) resolve();
        });
      }
    } else {
      let pending = names.length;
      if (pending === 0) return resolve();
      for (const n of names) {
        execFile("pkill", ["-9", "-f", n], () => {
          if (--pending === 0) resolve();
        });
      }
    }
  });
}

async function enforceKill(reason: string) {
  await writeKillFlag(reason);
  for (const t of vscode.window.terminals) {
    const name = (t.name ?? "").toLowerCase();
    if (name.includes("claude") || name === "anthropic" || name.startsWith("@")) {
      try {
        t.dispose();
      } catch {}
    }
  }
  claudeProcessSeen = false;
  await killProcessesByName(["claude.exe", "claude", "claude-code", "claude-code.exe"]);
  try {
    const ext = vscode.extensions.getExtension("anthropic.claude-code");
    if (ext) {
      await vscode.commands.executeCommand(
        "workbench.extensions.action.disableExtension",
        "anthropic.claude-code",
      );
    }
  } catch {}
}

async function poll(ctx: vscode.ExtensionContext) {
  const url = getServerUrl();
  const token = await getToken(ctx);
  if (!url || !token) {
    setStatus("$(plug) Claude Monitor: not signed in", "#fbbf24");
    return;
  }

  const claudeOpen = detectClaudeOpen();
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
      body: JSON.stringify({
        claudeRunning,
        claudeOpen,
        localSurface: claudeOpen,
        vscodeOpen: true,
        windowFocused,
        vscodeWindow,
        hostname,
        extensionVersion: EXT_VERSION,
      }),
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

  // Cache server-side kill switch for the timed bypass-permissions feature.
  // Only override when the server explicitly reports a value — a missing field
  // (older server, transient failure) leaves the last-known value in place.
  const cfg = resp?.config as Record<string, unknown> | undefined;
  if (cfg && typeof cfg.bypassPermissionsEnabled === "boolean") {
    bypassPermissionsAllowed = cfg.bypassPermissionsEnabled;
  }

  const blocked = Boolean(resp?.blocked);
  const reason = (resp?.reason as string | null) ?? "ended by team lead";

  if (blocked) {
    await enforceKill(reason);
    if (!lastBlocked) {
      vscode.window
        .showWarningMessage(
          `Claude Code BLOCKED: ${reason}. Terminals closed and Claude Code extension disabled.`,
          { modal: true },
          "Reload Window",
          "Open dashboard",
        )
        .then((sel) => {
          if (sel === "Reload Window") {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
          } else if (sel === "Open dashboard" && url) {
            vscode.env.openExternal(vscode.Uri.parse(url));
          }
        });
    }
    setStatus("$(circle-slash) Claude: BLOCKED", "#f87171", reason);
  } else {
    await clearKillFlag();
    const queuePos = resp?.myQueuePosition as number | null;
    const eta = resp?.myQueueEtaMin as number | null;
    const mySlot = resp?.mySlot as { slotNumber?: number; plannedEndAt?: string } | null;
    const activeUsers = resp?.activeUsers as Array<{ email?: string }> | undefined;
    if (mySlot && mySlot.plannedEndAt) {
      const remainMs = new Date(mySlot.plannedEndAt).getTime() - Date.now();
      const remainMin = Math.max(0, Math.round(remainMs / 60000));
      setStatus(
        `$(record) Claude slot ${mySlot.slotNumber ?? "?"} · ${remainMin}m left`,
        "#34d399",
      );
    } else if (queuePos != null) {
      setStatus(
        `$(watch) Queue #${queuePos}${eta != null ? ` · ~${eta}m` : ""}`,
        "#fbbf24",
      );
    } else if (activeUsers && activeUsers.length > 0) {
      const list = activeUsers
        .map((u) => u.email ?? "?")
        .filter(Boolean)
        .join(", ");
      setStatus(`$(eye) Claude active: ${list}`, "#fbbf24");
    } else if (claudeOpen) {
      setStatus("$(pulse) Claude Monitor: terminal open", "#fbbf24");
    } else {
      setStatus("$(check) Claude Monitor: idle");
    }
  }
  lastBlocked = blocked;
}

async function ensureHookInstalled() {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  const url = getServerUrl();

  const hookScript = `#!/usr/bin/env node
// Claude Monitor hook v${EXT_VERSION} — reports telemetry and blocks tool calls when the kill flag is set.
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
const model =
  payload.model ||
  (payload.tool_response && payload.tool_response.model) ||
  (payload.message && payload.message.model) ||
  null;

let token = "";
try { token = fs.readFileSync(TOKEN_FILE, "utf-8").trim(); } catch {}

if (token && SERVER) {
  try {
    await fetch(SERVER + "/api/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "X-Claude-Monitor-Ext": ${JSON.stringify(EXT_VERSION)},
      },
      body: JSON.stringify({ event_type: eventType, session_id: sessionId, cwd, tool, model, payload }),
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
    const arr =
      (hooks[eventName] as Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>) ??
      [];
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

// Install the Claude Desktop MCP server. Claude Desktop has no
// extension/plugin system — MCP servers are the only supported hook. We
// register a stdio server that (a) reports app presence + tool calls via
// /api/ingest, (b) exposes a passive tool so we appear in the tool list,
// (c) checks the kill flag before responding.
//
// Claude Desktop reads its config on startup only, so a user has to restart
// the app after this runs the first time. The extension surfaces that in a
// one-shot info toast.
async function ensureDesktopMcpInstalled(): Promise<{ configWritten: boolean }> {
  fs.mkdirSync(KILL_DIR, { recursive: true });
  const url = getServerUrl();

  const mcpScript = `#!/usr/bin/env node
// Claude Monitor desktop MCP server v${EXT_VERSION} — reports Claude Desktop
// presence and tool activity to the team dashboard, and enforces the kill
// switch. Auto-installed by the Claude Monitor VS Code extension.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const KILL_FLAG = path.join(os.homedir(), ".claude-monitor", "blocked");
const TOKEN_FILE = path.join(os.homedir(), ".claude-monitor", "token");
const SERVER = ${JSON.stringify(url || "")};
const VERSION = ${JSON.stringify(EXT_VERSION)};
const SOURCE = "claude-desktop";

function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, "utf-8").trim(); } catch { return ""; }
}

function isBlocked() {
  return fs.existsSync(KILL_FLAG);
}

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

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function err(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

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
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
    return;
  }
  if (method === "tools/list") {
    return ok(id, {
      tools: [
        {
          name: "monitor__ping",
          description: "Team-monitor presence ping. Safe no-op — its only purpose is to record Claude Desktop activity to your team dashboard.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
  }
  if (method === "tools/call") {
    const toolName = params?.name ?? null;
    if (isBlocked()) {
      let reason = "ended by team lead";
      try {
        const raw = fs.readFileSync(KILL_FLAG, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.reason) reason = parsed.reason;
      } catch {}
      await report("PreToolUse", { tool: toolName, blocked: true, reason });
      return err(id, -32001, "Claude Monitor: " + reason);
    }
    await report("PreToolUse", { tool: toolName });
    return ok(id, {
      content: [{ type: "text", text: "ok" }],
    });
  }
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "ping") return ok(id, {});
  return err(id, -32601, "method not found: " + method);
}

// Presence heartbeat every 60s while Claude Desktop keeps the process alive.
setInterval(() => { void heartbeat(); }, 60_000);
void heartbeat();

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { return; }
  if (Array.isArray(req)) {
    for (const r of req) await handle(r);
  } else {
    await handle(req);
  }
});
rl.on("close", () => {
  void report("Stop", {}).finally(() => process.exit(0));
});
`;
  fs.writeFileSync(DESKTOP_MCP_SCRIPT, mcpScript, { mode: 0o755 });

  const cfgPath = claudeDesktopConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

  let cfg: Record<string, unknown> = {};
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    } catch {
      cfg = {};
    }
  }

  const mcpServers =
    (cfg.mcpServers as Record<string, Record<string, unknown>> | undefined) ?? {};
  const desired = {
    command: process.execPath || "node",
    args: [DESKTOP_MCP_SCRIPT],
  };
  const existing = mcpServers["claude-monitor"];
  const same =
    existing &&
    typeof existing === "object" &&
    existing.command === desired.command &&
    Array.isArray(existing.args) &&
    existing.args.length === desired.args.length &&
    (existing.args as unknown[]).every((a, i) => a === desired.args[i]);

  if (same) return { configWritten: false };

  mcpServers["claude-monitor"] = desired;
  cfg.mcpServers = mcpServers;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return { configWritten: true };
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
  try {
    const cfg = vscode.workspace.getConfiguration("claudeMonitor");
    if (cfg.get<string>("serverUrl")) {
      await cfg.update("serverUrl", undefined, vscode.ConfigurationTarget.Global);
      await cfg.update("serverUrl", undefined, vscode.ConfigurationTarget.Workspace);
    }
  } catch {}

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "claudeMonitor.openDashboard";
  statusBar.show();
  ctx.subscriptions.push(statusBar);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("claudeMonitor.signIn", async () => {
      const accepted = await ensureDisclosureAccepted();
      if (!accepted) {
        vscode.window.showInformationMessage(
          "Claude Monitor: sign-in cancelled — admin file access disclosure not accepted.",
        );
        return;
      }
      const token = await vscode.window.showInputBox({
        prompt: `Paste your API token from ${SERVER_URL}/admin (Extension API token card)`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) =>
          v.startsWith("ccm_") && v.length > 10 ? null : "Token should start with ccm_",
      });
      if (token) {
        await setToken(ctx, token);
        await writeTokenFileFromSecret(ctx);
        await ensureHookInstalled();
        const desktop = await ensureDesktopMcpInstalled().catch(() => ({
          configWritten: false,
        }));
        vscode.window.showInformationMessage(
          desktop.configWritten
            ? "Claude Monitor signed in. Hooks installed for Claude Code and Claude Desktop. Restart Claude Desktop once so it picks up the new MCP server."
            : "Claude Monitor signed in. Hook installed in ~/.claude/settings.json.",
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
      const desktop = await ensureDesktopMcpInstalled().catch(() => ({
        configWritten: false,
      }));
      vscode.window.showInformationMessage(
        desktop.configWritten
          ? "Claude Monitor: hooks (re)installed. Claude Desktop config was updated — restart it once."
          : "Claude Monitor: hooks (re)installed.",
      );
    }),
    vscode.commands.registerCommand("claudeMonitor.installDesktopMcp", async () => {
      const desktop = await ensureDesktopMcpInstalled().catch((e) => {
        vscode.window.showErrorMessage(
          "Claude Monitor: desktop MCP install failed: " + String(e),
        );
        return { configWritten: false };
      });
      vscode.window.showInformationMessage(
        desktop.configWritten
          ? "Claude Monitor: Claude Desktop MCP installed. Restart Claude Desktop for it to take effect."
          : "Claude Monitor: Claude Desktop MCP was already installed and up to date.",
      );
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
    vscode.commands.registerCommand("claudeMonitor.requestSlot", async () => {
      const url = getServerUrl();
      vscode.env.openExternal(vscode.Uri.parse(`${url}/dashboard`));
    }),
    vscode.commands.registerCommand("claudeMonitor.toggleBypassMode", async () => {
      const state = readBypassState();
      // Cancelling / extending an already-running bypass is always permitted
      // — the kill switch only gates *starting* a new one. This matches the
      // policy: flipping the admin toggle off doesn't yank the rug out from
      // anyone mid-session; existing bypasses run out naturally.
      if (!state && !bypassPermissionsAllowed) {
        vscode.window.showWarningMessage(
          "Claude Monitor: bypass-permissions is disabled by admin.",
        );
        return;
      }
      if (state) {
        const remaining = formatRemaining(state.expiresAt);
        const choice = await vscode.window.showQuickPick(
          [
            { label: "$(close) Cancel bypass now", value: "cancel" },
            { label: "$(add) Extend by 15 min", value: "ext-15" },
            { label: "$(add) Extend by 1 hour", value: "ext-60" },
            { label: "$(info) Keep active", value: "keep" },
          ],
          {
            placeHolder: `Bypass active — ${remaining} remaining. Reverts to "${state.originalMode ?? "(absent)"}".`,
            ignoreFocusOut: true,
          },
        );
        if (!choice || choice.value === "keep") return;
        if (choice.value === "cancel") {
          await revertBypass();
          renderBypassStatus();
          void poll(ctx);
          vscode.window.showInformationMessage("Claude Monitor: bypass mode cancelled.");
          return;
        }
        const extendMin = choice.value === "ext-15" ? 15 : 60;
        const newExpires = new Date(new Date(state.expiresAt).getTime() + extendMin * 60_000);
        writeBypassState({ ...state, expiresAt: newExpires.toISOString() });
        renderBypassStatus();
        vscode.window.showInformationMessage(
          `Claude Monitor: bypass extended by ${extendMin} min.`,
        );
        return;
      }

      const choice = await vscode.window.showQuickPick(
        [
          { label: "$(clock) 15 minutes", minutes: 15 },
          { label: "$(clock) 1 hour", minutes: 60 },
          { label: "$(clock) 2 hours", minutes: 120 },
          { label: "$(clock) 4 hours", minutes: 240 },
          { label: "$(edit) Custom (minutes)…", minutes: -1 },
        ],
        {
          placeHolder: "Bypass permission prompts for how long?",
          ignoreFocusOut: true,
        },
      );
      if (!choice) return;

      let minutes = choice.minutes;
      if (minutes === -1) {
        const input = await vscode.window.showInputBox({
          prompt: "Bypass duration in minutes (1–1440)",
          ignoreFocusOut: true,
          validateInput: (v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || !Number.isInteger(n)) return "Enter a whole number";
            if (n < 1) return "Must be at least 1";
            if (n > 1440) return "Max 24 hours (1440 min)";
            return null;
          },
        });
        if (!input) return;
        minutes = Number(input);
      }

      await activateBypass(minutes);
      renderBypassStatus();
      const expiresAt = new Date(Date.now() + minutes * 60_000);
      vscode.window.showWarningMessage(
        `Claude Monitor: BYPASS active for ${minutes} min. Reverts at ${expiresAt.toLocaleTimeString()}.`,
      );
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
    vscode.window.onDidChangeWindowState((s) => {
      windowFocused = s.focused;
    }),
  );

  await writeTokenFileFromSecret(ctx);

  // Bypass-mode crash recovery: if VSCode was killed mid-bypass and the timer
  // has since elapsed, revert immediately on activation.
  await checkBypassExpiry();

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
    // Best-effort — never block activation on desktop MCP install.
    void ensureDesktopMcpInstalled().catch(() => {});
  }

  let lastUpdateCheck = 0;
  heartbeat = setInterval(async () => {
    await checkBypassExpiry();
    if (bypassActive) renderBypassStatus();
    await poll(ctx);
    await pollFileCommands(ctx);
    // Throttle update checks — every 5 minutes is plenty.
    const now = Date.now();
    if (now - lastUpdateCheck > 5 * 60_000) {
      lastUpdateCheck = now;
      await checkForUpdates(ctx);
    }
  }, 10_000);
  bypassTicker = setInterval(() => {
    if (bypassActive) renderBypassStatus();
  }, 1_000);
  ctx.subscriptions.push({
    dispose: () => {
      if (heartbeat) clearInterval(heartbeat);
      if (bypassTicker) clearInterval(bypassTicker);
    },
  });
  if (bypassActive) renderBypassStatus();
  void poll(ctx);
}

export function deactivate() {
  if (heartbeat) clearInterval(heartbeat);
  if (bypassTicker) clearInterval(bypassTicker);
}
