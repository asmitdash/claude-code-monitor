#!/usr/bin/env node
// Headless tests of the v0.4 bypass round-trip. We can't drive the VS Code UI
// from a script, so we replay the EXACT activate/revert algorithm against a
// synthetic settings file and a synthetic state file, and assert the
// before/after JSON shape matches expectations.
//
// The functions below are a verbatim port of the logic in extension.ts.
// If the production extension changes its algorithm and forgets to update
// this harness, that's a bug — the test suite is the spec.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DIR = path.join(os.tmpdir(), `bypass-test-${process.pid}`);
fs.mkdirSync(TEST_DIR, { recursive: true });
const SETTINGS_PATH = path.join(TEST_DIR, "settings.json");
const STATE_PATH = path.join(TEST_DIR, "bypass-state.json");

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}
function writeSettings(s) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}
function readState() {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}
function writeState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
function clearState() {
  if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
}

function activateBypass(durationMinutes) {
  const settings = readSettings();
  const permissions = settings.permissions ?? {};
  const currentMode = permissions.defaultMode;
  const originalMode = typeof currentMode === "string" ? currentMode : null;
  const safeOriginal = originalMode === "bypassPermissions" ? null : originalMode;
  const currentAsk = permissions.ask;
  let originalAsk = null;
  if (Array.isArray(currentAsk)) {
    originalAsk = currentAsk.filter((x) => typeof x === "string");
  }
  permissions.defaultMode = "bypassPermissions";
  permissions.ask = [];
  settings.permissions = permissions;
  writeSettings(settings);
  const now = new Date(2026, 5, 23, 12, 0, 0); // deterministic
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  writeState({
    expiresAt: expiresAt.toISOString(),
    originalMode: safeOriginal,
    originalAsk,
    activatedAt: now.toISOString(),
  });
}

