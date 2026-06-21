#!/usr/bin/env node
// One-shot migration runner with explicit pre/post row-count audit so we can
// PROVE no rows were lost and the role rename worked. Uses the same pg
// connection string the rest of the app uses (DATABASE_URL).
import { config } from "dotenv";
import { readFileSync } from "fs";
import { Client } from "pg";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const TABLES = [
  "users",
  "slots",
  "queue",
  "events",
  "presence",
  "kill_flags",
  "allowed_emails",
  "approvals",
  "audit_log",
  "restrictions",
  "quota_config",
  "broadcasts",
  "webhooks",
  "grants",
];

async function counts(client) {
  const out = {};
  for (const t of TABLES) {
    try {
      const r = await client.query(`SELECT count(*)::int AS c FROM "${t}"`);
      out[t] = r.rows[0].c;
    } catch (e) {
      out[t] = `ERR:${(e.message || "").split("\n")[0]}`;
    }
  }
  return out;
}

async function roleBreakdown(client) {
  try {
    const r = await client.query(
      `SELECT role::text AS role, count(*)::int AS c FROM "users" GROUP BY role ORDER BY role`,
    );
    return r.rows;
  } catch (e) {
    return [{ error: (e.message || "").split("\n")[0] }];
  }
}

async function enumLabels(client) {
  const r = await client.query(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role'
    ORDER BY e.enumsortorder
  `);
  return r.rows.map((r) => r.enumlabel);
}

async function newTablesExist(client) {
  const r = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('invites','file_commands','file_snapshots','releases')
    ORDER BY tablename
  `);
  return r.rows.map((r) => r.tablename);
}

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("usage: apply-migration.mjs <path-to-sql>");
  process.exit(2);
}
const sql = readFileSync(sqlPath, "utf-8");

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();
  console.log("=== PRE-FLIGHT ===");
  const before = await counts(client);
  const roleBefore = await roleBreakdown(client);
  const enumBefore = await enumLabels(client);
  const newTablesBefore = await newTablesExist(client);
  console.log("row counts:", before);
  console.log("users by role:", roleBefore);
  console.log("role enum labels:", enumBefore);
  console.log("new tables already present:", newTablesBefore);

  console.log("\n=== APPLYING MIGRATION ===");
  // Strip drizzle's --> statement-breakpoint markers and run the SQL whole;
  // pg accepts multiple statements per query call.
  const cleaned = sql.replace(/-->\s*statement-breakpoint/g, "");
  await client.query(cleaned);
  console.log("migration applied");

  console.log("\n=== POST-FLIGHT ===");
  const after = await counts(client);
  const roleAfter = await roleBreakdown(client);
  const enumAfter = await enumLabels(client);
  const newTablesAfter = await newTablesExist(client);
  console.log("row counts:", after);
  console.log("users by role:", roleAfter);
  console.log("role enum labels:", enumAfter);
  console.log("new tables present:", newTablesAfter);

  console.log("\n=== AUDIT ===");
  let dataLossDetected = false;
  for (const t of TABLES) {
    const b = before[t];
    const a = after[t];
    if (typeof b === "number" && typeof a === "number") {
      if (a < b) {
        console.error(`!! DATA LOSS: ${t} went from ${b} to ${a}`);
        dataLossDetected = true;
      } else if (a !== b) {
        console.log(`note: ${t} changed ${b} -> ${a} (likely audit_log added a row)`);
      }
    }
  }
  if (!enumAfter.includes("admin")) {
    console.error("!! enum 'admin' label missing after migration");
    process.exit(1);
  }
  if (enumAfter.includes("tl")) {
    console.error("!! enum 'tl' label still present — rename did not run");
    process.exit(1);
  }
  for (const need of ["invites", "file_commands", "file_snapshots", "releases"]) {
    if (!newTablesAfter.includes(need)) {
      console.error(`!! table missing after migration: ${need}`);
      process.exit(1);
    }
  }
  if (dataLossDetected) {
    console.error("!! data loss detected — investigate before deploying");
    process.exit(1);
  }
  console.log("OK — no data loss, role enum has admin, all 4 new tables present.");
  await client.end();
})().catch(async (e) => {
  console.error("FATAL:", e);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
