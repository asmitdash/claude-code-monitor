import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
config({ path: ".env.local" });

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, "..", "drizzle", "0001_two_slot_redesign.sql");
const sql = readFileSync(file, "utf8");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const stmts = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
console.log(`Running ${stmts.length} statements from ${file}`);
let ok = 0, fail = 0;
for (const s of stmts) {
  try {
    await pool.query(s);
    ok++;
  } catch (e) {
    fail++;
    console.error("FAIL:", e.message, "\nSQL preview:", s.slice(0, 220));
  }
}
console.log(`OK: ${ok}, FAIL: ${fail}`);
await pool.end();
