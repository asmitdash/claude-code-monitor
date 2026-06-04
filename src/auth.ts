import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isAllowed, roleFor } from "@/lib/allowlist";
import { randomBytes } from "crypto";

function generateToken() {
  return "ccm_" + randomBytes(32).toString("hex");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!isAllowed(email)) return false;

      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email!))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(schema.users).values({
          email: email!,
          name: user.name ?? null,
          image: user.image ?? null,
          role: roleFor(email),
          apiToken: generateToken(),
        });
      } else {
        await db
          .update(schema.users)
          .set({
            name: user.name ?? existing[0].name,
            image: user.image ?? existing[0].image,
            role: roleFor(email),
          })
          .where(eq(schema.users.email, email!));
      }

      return true;
    },
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
