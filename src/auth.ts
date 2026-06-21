import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";
import { isAllowed, roleFor } from "@/lib/allowlist";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

function generateToken() {
  return "ccm_" + randomBytes(32).toString("hex");
}

const ADMIN_EMAILS_ENV = (process.env.ADMIN_EMAILS || process.env.TL_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Returns the invite row if the token is currently valid for the given email,
// otherwise null. Email match is case-insensitive.
async function validInviteFor(token: string, email: string) {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.token, token))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.consumedAt) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  if (row.email.toLowerCase() !== email.toLowerCase()) return null;
  return row;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "Email + password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        inviteToken: { label: "Invite token", type: "text" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        const inviteToken = String(credentials?.inviteToken ?? "").trim();
        if (!email || !password) return null;

        const existing = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        // Existing user — invite is not needed; standard password login.
        if (existing.length > 0) {
          const user = existing[0];
          // Existing users still need to be on the allowlist. This is the same
          // gate the original flow used; without it a removed teammate could
          // still log in with their old password.
          if (!(await isAllowed(email))) return null;

          if (!user.passwordHash) {
            const hash = await bcrypt.hash(password, 10);
            const role = await roleFor(email);
            await db
              .update(schema.users)
              .set({ passwordHash: hash, role })
              .where(eq(schema.users.id, user.id));
            return { id: user.id, email: user.email, name: user.name ?? email.split("@")[0] };
          }
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) return null;

          const role = await roleFor(email);
          if (user.role !== role) {
            await db
              .update(schema.users)
              .set({ role })
              .where(eq(schema.users.id, user.id));
          }
          return { id: user.id, email: user.email, name: user.name ?? email.split("@")[0] };
        }

        // No existing user — sign-up path. Three accepted cases:
        // 1. Bootstrap: users table empty AND email is in ADMIN_EMAILS_ENV.
        //    First-ever admin gets in without an invite.
        // 2. Valid invite token for this email.
        // 3. (legacy) Email is already in the env-bootstrapped allowedEmails table
        //    AND the original allowlist returns true. Kept so existing teammates
        //    pre-MEMBER_EMAILS-removal can still create their account on first
        //    sign-in. New deployments should rely on invites instead.
        const userCountRow = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.users);
        const userCount = Number(userCountRow[0]?.count ?? 0);

        let role: "admin" | "member" | null = null;
        let inviteRow: Awaited<ReturnType<typeof validInviteFor>> = null;

        if (userCount === 0 && ADMIN_EMAILS_ENV.includes(email)) {
          role = "admin";
        } else if (inviteToken) {
          inviteRow = await validInviteFor(inviteToken, email);
          if (inviteRow) {
            role = inviteRow.role;
          }
        }

        if (!role && (await isAllowed(email))) {
          // Legacy allowlist fallback — keep working for already-bootstrapped
          // teammates until invites fully replace MEMBER_EMAILS.
          role = await roleFor(email);
        }

        if (!role) return null;

        const hash = await bcrypt.hash(password, 10);
        const [created] = await db
          .insert(schema.users)
          .values({
            email,
            role,
            apiToken: generateToken(),
            passwordHash: hash,
          })
          .returning();

        if (inviteRow) {
          await db
            .update(schema.invites)
            .set({ consumedAt: new Date(), consumedByUserId: created.id })
            .where(eq(schema.invites.id, inviteRow.id));
        }

        return {
          id: created.id,
          email: created.email,
          name: created.name ?? email.split("@")[0],
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email) as string | undefined;
      if (email) {
        const dbUser = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email.toLowerCase()))
          .limit(1);
        if (dbUser[0]) {
          token.userId = dbUser[0].id;
          token.role = dbUser[0].role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string }).id = token.userId as string;
        (session.user as { id?: string; role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});
