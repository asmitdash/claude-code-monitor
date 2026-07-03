#!/usr/bin/env node
// Publish whichever .vsix sits in ./extension/ that matches the version in
// extension/package.json. Marks it as `is_latest` in the releases table and
// demotes the previous latest. Idempotent — safe to re-run.
//
// Usage:
//   npm run publish:vsix                 # picks version from extension/package.json
//   npm run publish:vsix -- --notes "…"  # optional custom notes
//   npm run publish:vsix -- --version 0.9.0  # override auto-detection
//   npm run publish:vsix -- --dry-run    # show what would happen, don't write
//
// After `npm run package` (which builds extension/claude-monitor-<v>.vsix),
// running this pushes it live so the dashboard's "Download .vsix" button and
// the update banner both serve the new version.

import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

config({ path: path.join(REPO_ROOT, ".env.local") });

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : true;
}

const dryRun = arg("--dry-run") === true;
const notesOverride = typeof arg("--notes") === "string" ? arg("--notes") : null;
const versionOverride = typeof arg("--version") === "string" ? arg("--version") : null;

const pkgJson = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "extension", "package.json"), "utf-8"),
);
const version = versionOverride ?? pkgJson.version;
if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(version)) {
  console.error(`bad version "${version}" — expected semver`);
  process.exit(2);
}

const vsixPath = path.join(REPO_ROOT, "extension", `claude-monitor-${version}.vsix`);
if (!existsSync(vsixPath)) {
  console.error(`vsix not found: ${vsixPath}`);
  console.error(`run \`npm run package\` inside extension/ first.`);
  process.exit(2);
}

const bytes = readFileSync(vsixPath);
const b64 = bytes.toString("base64");
const notes =
  notesOverride ??
  `Auto-published v${version} from ${path.basename(vsixPath)} (${bytes.length} bytes)`;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set — check .env.local");
  process.exit(2);
}

const uploadedBy = process.env.USER || process.env.USERNAME || "publish-vsix-script";

console.log(`[publish-vsix] version:  ${version}`);
console.log(`[publish-vsix] file:     ${vsixPath}`);
console.log(`[publish-vsix] size:     ${bytes.length} bytes`);
console.log(`[publish-vsix] notes:    ${notes}`);
console.log(`[publish-vsix] as:       ${uploadedBy}`);
if (dryRun) {
  console.log("[publish-vsix] --dry-run set, exiting without writing.");
  process.exit(0);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();

  await client.query(
    `UPDATE "releases" SET "is_latest" = false WHERE "is_latest" = true`,
  );

  const existing = await client.query(
    `SELECT id FROM "releases" WHERE "version" = $1`,
    [version],
  );

  let created;
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE "releases"
         SET "is_latest" = true,
             "vsix_bytes" = $2,
             "size_bytes" = $3,
             "notes" = $4,
             "uploaded_at" = NOW(),
             "uploaded_by" = $5,
             "auto_update_enabled" = true
       WHERE "id" = $1`,
      [id, b64, bytes.length, notes, uploadedBy],
    );
    created = { id, version, action: "replaced" };
  } else {
    const r = await client.query(
      `INSERT INTO "releases"
         ("version","vsix_bytes","size_bytes","uploaded_by","auto_update_enabled","is_latest","notes")
       VALUES ($1,$2,$3,$4,true,true,$5)
       RETURNING id`,
      [version, b64, bytes.length, uploadedBy, notes],
    );
    created = { id: r.rows[0].id, version, action: "inserted" };
  }

  console.log(`[publish-vsix] ${created.action} row ${created.id}`);

  const all = await client.query(
    `SELECT version, size_bytes, is_latest, uploaded_at
       FROM "releases"
       ORDER BY uploaded_at DESC
       LIMIT 5`,
  );
  console.table(all.rows);

  await client.end();
})().catch(async (e) => {
  console.error("FATAL:", e);
  try { await client.end(); } catch {}
  process.exit(1);
});
