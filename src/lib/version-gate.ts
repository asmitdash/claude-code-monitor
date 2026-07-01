// Version gate: block Claude Code hooks/heartbeats from extensions older than
// MIN_EXTENSION_VERSION. Anyone below is force-ended immediately.
//
// Threshold is env-driven: MIN_EXTENSION_VERSION defaults to "0.3.0".
// Semver comparison is dot-numeric only (no pre-release / build tags — we
// never publish those from this extension).

const DEFAULT_MIN = "0.3.0";

export function getMinExtensionVersion(): string {
  return (process.env.MIN_EXTENSION_VERSION || DEFAULT_MIN).trim();
}

function parts(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const cleaned = v.trim().replace(/^v/, "");
  if (!/^\d+(\.\d+)*$/.test(cleaned)) return null;
  return cleaned.split(".").map((n) => parseInt(n, 10));
}

// Returns true iff `installed` >= `minimum`.
// Missing/malformed installed version → treated as too-old → returns false.
export function extensionMeetsMinimum(
  installed: string | null | undefined,
  minimum: string = getMinExtensionVersion(),
): boolean {
  const a = parts(installed);
  const b = parts(minimum);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true; // equal
}

export function versionGateReason(minimum: string): string {
  return `extension version < ${minimum} — update to continue. Restart VS Code after auto-update.`;
}
