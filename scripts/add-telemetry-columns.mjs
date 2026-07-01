// Manual migration for the telemetry pack — sidesteps drizzle-kit's
// interactive prompt on the unrelated `releases` table.
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.local' });
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const statements = [
  `ALTER TABLE slots ADD COLUMN IF NOT EXISTS first_tool_at_ms integer`,
  `ALTER TABLE slots ADD COLUMN IF NOT EXISTS idle_warn_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE slots ADD COLUMN IF NOT EXISTS outcome_tag text`,
  `ALTER TABLE slots ADD COLUMN IF NOT EXISTS outcome_note text`,
  `ALTER TABLE slots ADD COLUMN IF NOT EXISTS outcome_tagged_at timestamptz`,
  `ALTER TABLE slots ADD COLUMN IF NOT EXISTS project_name text`,
];

for (const s of statements) {
  console.log('running:', s.slice(0, 80));
  await client.query(s);
}
console.log('done');
await client.end();
