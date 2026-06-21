#!/usr/bin/env node
// Pre-load the current .vsix into the releases table so v0.3.0 is available
// the moment the dashboard goes live, and any teammate already on v0.2.0 will
// get the update prompt within ~5min of the extension talking to prod.
import { config } from "dotenv";
import { readFileSync } from "fs";
import { Client } from "pg";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
const vsixPath = process.argv[2];
const version = process.argv[3];
const uploadedBy = process.argv[4] || "system";
if (!url || !vsixPath || !version) {
  console.error("usage: seed-release.mjs <vsix-path> <version> [uploadedBy]");
  process.exit(2);
}

const bytes = readFileSync(vsixPath);
const b64 = bytes.toString("base64");

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();

  // Demote any existing latest.
  await client.query(`UPDATE "releases" SET "is_latest" = false WHERE "is_latest" = true`);

  // Skip if this exact version already exists (idempotent on re-run).
  const existing = await client.query(
    `SELECT id FROM "releases" WHERE "version" = $1`,
    [version],
  );
  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE "releases" SET "is_latest" = true WHERE "id" = $1`,
      [existing.rows[0].id],
    );
    console.log(`v${version} already in releases — re-marked as latest`);
  } else {
    await client.query(
      `INSERT INTO "releases" ("version","vsix_bytes","size_bytes","uploaded_by","auto_update_enabled","is_latest","notes")
       VALUES ($1,$2,$3,$4,true,true,$5)`,
      [
        version,
        b64,
        bytes.length,
        uploadedBy,
        "Initial publish — bypass + admin file access + invite-only signup + self-update",
      ],
    );
    console.log(`v${version} inserted (${bytes.length} bytes)`);
  }

  const all = await client.query(
    `SELECT version, size_bytes, is_latest, auto_update_enabled FROM "releases" ORDER BY uploaded_at DESC`,
  );
  console.log("releases now:", all.rows);

  await client.end();
})().catch(async (e) => {
  console.error("FATAL:", e);
  try { await client.end(); } catch {}
  process.exit(1);
});
