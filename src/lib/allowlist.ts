import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

const TL_EMAILS_ENV = (process.env.TL_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const MEMBER_EMAILS_ENV = (process.env.MEMBER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

let bootstrapped = false;

async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  const seed: Array<{ email: string; role: "tl" | "member" }> = [
    ...TL_EMAILS_ENV.map((email) => ({ email, role: "tl" as const })),
    ...MEMBER_EMAILS_ENV.filter((e) => e !== "placeholder").map((email) => ({
      email,
      role: "member" as const,
    })),
  ];
  for (const row of seed) {
    await db
      .insert(schema.allowedEmails)
      .values({ email: row.email, role: row.role, addedBy: "env-bootstrap" })
      .onConflictDoNothing();
  }
}

export async function isAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const norm = email.toLowerCase();
  if (TL_EMAILS_ENV.includes(norm)) return true;
  await bootstrap();
  const row = await db
    .select()
    .from(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, norm))
    .limit(1);
  return row.length > 0;
}

export async function roleFor(email: string | null | undefined): Promise<"tl" | "member"> {
  if (!email) return "member";
  const norm = email.toLowerCase();
  if (TL_EMAILS_ENV.includes(norm)) return "tl";
  await bootstrap();
  const row = await db
    .select()
    .from(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, norm))
    .limit(1);
  return (row[0]?.role as "tl" | "member" | undefined) ?? "member";
}

export async function listMembers() {
  await bootstrap();
  return db.select().from(schema.allowedEmails).orderBy(schema.allowedEmails.role, schema.allowedEmails.email);
}

export async function addMember(email: string, role: "tl" | "member", addedBy: string) {
  const norm = email.toLowerCase().trim();
  await db
    .insert(schema.allowedEmails)
    .values({ email: norm, role, addedBy })
    .onConflictDoUpdate({
      target: schema.allowedEmails.email,
      set: { role, addedBy },
    });
}

export async function removeMember(email: string) {
  const norm = email.toLowerCase().trim();
  if (TL_EMAILS_ENV.includes(norm)) {
    throw new Error("cannot remove env-bootstrapped TL");
  }
  await db.delete(schema.allowedEmails).where(eq(schema.allowedEmails.email, norm));
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, norm))
    .limit(1);
  if (user[0]) {
    await db.delete(schema.users).where(eq(schema.users.email, norm));
  }
}
