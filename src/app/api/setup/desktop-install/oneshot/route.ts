import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session-helper";

export const runtime = "nodejs";

// Session-gated one-shot installer for Claude Desktop. Returns a personalized
// script or launcher with the caller's own API token baked in — designed so
// non-technical teammates can click "Download installer", double-click the
// downloaded file, and be done. Restarting Claude Desktop is the only
// remaining manual step (nothing can automate that from the browser).
//
// Query: ?os=win   -> .cmd file that shells out to Node
//        ?os=mac   -> .command file (bash + node)
//        ?os=sh    -> .sh file (bash + node) — Linux
//        (default) -> .mjs, same as /api/setup/desktop-install but with token baked in
export async function GET(req: NextRequest) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [row] = await db
    .select({ apiToken: schema.users.apiToken })
    .from(schema.users)
    .where(eq(schema.users.id, me.id))
    .limit(1);
  if (!row?.apiToken)
    return NextResponse.json({ error: "no_token" }, { status: 500 });

  const os = (req.nextUrl.searchParams.get("os") ?? "mjs").toLowerCase();
  const origin = req.nextUrl.origin;
  const token = row.apiToken;

  if (os === "win") {
    // A .cmd is the simplest thing a Windows user can double-click. Node has
    // to be on PATH. We fetch the installer over HTTPS then invoke it.
    const cmd = `@echo off
setlocal
set "INSTALLER=%TEMP%\\claude-monitor-install.mjs"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node 20+ from https://nodejs.org/ and re-run this file.
  pause
  exit /b 1
)
echo Downloading Claude Monitor installer...
curl.exe -fsSL "${origin}/api/setup/desktop-install" -o "%INSTALLER%"
if errorlevel 1 (
  echo Download failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo Running installer...
node "%INSTALLER%" --token=${token}
echo.
echo Done. Now FULLY QUIT Claude Desktop (right-click tray icon -> Quit) and reopen it.
pause
`;
    return new NextResponse(cmd, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition":
          'attachment; filename="claude-monitor-install.cmd"',
      },
    });
  }

  if (os === "mac" || os === "sh") {
    const filename =
      os === "mac" ? "claude-monitor-install.command" : "claude-monitor-install.sh";
    const sh = `#!/usr/bin/env bash
set -e
INSTALLER="$(mktemp -t claude-monitor-install).mjs"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found on PATH. Install Node 20+ from https://nodejs.org/ and re-run this file."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
echo "Downloading Claude Monitor installer..."
curl -fsSL "${origin}/api/setup/desktop-install" -o "$INSTALLER"
echo "Running installer..."
node "$INSTALLER" --token=${token}
echo ""
echo "Done. Now FULLY QUIT Claude Desktop (Cmd-Q or right-click -> Quit) and reopen it."
read -n 1 -s -r -p "Press any key to close..."
`;
    return new NextResponse(sh, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(
    { error: "unknown os — use ?os=win, ?os=mac, or ?os=sh" },
    { status: 400 },
  );
}
