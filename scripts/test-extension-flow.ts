import { config } from "dotenv";
config({ path: ".env.local" });

import { db, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";

const TEST_EMAIL = "test-extension-flow@noop.local";
const SERVER = process.env.TEST_SERVER ?? "https://claude-code-monitor-theta.vercel.app";

async function main() {
  console.log(`[test] using server: ${SERVER}`);

  await db.delete(schema.users).where(eq(schema.users.email, TEST_EMAIL));
  await db.delete(schema.allowedEmails).where(eq(schema.allowedEmails.email, TEST_EMAIL));

  const token = "ccm_" + randomBytes(32).toString("hex");
  await db.insert(schema.allowedEmails).values({
    email: TEST_EMAIL,
    role: "member",
    addedBy: "e2e-test",
  });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: TEST_EMAIL,
      role: "member",
      apiToken: token,
      passwordHash: null,
    })
    .returning();
  console.log(`[test] created user ${user.id} with token ${token.slice(0, 12)}...`);

  for (let i = 1; i <= 3; i++) {
    console.log(`\n[test] attempt ${i}/3 — POST /api/extension/status`);
    const res = await fetch(`${SERVER}/api/extension/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        claudeRunning: i === 2,
        vscodeWindow: "test-workspace",
        hostname: `test-host-${i}`,
      }),
    });
    const body = await res.text();
    console.log(`  status: ${res.status}`);
    console.log(`  body:   ${body.slice(0, 300)}`);
    if (!res.ok) {
      console.error(`  ❌ FAILED at attempt ${i}`);
      process.exit(1);
    }
  }

  console.log("\n[test] testing /api/ingest");
  const ingest = await fetch(`${SERVER}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      event_type: "PreToolUse",
      session_id: "test-session",
      cwd: "/tmp/test",
      tool: "Read",
    }),
  });
  console.log(`  status: ${ingest.status}`);
  console.log(`  body:   ${(await ingest.text()).slice(0, 200)}`);
  if (!ingest.ok) {
    console.error("  ❌ ingest failed");
    process.exit(1);
  }

  console.log("\n[test] cleaning up test user");
  await db.delete(schema.users).where(eq(schema.users.email, TEST_EMAIL));
  await db.delete(schema.allowedEmails).where(eq(schema.allowedEmails.email, TEST_EMAIL));

  console.log("\n✓ All extension API endpoints verified.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
