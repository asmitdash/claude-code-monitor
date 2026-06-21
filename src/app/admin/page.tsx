import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { AdminClient } from "./client";

export default async function AdminPage() {
  const session = await auth();
  const me = session?.user as { id?: string; role?: string } | undefined;
  if (!me?.id) redirect("/login");
  if (me.role !== "admin") redirect("/dashboard");

  const u = await db.select().from(schema.users).where(eq(schema.users.id, me.id)).limit(1);
  if (!u[0]) redirect("/login");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            Claude Code Monitor
            <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-normal">
              Admin
            </span>
          </h1>
          <p className="text-xs text-neutral-500">{u[0].email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="text-xs text-neutral-400 hover:text-neutral-200">
            Sign out
          </button>
        </form>
      </header>
      <AdminClient apiToken={u[0].apiToken} />
    </div>
  );
}
