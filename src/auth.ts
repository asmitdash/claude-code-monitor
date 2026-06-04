import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isAllowed, roleFor } from "@/lib/allowlist";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

function generateToken() {
  return "ccm_" + randomBytes(32).toString("hex");
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
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        if (!isAllowed(email)) return null;

        const existing = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        if (existing.length === 0) {
          const hash = await bcrypt.hash(password, 10);
          const [created] = await db
            .insert(schema.users)
            .values({
              email,
              role: roleFor(email),
              apiToken: generateToken(),
              passwordHash: hash,
            })
            .returning();
          return {
            id: created.id,
            email: created.email,
            name: created.name ?? email.split("@")[0],
          };
        }

        const user = existing[0];
        if (!user.passwordHash) {
          const hash = await bcrypt.hash(password, 10);
          await db
            .update(schema.users)
            .set({ passwordHash: hash, role: roleFor(email) })
            .where(eq(schema.users.id, user.id));
          return { id: user.id, email: user.email, name: user.name ?? email.split("@")[0] };
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        if (user.role !== roleFor(email)) {
          await db
            .update(schema.users)
            .set({ role: roleFor(email) })
            .where(eq(schema.users.id, user.id));
        }

        return { id: user.id, email: user.email, name: user.name ?? email.split("@")[0] };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, user.email.toLowerCase()))
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
