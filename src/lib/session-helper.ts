import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export type SessionActor = {
  id: string;
  email: string;
  role: "admin" | "member";
  name: string | null;
  isImpersonating: boolean;
  realActorId: string;
  realActorEmail: string;
  realActorRole: "admin" | "member";
};

const IMPERSONATE_COOKIE = "ccm_impersonate";

export async function getActor(): Promise<SessionActor | null> {
  const sess = await auth();
  const me = sess?.user as { id?: string; email?: string; role?: string; name?: string | null } | undefined;
  if (!me?.id || !me.email) return null;
  const realRole = (me.role === "admin" ? "admin" : "member") as "admin" | "member";

  let impersonating: SessionActor | null = null;
  if (realRole === "admin") {
    const c = (await cookies()).get(IMPERSONATE_COOKIE)?.value;
    if (c) {
      const target = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, c))
        .limit(1);
      if (target[0]) {
        impersonating = {
          id: target[0].id,
          email: target[0].email,
          name: target[0].name,
          role: target[0].role,
          isImpersonating: true,
          realActorId: me.id,
          realActorEmail: me.email,
          realActorRole: realRole,
        };
      }
    }
  }

  if (impersonating) return impersonating;

  return {
    id: me.id,
    email: me.email,
    role: realRole,
    name: me.name ?? null,
    isImpersonating: false,
    realActorId: me.id,
    realActorEmail: me.email,
    realActorRole: realRole,
  };
}

export async function requireAdmin() {
  const a = await getActor();
  if (!a) return null;
  if (a.realActorRole !== "admin") return null;
  return a;
}

// Backwards-compat alias for any caller still using the old name. Prefer
// requireAdmin in new code; this alias will be removed once all callers migrate.
export const requireTL = requireAdmin;

export async function requireUser() {
  return getActor();
}

export const IMPERSONATE_COOKIE_NAME = IMPERSONATE_COOKIE;