function revertBypass() {
  const state = readState();
  const settings = readSettings();
  const permissions = settings.permissions ?? {};
  if (permissions.defaultMode === "bypassPermissions") {
    if (state && state.originalMode !== null) {
      permissions.defaultMode = state.originalMode;
    } else {
      delete permissions.defaultMode;
    }
  }
  if (state) {
    const currentAsk = Array.isArray(permissions.ask) ? permissions.ask : [];
    if (state.originalAsk === null || state.originalAsk === undefined) {
      if (currentAsk.length === 0) {
        delete permissions.ask;
      }
    } else {
      const merged = [...currentAsk];
      for (const orig of state.originalAsk) {
        if (!merged.includes(orig)) merged.push(orig);
      }
      permissions.ask = merged;
    }
  }
  settings.permissions = permissions;
  writeSettings(settings);
  clearState();
}

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
    clearState();
    fn();
    console.log(`PASS ${name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${name}`);
    console.log("  " + (e.stack || e.message || e));
    fail++;
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "mismatch"}\n  expected: ${e}\n  actual:   ${a}`);
}

// ============================================================================

test("Test 1 — happy path: defaultMode=acceptEdits, ask=[A,B,C] -> bypass -> revert", () => {
  writeSettings({
    permissions: {
      allow: ["Bash"],
      ask: ["Bash(rm *)", "Bash(taskkill *)", "Bash(git push --force *)"],
      defaultMode: "acceptEdits",
    },
    model: "global.anthropic.claude-opus-4-7[1m]",
  });
  activateBypass(30);
  const mid = readSettings();
  eq(mid.permissions.defaultMode, "bypassPermissions", "defaultMode should flip");
  eq(mid.permissions.ask, [], "ask should be empty during bypass");
  eq(mid.permissions.allow, ["Bash"], "allow must be untouched");
  eq(mid.model, "global.anthropic.claude-opus-4-7[1m]", "unrelated keys must be untouched");
  const state = readState();
  eq(state.originalMode, "acceptEdits", "originalMode captured");
  eq(state.originalAsk, ["Bash(rm *)", "Bash(taskkill *)", "Bash(git push --force *)"], "originalAsk captured");

  revertBypass();
  const after = readSettings();
  eq(after.permissions.defaultMode, "acceptEdits", "defaultMode restored");
  eq(after.permissions.ask, ["Bash(rm *)", "Bash(taskkill *)", "Bash(git push --force *)"], "ask restored");
  eq(after.permissions.allow, ["Bash"], "allow still untouched");
  eq(readState(), null, "state file cleared");
});

test("Test 2 — empty ask list: bypass + revert leaves ask absent", () => {
  writeSettings({
    permissions: { allow: ["Bash"], defaultMode: "default" },
  });
  activateBypass(15);
  const mid = readSettings();
  eq(mid.permissions.ask, [], "ask cleared (was absent before)");
  const state = readState();
  eq(state.originalAsk, null, "originalAsk null when field was absent");

  revertBypass();
  const after = readSettings();
  if ("ask" in after.permissions) {
    throw new Error(`ask should be absent after revert, got ${JSON.stringify(after.permissions.ask)}`);
  }
  eq(after.permissions.defaultMode, "default", "defaultMode restored");
});

test("Test 3 — defaultMode absent: revert deletes the key", () => {
  writeSettings({
    permissions: { allow: ["Bash"], ask: ["Bash(rm *)"] },
  });
  activateBypass(60);
  const mid = readSettings();
  eq(mid.permissions.defaultMode, "bypassPermissions", "flipped");
  const state = readState();
  eq(state.originalMode, null, "originalMode null when absent");

  revertBypass();
  const after = readSettings();
  if ("defaultMode" in after.permissions) {
    throw new Error("defaultMode should be deleted, not restored");
  }
  eq(after.permissions.ask, ["Bash(rm *)"], "ask restored");
});

test("Test 4 — user adds an ask rule DURING bypass: merge on revert", () => {
  writeSettings({
    permissions: {
      allow: ["Bash"],
      ask: ["Bash(rm *)"],
      defaultMode: "acceptEdits",
    },
  });
  activateBypass(30);
  // user manually edits settings.json mid-bypass to add a new ask rule
  const live = readSettings();
  live.permissions.ask = ["Bash(npm uninstall *)"];
  writeSettings(live);

  revertBypass();
  const after = readSettings();
  // Expected: user's "npm uninstall" first, then the saved "rm" appended.
  eq(after.permissions.ask, ["Bash(npm uninstall *)", "Bash(rm *)"], "merged user-added + originals");
});

test("Test 5 — user re-adds an original-list rule during bypass: no duplicate", () => {
  writeSettings({
    permissions: {
      allow: ["Bash"],
      ask: ["Bash(rm *)", "Bash(taskkill *)"],
      defaultMode: "default",
    },
  });
  activateBypass(30);
  const live = readSettings();
  live.permissions.ask = ["Bash(rm *)"]; // user re-added one
  writeSettings(live);

  revertBypass();
  const after = readSettings();
  // Expected: rm (user-added) + taskkill (only missing original). No duplicate rm.
  eq(after.permissions.ask, ["Bash(rm *)", "Bash(taskkill *)"], "no duplicate");
});

test("Test 6 — already-bypassed state: don't capture bypassPermissions as originalMode", () => {
  writeSettings({
    permissions: {
      defaultMode: "bypassPermissions",
      ask: ["Bash(rm *)"],
    },
  });
  activateBypass(15);
  const state = readState();
  eq(state.originalMode, null, "must not capture bypassPermissions as the thing to restore");

  revertBypass();
  const after = readSettings();
  if ("defaultMode" in after.permissions) {
    throw new Error("defaultMode should be deleted on revert when originalMode was null");
  }
});

test("Test 7 — state file from v0.3 (no originalAsk field): revert is forwards-compatible", () => {
  writeSettings({
    permissions: {
      ask: ["Bash(rm *)", "Bash(taskkill *)"],
      defaultMode: "bypassPermissions",
    },
  });
  // Synthesize a v0.3-shape state file (no originalAsk). v0.4 must tolerate it
  // — specifically, it must not blow up and must NOT mass-delete the ask list,
  // because v0.3 didn't manage that field.
  writeState({
    expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    originalMode: "acceptEdits",
    activatedAt: new Date(Date.now() - 60_000).toISOString(),
    // intentionally NO originalAsk field
  });
  // Pretend a user manually emptied ask somehow during a v0.3 bypass.
  const live = readSettings();
  live.permissions.ask = [];
  writeSettings(live);

  revertBypass();
  const after = readSettings();
  eq(after.permissions.defaultMode, "acceptEdits", "defaultMode restored from v0.3 state");
  // v0.4 sees originalAsk is missing AND current ask is empty -> deletes the
  // empty ask field. This is acceptable v0.3-compat behavior: nothing to
  // restore, so don't keep an empty array around.
  if ("ask" in after.permissions && after.permissions.ask.length !== 0) {
    throw new Error("ask should be empty/absent — there was nothing to restore");
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(TEST_DIR, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
